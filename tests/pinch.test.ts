import { describe, expect, it } from 'vitest';
import { createPinchFsm, updatePinch } from '../src/gesture/pinch';

// Config: engage < 0.4, release > 0.6, debounceFrames = 2.
function feed(ratios: number[]) {
  let fsm = createPinchFsm();
  const events: string[] = [];
  for (const ratio of ratios) {
    const result = updatePinch(fsm, ratio);
    fsm = result.fsm;
    if (result.started) events.push('start');
    if (result.ended) events.push('end');
  }
  return { fsm, events };
}

describe('pinch FSM', () => {
  it('starts only after debounceFrames consecutive frames below engage', () => {
    expect(feed([0.3]).events).toEqual([]);
    expect(feed([0.3, 0.3]).events).toEqual(['start']);
  });

  it('a single noisy frame cannot start a pinch', () => {
    expect(feed([0.3, 0.5, 0.3, 0.5]).events).toEqual([]);
  });

  it('does not end in the hysteresis band (0.4-0.6)', () => {
    const { events, fsm } = feed([0.3, 0.3, 0.5, 0.55, 0.5]);
    expect(events).toEqual(['start']);
    expect(fsm.phase).toBe('pinching');
  });

  it('ends when the ratio exceeds release', () => {
    expect(feed([0.3, 0.3, 0.65]).events).toEqual(['start', 'end']);
  });

  it('threshold flicker around a single value produces no event storm', () => {
    // Oscillating right at the old single-threshold value (0.55-ish zone).
    const { events } = feed([0.3, 0.3, 0.45, 0.58, 0.45, 0.58, 0.45]);
    expect(events).toEqual(['start']); // still one pinch, no end, no restarts
  });

  it('can pinch again after release', () => {
    expect(feed([0.3, 0.3, 0.7, 0.3, 0.3]).events).toEqual(['start', 'end', 'start']);
  });
});
