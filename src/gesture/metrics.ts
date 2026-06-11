import type { Point } from './types';

export const WRIST = 0;
export const THUMB_TIP = 4;
export const INDEX_MCP = 5;
export const INDEX_TIP = 8;
export const MIDDLE_MCP = 9;
export const MIDDLE_TIP = 12;
export const RING_MCP = 13;
export const RING_TIP = 16;
export const PINKY_MCP = 17;
export const PINKY_TIP = 20;

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function mirrorPoint(point: Point): Point {
  return { x: 1 - point.x, y: point.y };
}

export function averagePoint(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/** Hand-scale reference that does not change when fingers pinch or curl. */
export function knuckleSpan(landmarks: Point[]): number {
  return Math.max(distance(landmarks[INDEX_MCP], landmarks[PINKY_MCP]), 0.05);
}

export function pinchRatio(landmarks: Point[]): number {
  return distance(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) / knuckleSpan(landmarks);
}

/**
 * Mean of tip-to-wrist / mcp-to-wrist for middle, ring, pinky.
 * Extended fingers ≈ 1.6-1.9; a fist ≈ 0.6-0.9. Thumb and index are
 * deliberately excluded so pinching can never read as grabbing.
 */
export function fingerCurl(landmarks: Point[]): number {
  const wrist = landmarks[WRIST];
  const fingers: Array<[number, number]> = [
    [MIDDLE_TIP, MIDDLE_MCP],
    [RING_TIP, RING_MCP],
    [PINKY_TIP, PINKY_MCP],
  ];
  let total = 0;
  for (const [tip, mcp] of fingers) {
    total += distance(landmarks[tip], wrist) / Math.max(distance(landmarks[mcp], wrist), 1e-6);
  }
  return total / fingers.length;
}

export function palmCenter(landmarks: Point[]): Point {
  return averagePoint([
    landmarks[WRIST],
    landmarks[INDEX_MCP],
    landmarks[MIDDLE_MCP],
    landmarks[PINKY_MCP],
  ]);
}

export function pinchMidpoint(landmarks: Point[]): Point {
  return averagePoint([landmarks[THUMB_TIP], landmarks[INDEX_TIP]]);
}
