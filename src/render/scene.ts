import { SIM_CONFIG } from '../gesture/config';
import type { TrackedHand } from '../gesture/types';
import type { BlackHole } from '../sim/world';
import { drawBlackHole } from './hole';
import { drawHandSkeleton } from './skeleton';
import type { StarfieldRenderer } from './starfield';

function isHandNearHole(hand: TrackedHand, hole: BlackHole, width: number, height: number): boolean {
  const palmX = hand.palm.x * width;
  const palmY = hand.palm.y * height;
  const range = Math.max(hole.radius * 0.9, Math.min(width, height) * SIM_CONFIG.grabPaddingFraction);
  return Math.hypot(palmX - hole.x, palmY - hole.y) < range;
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  starfield: StarfieldRenderer,
  hands: TrackedHand[],
  holes: BlackHole[],
  now: number,
): void {
  ctx.clearRect(0, 0, width, height);

  const aura = ctx.createLinearGradient(0, 0, width, height);
  aura.addColorStop(0, 'rgba(12, 20, 44, 0.06)');
  aura.addColorStop(0.5, 'rgba(3, 4, 8, 0.02)');
  aura.addColorStop(1, 'rgba(18, 34, 58, 0.08)');
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, width, height);

  starfield.draw(ctx, width, height, now);

  for (const hand of hands) {
    drawHandSkeleton(ctx, hand, width, height, now);
  }

  for (const hole of holes) {
    const highlight = hole.grabbedBy === null
      && hands.some((hand) => isHandNearHole(hand, hole, width, height));
    drawBlackHole(ctx, hole, now, highlight);
  }

  const vignette = ctx.createRadialGradient(
    width * 0.5, height * 0.48, Math.min(width, height) * 0.12,
    width * 0.5, height * 0.5, Math.max(width, height) * 0.78,
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}
