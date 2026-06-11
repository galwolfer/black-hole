import { GESTURE_CONFIG } from './config';
import type { GrabPhase } from './types';

export type GrabFsm = {
  phase: GrabPhase;
  engageFrames: number;
};

export type GrabUpdate = {
  fsm: GrabFsm;
  started: boolean;
  ended: boolean;
};

export function createGrabFsm(): GrabFsm {
  return { phase: 'idle', engageFrames: 0 };
}

/**
 * Fist detection on the middle/ring/pinky curl metric. Engagement is blocked
 * while a pinch is active and for postPinchRefractoryMs after it ends, so a
 * pinch can never bleed into a grab. An already-active grab is unaffected.
 */
export function updateGrab(
  fsm: GrabFsm,
  curl: number,
  nowMs: number,
  pinchActive: boolean,
  lastPinchEndMs: number,
): GrabUpdate {
  const { engageCurl, releaseCurl, debounceFrames, postPinchRefractoryMs } = GESTURE_CONFIG.grab;
  const engageBlocked = pinchActive || nowMs - lastPinchEndMs < postPinchRefractoryMs;

  switch (fsm.phase) {
    case 'idle': {
      if (curl < engageCurl && !engageBlocked) {
        if (debounceFrames <= 1) {
          return { fsm: { phase: 'grabbing', engageFrames: 0 }, started: true, ended: false };
        }
        return { fsm: { phase: 'engaging', engageFrames: 1 }, started: false, ended: false };
      }
      return { fsm, started: false, ended: false };
    }
    case 'engaging': {
      if (curl < engageCurl && !engageBlocked) {
        const frames = fsm.engageFrames + 1;
        if (frames >= debounceFrames) {
          return { fsm: { phase: 'grabbing', engageFrames: 0 }, started: true, ended: false };
        }
        return { fsm: { phase: 'engaging', engageFrames: frames }, started: false, ended: false };
      }
      return { fsm: { phase: 'idle', engageFrames: 0 }, started: false, ended: false };
    }
    case 'grabbing': {
      if (curl > releaseCurl) {
        return { fsm: { phase: 'idle', engageFrames: 0 }, started: false, ended: true };
      }
      return { fsm, started: false, ended: false };
    }
  }
}
