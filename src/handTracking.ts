export type Point = {
  x: number;
  y: number;
};

export type HandFrame = {
  label: string;
  landmarks: Point[];
  pinchPoint: Point | null;
  isPinching: boolean;
  handSpan: number;
};

export type Star = {
  x: number;
  y: number;
  size: number;
  phase: number;
};

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

export function mirrorPoint(point: { x: number; y: number }): Point {
  return {
    x: 1 - point.x,
    y: point.y,
  };
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function generateStars(count: number): Star[] {
  return Array.from({ length: count }, () => ({
    x: Math.random(),
    y: Math.random(),
    size: 0.5 + Math.random() * 1.8,
    phase: Math.random() * Math.PI * 2,
  }));
}

export function getHandFrames(result: any): HandFrame[] {
  const landmarks = Array.isArray(result?.landmarks) ? result.landmarks : [];
  const handednesses = Array.isArray(result?.handednesses) ? result.handednesses : [];

  return landmarks.map((handLandmarks: Array<{ x: number; y: number }>, index: number) => {
    const thumbTip = handLandmarks[4];
    const indexTip = handLandmarks[8];
    const wrist = handLandmarks[0];
    const indexMcp = handLandmarks[5];
    const pinkyMcp = handLandmarks[17];
    const middleMcp = handLandmarks[9];
    const span = Math.max(distance(indexMcp, pinkyMcp), distance(wrist, middleMcp), 0.12);
    const pinchDistance = distance(thumbTip, indexTip);
    const isPinching = pinchDistance / span < 0.38;
    const pinchPoint = isPinching
      ? mirrorPoint({
          x: (thumbTip.x + indexTip.x) / 2,
          y: (thumbTip.y + indexTip.y) / 2,
        })
      : null;

    const mirroredLandmarks = handLandmarks.map((point) => mirrorPoint(point));
    const label = handednesses[index]?.[0]?.categoryName ?? `Hand ${index + 1}`;

    return {
      label,
      landmarks: mirroredLandmarks,
      pinchPoint,
      isPinching,
      handSpan: span,
    };
  });
}

export function drawHandSkeleton(
  ctx: CanvasRenderingContext2D,
  frame: HandFrame,
  width: number,
  height: number,
  now: number,
): void {
  const points = frame.landmarks.map((point) => ({ x: point.x * width, y: point.y * height }));

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

  if (frame.pinchPoint) {
    const pinchX = frame.pinchPoint.x * width;
    const pinchY = frame.pinchPoint.y * height;
    ctx.strokeStyle = 'rgba(255, 182, 114, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(pinchX, pinchY, 12, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}