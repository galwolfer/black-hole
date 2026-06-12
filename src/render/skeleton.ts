import type { TrackedHand } from '../gesture/types';

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export function drawHandSkeleton(
  ctx: CanvasRenderingContext2D,
  hand: TrackedHand,
  width: number,
  height: number,
  now: number,
): void {
  const points = hand.landmarks.map((point) => ({ x: point.x * width, y: point.y * height }));

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(143, 231, 255, 0.72)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';

  for (const [from, to] of HAND_CONNECTIONS) {
    const a = points[from];
    const b = points[to];
    if (!a || !b) {
      continue;
    }
    ctx.globalAlpha = 0.25 + 0.18 * Math.sin(now * 0.004 + from + to);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  for (const point of points) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  if (hand.pinchPhase !== 'idle') {
    const pinchX = hand.pinchPoint.x * width;
    const pinchY = hand.pinchPoint.y * height;
    ctx.strokeStyle = hand.pinchPhase === 'pinching'
      ? 'rgba(255, 182, 114, 0.9)'
      : 'rgba(255, 182, 114, 0.45)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(pinchX, pinchY, 12, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (hand.grabPhase === 'grabbing') {
    const palmX = hand.palm.x * width;
    const palmY = hand.palm.y * height;
    ctx.strokeStyle = 'rgba(142, 227, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(palmX, palmY, 18, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
