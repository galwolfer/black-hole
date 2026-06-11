import { describe, expect, it } from 'vitest';
import { createWorld, stepWorld } from '../src/sim/world';
import type { GestureEvent, TrackedHand } from '../src/gesture/types';

const WIDTH = 1280;
const HEIGHT = 720;

function hand(overrides: Partial<TrackedHand> & { id: number }): TrackedHand {
  return {
    handedness: 'Right',
    landmarks: [],
    palm: { x: 0.5, y: 0.5 },
    pinchPoint: { x: 0.5, y: 0.5 },
    knuckleSpan: 0.15,
    pinchRatio: 1.2,
    curl: 1.7,
    pinchPhase: 'idle',
    grabPhase: 'idle',
    velocity: { x: 0, y: 0 },
    speed: 0,
    ...overrides,
  };
}

function pinchStart(handId: number, x = 0.5, y = 0.5): GestureEvent {
  return { type: 'pinchStart', handId, point: { x, y }, span: 0.15 };
}

describe('world reducer', () => {
  it('spawns a hole on pinchStart and reports it for audio', () => {
    const world = createWorld('multi');
    const result = stepWorld(world, [pinchStart(1)], [], 1 / 60, WIDTH, HEIGHT, 1000);
    expect(world.holes).toHaveLength(1);
    expect(result.spawned).toBe(true);
    expect(world.holes[0].x).toBeCloseTo(0.5 * WIDTH, 5);
  });

  it('solo mode allows exactly one hole and does NOT report a phantom spawn', () => {
    const world = createWorld('solo');
    stepWorld(world, [pinchStart(1)], [], 1 / 60, WIDTH, HEIGHT, 1000);
    const second = stepWorld(world, [pinchStart(1)], [], 1 / 60, WIDTH, HEIGHT, 2000);
    expect(world.holes).toHaveLength(1);
    expect(second.spawned).toBe(false); // fixes the spawn-sound-with-no-hole bug
  });

  it('multi mode caps holes at 10', () => {
    const world = createWorld('multi');
    for (let i = 0; i < 12; i += 1) {
      stepWorld(world, [pinchStart(1, 0.1 + i * 0.05)], [], 1 / 60, WIDTH, HEIGHT, 1000 + i);
    }
    expect(world.holes.length).toBeLessThanOrEqual(10);
  });

  it('a freshly spawned hole cannot be grabbed during the spawn lock', () => {
    const world = createWorld('solo');
    stepWorld(world, [pinchStart(1)], [], 1 / 60, WIDTH, HEIGHT, 1000);
    const grabbing = hand({ id: 1, grabPhase: 'grabbing', palm: { x: 0.5, y: 0.5 } });
    stepWorld(world, [{ type: 'grabStart', handId: 1, point: { x: 0.5, y: 0.5 } }], [grabbing], 1 / 60, WIDTH, HEIGHT, 1100);
    expect(world.holes[0].grabbedBy).toBeNull(); // 100ms < 300ms spawn lock
  });

  it('grabbing after the lock moves the hole with the palm', () => {
    const world = createWorld('solo');
    stepWorld(world, [pinchStart(1)], [], 1 / 60, WIDTH, HEIGHT, 1000);
    const grabbing = hand({ id: 1, grabPhase: 'grabbing', palm: { x: 0.5, y: 0.5 } });
    stepWorld(world, [{ type: 'grabStart', handId: 1, point: { x: 0.5, y: 0.5 } }], [grabbing], 1 / 60, WIDTH, HEIGHT, 1500);
    expect(world.holes[0].grabbedBy).toBe(1);

    const moved = hand({ id: 1, grabPhase: 'grabbing', palm: { x: 0.7, y: 0.6 } });
    stepWorld(world, [], [moved], 1 / 60, WIDTH, HEIGHT, 1533);
    expect(world.holes[0].x).toBeCloseTo(0.7 * WIDTH, 0);
    expect(world.holes[0].y).toBeCloseTo(0.6 * HEIGHT, 0);
  });

  it('the grab target has a floor so small holes are still grabbable', () => {
    const world = createWorld('solo');
    stepWorld(world, [pinchStart(1, 0.5, 0.5)], [], 1 / 60, WIDTH, HEIGHT, 1000);
    world.holes[0].radius = 10; // tiny hole
    // Palm 40px away: outside radius*0.9 (9px) but inside the 6% floor (43px).
    const grabbing = hand({ id: 1, grabPhase: 'grabbing', palm: { x: 0.5 + 40 / WIDTH, y: 0.5 } });
    stepWorld(world, [{ type: 'grabStart', handId: 1, point: grabbing.palm }], [grabbing], 1 / 60, WIDTH, HEIGHT, 1500);
    expect(world.holes[0].grabbedBy).toBe(1);
  });

  it('two grabbing hands resize the hole by their separation', () => {
    const world = createWorld('solo');
    stepWorld(world, [pinchStart(1)], [], 1 / 60, WIDTH, HEIGHT, 1000);
    const left = hand({ id: 1, grabPhase: 'grabbing', palm: { x: 0.47, y: 0.5 } });
    const right = hand({ id: 2, grabPhase: 'grabbing', palm: { x: 0.53, y: 0.5 } });
    stepWorld(world, [
      { type: 'grabStart', handId: 1, point: left.palm },
      { type: 'grabStart', handId: 2, point: right.palm },
    ], [left, right], 1 / 60, WIDTH, HEIGHT, 1500);
    stepWorld(world, [], [left, right], 1 / 60, WIDTH, HEIGHT, 1533);
    const separation = 0.06 * WIDTH;
    expect(world.holes[0].radius).toBeCloseTo(separation * 0.45, 0);
    expect(world.holes[0].x).toBeCloseTo(0.5 * WIDTH, 0);
  });

  it('grabEnd with a fast release flicks the hole', () => {
    const world = createWorld('solo');
    stepWorld(world, [pinchStart(1)], [], 1 / 60, WIDTH, HEIGHT, 1000);
    const grabbing = hand({ id: 1, grabPhase: 'grabbing' });
    stepWorld(world, [{ type: 'grabStart', handId: 1, point: { x: 0.5, y: 0.5 } }], [grabbing], 1 / 60, WIDTH, HEIGHT, 1500);
    stepWorld(world, [
      { type: 'grabEnd', handId: 1, releaseVelocity: { x: 2, y: 0 }, peakSpeed: 2 },
    ], [], 1 / 60, WIDTH, HEIGHT, 1600);
    expect(world.holes[0].grabbedBy).toBeNull();
    expect(world.holes[0].velocityX).toBeGreaterThan(0);
  });

  it('flick converts each velocity axis by its own dimension (x:width, y:height)', () => {
    const world = createWorld('solo');
    stepWorld(world, [pinchStart(1)], [], 1 / 60, WIDTH, HEIGHT, 1000);
    const grabbing = hand({ id: 1, grabPhase: 'grabbing' });
    stepWorld(world, [{ type: 'grabStart', handId: 1, point: { x: 0.5, y: 0.5 } }], [grabbing], 1 / 60, WIDTH, HEIGHT, 1500);
    stepWorld(world, [
      { type: 'grabEnd', handId: 1, releaseVelocity: { x: 1, y: 1 }, peakSpeed: 1.4 },
    ], [], 1 / 60, WIDTH, HEIGHT, 1600);
    // Equal normalized velocity on both axes must scale by width vs height
    // respectively. The ratio is independent of damping and flickVelocityScale,
    // so it isolates the dimensional conversion: vy/vx === height/width.
    expect(world.holes[0].velocityX).toBeGreaterThan(0);
    expect(world.holes[0].velocityY / world.holes[0].velocityX).toBeCloseTo(HEIGHT / WIDTH, 5);
  });

  it('a slash through a hole deletes it', () => {
    const world = createWorld('solo');
    stepWorld(world, [pinchStart(1, 0.5, 0.5)], [], 1 / 60, WIDTH, HEIGHT, 1000);
    stepWorld(world, [
      { type: 'slash', handId: 1, from: { x: 0.3, y: 0.5 }, to: { x: 0.7, y: 0.5 } },
    ], [], 1 / 60, WIDTH, HEIGHT, 2000);
    expect(world.holes).toHaveLength(0);
  });

  it('a slash missing every hole deletes nothing', () => {
    const world = createWorld('solo');
    stepWorld(world, [pinchStart(1, 0.5, 0.5)], [], 1 / 60, WIDTH, HEIGHT, 1000);
    stepWorld(world, [
      { type: 'slash', handId: 1, from: { x: 0.1, y: 0.05 }, to: { x: 0.9, y: 0.05 } },
    ], [], 1 / 60, WIDTH, HEIGHT, 2000);
    expect(world.holes).toHaveLength(1);
  });

  it('handLost releases a grabbed hole', () => {
    const world = createWorld('solo');
    stepWorld(world, [pinchStart(1)], [], 1 / 60, WIDTH, HEIGHT, 1000);
    const grabbing = hand({ id: 1, grabPhase: 'grabbing' });
    stepWorld(world, [{ type: 'grabStart', handId: 1, point: { x: 0.5, y: 0.5 } }], [grabbing], 1 / 60, WIDTH, HEIGHT, 1500);
    stepWorld(world, [{ type: 'handLost', handId: 1 }], [], 1 / 60, WIDTH, HEIGHT, 1700);
    expect(world.holes[0].grabbedBy).toBeNull();
  });

  it('multi-mode holes expire; the solo hole does not', () => {
    const multi = createWorld('multi');
    stepWorld(multi, [pinchStart(1)], [], 1 / 60, WIDTH, HEIGHT, 1000);
    stepWorld(multi, [], [], 1 / 60, WIDTH, HEIGHT, 60000);
    expect(multi.holes).toHaveLength(0);

    const solo = createWorld('solo');
    stepWorld(solo, [pinchStart(1)], [], 1 / 60, WIDTH, HEIGHT, 1000);
    stepWorld(solo, [], [], 1 / 60, WIDTH, HEIGHT, 60000);
    expect(solo.holes).toHaveLength(1);
  });
});
