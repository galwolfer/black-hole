import type { BlackHole } from '../sim/world';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function drawBlackHole(
  ctx: CanvasRenderingContext2D,
  hole: BlackHole,
  now: number,
  highlight: boolean,
): void {
  const age = now - hole.createdAt;
  const progress = Number.isFinite(hole.lifespan) ? clamp(age / hole.lifespan, 0, 1) : 0;
  const fade = 1 - progress;
  const pulse = 0.65 + 0.35 * Math.sin(now * 0.005 + hole.seed);
  const core = hole.radius * (0.64 + 0.08 * Math.sin(now * 0.012 + hole.seed));
  const ring = hole.radius * (1.35 + 0.18 * pulse);
  const glow = ctx.createRadialGradient(hole.x, hole.y, core * 0.2, hole.x, hole.y, ring * 2.3);
  glow.addColorStop(0, `rgba(0, 0, 0, ${0.95 * fade})`);
  glow.addColorStop(0.42, `rgba(10, 16, 34, ${0.92 * fade})`);
  glow.addColorStop(0.68, `rgba(20, 68, 112, ${0.42 * fade})`);
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, ring * 2.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowColor = `rgba(104, 198, 255, ${0.7 * fade})`;
  ctx.shadowBlur = 30;
  ctx.fillStyle = 'rgba(1, 2, 8, 0.98)';
  ctx.beginPath();
  ctx.arc(hole.x, hole.y, core, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = `rgba(142, 227, 255, ${0.5 * fade})`;
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 4; i += 1) {
    const orbit = ring + i * hole.radius * 0.16;
    const start = now * 0.0015 + hole.seed + i * 1.2;
    const sweep = Math.PI * (0.6 + 0.12 * i + 0.1 * pulse);
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, orbit, start, start + sweep);
    ctx.stroke();
  }

  ctx.strokeStyle = `rgba(255, 170, 96, ${0.34 * fade})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i += 1) {
    const angle = now * 0.0025 + hole.seed + i * 0.6;
    const startRadius = core * 0.85 + i * 1.5;
    const x1 = hole.x + Math.cos(angle) * startRadius;
    const y1 = hole.y + Math.sin(angle) * startRadius;
    const x2 = hole.x + Math.cos(angle + 0.28) * (startRadius + 18);
    const y2 = hole.y + Math.sin(angle + 0.28) * (startRadius + 18);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  if (highlight) {
    ctx.strokeStyle = `rgba(142, 227, 255, ${0.35 + 0.25 * pulse})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, hole.radius * 1.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}
