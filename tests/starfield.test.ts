import { describe, expect, it } from 'vitest';
import { updateStars } from '../src/render/starfield';
import type { Star } from '../src/render/starfield';

const WIDTH = 1280;
const HEIGHT = 720;

function star(x: number, y: number): Star {
  return { x, y, size: 1, phase: 0 };
}

const hole = { x: 0.5 * WIDTH, y: 0.5 * HEIGHT, radius: 60 };

describe('updateStars', () => {
  it('pulls nearby stars toward the hole', () => {
    const stars = [star(0.4, 0.5)];
    updateStars(stars, [hole], 1 / 30, WIDTH, HEIGHT);
    expect(stars[0].x).toBeGreaterThan(0.4);
    expect(stars[0].y).toBeCloseTo(0.5, 3);
  });

  it('barely affects distant stars', () => {
    const distant = [star(0.02, 0.02)];
    const nearby = [star(0.4, 0.5)];
    updateStars(distant, [hole], 1 / 30, WIDTH, HEIGHT);
    updateStars(nearby, [hole], 1 / 30, WIDTH, HEIGHT);
    const distantPull = Math.abs(distant[0].x - 0.02);
    const nearbyPull = Math.abs(nearby[0].x - 0.4);
    // Inverse-square falloff: a far star drifts a tiny fraction of a near one's pull.
    expect(distantPull).toBeLessThan(0.005);
    expect(distantPull).toBeLessThan(nearbyPull * 0.1);
  });

  it('respawns a star consumed by the hole at a screen edge', () => {
    const stars = [star(0.5 + 1 / WIDTH, 0.5)]; // basically at the center
    updateStars(stars, [hole], 1 / 30, WIDTH, HEIGHT);
    const distanceFromHole = Math.hypot(stars[0].x - 0.5, stars[0].y - 0.5);
    expect(distanceFromHole).toBeGreaterThan(0.3); // teleported away, not stuck inside
  });

  it('does nothing without holes', () => {
    const stars = [star(0.4, 0.5)];
    updateStars(stars, [], 1 / 30, WIDTH, HEIGHT);
    expect(stars[0]).toEqual(star(0.4, 0.5));
  });
});
