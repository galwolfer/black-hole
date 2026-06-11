import { GESTURE_CONFIG } from './config';
import type { Point } from './types';

function smoothingFactor(cutoffHz: number, dtSeconds: number): number {
  const r = 2 * Math.PI * cutoffHz * dtSeconds;
  return r / (r + 1);
}

/**
 * One Euro filter (Casiez, Roussel, Vogel — CHI 2012).
 * Adaptive low-pass: heavy smoothing at rest, low lag during fast motion.
 */
export class OneEuroFilter {
  private prevValue: number | null = null;
  private prevDerivative = 0;
  private prevTimeMs: number | null = null;

  constructor(
    private readonly minCutoff: number = GESTURE_CONFIG.filter.minCutoff,
    private readonly beta: number = GESTURE_CONFIG.filter.beta,
    private readonly dCutoff: number = GESTURE_CONFIG.filter.dCutoff,
  ) {}

  reset(): void {
    this.prevValue = null;
    this.prevDerivative = 0;
    this.prevTimeMs = null;
  }

  filter(value: number, timeMs: number): number {
    if (this.prevValue === null || this.prevTimeMs === null) {
      this.prevValue = value;
      this.prevTimeMs = timeMs;
      return value;
    }

    const dt = Math.min(Math.max((timeMs - this.prevTimeMs) / 1000, 1 / 240), 1 / 10);
    const derivative = (value - this.prevValue) / dt;
    const aDerivative = smoothingFactor(this.dCutoff, dt);
    const smoothDerivative = aDerivative * derivative + (1 - aDerivative) * this.prevDerivative;
    const cutoff = this.minCutoff + this.beta * Math.abs(smoothDerivative);
    const a = smoothingFactor(cutoff, dt);
    const filtered = a * value + (1 - a) * this.prevValue;

    this.prevValue = filtered;
    this.prevDerivative = smoothDerivative;
    this.prevTimeMs = timeMs;
    return filtered;
  }
}

export class PointFilter {
  private readonly xFilter = new OneEuroFilter();
  private readonly yFilter = new OneEuroFilter();

  reset(): void {
    this.xFilter.reset();
    this.yFilter.reset();
  }

  filter(point: Point, timeMs: number): Point {
    return {
      x: this.xFilter.filter(point.x, timeMs),
      y: this.yFilter.filter(point.y, timeMs),
    };
  }
}
