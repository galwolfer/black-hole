export type Star = {
  x: number;
  y: number;
  size: number;
  phase: number;
};

export function generateStars(count: number): Star[] {
  return Array.from({ length: count }, () => ({
    x: Math.random(),
    y: Math.random(),
    size: 0.5 + Math.random() * 1.8,
    phase: Math.random() * Math.PI * 2,
  }));
}

/**
 * Stars twinkle by alpha only, so we pre-render two offscreen layers (dim and
 * bright) once per resize and cross-fade them per frame: 2 drawImage calls
 * instead of 96 arc fills.
 */
export class StarfieldRenderer {
  private dimLayer: HTMLCanvasElement | null = null;
  private brightLayer: HTMLCanvasElement | null = null;
  private layerWidth = 0;
  private layerHeight = 0;

  constructor(readonly stars: Star[]) {}

  private renderLayer(width: number, height: number, alpha: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      for (const star of this.stars) {
        ctx.beginPath();
        ctx.arc(star.x * width, star.y * height, star.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return canvas;
  }

  /** Call when star positions changed (attraction active). */
  invalidate(): void {
    // Null BOTH layers: draw() rebuilds them together, but nulling only one
    // would leave the other holding last frame's star positions if the draw
    // path is ever refactored.
    this.dimLayer = null;
    this.brightLayer = null;
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, now: number): void {
    if (!this.dimLayer || this.layerWidth !== width || this.layerHeight !== height) {
      this.dimLayer = this.renderLayer(width, height, 0.2);
      this.brightLayer = this.renderLayer(width, height, 0.55);
      this.layerWidth = width;
      this.layerHeight = height;
    }
    const twinkle = 0.5 + 0.5 * Math.sin(now * 0.002);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.drawImage(this.dimLayer, 0, 0, width, height);
    ctx.globalAlpha = twinkle * 0.8;
    if (this.brightLayer) {
      ctx.drawImage(this.brightLayer, 0, 0, width, height);
    }
    ctx.restore();
  }
}

type Attractor = { x: number; y: number; radius: number };

/**
 * Inverse-square pull toward each hole, in normalized space. Stars falling
 * inside a core respawn on a random screen edge, so the field never drains.
 * Pure and unit-tested; called once per frame before drawing.
 */
export function updateStars(
  stars: Star[],
  holes: Attractor[],
  dtSeconds: number,
  width: number,
  height: number,
): void {
  if (holes.length === 0) {
    return;
  }
  for (const star of stars) {
    for (const hole of holes) {
      const holeX = hole.x / width;
      const holeY = hole.y / height;
      const dx = holeX - star.x;
      const dy = holeY - star.y;
      const distSq = dx * dx + dy * dy;
      const coreNormalized = (hole.radius * 0.5) / Math.min(width, height);

      if (distSq < coreNormalized * coreNormalized) {
        // Consumed: respawn on a random edge.
        if (Math.random() < 0.5) {
          star.x = Math.random() < 0.5 ? 0 : 1;
          star.y = Math.random();
        } else {
          star.x = Math.random();
          star.y = Math.random() < 0.5 ? 0 : 1;
        }
        break;
      }

      const pull = 0.0012 / Math.max(distSq, 0.0004);
      const dist = Math.sqrt(distSq);
      star.x += (dx / dist) * pull * dtSeconds * 60;
      star.y += (dy / dist) * pull * dtSeconds * 60;
    }
  }
}
