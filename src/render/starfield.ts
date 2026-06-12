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

  constructor(private readonly stars: Star[]) {}

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
