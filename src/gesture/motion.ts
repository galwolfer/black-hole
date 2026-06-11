import { GESTURE_CONFIG } from './config';
import type { Point } from './types';

type Sample = { x: number; y: number; tMs: number };
type SpeedSample = { speed: number; tMs: number };

/**
 * Ring buffer of recent (already-filtered) palm positions. Velocity comes
 * from a least-squares line fit over the buffer — far more robust to
 * single-frame jitter than two-sample differencing. Units are normalized
 * frame-widths per second, so thresholds are resolution-independent.
 */
export class MotionTracker {
  private samples: Sample[] = [];
  private speedHistory: SpeedSample[] = [];

  reset(): void {
    this.samples = [];
    this.speedHistory = [];
  }

  push(point: Point, tMs: number): void {
    this.samples.push({ x: point.x, y: point.y, tMs });
    if (this.samples.length > GESTURE_CONFIG.motion.bufferSize) {
      this.samples.shift();
    }
  }

  /** Least-squares slope of position vs time, per second. */
  velocity(): Point {
    const n = this.samples.length;
    if (n < 2) {
      return { x: 0, y: 0 };
    }
    let meanT = 0;
    let meanX = 0;
    let meanY = 0;
    for (const sample of this.samples) {
      meanT += sample.tMs;
      meanX += sample.x;
      meanY += sample.y;
    }
    meanT /= n;
    meanX /= n;
    meanY /= n;

    let covTX = 0;
    let covTY = 0;
    let varT = 0;
    for (const sample of this.samples) {
      const dt = sample.tMs - meanT;
      covTX += dt * (sample.x - meanX);
      covTY += dt * (sample.y - meanY);
      varT += dt * dt;
    }
    if (varT === 0) {
      return { x: 0, y: 0 };
    }
    return { x: (covTX / varT) * 1000, y: (covTY / varT) * 1000 };
  }

  speed(): number {
    const v = this.velocity();
    return Math.hypot(v.x, v.y);
  }

  /** Call once per frame after push() so peakSpeed has a history to scan. */
  recordSpeed(tMs: number): void {
    this.speedHistory.push({ speed: this.speed(), tMs });
    // Keep ~0.5s of history.
    while (this.speedHistory.length > 0 && tMs - this.speedHistory[0].tMs > 500) {
      this.speedHistory.shift();
    }
  }

  /** Max recorded speed within the trailing window — flicks decelerate at release. */
  peakSpeed(windowMs: number, nowMs: number): number {
    let peak = 0;
    for (const sample of this.speedHistory) {
      if (nowMs - sample.tMs <= windowMs && sample.speed > peak) {
        peak = sample.speed;
      }
    }
    return peak;
  }
}
