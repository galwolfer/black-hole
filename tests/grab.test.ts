import { describe, expect, it } from 'vitest';
import { createGrabFsm, updateGrab } from '../src/gesture/grab';

// Config: engage < 1.1, release > 1.3, debounceFrames = 2, refractory 250ms.
type Frame = { curl: number; now: number; pinchActive?: boolean; lastPinchEndMs?: number };

function feed(frames: Frame[]) {
  let fsm = createGrabFsm();
  const events: string[] = [];
  for (const frame of frames) {
    const result = updateGrab(
      fsm,
      frame.curl,
      frame.now,
      frame.pinchActive ?? false,
      frame.lastPinchEndMs ?? -10000,
    );
    fsm = result.fsm;
    if (result.started) events.push('start');
    if (result.ended) events.push('end');
  }
  return { fsm, events };
}

describe('grab FSM', () => {
  it('starts after two consecutive curled frames', () => {
    expect(feed([{ curl: 0.8, now: 0 }]).events).toEqual([]);
    expect(feed([{ curl: 0.8, now: 0 }, { curl: 0.8, now: 33 }]).events).toEqual(['start']);
  });

  it('ends only above the release threshold', () => {
    const { events } = feed([
      { curl: 0.8, now: 0 },
      { curl: 0.8, now: 33 },
      { curl: 1.2, now: 66 }, // in the hysteresis band: still grabbing
      { curl: 1.4, now: 99 }, // released
    ]);
    expect(events).toEqual(['start', 'end']);
  });

  it('never engages while a pinch is active', () => {
    const { events } = feed([
      { curl: 0.8, now: 0, pinchActive: true },
      { curl: 0.8, now: 33, pinchActive: true },
      { curl: 0.8, now: 66, pinchActive: true },
    ]);
    expect(events).toEqual([]);
  });

  it('never engages during the post-pinch refractory period', () => {
    const { events } = feed([
      { curl: 0.8, now: 100, lastPinchEndMs: 50 },
      { curl: 0.8, now: 133, lastPinchEndMs: 50 },
    ]);
    expect(events).toEqual([]); // only 83ms since pinch end < 250ms
  });

  it('engages normally after the refractory period expires', () => {
    const { events } = feed([
      { curl: 0.8, now: 400, lastPinchEndMs: 50 },
      { curl: 0.8, now: 433, lastPinchEndMs: 50 },
    ]);
    expect(events).toEqual(['start']);
  });

  it('an active grab is not cancelled by refractory rules', () => {
    const { fsm } = feed([
      { curl: 0.8, now: 0 },
      { curl: 0.8, now: 33 },
      { curl: 0.8, now: 66, pinchActive: true }, // weird pose mid-grab
    ]);
    expect(fsm.phase).toBe('grabbing');
  });
});
