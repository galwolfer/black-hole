import { describe, expect, it } from 'vitest';
import { GestureEngine } from '../src/gesture/engine';
import type { Point, RawHand } from '../src/gesture/types';
import {
  INDEX_MCP, INDEX_TIP, MIDDLE_MCP, MIDDLE_TIP, PINKY_MCP, PINKY_TIP,
  RING_MCP, RING_TIP, THUMB_TIP, WRIST,
} from '../src/gesture/metrics';

const FRAME_MS = 1000 / 30;

/**
 * Build a synthetic hand landmark array.
 *
 * Fixture geometry notes (all values verified by printing metrics):
 *   open:  pinchRatio≈0.72, curl≈2.0  — well above thresholds
 *   pinch: pinchRatio=0 (tips touching), curl≈2.0 — well below engage
 *   fist:  curl≈0.39, pinchRatio≈1.08 — thumb/index kept far apart so
 *          pinchRatio stays above releaseRatio=0.6 (no spurious pinch)
 *
 * The One Euro filter smooths transitions, so tests use enough frames
 * for the filtered metric to cross each FSM threshold:
 *   pinch engage: need ≥2 consecutive filtered frames below 0.4
 *   pinch release: need filtered ratio > 0.6
 *   grab engage:  need ≥2 consecutive filtered frames below 1.1
 */
function makeHand(center: Point, options: { pinching?: boolean; fist?: boolean } = {}): RawHand {
  const landmarks: Point[] = Array.from({ length: 21 }, () => ({ ...center }));
  const offset = (dx: number, dy: number): Point => ({ x: center.x + dx, y: center.y + dy });
  landmarks[WRIST] = offset(0, 0.15);
  landmarks[INDEX_MCP] = offset(-0.05, 0);
  landmarks[MIDDLE_MCP] = offset(0, 0);
  landmarks[RING_MCP] = offset(0.04, 0);
  landmarks[PINKY_MCP] = offset(0.08, 0.01);
  if (options.fist) {
    // Middle/ring/pinky curled back (close to wrist) → curl≈0.39 < engageCurl=1.1
    landmarks[MIDDLE_TIP] = offset(0, 0.1);
    landmarks[RING_TIP] = offset(0.03, 0.1);
    landmarks[PINKY_TIP] = offset(0.06, 0.11);
    // Thumb and index kept APART (pinchRatio≈1.08) so the pinch FSM never fires
    landmarks[THUMB_TIP] = offset(-0.1, 0.05);
    landmarks[INDEX_TIP] = offset(0.04, 0.07);
  } else {
    landmarks[MIDDLE_TIP] = offset(0, -0.18);
    landmarks[RING_TIP] = offset(0.05, -0.16);
    landmarks[PINKY_TIP] = offset(0.09, -0.12);
    if (options.pinching) {
      // Tips touching → pinchRatio=0, well below engageRatio=0.4
      landmarks[THUMB_TIP] = offset(-0.045, -0.14);
      landmarks[INDEX_TIP] = offset(-0.045, -0.14);
    } else {
      landmarks[THUMB_TIP] = offset(-0.1, -0.08);
      landmarks[INDEX_TIP] = offset(-0.05, -0.16);
    }
  }
  return { landmarks, handedness: 'Right' };
}

function run(engine: GestureEngine, frames: RawHand[][], startFrame = 0) {
  const allEvents: { type: string; [k: string]: unknown }[] = [];
  let hands;
  for (let i = 0; i < frames.length; i += 1) {
    const result = engine.update(frames[i], (startFrame + i) * FRAME_MS);
    allEvents.push(...result.events);
    hands = result.hands;
  }
  return { events: allEvents, hands };
}

describe('GestureEngine', () => {
  it('emits pinchStart once for a held pinch, then pinchEnd on release', () => {
    const engine = new GestureEngine();
    const c = { x: 0.5, y: 0.5 };
    const open = makeHand(c);
    const pinch = makeHand(c, { pinching: true });
    // Need enough frames for One Euro filter to let filtered ratio cross thresholds:
    //   4 open warm-up → filter settled at raw≈0.72
    //   6 pinch frames → filtered ratio drops below engageRatio=0.4 by frame 5-6
    //   6 open frames  → filtered ratio rises above releaseRatio=0.6 by frame 4-5
    const frames: RawHand[][] = [
      [open], [open], [open], [open],
      [pinch], [pinch], [pinch], [pinch], [pinch], [pinch],
      [open], [open], [open], [open], [open], [open],
    ];
    const { events } = run(engine, frames);
    const types = events.map((event) => event.type);
    expect(types.filter((t) => t === 'pinchStart')).toHaveLength(1);
    expect(types.filter((t) => t === 'pinchEnd')).toHaveLength(1);
  });

  it('a fist emits grabStart (after pinch refractory is irrelevant here)', () => {
    const engine = new GestureEngine();
    const c = { x: 0.5, y: 0.5 };
    const open = makeHand(c);
    const fist = makeHand(c, { fist: true });
    // 2 open warm-up + 7 fist frames: filter needs ~5 fist frames to bring
    // curl below engageCurl=1.1 (curl raw≈0.39, filtered starts at 2.0)
    const frames: RawHand[][] = [
      [open], [open],
      [fist], [fist], [fist], [fist], [fist], [fist], [fist],
    ];
    const { events } = run(engine, frames);
    expect(events.map((event) => event.type)).toContain('grabStart');
  });

  it('pinching does NOT emit grabStart (curl stays high)', () => {
    const engine = new GestureEngine();
    const c = { x: 0.5, y: 0.5 };
    const open = makeHand(c);
    const pinch = makeHand(c, { pinching: true });
    // Pinch has curl≈2.0 (only thumb+index close, middle/ring/pinky extended)
    // → curl always above engageCurl=1.1, so grab FSM never engages
    const frames: RawHand[][] = [
      [open], [open],
      [pinch], [pinch], [pinch], [pinch], [pinch], [pinch],
    ];
    const { events } = run(engine, frames);
    expect(events.map((event) => event.type)).not.toContain('grabStart');
  });

  it('keeps hand ids stable when the input order swaps', () => {
    const engine = new GestureEngine();
    const left = makeHand({ x: 0.25, y: 0.5 });
    const right = makeHand({ x: 0.75, y: 0.5 });
    const frame1 = engine.update([left, right], 0);
    const frame2 = engine.update([right, left], FRAME_MS);
    expect(frame2.hands[0].id).toBe(frame1.hands[1].id);
    expect(frame2.hands[1].id).toBe(frame1.hands[0].id);
  });

  it('emits handLost when a hand disappears past the TTL', () => {
    const engine = new GestureEngine();
    const open = makeHand({ x: 0.5, y: 0.5 });
    engine.update([open], 0);
    engine.update([], 100);
    const late = engine.update([], 400);
    expect(late.events.map((event) => event.type)).toContain('handLost');
  });

  it('grabEnd carries release velocity from the motion tracker', () => {
    const engine = new GestureEngine();
    const frames: RawHand[][] = [];
    // 2 open warm-up frames
    frames.push([makeHand({ x: 0.2, y: 0.5 })]);
    frames.push([makeHand({ x: 0.2, y: 0.5 })]);
    // Fist sweeping right fast (step=0.06/frame ≈ 1.8 norm/s), 8 fist frames.
    // Grab fires at frame ~8 (filter warms up after ~5-6 fist frames).
    for (let i = 0; i < 8; i += 1) {
      frames.push([makeHand({ x: 0.2 + i * 0.06, y: 0.5 }, { fist: true })]);
    }
    // 3 open frames to release (filter raises curl above releaseCurl=1.3 by frame 3)
    frames.push([makeHand({ x: 0.7, y: 0.5 })]);
    frames.push([makeHand({ x: 0.7, y: 0.5 })]);
    frames.push([makeHand({ x: 0.7, y: 0.5 })]);
    const { events } = run(engine, frames);
    const grabEnd = events.find((event) => event.type === 'grabEnd');
    expect(grabEnd).toBeDefined();
    if (grabEnd && grabEnd.type === 'grabEnd') {
      expect(grabEnd.peakSpeed).toBeGreaterThan(1);
      expect(grabEnd.releaseVelocity.x).toBeGreaterThan(0);
    }
  });

  it('a fast horizontal open-hand sweep emits exactly one slash (cooldown)', () => {
    const engine = new GestureEngine();
    const frames: RawHand[][] = [];
    // Step=0.12 per 33ms ≈ 3.6 norm/s. Regression velocity hits >2.0 by frame 6.
    // minFrames=3 consecutive qualifying frames needed → slash fires around frame 8.
    for (let i = 0; i < 9; i += 1) {
      frames.push([makeHand({ x: 0.05 + i * 0.12, y: 0.5 })]);
    }
    const { events } = run(engine, frames);
    expect(events.filter((event) => event.type === 'slash')).toHaveLength(1);
  });

  it('a slow open-hand drift emits no slash', () => {
    const engine = new GestureEngine();
    const frames: RawHand[][] = [];
    for (let i = 0; i < 12; i += 1) {
      frames.push([makeHand({ x: 0.3 + i * 0.01, y: 0.5 })]);
    }
    const { events } = run(engine, frames);
    expect(events.filter((event) => event.type === 'slash')).toHaveLength(0);
  });

  it('a fist right after a pinch ends cannot grab until the refractory expires', () => {
    // End-to-end coverage of the engine's post-pinch refractory wiring:
    // the engine records lastPinchEndMs on pinchEnd and feeds it (plus
    // pinchActive) into updateGrab. This test would FAIL if that guard were
    // removed, because a real pinch release leaves the curl ALREADY below
    // engageCurl=1.1 (the fingers are uncurling from the pinch pose) — only
    // the 250ms refractory keeps a grab from firing immediately.
    const engine = new GestureEngine();
    const c = { x: 0.5, y: 0.5 };
    const open = makeHand(c);
    const pinch = makeHand(c, { pinching: true });
    const fist = makeHand(c, { fist: true });

    // 4 open warm-up + 6 pinch frames → pinchStart fires; pinch held.
    // Then feed fist frames directly (no open gap), so the curl coming out of
    // the pinch drops below engageCurl almost immediately. Verified timings:
    //   pinchEnd fires at frame 12 (now=400, curl≈1.106)
    //   curl stays below 1.1 from frame 13 onward (0.935, 0.804, 0.705, ...)
    //   grabStart fires only at frame 21 (now=700) — i.e. exactly when
    //   now-lastPinchEndMs crosses 250ms (300ms ≥ 250ms).
    const seq: RawHand[] = [
      open, open, open, open,
      pinch, pinch, pinch, pinch, pinch, pinch,
      ...Array.from({ length: 20 }, () => fist),
    ];

    let pinchEndMs = -1;
    let firstGrabStartMs = -1;
    let grabStartWithinRefractory = false;
    for (let i = 0; i < seq.length; i += 1) {
      const now = i * FRAME_MS;
      const result = engine.update([seq[i]], now);
      for (const event of result.events) {
        if (event.type === 'pinchEnd') {
          pinchEndMs = now;
        }
        if (event.type === 'grabStart') {
          if (firstGrabStartMs < 0) {
            firstGrabStartMs = now;
          }
          // A grabStart while still inside the 250ms refractory is the failure
          // the guard exists to prevent.
          if (pinchEndMs >= 0 && now - pinchEndMs < 250) {
            grabStartWithinRefractory = true;
          }
        }
      }
    }

    // Sanity: the scenario actually exercised a pinch release.
    expect(pinchEndMs).toBeGreaterThanOrEqual(0);
    // The guard held: no grab during the refractory window...
    expect(grabStartWithinRefractory).toBe(false);
    // ...but a grab DID eventually fire once the refractory expired.
    expect(firstGrabStartMs).toBeGreaterThanOrEqual(0);
    expect(firstGrabStartMs - pinchEndMs).toBeGreaterThanOrEqual(250);
  });
});
