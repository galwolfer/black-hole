import { describe, expect, it } from 'vitest';
import { OneEuroFilter, PointFilter } from '../src/gesture/oneEuro';

const FRAME_MS = 1000 / 30;

describe('OneEuroFilter', () => {
  it('passes the first sample through unchanged', () => {
    const filter = new OneEuroFilter();
    expect(filter.filter(0.42, 0)).toBe(0.42);
  });

  it('is identity on a constant signal', () => {
    const filter = new OneEuroFilter();
    let value = 0;
    for (let i = 0; i < 30; i += 1) {
      value = filter.filter(0.5, i * FRAME_MS);
    }
    expect(value).toBeCloseTo(0.5, 6);
  });

  it('converges to a step within 20 frames at 30fps', () => {
    const filter = new OneEuroFilter();
    filter.filter(0, 0);
    let value = 0;
    for (let i = 1; i <= 20; i += 1) {
      value = filter.filter(1, i * FRAME_MS);
    }
    expect(value).toBeGreaterThan(0.9);
  });

  it('attenuates high-frequency noise', () => {
    const filter = new OneEuroFilter();
    const noisy: number[] = [];
    const filtered: number[] = [];
    for (let i = 0; i < 120; i += 1) {
      // 0.5 plus alternating ±0.02 jitter — like a resting hand.
      const sample = 0.5 + (i % 2 === 0 ? 0.02 : -0.02);
      noisy.push(sample);
      filtered.push(filter.filter(sample, i * FRAME_MS));
    }
    const variance = (values: number[]) => {
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    };
    expect(variance(filtered.slice(30))).toBeLessThan(variance(noisy.slice(30)) * 0.2);
  });

  it('tracks fast motion with little lag (beta kicks in)', () => {
    const filter = new OneEuroFilter();
    let value = 0;
    // Sweep 0 -> 1 in 10 frames (a flick-speed motion).
    for (let i = 0; i <= 10; i += 1) {
      value = filter.filter(i / 10, i * FRAME_MS);
    }
    expect(value).toBeGreaterThan(0.65);
  });

  it('reset clears state', () => {
    const filter = new OneEuroFilter();
    filter.filter(1, 0);
    filter.reset();
    expect(filter.filter(0.3, FRAME_MS)).toBe(0.3);
  });
});

describe('PointFilter', () => {
  it('filters x and y independently', () => {
    const filter = new PointFilter();
    const first = filter.filter({ x: 0.1, y: 0.9 }, 0);
    expect(first).toEqual({ x: 0.1, y: 0.9 });
    const second = filter.filter({ x: 0.1, y: 0.9 }, FRAME_MS);
    expect(second.x).toBeCloseTo(0.1, 6);
    expect(second.y).toBeCloseTo(0.9, 6);
  });
});
