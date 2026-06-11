import { describe, expect, it } from 'vitest';
import {
  INDEX_MCP, INDEX_TIP, MIDDLE_MCP, MIDDLE_TIP, PINKY_MCP, PINKY_TIP,
  RING_MCP, RING_TIP, THUMB_TIP, WRIST,
  distance, fingerCurl, knuckleSpan, mirrorPoint, palmCenter, pinchMidpoint, pinchRatio,
} from '../src/gesture/metrics';
import type { Point } from '../src/gesture/types';

/** Build a 21-landmark hand where every point defaults to the wrist. */
function makeHand(overrides: Partial<Record<number, Point>>): Point[] {
  const landmarks: Point[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.8 }));
  for (const [index, point] of Object.entries(overrides)) {
    landmarks[Number(index)] = point as Point;
  }
  return landmarks;
}

// An open hand: wrist at bottom, MCPs mid, fingertips far.
function openHand(): Point[] {
  return makeHand({
    [WRIST]: { x: 0.5, y: 0.8 },
    [THUMB_TIP]: { x: 0.38, y: 0.62 },
    [INDEX_MCP]: { x: 0.45, y: 0.6 },
    [INDEX_TIP]: { x: 0.44, y: 0.42 },
    [MIDDLE_MCP]: { x: 0.5, y: 0.6 },
    [MIDDLE_TIP]: { x: 0.5, y: 0.4 },
    [RING_MCP]: { x: 0.55, y: 0.6 },
    [RING_TIP]: { x: 0.56, y: 0.42 },
    [PINKY_MCP]: { x: 0.6, y: 0.62 },
    [PINKY_TIP]: { x: 0.62, y: 0.46 },
  });
}

// A fist: fingertips pulled back near the wrist.
function fist(): Point[] {
  return makeHand({
    [WRIST]: { x: 0.5, y: 0.8 },
    [THUMB_TIP]: { x: 0.45, y: 0.68 },
    [INDEX_MCP]: { x: 0.45, y: 0.6 },
    [INDEX_TIP]: { x: 0.46, y: 0.68 },
    [MIDDLE_MCP]: { x: 0.5, y: 0.6 },
    [MIDDLE_TIP]: { x: 0.5, y: 0.69 },
    [RING_MCP]: { x: 0.55, y: 0.6 },
    [RING_TIP]: { x: 0.54, y: 0.69 },
    [PINKY_MCP]: { x: 0.6, y: 0.62 },
    [PINKY_TIP]: { x: 0.58, y: 0.7 },
  });
}

describe('metrics', () => {
  it('measures distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('mirrors x only', () => {
    expect(mirrorPoint({ x: 0.2, y: 0.7 })).toEqual({ x: 0.8, y: 0.7 });
  });

  it('knuckle span is the index-to-pinky MCP distance with a floor', () => {
    const hand = openHand();
    expect(knuckleSpan(hand)).toBeCloseTo(distance(hand[INDEX_MCP], hand[PINKY_MCP]), 5);
    expect(knuckleSpan(makeHand({}))).toBeGreaterThanOrEqual(0.05);
  });

  it('pinch ratio is low when thumb and index tips touch', () => {
    const touching = makeHand({
      [THUMB_TIP]: { x: 0.44, y: 0.42 },
      [INDEX_TIP]: { x: 0.44, y: 0.42 },
      [INDEX_MCP]: { x: 0.45, y: 0.6 },
      [PINKY_MCP]: { x: 0.6, y: 0.62 },
    });
    expect(pinchRatio(touching)).toBeLessThan(0.1);
    expect(pinchRatio(openHand())).toBeGreaterThan(1.0);
  });

  it('finger curl separates open hand from fist', () => {
    expect(fingerCurl(openHand())).toBeGreaterThan(1.5);
    expect(fingerCurl(fist())).toBeLessThan(0.8);
  });

  it('curl ignores thumb and index, so a pinch with extended fingers stays "open"', () => {
    const pinching = openHand();
    pinching[THUMB_TIP] = { x: 0.44, y: 0.42 };
    pinching[INDEX_TIP] = { x: 0.44, y: 0.42 };
    expect(fingerCurl(pinching)).toBeGreaterThan(1.5);
  });

  it('palm center averages wrist and MCPs', () => {
    const hand = openHand();
    const center = palmCenter(hand);
    expect(center.x).toBeCloseTo((0.5 + 0.45 + 0.5 + 0.6) / 4, 5);
    expect(center.y).toBeCloseTo((0.8 + 0.6 + 0.6 + 0.62) / 4, 5);
  });

  it('pinch midpoint is between thumb and index tips', () => {
    const hand = openHand();
    const mid = pinchMidpoint(hand);
    expect(mid.x).toBeCloseTo((0.38 + 0.44) / 2, 5);
    expect(mid.y).toBeCloseTo((0.62 + 0.42) / 2, 5);
  });
});
