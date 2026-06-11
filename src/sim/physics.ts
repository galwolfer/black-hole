import { SIM_CONFIG } from '../gesture/config';

export type MovingHole = {
  x: number;
  y: number;
  radius: number;
  velocityX: number;
  velocityY: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Integrate a free (ungrabbed) hole with real elapsed time. Damping is
 * exponential in dt, so 30Hz and 120Hz displays produce the same motion.
 * Mutates the hole in place (it lives in a ref, not React state).
 */
export function stepFreeHole(hole: MovingHole, dtSeconds: number, width: number, height: number): void {
  const dt = clamp(dtSeconds, SIM_CONFIG.minDt, SIM_CONFIG.maxDt);
  const damping = Math.exp(-SIM_CONFIG.dampingK * dt);

  hole.velocityX *= damping;
  hole.velocityY *= damping;
  hole.x += hole.velocityX * dt;
  hole.y += hole.velocityY * dt;

  if (hole.x - hole.radius < 0 || hole.x + hole.radius > width) {
    hole.velocityX *= -SIM_CONFIG.restitution;
    hole.x = clamp(hole.x, hole.radius, width - hole.radius);
  }
  if (hole.y - hole.radius < 0 || hole.y + hole.radius > height) {
    hole.velocityY *= -SIM_CONFIG.restitution;
    hole.y = clamp(hole.y, hole.radius, height - hole.radius);
  }
}
