import { GESTURE_CONFIG } from './config';
import { HandRegistry } from './handRegistry';
import {
  fingerCurl, knuckleSpan, palmCenter, pinchMidpoint, pinchRatio,
} from './metrics';
import { MotionTracker } from './motion';
import { OneEuroFilter, PointFilter } from './oneEuro';
import { createGrabFsm, updateGrab, type GrabFsm } from './grab';
import { createPinchFsm, updatePinch, type PinchFsm } from './pinch';
import type { GestureEvent, Point, RawHand, TrackedHand } from './types';

type HandState = {
  filters: PointFilter[];
  pinchFsm: PinchFsm;
  grabFsm: GrabFsm;
  motion: MotionTracker;
  lastPinchEndMs: number;
  slashFrames: number;
  slashCooldownUntilMs: number;
  slashStart: Point | null;
};

function createHandState(): HandState {
  return {
    filters: Array.from({ length: 21 }, () => new PointFilter()),
    pinchFsm: createPinchFsm(),
    grabFsm: createGrabFsm(),
    motion: new MotionTracker(),
    lastPinchEndMs: -100000,
    slashFrames: 0,
    slashCooldownUntilMs: 0,
    slashStart: null,
  };
}

/**
 * Per-frame pipeline: raw mirrored landmarks → identity assignment →
 * One Euro smoothing → metrics → FSM updates → typed gesture events.
 * Pure with respect to the DOM and MediaPipe; fully unit-testable.
 */
export class GestureEngine {
  private readonly registry = new HandRegistry();
  private readonly states = new Map<number, HandState>();

  reset(): void {
    this.states.clear();
  }

  update(rawHands: RawHand[], nowMs: number): { hands: TrackedHand[]; events: GestureEvent[] } {
    const events: GestureEvent[] = [];

    const { ids, lostIds } = this.registry.assign(
      rawHands.map((hand) => ({ palm: palmCenter(hand.landmarks), handedness: hand.handedness })),
      nowMs,
    );

    for (const lostId of lostIds) {
      this.states.delete(lostId);
      events.push({ type: 'handLost', handId: lostId });
    }

    const hands: TrackedHand[] = rawHands.map((raw, index) => {
      const id = ids[index];
      let state = this.states.get(id);
      if (!state) {
        state = createHandState();
        this.states.set(id, state);
      }

      const landmarks = raw.landmarks.map((point, landmarkIndex) =>
        state!.filters[landmarkIndex].filter(point, nowMs),
      );

      const palm = palmCenter(landmarks);
      const span = knuckleSpan(landmarks);
      const ratio = pinchRatio(landmarks);
      const curl = fingerCurl(landmarks);
      const pinchPoint = pinchMidpoint(landmarks);

      state.motion.push(palm, nowMs);
      state.motion.recordSpeed(nowMs);
      const velocity = state.motion.velocity();
      const speed = Math.hypot(velocity.x, velocity.y);

      const pinchUpdate = updatePinch(state.pinchFsm, ratio);
      state.pinchFsm = pinchUpdate.fsm;
      if (pinchUpdate.started) {
        events.push({ type: 'pinchStart', handId: id, point: pinchPoint, span });
      }
      if (pinchUpdate.ended) {
        state.lastPinchEndMs = nowMs;
        events.push({ type: 'pinchEnd', handId: id });
      }

      const grabUpdate = updateGrab(
        state.grabFsm,
        curl,
        nowMs,
        state.pinchFsm.phase !== 'idle',
        state.lastPinchEndMs,
      );
      state.grabFsm = grabUpdate.fsm;
      if (grabUpdate.started) {
        events.push({ type: 'grabStart', handId: id, point: palm });
      }
      if (grabUpdate.ended) {
        events.push({
          type: 'grabEnd',
          handId: id,
          releaseVelocity: velocity,
          peakSpeed: state.motion.peakSpeed(GESTURE_CONFIG.flick.peakWindowMs, nowMs),
        });
      }

      // Slash: sustained fast, mostly-horizontal, open-hand motion.
      const { minSpeed, horizontalRatio, minFrames, cooldownMs } = GESTURE_CONFIG.slash;
      const handOpen = state.pinchFsm.phase === 'idle' && state.grabFsm.phase === 'idle';
      const qualifies =
        handOpen
        && speed > minSpeed
        && Math.abs(velocity.x) > Math.abs(velocity.y) * horizontalRatio
        && nowMs >= state.slashCooldownUntilMs;
      if (qualifies) {
        if (state.slashFrames === 0) {
          state.slashStart = palm;
        }
        state.slashFrames += 1;
        if (state.slashFrames >= minFrames && state.slashStart) {
          events.push({ type: 'slash', handId: id, from: state.slashStart, to: palm });
          state.slashFrames = 0;
          state.slashStart = null;
          state.slashCooldownUntilMs = nowMs + cooldownMs;
        }
      } else {
        state.slashFrames = 0;
        state.slashStart = null;
      }

      return {
        id,
        handedness: raw.handedness,
        landmarks,
        palm,
        pinchPoint,
        knuckleSpan: span,
        pinchRatio: ratio,
        curl,
        pinchPhase: state.pinchFsm.phase,
        grabPhase: state.grabFsm.phase,
        velocity,
        speed,
      };
    });

    return { hands, events };
  }
}
