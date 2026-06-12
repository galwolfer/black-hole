import { GESTURE_CONFIG } from '../gesture/config';
import type { TrackedHand } from '../gesture/types';

const LINE_HEIGHT = 14;

/**
 * On-canvas gesture telemetry: turns "gestures feel unreliable" into numbers
 * you can watch while testing. Enabled with ?debug=1.
 */
export function drawDebugHud(
  ctx: CanvasRenderingContext2D,
  hands: TrackedHand[],
  fps: number,
  width: number,
): void {
  ctx.save();
  ctx.font = '11px ui-monospace, monospace';
  ctx.textBaseline = 'top';

  const lines: string[] = [`fps ${fps.toFixed(0)}`];
  for (const hand of hands) {
    const { pinch, grab } = GESTURE_CONFIG;
    lines.push(
      `#${hand.id} ${hand.handedness}`
      + ` pinch ${hand.pinchRatio.toFixed(2)} [${pinch.engageRatio}/${pinch.releaseRatio}] ${hand.pinchPhase}`
      + ` curl ${hand.curl.toFixed(2)} [${grab.engageCurl}/${grab.releaseCurl}] ${hand.grabPhase}`
      + ` v ${hand.speed.toFixed(2)} w/s`,
    );
  }

  const boxWidth = Math.min(width - 16, 560);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(8, 8, boxWidth, 10 + lines.length * LINE_HEIGHT);
  ctx.fillStyle = 'rgba(142, 227, 255, 0.95)';
  lines.forEach((line, index) => {
    ctx.fillText(line, 14, 14 + index * LINE_HEIGHT);
  });

  ctx.restore();
}
