import { SIM_CONFIG } from '../gesture/config';
import { distance } from '../gesture/metrics';
import type { GestureEvent, Point, TrackedHand } from '../gesture/types';
import { stepFreeHole } from './physics';

export type Mode = 'multi' | 'solo';

export type BlackHole = {
  id: number;
  x: number;
  y: number;
  createdAt: number;
  /** Infinity for the solo hole — it never expires. */
  lifespan: number;
  radius: number;
  seed: number;
  velocityX: number;
  velocityY: number;
  grabbedBy: number | null;
};

export type World = {
  mode: Mode;
  holes: BlackHole[];
  nextHoleId: number;
};

export type StepResult = {
  /** True only when a hole was actually created this step (drives audio). */
  spawned: boolean;
  grabbed: boolean;
  flicked: boolean;
  slashed: boolean;
};

export function createWorld(mode: Mode): World {
  return { mode, holes: [], nextHoleId: 1 };
}

function grabRange(hole: BlackHole, width: number, height: number): number {
  const minDimension = Math.min(width, height);
  return Math.max(hole.radius * 0.9, minDimension * SIM_CONFIG.grabPaddingFraction);
}

function distancePointToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return distance(point, from);
  }
  let t = ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared;
  t = Math.min(Math.max(t, 0), 1);
  return distance(point, { x: from.x + t * dx, y: from.y + t * dy });
}

function spawnHole(world: World, point: Point, span: number, width: number, height: number, now: number): boolean {
  if (world.mode === 'solo' && world.holes.length >= 1) {
    return false;
  }
  const minDimension = Math.min(width, height);
  const hole: BlackHole = {
    id: world.nextHoleId,
    x: point.x * width,
    y: point.y * height,
    createdAt: now,
    lifespan: world.mode === 'solo' ? Infinity : 3200 + span * 12000,
    radius: minDimension * (0.07 + span * 0.5),
    seed: Math.random() * Math.PI * 2,
    velocityX: 0,
    velocityY: 0,
    grabbedBy: null,
  };
  world.nextHoleId += 1;
  world.holes.push(hole);
  if (world.holes.length > SIM_CONFIG.maxHolesMulti) {
    world.holes.shift();
  }
  return true;
}

/**
 * Advance the world by one frame: apply gesture events, follow grabbing
 * hands, integrate free holes, expire old ones. Single spawn path, single
 * source of truth for what actually happened (StepResult drives audio).
 */
export function stepWorld(
  world: World,
  events: GestureEvent[],
  hands: TrackedHand[],
  dtSeconds: number,
  width: number,
  height: number,
  now: number,
): StepResult {
  const result: StepResult = { spawned: false, grabbed: false, flicked: false, slashed: false };
  const handById = new Map(hands.map((hand) => [hand.id, hand]));

  for (const event of events) {
    switch (event.type) {
      case 'pinchStart': {
        if (spawnHole(world, event.point, event.span, width, height, now)) {
          result.spawned = true;
        }
        break;
      }
      case 'grabStart': {
        const grabPoint = { x: event.point.x * width, y: event.point.y * height };
        for (const hole of world.holes) {
          const locked = now - hole.createdAt < SIM_CONFIG.spawnGrabLockMs;
          const alreadyHeld = hole.grabbedBy !== null && handById.get(hole.grabbedBy)?.grabPhase === 'grabbing';
          const inRange = distance(grabPoint, { x: hole.x, y: hole.y }) < grabRange(hole, width, height);
          if (!locked && inRange && (!alreadyHeld || hole.grabbedBy !== event.handId)) {
            if (hole.grabbedBy === null) {
              hole.grabbedBy = event.handId;
              result.grabbed = true;
            }
            break;
          }
        }
        break;
      }
      case 'grabEnd':
      case 'handLost': {
        for (const hole of world.holes) {
          if (hole.grabbedBy === event.handId) {
            hole.grabbedBy = null;
            if (event.type === 'grabEnd' && event.peakSpeed > 1e-6) {
              // releaseVelocity is in normalized frame-fractions/sec; convert each
              // axis to px/sec by its own dimension (x by width, y by height).
              hole.velocityX = event.releaseVelocity.x * width * SIM_CONFIG.flickVelocityScale;
              hole.velocityY = event.releaseVelocity.y * height * SIM_CONFIG.flickVelocityScale;
              result.flicked = true;
            }
          }
        }
        break;
      }
      case 'slash': {
        const from = { x: event.from.x * width, y: event.from.y * height };
        const to = { x: event.to.x * width, y: event.to.y * height };
        const before = world.holes.length;
        world.holes = world.holes.filter(
          (hole) => distancePointToSegment({ x: hole.x, y: hole.y }, from, to) > hole.radius,
        );
        if (world.holes.length < before) {
          result.slashed = true;
        }
        break;
      }
      case 'pinchEnd':
        break;
    }
  }

  // Grabbed holes follow hands; two grabbing hands near a hole resize it.
  const grabbingHands = hands.filter((hand) => hand.grabPhase === 'grabbing');
  for (const hole of world.holes) {
    const holders = grabbingHands.filter((hand) => {
      const palm = { x: hand.palm.x * width, y: hand.palm.y * height };
      return hole.grabbedBy === hand.id
        || distance(palm, { x: hole.x, y: hole.y }) < grabRange(hole, width, height);
    });

    if (hole.grabbedBy !== null && holders.length >= 2) {
      const [first, second] = holders;
      const firstPalm = { x: first.palm.x * width, y: first.palm.y * height };
      const secondPalm = { x: second.palm.x * width, y: second.palm.y * height };
      hole.x = (firstPalm.x + secondPalm.x) / 2;
      hole.y = (firstPalm.y + secondPalm.y) / 2;
      const minDimension = Math.min(width, height);
      const separation = distance(firstPalm, secondPalm);
      hole.radius = Math.min(Math.max(separation * 0.45, minDimension * 0.04), minDimension * 0.25);
      hole.velocityX = 0;
      hole.velocityY = 0;
    } else if (hole.grabbedBy !== null) {
      const holder = handById.get(hole.grabbedBy);
      if (holder && holder.grabPhase === 'grabbing') {
        hole.x = holder.palm.x * width;
        hole.y = holder.palm.y * height;
        hole.velocityX = 0;
        hole.velocityY = 0;
      } else {
        hole.grabbedBy = null;
      }
    } else {
      stepFreeHole(hole, dtSeconds, width, height);
    }
  }

  world.holes = world.holes.filter((hole) => now - hole.createdAt < hole.lifespan);
  return result;
}
