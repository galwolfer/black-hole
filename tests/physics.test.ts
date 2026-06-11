import { describe, expect, it } from 'vitest';
import { stepFreeHole } from '../src/sim/physics';

function makeHole(velocityX: number, velocityY: number) {
  return {
    x: 400, y: 300, radius: 50,
    velocityX, velocityY,
  };
}

const WIDTH = 1280;
const HEIGHT = 720;

describe('stepFreeHole', () => {
  it('is frame-rate independent: 1s at 30Hz vs 120Hz ends within 2%', () => {
    const at30 = makeHole(600, 0);
    const at120 = makeHole(600, 0);
    for (let i = 0; i < 30; i += 1) stepFreeHole(at30, 1 / 30, WIDTH, HEIGHT);
    for (let i = 0; i < 120; i += 1) stepFreeHole(at120, 1 / 120, WIDTH, HEIGHT);
    expect(Math.abs(at30.x - at120.x)).toBeLessThan(Math.abs(at120.x - 400) * 0.02 + 1);
    expect(Math.abs(at30.velocityX - at120.velocityX)).toBeLessThan(at120.velocityX * 0.02 + 1);
  });

  it('damps velocity exponentially', () => {
    const hole = makeHole(1000, 0);
    const dt = 1 / 20; // maxDt — within the clamp range
    stepFreeHole(hole, dt, WIDTH, HEIGHT);
    // v = 1000 * exp(-0.9 * dt)
    expect(hole.velocityX).toBeCloseTo(1000 * Math.exp(-0.9 * dt), 1);
  });

  it('bounces off walls with restitution and stays in bounds', () => {
    const hole = makeHole(-30000, 0); // will cross the left wall this step
    stepFreeHole(hole, 1 / 30, WIDTH, HEIGHT);
    expect(hole.x).toBeGreaterThanOrEqual(hole.radius);
    expect(hole.velocityX).toBeGreaterThan(0); // reversed
  });

  it('clamps absurd dt values instead of exploding', () => {
    const hole = makeHole(600, 0);
    stepFreeHole(hole, 5, WIDTH, HEIGHT); // tab was backgrounded for 5s
    expect(hole.x).toBeLessThan(WIDTH); // moved at most one clamped step
  });
});
