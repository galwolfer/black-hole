import { describe, expect, it } from 'vitest';
import { MotionTracker } from '../src/gesture/motion';

const FRAME_MS = 1000 / 30;

describe('MotionTracker', () => {
  it('reports zero velocity with fewer than two samples', () => {
    const tracker = new MotionTracker();
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 });
    tracker.push({ x: 0.5, y: 0.5 }, 0);
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 });
  });

  it('measures constant velocity exactly (least squares on a line)', () => {
    const tracker = new MotionTracker();
    // 0.6 frame-widths per second along x.
    for (let i = 0; i < 8; i += 1) {
      tracker.push({ x: 0.1 + 0.6 * (i * FRAME_MS) / 1000, y: 0.5 }, i * FRAME_MS);
    }
    const velocity = tracker.velocity();
    expect(velocity.x).toBeCloseTo(0.6, 2);
    expect(velocity.y).toBeCloseTo(0, 5);
  });

  it('is robust to a single-frame outlier (unlike two-sample differencing)', () => {
    const tracker = new MotionTracker();
    for (let i = 0; i < 8; i += 1) {
      const x = 0.5 + (i === 4 ? 0.03 : 0); // one jitter spike
      tracker.push({ x, y: 0.5 }, i * FRAME_MS);
    }
    expect(Math.abs(tracker.velocity().x)).toBeLessThan(0.3);
    // Two-sample differencing on the spike frame would read 0.03 / 0.033 ≈ 0.9 w/s.
  });

  it('peakSpeed returns the max speed within the window', () => {
    const tracker = new MotionTracker();
    let x = 0;
    const speeds = [0, 0.5, 2.0, 1.0, 0.2]; // burst in the middle
    for (let i = 0; i < speeds.length; i += 1) {
      x += (speeds[i] * FRAME_MS) / 1000;
      tracker.push({ x, y: 0.5 }, i * FRAME_MS);
      tracker.recordSpeed(i * FRAME_MS);
    }
    const now = (speeds.length - 1) * FRAME_MS;
    expect(tracker.peakSpeed(200, now)).toBeGreaterThan(1.0);
  });

  it('reset clears history', () => {
    const tracker = new MotionTracker();
    tracker.push({ x: 0, y: 0 }, 0);
    tracker.push({ x: 1, y: 0 }, FRAME_MS);
    tracker.reset();
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 });
  });
});
