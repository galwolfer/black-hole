# Gesture Engine & App Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc, jittery gesture heuristics with a tested, filtered, state-machine-driven gesture engine, and restructure the app into typed modules with real physics, so gestures feel reliable and the app is "advanced and well made."

**Architecture:** Extract a pure, DOM-free gesture pipeline (`src/gesture/`) fed by MediaPipe landmarks: One Euro smoothing → stable hand identity → hysteresis state machines (pinch / grab / slash / flick) → typed `GestureEvent`s. A pure simulation layer (`src/sim/`) consumes events with frame-rate-independent physics. Rendering (`src/render/`), audio (`src/audio/`), and camera/model lifecycle (`src/hooks/`) become thin shells. `App.tsx` shrinks from 627 lines to a ~180-line composition root. Every algorithmic module is unit-tested with Vitest before integration.

**Tech Stack:** React 18 + TypeScript + Vite + Canvas2D + `@mediapipe/tasks-vision` (unchanged). New dev dependency: `vitest`. No new runtime dependencies.

---

## Background: verified defects this plan fixes

Each item was adversarially verified against the code by two independent reviewers (line numbers refer to the current `one-hole-mode` branch):

1. **No landmark smoothing** — `getHandFrames` (`src/handTracking.ts:83-120`) is stateless; all derived signals jitter. → Task 4 (One Euro filter).
2. **Single-threshold pinch, no hysteresis/debounce** (`src/handTracking.ts:97`, edge spawn at `src/App.tsx:446-451`) — flicker spawns multiple holes. → Task 6.
3. **Per-hand state keyed by unstable array index** (`src/App.tsx:185-186, 299, 327-334, 447, 453`) — identity swaps corrupt velocity and pinch edges. → Task 5 (hand registry).
4. **Spawn sound plays before the solo-mode guard** (`src/App.tsx:254-263`) — phantom spawn sound on every pinch when a solo hole exists. → Tasks 11/13 (sound fires only on actual `holeSpawned`).
5. **Grab metric (`openness < 1.35`, `src/App.tsx:304`) overlaps with pinch** — depending on pose, a fresh pinch can immediately read as a grab and the speed-based formula at `src/App.tsx:351-357` rewrites the radius. → Task 7 (curl metric over middle/ring/pinky only + post-pinch refractory).
6. **Absolute-pixel velocity thresholds** (900/1100 px/s, `src/App.tsx:305-306`) — resolution-dependent. → Task 8 (normalized frame-widths/second).
7. **Hardcoded `dt = 0.016`, per-frame damping `0.985`** (`src/App.tsx:373-376`) — frame-rate-dependent physics. → Task 9 (real dt, exponential damping).
8. **Tiny grab target** (`hole.radius * 0.6`, `src/App.tsx:49`, ~17 px minimum at 720p). → Task 10 (`max(radius * 0.9, 6%` of min dimension`)` + visual affordance in Task 13).
9. **Two solo-mode spawn paths in one frame** (`src/App.tsx:439-444` level-triggered + `446-451` edge-triggered). → Task 10 (single event-driven spawn path).
10. **Stale `handMotionRef` entries never cleaned** (`src/App.tsx:327-335`) — phantom velocities/flicks on hand reappearance. → Task 5 (track TTL + `handLost` events).
11. **`detectForVideo` on every rAF regardless of new video frames** (`src/App.tsx:436`) — ~4× redundant inference on 120 Hz displays with a 30 fps camera. → Task 12 (gate on `video.currentTime`).
12. **627-line `App.tsx`, `any`-typed MediaPipe boundary, zero tests.** → Tasks 1, 2, 13.

## Design decisions (synthesized from a 3-proposal design panel)

- **Normalized units end-to-end in the gesture pipeline.** Landmarks stay in MediaPipe's normalized [0,1] space; hand scale is normalized by *knuckle span* (index-MCP↔pinky-MCP — invariant under pinching, unlike the current `span` which mixes in `wrist↔middle-MCP`). Velocities are in frame-widths/second. Pixels appear only in `src/sim/` (hole positions) and `src/render/`.
- **Modes unify.** "Multi" vs "solo" becomes a `maxHoles` config (10 vs 1). Grab/resize/flick/slash work in both modes — the one-hole mode is no longer a separate code path with its own bugs.
- **Solo hole never expires; multi holes keep lifespans.**
- **Filter/threshold constants live in one `config.ts`** so the debug HUD (Task 14) can be used to tune feel without hunting through code. The numbers below are informed starting points, tuned during Task 15.
- **MediaPipe handedness labels are demoted to tiebreakers** in identity matching (they flip in mirrored selfie view); spatial nearest-neighbor wins.

## Target file structure

```
src/
  App.tsx                 (~180 lines: UI shell + composition root)
  main.tsx                (unchanged)
  styles.css              (minor additions)
  gesture/
    config.ts             tunable constants
    types.ts              Point, RawHand, TrackedHand, GestureEvent (no `any`)
    oneEuro.ts            One Euro filter (Casiez 2012) + PointFilter
    metrics.ts            knuckle span, pinch ratio, finger curl, palm center
    handRegistry.ts       stable hand IDs (nearest-neighbor + TTL)
    pinch.ts              pinch Schmitt-trigger FSM
    grab.ts               grab (fist) FSM with post-pinch refractory
    motion.ts             ring-buffer velocity (least-squares), peak speed
    engine.ts             per-frame pipeline: raw hands → TrackedHand[] + events
  sim/
    physics.ts            real-dt integration, exp damping, wall bounce
    world.ts              hole lifecycle reducer (spawn/grab/resize/flick/slash)
  render/
    starfield.ts          stars pre-rendered to offscreen canvas
    skeleton.ts           hand skeleton (moved from handTracking.ts)
    hole.ts               black hole drawing (moved from App.tsx)
    scene.ts              frame composition
    debugHud.ts           gesture-state overlay (?debug=1)
  audio/
    sounds.ts             WebAudio: master gain → compressor; per-event sounds
  hooks/
    useCamera.ts          getUserMedia lifecycle
    useHandLandmarker.ts  model load + per-video-frame detection
tests/
  oneEuro.test.ts  metrics.test.ts  handRegistry.test.ts  pinch.test.ts
  grab.test.ts  motion.test.ts  engine.test.ts  physics.test.ts  world.test.ts
```

`src/handTracking.ts` is deleted at the end of Task 13 (its pieces move to `gesture/` and `render/`).

---

### Task 1: Vitest harness

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest
```

- [ ] **Step 2: Add config and test script**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 3: Write a smoke test**

Create `tests/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Verify**

Run: `npm test` → Expected: 1 passed.
Run: `npm run build` → Expected: builds cleanly (vitest.config.ts must not break `tsc -b`; if `tsc -b` complains about vitest.config.ts, add `"exclude": ["vitest.config.ts"]` to `tsconfig.json` or add the file to `tsconfig.node.json` includes).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/smoke.test.ts
git commit -m "test: add vitest harness"
```

---

### Task 2: Gesture types and config

**Files:**
- Create: `src/gesture/types.ts`
- Create: `src/gesture/config.ts`

No tests (pure declarations), but everything later type-checks against these.

- [ ] **Step 1: Create `src/gesture/types.ts`**

```ts
export type Point = {
  x: number;
  y: number;
};

export type Handedness = 'Left' | 'Right' | 'Unknown';

/** One detected hand straight from MediaPipe, already mirrored to selfie view. */
export type RawHand = {
  /** 21 landmarks, normalized [0,1], mirrored (x = 1 - x). */
  landmarks: Point[];
  handedness: Handedness;
};

export type PinchPhase = 'idle' | 'engaging' | 'pinching';
export type GrabPhase = 'idle' | 'engaging' | 'grabbing';

/** A hand with stable identity, smoothed landmarks, and gesture state. */
export type TrackedHand = {
  id: number;
  handedness: Handedness;
  /** Smoothed, mirrored, normalized landmarks. */
  landmarks: Point[];
  palm: Point;
  pinchPoint: Point;
  knuckleSpan: number;
  pinchRatio: number;
  curl: number;
  pinchPhase: PinchPhase;
  grabPhase: GrabPhase;
  /** Normalized frame-widths per second. */
  velocity: Point;
  speed: number;
};

export type GestureEvent =
  | { type: 'pinchStart'; handId: number; point: Point; span: number }
  | { type: 'pinchEnd'; handId: number }
  | { type: 'grabStart'; handId: number; point: Point }
  | { type: 'grabEnd'; handId: number; releaseVelocity: Point; peakSpeed: number }
  | { type: 'slash'; handId: number; from: Point; to: Point }
  | { type: 'handLost'; handId: number };
```

- [ ] **Step 2: Create `src/gesture/config.ts`**

```ts
/** All gesture tunables in one place so the debug HUD tuning loop has a single target. */
export const GESTURE_CONFIG = {
  filter: {
    minCutoff: 1.4, // Hz — lower = smoother but laggier at rest
    beta: 0.01, // speed coefficient — higher = less lag during fast motion
    dCutoff: 1.0, // Hz — derivative low-pass
  },
  pinch: {
    engageRatio: 0.4, // pinchDistance / knuckleSpan to start a pinch
    releaseRatio: 0.6, // ratio to end it (hysteresis gap kills flicker)
    debounceFrames: 2, // consecutive frames below engage before firing
  },
  grab: {
    engageCurl: 1.1, // mean middle/ring/pinky tip-to-wrist / mcp-to-wrist
    releaseCurl: 1.3,
    debounceFrames: 2,
    postPinchRefractoryMs: 250, // no grab right after a pinch ends
  },
  flick: {
    minSpeed: 1.2, // frame-widths/sec at grab release
    peakWindowMs: 120, // people decelerate at release; use the peak just before
  },
  slash: {
    minSpeed: 2.0, // frame-widths/sec
    horizontalRatio: 0.7, // |vx| must exceed 0.7 * |vy|
    minFrames: 3, // consecutive qualifying frames
    cooldownMs: 500,
  },
  identity: {
    matchGate: 0.25, // max normalized palm distance to match a track
    trackTtlMs: 200, // coast a missing hand this long before declaring it lost
  },
  motion: {
    bufferSize: 8, // ~130-260ms of palm samples for velocity regression
  },
} as const;

export const SIM_CONFIG = {
  dampingK: 0.9, // s^-1; v *= exp(-k*dt) ≈ 0.985/frame at 60fps
  restitution: 0.82,
  minDt: 1 / 240, // clamp real dt into this range (seconds)
  maxDt: 1 / 20,
  flickVelocityScale: 0.42,
  spawnGrabLockMs: 300, // freshly spawned hole can't be grabbed immediately
  grabPaddingFraction: 0.06, // grab target ≥ 6% of min(width,height)
  maxHolesMulti: 10,
} as const;
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc -b` → Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/gesture/types.ts src/gesture/config.ts
git commit -m "feat: add typed gesture model and central config"
```

---

### Task 3: Geometry metrics (pinch ratio, finger curl, palm center)

**Files:**
- Create: `src/gesture/metrics.ts`
- Test: `tests/metrics.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/metrics.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/metrics.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/gesture/metrics.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/metrics.test.ts` → Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gesture/metrics.ts tests/metrics.test.ts
git commit -m "feat: scale-invariant hand metrics (knuckle span, pinch ratio, finger curl)"
```

---

### Task 4: One Euro filter

**Files:**
- Create: `src/gesture/oneEuro.ts`
- Test: `tests/oneEuro.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/oneEuro.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { OneEuroFilter, PointFilter } from '../src/gesture/oneEuro';

const FRAME_MS = 1000 / 30;

describe('OneEuroFilter', () => {
  it('passes the first sample through unchanged', () => {
    const filter = new OneEuroFilter();
    expect(filter.filter(0.42, 0)).toBe(0.42);
  });

  it('is identity on a constant signal', () => {
    const filter = new OneEuroFilter();
    let value = 0;
    for (let i = 0; i < 30; i += 1) {
      value = filter.filter(0.5, i * FRAME_MS);
    }
    expect(value).toBeCloseTo(0.5, 6);
  });

  it('converges to a step within 20 frames at 30fps', () => {
    const filter = new OneEuroFilter();
    filter.filter(0, 0);
    let value = 0;
    for (let i = 1; i <= 20; i += 1) {
      value = filter.filter(1, i * FRAME_MS);
    }
    expect(value).toBeGreaterThan(0.9);
  });

  it('attenuates high-frequency noise', () => {
    const filter = new OneEuroFilter();
    const noisy: number[] = [];
    const filtered: number[] = [];
    for (let i = 0; i < 120; i += 1) {
      // 0.5 plus alternating ±0.02 jitter — like a resting hand.
      const sample = 0.5 + (i % 2 === 0 ? 0.02 : -0.02);
      noisy.push(sample);
      filtered.push(filter.filter(sample, i * FRAME_MS));
    }
    const variance = (values: number[]) => {
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    };
    expect(variance(filtered.slice(30))).toBeLessThan(variance(noisy.slice(30)) * 0.2);
  });

  it('tracks fast motion with little lag (beta kicks in)', () => {
    const filter = new OneEuroFilter();
    let value = 0;
    // Sweep 0 -> 1 in 10 frames (a flick-speed motion).
    for (let i = 0; i <= 10; i += 1) {
      value = filter.filter(i / 10, i * FRAME_MS);
    }
    expect(value).toBeGreaterThan(0.7);
  });

  it('reset clears state', () => {
    const filter = new OneEuroFilter();
    filter.filter(1, 0);
    filter.reset();
    expect(filter.filter(0.3, FRAME_MS)).toBe(0.3);
  });
});

describe('PointFilter', () => {
  it('filters x and y independently', () => {
    const filter = new PointFilter();
    const first = filter.filter({ x: 0.1, y: 0.9 }, 0);
    expect(first).toEqual({ x: 0.1, y: 0.9 });
    const second = filter.filter({ x: 0.1, y: 0.9 }, FRAME_MS);
    expect(second.x).toBeCloseTo(0.1, 6);
    expect(second.y).toBeCloseTo(0.9, 6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/oneEuro.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/gesture/oneEuro.ts`**

```ts
import { GESTURE_CONFIG } from './config';
import type { Point } from './types';

function smoothingFactor(cutoffHz: number, dtSeconds: number): number {
  const r = 2 * Math.PI * cutoffHz * dtSeconds;
  return r / (r + 1);
}

/**
 * One Euro filter (Casiez, Roussel, Vogel — CHI 2012).
 * Adaptive low-pass: heavy smoothing at rest, low lag during fast motion.
 */
export class OneEuroFilter {
  private prevValue: number | null = null;
  private prevDerivative = 0;
  private prevTimeMs: number | null = null;

  constructor(
    private readonly minCutoff: number = GESTURE_CONFIG.filter.minCutoff,
    private readonly beta: number = GESTURE_CONFIG.filter.beta,
    private readonly dCutoff: number = GESTURE_CONFIG.filter.dCutoff,
  ) {}

  reset(): void {
    this.prevValue = null;
    this.prevDerivative = 0;
    this.prevTimeMs = null;
  }

  filter(value: number, timeMs: number): number {
    if (this.prevValue === null || this.prevTimeMs === null) {
      this.prevValue = value;
      this.prevTimeMs = timeMs;
      return value;
    }

    const dt = Math.min(Math.max((timeMs - this.prevTimeMs) / 1000, 1 / 240), 1 / 10);
    const derivative = (value - this.prevValue) / dt;
    const aDerivative = smoothingFactor(this.dCutoff, dt);
    const smoothDerivative = aDerivative * derivative + (1 - aDerivative) * this.prevDerivative;
    const cutoff = this.minCutoff + this.beta * Math.abs(smoothDerivative);
    const a = smoothingFactor(cutoff, dt);
    const filtered = a * value + (1 - a) * this.prevValue;

    this.prevValue = filtered;
    this.prevDerivative = smoothDerivative;
    this.prevTimeMs = timeMs;
    return filtered;
  }
}

export class PointFilter {
  private readonly xFilter = new OneEuroFilter();
  private readonly yFilter = new OneEuroFilter();

  reset(): void {
    this.xFilter.reset();
    this.yFilter.reset();
  }

  filter(point: Point, timeMs: number): Point {
    return {
      x: this.xFilter.filter(point.x, timeMs),
      y: this.yFilter.filter(point.y, timeMs),
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/oneEuro.test.ts` → Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gesture/oneEuro.ts tests/oneEuro.test.ts
git commit -m "feat: One Euro filter for landmark smoothing"
```

---

### Task 5: Stable hand identity registry

**Files:**
- Create: `src/gesture/handRegistry.ts`
- Test: `tests/handRegistry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/handRegistry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HandRegistry } from '../src/gesture/handRegistry';

describe('HandRegistry', () => {
  it('assigns a new id to a new hand and keeps it across frames', () => {
    const registry = new HandRegistry();
    const first = registry.assign([{ palm: { x: 0.3, y: 0.5 }, handedness: 'Left' as const }], 0);
    const second = registry.assign([{ palm: { x: 0.32, y: 0.51 }, handedness: 'Left' as const }], 33);
    expect(first.ids).toHaveLength(1);
    expect(second.ids[0]).toBe(first.ids[0]);
  });

  it('keeps identities when the input array order swaps', () => {
    const registry = new HandRegistry();
    const frame1 = registry.assign(
      [
        { palm: { x: 0.2, y: 0.5 }, handedness: 'Left' as const },
        { palm: { x: 0.8, y: 0.5 }, handedness: 'Right' as const },
      ],
      0,
    );
    // Same hands, swapped array order (MediaPipe does this).
    const frame2 = registry.assign(
      [
        { palm: { x: 0.81, y: 0.5 }, handedness: 'Right' as const },
        { palm: { x: 0.21, y: 0.5 }, handedness: 'Left' as const },
      ],
      33,
    );
    expect(frame2.ids[0]).toBe(frame1.ids[1]);
    expect(frame2.ids[1]).toBe(frame1.ids[0]);
  });

  it('matches by position even when handedness labels flip', () => {
    const registry = new HandRegistry();
    const frame1 = registry.assign([{ palm: { x: 0.4, y: 0.4 }, handedness: 'Left' as const }], 0);
    const frame2 = registry.assign([{ palm: { x: 0.41, y: 0.4 }, handedness: 'Right' as const }], 33);
    expect(frame2.ids[0]).toBe(frame1.ids[0]);
  });

  it('treats a far jump beyond the gate as a new hand', () => {
    const registry = new HandRegistry();
    const frame1 = registry.assign([{ palm: { x: 0.1, y: 0.1 }, handedness: 'Left' as const }], 0);
    const frame2 = registry.assign([{ palm: { x: 0.9, y: 0.9 }, handedness: 'Left' as const }], 33);
    expect(frame2.ids[0]).not.toBe(frame1.ids[0]);
  });

  it('coasts a briefly missing hand, then reports it lost after the TTL', () => {
    const registry = new HandRegistry();
    const frame1 = registry.assign([{ palm: { x: 0.5, y: 0.5 }, handedness: 'Left' as const }], 0);
    const id = frame1.ids[0];

    // Hand missing for one frame, within TTL: not lost yet.
    const frame2 = registry.assign([], 100);
    expect(frame2.lostIds).toHaveLength(0);

    // Reappears nearby: same id.
    const frame3 = registry.assign([{ palm: { x: 0.52, y: 0.5 }, handedness: 'Left' as const }], 150);
    expect(frame3.ids[0]).toBe(id);

    // Gone past the TTL (200ms): lost.
    registry.assign([], 200);
    const frame5 = registry.assign([], 500);
    expect(frame5.lostIds).toContain(id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/handRegistry.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/gesture/handRegistry.ts`**

```ts
import { GESTURE_CONFIG } from './config';
import { distance } from './metrics';
import type { Handedness, Point } from './types';

type Candidate = {
  palm: Point;
  handedness: Handedness;
};

type Track = {
  id: number;
  palm: Point;
  handedness: Handedness;
  lastSeenMs: number;
};

export type AssignResult = {
  /** Stable id for each input hand, same order as the input array. */
  ids: number[];
  /** Tracks that exceeded the TTL this frame. */
  lostIds: number[];
};

/**
 * Greedy nearest-neighbor association of detected hands to persistent tracks.
 * Position dominates; handedness only breaks ties. Tracks coast for a short
 * TTL through detection dropouts before being declared lost.
 */
export class HandRegistry {
  private tracks: Track[] = [];
  private nextId = 1;

  assign(hands: Candidate[], nowMs: number): AssignResult {
    const { matchGate, trackTtlMs } = GESTURE_CONFIG.identity;
    const ids: number[] = new Array(hands.length).fill(0);
    const usedTracks = new Set<number>();
    const usedHands = new Set<number>();

    // All candidate pairs within the gate, cheapest first; same-handedness
    // pairs get a small bonus so labels break ties without overriding position.
    const pairs: Array<{ trackIndex: number; handIndex: number; cost: number }> = [];
    this.tracks.forEach((track, trackIndex) => {
      hands.forEach((hand, handIndex) => {
        const d = distance(track.palm, hand.palm);
        if (d < matchGate) {
          const tieBreak = track.handedness === hand.handedness ? 0 : 0.01;
          pairs.push({ trackIndex, handIndex, cost: d + tieBreak });
        }
      });
    });
    pairs.sort((a, b) => a.cost - b.cost);

    for (const pair of pairs) {
      if (usedTracks.has(pair.trackIndex) || usedHands.has(pair.handIndex)) {
        continue;
      }
      usedTracks.add(pair.trackIndex);
      usedHands.add(pair.handIndex);
      const track = this.tracks[pair.trackIndex];
      const hand = hands[pair.handIndex];
      track.palm = hand.palm;
      track.handedness = hand.handedness;
      track.lastSeenMs = nowMs;
      ids[pair.handIndex] = track.id;
    }

    hands.forEach((hand, handIndex) => {
      if (usedHands.has(handIndex)) {
        return;
      }
      const track: Track = {
        id: this.nextId,
        palm: hand.palm,
        handedness: hand.handedness,
        lastSeenMs: nowMs,
      };
      this.nextId += 1;
      this.tracks.push(track);
      ids[handIndex] = track.id;
    });

    const lostIds: number[] = [];
    this.tracks = this.tracks.filter((track) => {
      if (nowMs - track.lastSeenMs > trackTtlMs) {
        lostIds.push(track.id);
        return false;
      }
      return true;
    });

    return { ids, lostIds };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/handRegistry.test.ts` → Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gesture/handRegistry.ts tests/handRegistry.test.ts
git commit -m "feat: stable hand identity via nearest-neighbor track association"
```

---

### Task 6: Pinch state machine (hysteresis + debounce)

**Files:**
- Create: `src/gesture/pinch.ts`
- Test: `tests/pinch.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/pinch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createPinchFsm, updatePinch } from '../src/gesture/pinch';

// Config: engage < 0.4, release > 0.6, debounceFrames = 2.
function feed(ratios: number[]) {
  let fsm = createPinchFsm();
  const events: string[] = [];
  for (const ratio of ratios) {
    const result = updatePinch(fsm, ratio);
    fsm = result.fsm;
    if (result.started) events.push('start');
    if (result.ended) events.push('end');
  }
  return { fsm, events };
}

describe('pinch FSM', () => {
  it('starts only after debounceFrames consecutive frames below engage', () => {
    expect(feed([0.3]).events).toEqual([]);
    expect(feed([0.3, 0.3]).events).toEqual(['start']);
  });

  it('a single noisy frame cannot start a pinch', () => {
    expect(feed([0.3, 0.5, 0.3, 0.5]).events).toEqual([]);
  });

  it('does not end in the hysteresis band (0.4-0.6)', () => {
    const { events, fsm } = feed([0.3, 0.3, 0.5, 0.55, 0.5]);
    expect(events).toEqual(['start']);
    expect(fsm.phase).toBe('pinching');
  });

  it('ends when the ratio exceeds release', () => {
    expect(feed([0.3, 0.3, 0.65]).events).toEqual(['start', 'end']);
  });

  it('threshold flicker around a single value produces no event storm', () => {
    // Oscillating right at the old single-threshold value (0.55-ish zone).
    const { events } = feed([0.3, 0.3, 0.45, 0.58, 0.45, 0.58, 0.45]);
    expect(events).toEqual(['start']); // still one pinch, no end, no restarts
  });

  it('can pinch again after release', () => {
    expect(feed([0.3, 0.3, 0.7, 0.3, 0.3]).events).toEqual(['start', 'end', 'start']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/pinch.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/gesture/pinch.ts`**

```ts
import { GESTURE_CONFIG } from './config';
import type { PinchPhase } from './types';

export type PinchFsm = {
  phase: PinchPhase;
  engageFrames: number;
};

export type PinchUpdate = {
  fsm: PinchFsm;
  started: boolean;
  ended: boolean;
};

export function createPinchFsm(): PinchFsm {
  return { phase: 'idle', engageFrames: 0 };
}

/**
 * Schmitt trigger with N-frame debounce: engage below engageRatio for
 * debounceFrames consecutive frames; release only above releaseRatio.
 * The gap between the two thresholds eliminates boundary flicker.
 */
export function updatePinch(fsm: PinchFsm, ratio: number): PinchUpdate {
  const { engageRatio, releaseRatio, debounceFrames } = GESTURE_CONFIG.pinch;

  switch (fsm.phase) {
    case 'idle': {
      if (ratio < engageRatio) {
        if (debounceFrames <= 1) {
          return { fsm: { phase: 'pinching', engageFrames: 0 }, started: true, ended: false };
        }
        return { fsm: { phase: 'engaging', engageFrames: 1 }, started: false, ended: false };
      }
      return { fsm, started: false, ended: false };
    }
    case 'engaging': {
      if (ratio < engageRatio) {
        const frames = fsm.engageFrames + 1;
        if (frames >= debounceFrames) {
          return { fsm: { phase: 'pinching', engageFrames: 0 }, started: true, ended: false };
        }
        return { fsm: { phase: 'engaging', engageFrames: frames }, started: false, ended: false };
      }
      return { fsm: { phase: 'idle', engageFrames: 0 }, started: false, ended: false };
    }
    case 'pinching': {
      if (ratio > releaseRatio) {
        return { fsm: { phase: 'idle', engageFrames: 0 }, started: false, ended: true };
      }
      return { fsm, started: false, ended: false };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/pinch.test.ts` → Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gesture/pinch.ts tests/pinch.test.ts
git commit -m "feat: hysteresis pinch state machine with debounce"
```

---

### Task 7: Grab state machine (curl-based, post-pinch refractory)

**Files:**
- Create: `src/gesture/grab.ts`
- Test: `tests/grab.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/grab.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createGrabFsm, updateGrab } from '../src/gesture/grab';

// Config: engage < 1.1, release > 1.3, debounceFrames = 2, refractory 250ms.
type Frame = { curl: number; now: number; pinchActive?: boolean; lastPinchEndMs?: number };

function feed(frames: Frame[]) {
  let fsm = createGrabFsm();
  const events: string[] = [];
  for (const frame of frames) {
    const result = updateGrab(
      fsm,
      frame.curl,
      frame.now,
      frame.pinchActive ?? false,
      frame.lastPinchEndMs ?? -10000,
    );
    fsm = result.fsm;
    if (result.started) events.push('start');
    if (result.ended) events.push('end');
  }
  return { fsm, events };
}

describe('grab FSM', () => {
  it('starts after two consecutive curled frames', () => {
    expect(feed([{ curl: 0.8, now: 0 }]).events).toEqual([]);
    expect(feed([{ curl: 0.8, now: 0 }, { curl: 0.8, now: 33 }]).events).toEqual(['start']);
  });

  it('ends only above the release threshold', () => {
    const { events } = feed([
      { curl: 0.8, now: 0 },
      { curl: 0.8, now: 33 },
      { curl: 1.2, now: 66 }, // in the hysteresis band: still grabbing
      { curl: 1.4, now: 99 }, // released
    ]);
    expect(events).toEqual(['start', 'end']);
  });

  it('never engages while a pinch is active', () => {
    const { events } = feed([
      { curl: 0.8, now: 0, pinchActive: true },
      { curl: 0.8, now: 33, pinchActive: true },
      { curl: 0.8, now: 66, pinchActive: true },
    ]);
    expect(events).toEqual([]);
  });

  it('never engages during the post-pinch refractory period', () => {
    const { events } = feed([
      { curl: 0.8, now: 100, lastPinchEndMs: 50 },
      { curl: 0.8, now: 133, lastPinchEndMs: 50 },
    ]);
    expect(events).toEqual([]); // only 83ms since pinch end < 250ms
  });

  it('engages normally after the refractory period expires', () => {
    const { events } = feed([
      { curl: 0.8, now: 400, lastPinchEndMs: 50 },
      { curl: 0.8, now: 433, lastPinchEndMs: 50 },
    ]);
    expect(events).toEqual(['start']);
  });

  it('an active grab is not cancelled by refractory rules', () => {
    const { fsm } = feed([
      { curl: 0.8, now: 0 },
      { curl: 0.8, now: 33 },
      { curl: 0.8, now: 66, pinchActive: true }, // weird pose mid-grab
    ]);
    expect(fsm.phase).toBe('grabbing');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/grab.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/gesture/grab.ts`**

```ts
import { GESTURE_CONFIG } from './config';
import type { GrabPhase } from './types';

export type GrabFsm = {
  phase: GrabPhase;
  engageFrames: number;
};

export type GrabUpdate = {
  fsm: GrabFsm;
  started: boolean;
  ended: boolean;
};

export function createGrabFsm(): GrabFsm {
  return { phase: 'idle', engageFrames: 0 };
}

/**
 * Fist detection on the middle/ring/pinky curl metric. Engagement is blocked
 * while a pinch is active and for postPinchRefractoryMs after it ends, so a
 * pinch can never bleed into a grab. An already-active grab is unaffected.
 */
export function updateGrab(
  fsm: GrabFsm,
  curl: number,
  nowMs: number,
  pinchActive: boolean,
  lastPinchEndMs: number,
): GrabUpdate {
  const { engageCurl, releaseCurl, debounceFrames, postPinchRefractoryMs } = GESTURE_CONFIG.grab;
  const engageBlocked = pinchActive || nowMs - lastPinchEndMs < postPinchRefractoryMs;

  switch (fsm.phase) {
    case 'idle': {
      if (curl < engageCurl && !engageBlocked) {
        if (debounceFrames <= 1) {
          return { fsm: { phase: 'grabbing', engageFrames: 0 }, started: true, ended: false };
        }
        return { fsm: { phase: 'engaging', engageFrames: 1 }, started: false, ended: false };
      }
      return { fsm, started: false, ended: false };
    }
    case 'engaging': {
      if (curl < engageCurl && !engageBlocked) {
        const frames = fsm.engageFrames + 1;
        if (frames >= debounceFrames) {
          return { fsm: { phase: 'grabbing', engageFrames: 0 }, started: true, ended: false };
        }
        return { fsm: { phase: 'engaging', engageFrames: frames }, started: false, ended: false };
      }
      return { fsm: { phase: 'idle', engageFrames: 0 }, started: false, ended: false };
    }
    case 'grabbing': {
      if (curl > releaseCurl) {
        return { fsm: { phase: 'idle', engageFrames: 0 }, started: false, ended: true };
      }
      return { fsm, started: false, ended: false };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/grab.test.ts` → Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gesture/grab.ts tests/grab.test.ts
git commit -m "feat: curl-based grab FSM with post-pinch refractory"
```

---

### Task 8: Motion tracker (regression velocity, peak speed)

**Files:**
- Create: `src/gesture/motion.ts`
- Test: `tests/motion.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/motion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MotionTracker } from '../src/gesture/motion';

const FRAME_MS = 1000 / 30;

describe('MotionTracker', () => {
  it('reports zero velocity with fewer than two samples', () => {
    const tracker = new MotionTracker();
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 });
    tracker.push({ x: 0.5, y: 0.5 }, 0);
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 });
  });

  it('measures constant velocity exactly (least squares on a line)', () => {
    const tracker = new MotionTracker();
    // 0.6 frame-widths per second along x.
    for (let i = 0; i < 8; i += 1) {
      tracker.push({ x: 0.1 + 0.6 * (i * FRAME_MS) / 1000, y: 0.5 }, i * FRAME_MS);
    }
    const velocity = tracker.velocity();
    expect(velocity.x).toBeCloseTo(0.6, 2);
    expect(velocity.y).toBeCloseTo(0, 5);
  });

  it('is robust to a single-frame outlier (unlike two-sample differencing)', () => {
    const tracker = new MotionTracker();
    for (let i = 0; i < 8; i += 1) {
      const x = 0.5 + (i === 4 ? 0.03 : 0); // one jitter spike
      tracker.push({ x, y: 0.5 }, i * FRAME_MS);
    }
    expect(Math.abs(tracker.velocity().x)).toBeLessThan(0.3);
    // Two-sample differencing on the spike frame would read 0.03 / 0.033 ≈ 0.9 w/s.
  });

  it('peakSpeed returns the max speed within the window', () => {
    const tracker = new MotionTracker();
    let x = 0;
    const speeds = [0, 0.5, 2.0, 1.0, 0.2]; // burst in the middle
    for (let i = 0; i < speeds.length; i += 1) {
      x += (speeds[i] * FRAME_MS) / 1000;
      tracker.push({ x, y: 0.5 }, i * FRAME_MS);
      tracker.recordSpeed(i * FRAME_MS);
    }
    const now = (speeds.length - 1) * FRAME_MS;
    expect(tracker.peakSpeed(200, now)).toBeGreaterThan(1.0);
  });

  it('reset clears history', () => {
    const tracker = new MotionTracker();
    tracker.push({ x: 0, y: 0 }, 0);
    tracker.push({ x: 1, y: 0 }, FRAME_MS);
    tracker.reset();
    expect(tracker.velocity()).toEqual({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/motion.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/gesture/motion.ts`**

```ts
import { GESTURE_CONFIG } from './config';
import type { Point } from './types';

type Sample = { x: number; y: number; tMs: number };
type SpeedSample = { speed: number; tMs: number };

/**
 * Ring buffer of recent (already-filtered) palm positions. Velocity comes
 * from a least-squares line fit over the buffer — far more robust to
 * single-frame jitter than two-sample differencing. Units are normalized
 * frame-widths per second, so thresholds are resolution-independent.
 */
export class MotionTracker {
  private samples: Sample[] = [];
  private speedHistory: SpeedSample[] = [];

  reset(): void {
    this.samples = [];
    this.speedHistory = [];
  }

  push(point: Point, tMs: number): void {
    this.samples.push({ x: point.x, y: point.y, tMs });
    if (this.samples.length > GESTURE_CONFIG.motion.bufferSize) {
      this.samples.shift();
    }
  }

  /** Least-squares slope of position vs time, per second. */
  velocity(): Point {
    const n = this.samples.length;
    if (n < 2) {
      return { x: 0, y: 0 };
    }
    let meanT = 0;
    let meanX = 0;
    let meanY = 0;
    for (const sample of this.samples) {
      meanT += sample.tMs;
      meanX += sample.x;
      meanY += sample.y;
    }
    meanT /= n;
    meanX /= n;
    meanY /= n;

    let covTX = 0;
    let covTY = 0;
    let varT = 0;
    for (const sample of this.samples) {
      const dt = sample.tMs - meanT;
      covTX += dt * (sample.x - meanX);
      covTY += dt * (sample.y - meanY);
      varT += dt * dt;
    }
    if (varT === 0) {
      return { x: 0, y: 0 };
    }
    return { x: (covTX / varT) * 1000, y: (covTY / varT) * 1000 };
  }

  speed(): number {
    const v = this.velocity();
    return Math.hypot(v.x, v.y);
  }

  /** Call once per frame after push() so peakSpeed has a history to scan. */
  recordSpeed(tMs: number): void {
    this.speedHistory.push({ speed: this.speed(), tMs });
    // Keep ~0.5s of history.
    while (this.speedHistory.length > 0 && tMs - this.speedHistory[0].tMs > 500) {
      this.speedHistory.shift();
    }
  }

  /** Max recorded speed within the trailing window — flicks decelerate at release. */
  peakSpeed(windowMs: number, nowMs: number): number {
    let peak = 0;
    for (const sample of this.speedHistory) {
      if (nowMs - sample.tMs <= windowMs && sample.speed > peak) {
        peak = sample.speed;
      }
    }
    return peak;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/motion.test.ts` → Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gesture/motion.ts tests/motion.test.ts
git commit -m "feat: regression-based motion tracking in normalized units"
```

---

### Task 9: Physics (real dt, exponential damping)

**Files:**
- Create: `src/sim/physics.ts`
- Test: `tests/physics.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/physics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { stepFreeHole } from '../src/sim/physics';

function makeHole(velocityX: number, velocityY: number) {
  return {
    x: 400, y: 300, radius: 50,
    velocityX, velocityY,
  };
}

const WIDTH = 1280;
const HEIGHT = 720;

describe('stepFreeHole', () => {
  it('is frame-rate independent: 1s at 30Hz vs 120Hz ends within 2%', () => {
    const at30 = makeHole(600, 0);
    const at120 = makeHole(600, 0);
    for (let i = 0; i < 30; i += 1) stepFreeHole(at30, 1 / 30, WIDTH, HEIGHT);
    for (let i = 0; i < 120; i += 1) stepFreeHole(at120, 1 / 120, WIDTH, HEIGHT);
    expect(Math.abs(at30.x - at120.x)).toBeLessThan(Math.abs(at120.x - 400) * 0.02 + 1);
    expect(Math.abs(at30.velocityX - at120.velocityX)).toBeLessThan(at120.velocityX * 0.02 + 1);
  });

  it('damps velocity exponentially', () => {
    const hole = makeHole(1000, 0);
    stepFreeHole(hole, 1, WIDTH, HEIGHT);
    // v(1s) = 1000 * exp(-0.9) ≈ 406.6
    expect(hole.velocityX).toBeCloseTo(1000 * Math.exp(-0.9), 0);
  });

  it('bounces off walls with restitution and stays in bounds', () => {
    const hole = makeHole(-30000, 0); // will cross the left wall this step
    stepFreeHole(hole, 1 / 30, WIDTH, HEIGHT);
    expect(hole.x).toBeGreaterThanOrEqual(hole.radius);
    expect(hole.velocityX).toBeGreaterThan(0); // reversed
  });

  it('clamps absurd dt values instead of exploding', () => {
    const hole = makeHole(600, 0);
    stepFreeHole(hole, 5, WIDTH, HEIGHT); // tab was backgrounded for 5s
    expect(hole.x).toBeLessThan(WIDTH); // moved at most one clamped step
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/physics.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/sim/physics.ts`**

```ts
import { SIM_CONFIG } from '../gesture/config';

export type MovingHole = {
  x: number;
  y: number;
  radius: number;
  velocityX: number;
  velocityY: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Integrate a free (ungrabbed) hole with real elapsed time. Damping is
 * exponential in dt, so 30Hz and 120Hz displays produce the same motion.
 * Mutates the hole in place (it lives in a ref, not React state).
 */
export function stepFreeHole(hole: MovingHole, dtSeconds: number, width: number, height: number): void {
  const dt = clamp(dtSeconds, SIM_CONFIG.minDt, SIM_CONFIG.maxDt);
  const damping = Math.exp(-SIM_CONFIG.dampingK * dt);

  hole.velocityX *= damping;
  hole.velocityY *= damping;
  hole.x += hole.velocityX * dt;
  hole.y += hole.velocityY * dt;

  if (hole.x - hole.radius < 0 || hole.x + hole.radius > width) {
    hole.velocityX *= -SIM_CONFIG.restitution;
    hole.x = clamp(hole.x, hole.radius, width - hole.radius);
  }
  if (hole.y - hole.radius < 0 || hole.y + hole.radius > height) {
    hole.velocityY *= -SIM_CONFIG.restitution;
    hole.y = clamp(hole.y, hole.radius, height - hole.radius);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/physics.test.ts` → Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/physics.ts tests/physics.test.ts
git commit -m "feat: frame-rate-independent hole physics"
```

---

### Task 10: World reducer (hole lifecycle from gesture events)

**Files:**
- Create: `src/sim/world.ts`
- Test: `tests/world.test.ts`

This is where defects 4, 5, 8, 9 are structurally fixed: one event-driven spawn path, spawn-lock against instant grabbing, enlarged grab targets, and a `holeSpawned` flag the audio layer keys off (so no sound without a spawn).

- [ ] **Step 1: Write the failing tests**

Create `tests/world.test.ts`:

```ts
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
    const left = hand({ id: 1, grabPhase: 'grabbing', palm: { x: 0.4, y: 0.5 } });
    const right = hand({ id: 2, grabPhase: 'grabbing', palm: { x: 0.6, y: 0.5 } });
    stepWorld(world, [
      { type: 'grabStart', handId: 1, point: left.palm },
      { type: 'grabStart', handId: 2, point: right.palm },
    ], [left, right], 1 / 60, WIDTH, HEIGHT, 1500);
    stepWorld(world, [], [left, right], 1 / 60, WIDTH, HEIGHT, 1533);
    const separation = 0.2 * WIDTH;
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/world.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/sim/world.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/world.test.ts` → Expected: all PASS.
Note: `radius: minDimension * (0.07 + span * 0.5)` and `lifespan: 3200 + span * 12000` rescale the old pixel-era constants for normalized `span` (a typical knuckle span is ~0.10-0.18 normalized vs the old mixed metric); the debug HUD tuning pass (Task 15) finalizes them.

- [ ] **Step 5: Commit**

```bash
git add src/sim/world.ts tests/world.test.ts
git commit -m "feat: event-driven hole world with spawn lock and segment slash"
```

---

### Task 11: Gesture engine (the per-frame pipeline)

**Files:**
- Create: `src/gesture/engine.ts`
- Test: `tests/engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/engine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GestureEngine } from '../src/gesture/engine';
import type { Point, RawHand } from '../src/gesture/types';
import {
  INDEX_MCP, INDEX_TIP, MIDDLE_MCP, MIDDLE_TIP, PINKY_MCP, PINKY_TIP,
  RING_MCP, RING_TIP, THUMB_TIP, WRIST,
} from '../src/gesture/metrics';

const FRAME_MS = 1000 / 30;

function makeHand(center: Point, options: { pinching?: boolean; fist?: boolean } = {}): RawHand {
  const landmarks: Point[] = Array.from({ length: 21 }, () => ({ ...center }));
  const offset = (dx: number, dy: number): Point => ({ x: center.x + dx, y: center.y + dy });
  landmarks[WRIST] = offset(0, 0.15);
  landmarks[INDEX_MCP] = offset(-0.05, 0);
  landmarks[MIDDLE_MCP] = offset(0, 0);
  landmarks[RING_MCP] = offset(0.04, 0);
  landmarks[PINKY_MCP] = offset(0.08, 0.01);
  if (options.fist) {
    landmarks[MIDDLE_TIP] = offset(0, 0.1);
    landmarks[RING_TIP] = offset(0.03, 0.1);
    landmarks[PINKY_TIP] = offset(0.06, 0.11);
    landmarks[THUMB_TIP] = offset(-0.05, 0.08);
    landmarks[INDEX_TIP] = offset(-0.04, 0.09);
  } else {
    landmarks[MIDDLE_TIP] = offset(0, -0.18);
    landmarks[RING_TIP] = offset(0.05, -0.16);
    landmarks[PINKY_TIP] = offset(0.09, -0.12);
    if (options.pinching) {
      landmarks[THUMB_TIP] = offset(-0.045, -0.14);
      landmarks[INDEX_TIP] = offset(-0.045, -0.14);
    } else {
      landmarks[THUMB_TIP] = offset(-0.1, -0.08);
      landmarks[INDEX_TIP] = offset(-0.05, -0.16);
    }
  }
  return { landmarks, handedness: 'Right' };
}

function run(engine: GestureEngine, frames: RawHand[][], startFrame = 0) {
  const allEvents = [];
  let hands;
  for (let i = 0; i < frames.length; i += 1) {
    const result = engine.update(frames[i], (startFrame + i) * FRAME_MS);
    allEvents.push(...result.events);
    hands = result.hands;
  }
  return { events: allEvents, hands };
}

describe('GestureEngine', () => {
  it('emits pinchStart once for a held pinch, then pinchEnd on release', () => {
    const engine = new GestureEngine();
    const open = makeHand({ x: 0.5, y: 0.5 });
    const pinch = makeHand({ x: 0.5, y: 0.5 }, { pinching: true });
    const { events } = run(engine, [open, open, pinch, pinch, pinch, pinch, open, open]);
    const types = events.map((event) => event.type);
    expect(types.filter((t) => t === 'pinchStart')).toHaveLength(1);
    expect(types.filter((t) => t === 'pinchEnd')).toHaveLength(1);
  });

  it('a fist emits grabStart (after pinch refractory is irrelevant here)', () => {
    const engine = new GestureEngine();
    const open = makeHand({ x: 0.5, y: 0.5 });
    const fist = makeHand({ x: 0.5, y: 0.5 }, { fist: true });
    const { events } = run(engine, [open, open, fist, fist, fist]);
    expect(events.map((event) => event.type)).toContain('grabStart');
  });

  it('pinching does NOT emit grabStart (curl stays high)', () => {
    const engine = new GestureEngine();
    const open = makeHand({ x: 0.5, y: 0.5 });
    const pinch = makeHand({ x: 0.5, y: 0.5 }, { pinching: true });
    const { events } = run(engine, [open, open, pinch, pinch, pinch, pinch]);
    expect(events.map((event) => event.type)).not.toContain('grabStart');
  });

  it('keeps hand ids stable when the input order swaps', () => {
    const engine = new GestureEngine();
    const left = makeHand({ x: 0.25, y: 0.5 });
    const right = makeHand({ x: 0.75, y: 0.5 });
    const frame1 = engine.update([left, right], 0);
    const frame2 = engine.update([right, left], FRAME_MS);
    expect(frame2.hands[0].id).toBe(frame1.hands[1].id);
    expect(frame2.hands[1].id).toBe(frame1.hands[0].id);
  });

  it('emits handLost when a hand disappears past the TTL', () => {
    const engine = new GestureEngine();
    const open = makeHand({ x: 0.5, y: 0.5 });
    engine.update([open], 0);
    engine.update([], 100);
    const late = engine.update([], 400);
    expect(late.events.map((event) => event.type)).toContain('handLost');
  });

  it('grabEnd carries release velocity from the motion tracker', () => {
    const engine = new GestureEngine();
    const frames: RawHand[][] = [];
    // Fist sweeping right fast, then opens.
    for (let i = 0; i < 8; i += 1) {
      frames.push([makeHand({ x: 0.2 + i * 0.06, y: 0.5 }, { fist: true })]);
    }
    frames.push([makeHand({ x: 0.7, y: 0.5 })]);
    const { events } = run(engine, frames);
    const grabEnd = events.find((event) => event.type === 'grabEnd');
    expect(grabEnd).toBeDefined();
    if (grabEnd && grabEnd.type === 'grabEnd') {
      expect(grabEnd.peakSpeed).toBeGreaterThan(1);
      expect(grabEnd.releaseVelocity.x).toBeGreaterThan(0);
    }
  });

  it('a fast horizontal open-hand sweep emits exactly one slash (cooldown)', () => {
    const engine = new GestureEngine();
    const frames: RawHand[][] = [];
    // 0.09 normalized per 33ms ≈ 2.7 widths/sec, open hand, horizontal.
    for (let i = 0; i < 9; i += 1) {
      frames.push([makeHand({ x: 0.05 + i * 0.09, y: 0.5 })]);
    }
    const { events } = run(engine, frames);
    expect(events.filter((event) => event.type === 'slash')).toHaveLength(1);
  });

  it('a slow open-hand drift emits no slash', () => {
    const engine = new GestureEngine();
    const frames: RawHand[][] = [];
    for (let i = 0; i < 12; i += 1) {
      frames.push([makeHand({ x: 0.3 + i * 0.01, y: 0.5 })]);
    }
    const { events } = run(engine, frames);
    expect(events.filter((event) => event.type === 'slash')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/gesture/engine.ts`**

```ts
import { GESTURE_CONFIG } from './config';
import { HandRegistry } from './handRegistry';
import {
  fingerCurl, knuckleSpan, palmCenter, pinchMidpoint, pinchRatio,
} from './metrics';
import { MotionTracker } from './motion';
import { OneEuroFilter, PointFilter } from './oneEuro';
import { createGrabFsm, updateGrab, type GrabFsm } from './grab';
import { createPinchFsm, updatePinch, type PinchFsm } from './pinch';
import type { GestureEvent, Point, RawHand, TrackedHand } from './types';

type HandState = {
  filters: PointFilter[];
  pinchFsm: PinchFsm;
  grabFsm: GrabFsm;
  motion: MotionTracker;
  lastPinchEndMs: number;
  slashFrames: number;
  slashCooldownUntilMs: number;
  slashStart: Point | null;
};

function createHandState(): HandState {
  return {
    filters: Array.from({ length: 21 }, () => new PointFilter()),
    pinchFsm: createPinchFsm(),
    grabFsm: createGrabFsm(),
    motion: new MotionTracker(),
    lastPinchEndMs: -100000,
    slashFrames: 0,
    slashCooldownUntilMs: 0,
    slashStart: null,
  };
}

/**
 * Per-frame pipeline: raw mirrored landmarks → identity assignment →
 * One Euro smoothing → metrics → FSM updates → typed gesture events.
 * Pure with respect to the DOM and MediaPipe; fully unit-testable.
 */
export class GestureEngine {
  private readonly registry = new HandRegistry();
  private readonly states = new Map<number, HandState>();

  reset(): void {
    this.states.clear();
  }

  update(rawHands: RawHand[], nowMs: number): { hands: TrackedHand[]; events: GestureEvent[] } {
    const events: GestureEvent[] = [];

    const { ids, lostIds } = this.registry.assign(
      rawHands.map((hand) => ({ palm: palmCenter(hand.landmarks), handedness: hand.handedness })),
      nowMs,
    );

    for (const lostId of lostIds) {
      this.states.delete(lostId);
      events.push({ type: 'handLost', handId: lostId });
    }

    const hands: TrackedHand[] = rawHands.map((raw, index) => {
      const id = ids[index];
      let state = this.states.get(id);
      if (!state) {
        state = createHandState();
        this.states.set(id, state);
      }

      const landmarks = raw.landmarks.map((point, landmarkIndex) =>
        state!.filters[landmarkIndex].filter(point, nowMs),
      );

      const palm = palmCenter(landmarks);
      const span = knuckleSpan(landmarks);
      const ratio = pinchRatio(landmarks);
      const curl = fingerCurl(landmarks);
      const pinchPoint = pinchMidpoint(landmarks);

      state.motion.push(palm, nowMs);
      state.motion.recordSpeed(nowMs);
      const velocity = state.motion.velocity();
      const speed = Math.hypot(velocity.x, velocity.y);

      const pinchUpdate = updatePinch(state.pinchFsm, ratio);
      state.pinchFsm = pinchUpdate.fsm;
      if (pinchUpdate.started) {
        events.push({ type: 'pinchStart', handId: id, point: pinchPoint, span });
      }
      if (pinchUpdate.ended) {
        state.lastPinchEndMs = nowMs;
        events.push({ type: 'pinchEnd', handId: id });
      }

      const grabUpdate = updateGrab(
        state.grabFsm,
        curl,
        nowMs,
        state.pinchFsm.phase !== 'idle',
        state.lastPinchEndMs,
      );
      state.grabFsm = grabUpdate.fsm;
      if (grabUpdate.started) {
        events.push({ type: 'grabStart', handId: id, point: palm });
      }
      if (grabUpdate.ended) {
        events.push({
          type: 'grabEnd',
          handId: id,
          releaseVelocity: velocity,
          peakSpeed: state.motion.peakSpeed(GESTURE_CONFIG.flick.peakWindowMs, nowMs),
        });
      }

      // Slash: sustained fast, mostly-horizontal, open-hand motion.
      const { minSpeed, horizontalRatio, minFrames, cooldownMs } = GESTURE_CONFIG.slash;
      const handOpen = state.pinchFsm.phase === 'idle' && state.grabFsm.phase === 'idle';
      const qualifies =
        handOpen
        && speed > minSpeed
        && Math.abs(velocity.x) > Math.abs(velocity.y) * horizontalRatio
        && nowMs >= state.slashCooldownUntilMs;
      if (qualifies) {
        if (state.slashFrames === 0) {
          state.slashStart = palm;
        }
        state.slashFrames += 1;
        if (state.slashFrames >= minFrames && state.slashStart) {
          events.push({ type: 'slash', handId: id, from: state.slashStart, to: palm });
          state.slashFrames = 0;
          state.slashStart = null;
          state.slashCooldownUntilMs = nowMs + cooldownMs;
        }
      } else {
        state.slashFrames = 0;
        state.slashStart = null;
      }

      return {
        id,
        handedness: raw.handedness,
        landmarks,
        palm,
        pinchPoint,
        knuckleSpan: span,
        pinchRatio: ratio,
        curl,
        pinchPhase: state.pinchFsm.phase,
        grabPhase: state.grabFsm.phase,
        velocity,
        speed,
      };
    });

    return { hands, events };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine.test.ts` → Expected: all PASS.
If the slash or grabEnd tests are flaky, the synthetic hand geometry is the suspect — print `pinchRatio`/`curl` from a debug test and adjust the fixture offsets, not the engine.

- [ ] **Step 5: Run the whole suite**

Run: `npm test` → Expected: all files PASS.

- [ ] **Step 6: Commit**

```bash
git add src/gesture/engine.ts tests/engine.test.ts
git commit -m "feat: gesture engine pipeline emitting typed events"
```

---

### Task 12: Camera + landmarker hooks (typed, frame-gated)

**Files:**
- Create: `src/hooks/useCamera.ts`
- Create: `src/hooks/useHandLandmarker.ts`

These are extractions of `src/App.tsx:476-535` with two changes: a typed MediaPipe boundary and detection gated on new video frames. No unit tests (browser APIs); verified by build + manual run in Task 13.

- [ ] **Step 1: Create `src/hooks/useCamera.ts`**

```ts
import { useEffect, useRef, useState } from 'react';

export type CameraState = {
  status: 'starting' | 'ready' | 'error';
  error: string | null;
};

/** Owns the getUserMedia lifecycle for the given video element. */
export function useCamera(videoRef: React.RefObject<HTMLVideoElement | null>): CameraState {
  const [state, setState] = useState<CameraState>({ status: 'starting', error: null });
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          throw new Error('Video element not ready.');
        }
        video.srcObject = stream;
        await video.play();
        if (!cancelled) {
          setState({ status: 'ready', error: null });
        }
      } catch (cause) {
        if (!cancelled) {
          const message = cause instanceof Error ? cause.message : 'Unable to start the camera.';
          setState({ status: 'error', error: message });
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [videoRef]);

  return state;
}
```

- [ ] **Step 2: Create `src/hooks/useHandLandmarker.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { mirrorPoint } from '../gesture/metrics';
import type { Handedness, RawHand } from '../gesture/types';

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm';

export type LandmarkerState = {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
};

/** Typed adapter from a MediaPipe result to mirrored RawHands. */
export function toRawHands(result: HandLandmarkerResult): RawHand[] {
  return result.landmarks.map((handLandmarks, index) => {
    const categoryName = result.handednesses[index]?.[0]?.categoryName;
    const handedness: Handedness =
      categoryName === 'Left' || categoryName === 'Right' ? categoryName : 'Unknown';
    return {
      landmarks: handLandmarks.map((point) => mirrorPoint({ x: point.x, y: point.y })),
      handedness,
    };
  });
}

/**
 * Loads the hand model and exposes detect(video, now), which runs inference
 * only when the video has produced a new frame (saves ~4x inference on
 * 120Hz displays with a 30fps camera) and returns the previous result otherwise.
 */
export function useHandLandmarker(): {
  state: LandmarkerState;
  detect: (video: HTMLVideoElement, nowMs: number) => RawHand[];
} {
  const [state, setState] = useState<LandmarkerState>({ status: 'loading', error: null });
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const lastHandsRef = useRef<RawHand[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        if (cancelled) return;
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.5,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setState({ status: 'ready', error: null });
      } catch (cause) {
        if (!cancelled) {
          const message = cause instanceof Error ? cause.message : 'Failed to load the hand model.';
          setState({ status: 'error', error: message });
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  // Referentially stable: App's rAF effect depends on `detect`, and an
  // unstable identity would restart the loop (and close the audio engine)
  // on every re-render.
  const detect = useCallback((video: HTMLVideoElement, nowMs: number): RawHand[] => {
    const landmarker = landmarkerRef.current;
    if (!landmarker || video.readyState < 2) {
      return lastHandsRef.current;
    }
    if (video.currentTime === lastVideoTimeRef.current) {
      return lastHandsRef.current; // no new camera frame; reuse last result
    }
    lastVideoTimeRef.current = video.currentTime;
    const result = landmarker.detectForVideo(video, nowMs);
    lastHandsRef.current = toRawHands(result);
    return lastHandsRef.current;
  }, []);

  return { state, detect };
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc -b` → Expected: no errors. (If `HandLandmarkerResult` is not exported in the installed version, import the type via `import type { HandLandmarkerResult } from '@mediapipe/tasks-vision'` — it is exported in 0.10.21.)

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useCamera.ts src/hooks/useHandLandmarker.ts
git commit -m "refactor: typed camera and landmarker hooks with frame-gated detection"
```

---

### Task 13: Renderers, audio, and the new slim App.tsx

**Files:**
- Create: `src/render/starfield.ts`, `src/render/skeleton.ts`, `src/render/hole.ts`, `src/render/scene.ts`
- Create: `src/audio/sounds.ts`
- Modify: `src/App.tsx` (full rewrite, ~180 lines)
- Delete: `src/handTracking.ts`

This is the integration task. Drawing code moves mostly verbatim; the behavioral changes are: starfield pre-rendered offscreen (96 arc fills → 1 drawImage per frame), audio behind a master compressor and driven only by `StepResult` (fixing the phantom-spawn-sound bug), and grab-range highlight affordance.

- [ ] **Step 1: Create `src/render/starfield.ts`**

```ts
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
```

- [ ] **Step 2: Create `src/render/skeleton.ts`**

Move `HAND_CONNECTIONS` and `drawHandSkeleton` verbatim from `src/handTracking.ts:23-45` and `122-170`, with the signature adapted to `TrackedHand` and a pinch-progress ring:

```ts
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
```

- [ ] **Step 3: Create `src/render/hole.ts`**

Move `drawBlackHole` from `src/App.tsx:67-129` verbatim, importing `BlackHole` from `../sim/world`, with two changes: (a) `fade` handles `lifespan: Infinity` (`const progress = Number.isFinite(hole.lifespan) ? clamp(age / hole.lifespan, 0, 1) : 0;`), and (b) add a grab-affordance ring drawn when a provided `highlight` flag is true:

```ts
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
```

- [ ] **Step 4: Create `src/render/scene.ts`**

Composition of `drawScene` from `src/App.tsx:131-172`, using the new pieces. The `highlight` flag implements the grab affordance: a dashed ring appears when any hand is inside grab range, teaching the user where grabbing works.

```ts
import { SIM_CONFIG } from '../gesture/config';
import type { TrackedHand } from '../gesture/types';
import type { BlackHole } from '../sim/world';
import { drawBlackHole } from './hole';
import { drawHandSkeleton } from './skeleton';
import type { StarfieldRenderer } from './starfield';

function isHandNearHole(hand: TrackedHand, hole: BlackHole, width: number, height: number): boolean {
  const palmX = hand.palm.x * width;
  const palmY = hand.palm.y * height;
  const range = Math.max(hole.radius * 0.9, Math.min(width, height) * SIM_CONFIG.grabPaddingFraction);
  return Math.hypot(palmX - hole.x, palmY - hole.y) < range;
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  starfield: StarfieldRenderer,
  hands: TrackedHand[],
  holes: BlackHole[],
  now: number,
): void {
  ctx.clearRect(0, 0, width, height);

  const aura = ctx.createLinearGradient(0, 0, width, height);
  aura.addColorStop(0, 'rgba(12, 20, 44, 0.06)');
  aura.addColorStop(0.5, 'rgba(3, 4, 8, 0.02)');
  aura.addColorStop(1, 'rgba(18, 34, 58, 0.08)');
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, width, height);

  starfield.draw(ctx, width, height, now);

  for (const hand of hands) {
    drawHandSkeleton(ctx, hand, width, height, now);
  }

  for (const hole of holes) {
    const highlight = hole.grabbedBy === null
      && hands.some((hand) => isHandNearHole(hand, hole, width, height));
    drawBlackHole(ctx, hole, now, highlight);
  }

  const vignette = ctx.createRadialGradient(
    width * 0.5, height * 0.48, Math.min(width, height) * 0.12,
    width * 0.5, height * 0.5, Math.max(width, height) * 0.78,
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}
```

- [ ] **Step 5: Create `src/audio/sounds.ts`**

The synth recipe is the existing `triggerSound` (`src/App.tsx:196-229`) behind a master gain → compressor chain, with one named function per world outcome:

```ts
export class SoundEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = false;

  async enable(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext();
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.ratio.value = 6;
      this.master = this.context.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(compressor);
      compressor.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    this.enabled = true;
    this.tone(220, 0.08, 'sine', 0.02);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = null;
    this.master = null;
    this.enabled = false;
  }

  private tone(frequency: number, duration: number, type: OscillatorType, gainValue: number): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || !this.enabled) {
      return;
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(18, frequency * 0.2),
      context.currentTime + duration,
    );
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(1200, frequency * 8), context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(gainValue, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + 0.03);
    oscillator.onended = () => {
      oscillator.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  playSpawn(span: number): void {
    this.tone(96 + span * 600, 0.14, 'sine', 0.05);
    window.setTimeout(() => this.tone(320 + span * 1400, 0.12, 'triangle', 0.025), 24);
  }

  playGrab(): void {
    this.tone(180, 0.07, 'sine', 0.03);
  }

  playFlick(): void {
    this.tone(420, 0.18, 'triangle', 0.035);
  }

  playSlash(): void {
    this.tone(620, 0.1, 'sawtooth', 0.02);
  }
}
```

- [ ] **Step 6: Rewrite `src/App.tsx`**

Full replacement. The JSX (panel, mode switcher, HUD) keeps the existing structure and class names so `styles.css` continues to work; the logic shrinks to wiring:

```tsx
import { useEffect, useRef, useState } from 'react';
import { SoundEngine } from './audio/sounds';
import { GestureEngine } from './gesture/engine';
import { useCamera } from './hooks/useCamera';
import { useHandLandmarker } from './hooks/useHandLandmarker';
import { drawScene } from './render/scene';
import { generateStars, StarfieldRenderer } from './render/starfield';
import { createWorld, stepWorld, type Mode, type World } from './sim/world';

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef(new GestureEngine());
  const worldRef = useRef<World>(createWorld('multi'));
  const starfieldRef = useRef(new StarfieldRenderer(generateStars(96)));
  const soundRef = useRef(new SoundEngine());
  const lastFrameMsRef = useRef<number | null>(null);

  const [mode, setMode] = useState<Mode>('multi');
  const [soundEnabled, setSoundEnabled] = useState(false);

  const camera = useCamera(videoRef);
  const { state: landmarkerState, detect } = useHandLandmarker();

  const status =
    camera.status === 'error' ? 'Camera setup failed.'
    : camera.status === 'starting' ? 'Requesting camera access...'
    : landmarkerState.status === 'error' ? 'Hand model failed to load.'
    : landmarkerState.status === 'loading' ? 'Loading hand model...'
    : mode === 'solo'
      ? 'One-hole mode: pinch to create, fist to grab, flick to throw, slash to delete.'
      : 'Multi-hole mode: pinch to spawn black holes; grab, flick, and slash them.';

  const switchMode = (nextMode: Mode) => {
    worldRef.current = createWorld(nextMode);
    engineRef.current.reset();
    setMode(nextMode);
  };

  useEffect(() => {
    let animationFrame = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled) {
        return;
      }
      animationFrame = window.requestAnimationFrame(tick);

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || !video.videoWidth) {
        return;
      }

      const width = video.videoWidth;
      const height = video.videoHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const now = performance.now();
      const dt = lastFrameMsRef.current === null ? 1 / 60 : (now - lastFrameMsRef.current) / 1000;
      lastFrameMsRef.current = now;

      const rawHands = detect(video, now);
      const { hands, events } = engineRef.current.update(rawHands, now);
      const outcome = stepWorld(worldRef.current, events, hands, dt, width, height, now);

      const sound = soundRef.current;
      if (outcome.spawned) {
        const spawn = events.find((event) => event.type === 'pinchStart');
        sound.playSpawn(spawn && spawn.type === 'pinchStart' ? spawn.span : 0.12);
      }
      if (outcome.grabbed) sound.playGrab();
      if (outcome.flicked) sound.playFlick();
      if (outcome.slashed) sound.playSlash();

      drawScene(ctx, width, height, starfieldRef.current, hands, worldRef.current.holes, now);
    };

    tick();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      void soundRef.current.close();
    };
  }, [detect]);

  return (
    <main className="app-shell">
      <section className="frame">
        <aside className="panel">
          <p className="eyebrow">Black Hole Hands</p>
          <h1>Open singularities with a pinch.</h1>
          <p className="lede">
            Hold your hands inside the frame, pinch thumb and index finger together, and the screen
            will collapse into a living black hole.
          </p>

          <div className="stat-card">
            <span className="stat-label">Status</span>
            <span className="stat-value">{status}</span>
          </div>

          <div className="mode-switcher">
            <button
              className={mode === 'multi' ? 'mode-button is-active' : 'mode-button'}
              type="button"
              onClick={() => switchMode('multi')}
            >
              Multi-hole mode
            </button>
            <button
              className={mode === 'solo' ? 'mode-button is-active' : 'mode-button'}
              type="button"
              onClick={() => switchMode('solo')}
            >
              One-hole mode
            </button>
          </div>

          <button
            className="sound-button"
            type="button"
            onClick={() => {
              void soundRef.current.enable().then(() => setSoundEnabled(true));
            }}
          >
            {soundEnabled ? 'Sound active' : 'Enable sound'}
          </button>

          <div className="guide-list">
            <div>
              <strong>1</strong>
              <span>Allow webcam access and pick a mode.</span>
            </div>
            <div>
              <strong>2</strong>
              <span>Pinch thumb and index together to open a hole. Make a fist near it to grab it; with two fists, stretch it.</span>
            </div>
            <div>
              <strong>3</strong>
              <span>Open your fist fast to flick the hole. Swipe an open hand through it to delete it.</span>
            </div>
          </div>

          {camera.error || landmarkerState.error
            ? <p className="error">{camera.error ?? landmarkerState.error}</p>
            : <p className="hint">Best results come from even lighting and a plain background.</p>}
        </aside>

        <section className="stage">
          <div className="video-shell">
            <video ref={videoRef} className="camera" autoPlay muted playsInline />
            <canvas ref={canvasRef} className="overlay" />

            <div className="hud hud-top-left">Selfie view</div>
            <div className="hud hud-top-right">Gestures: pinch / fist / flick / slash</div>
            <div className="hud hud-bottom-left">{mode === 'solo' ? 'One hole max' : 'Up to 10 holes'}</div>
          </div>
        </section>
      </section>
    </main>
  );
}
```

- [ ] **Step 7: Delete the old module**

```bash
git rm src/handTracking.ts
```

- [ ] **Step 8: Verify build and tests**

Run: `npm run build && npm test` → Expected: build succeeds, all tests pass.

- [ ] **Step 9: Manual smoke test**

Run: `npm run dev`, open the URL, allow the camera, and check:
- Pinch spawns exactly one hole per pinch (hold a pinch: no extra spawns).
- A fist near a hole grabs and drags it; the dashed affordance ring appears when your palm is in range.
- Opening the fist fast throws the hole; it glides and bounces off edges.
- A fast open-hand swipe through a hole deletes it.
- One-hole mode: second pinch does nothing (and with sound on, makes NO sound).
- Two fists on the hole stretch it.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: integrate gesture engine, world sim, renderers, and event-driven audio"
```

---

### Task 14: Debug HUD (tuning instrument)

**Files:**
- Create: `src/render/debugHud.ts`
- Modify: `src/App.tsx` (~10 lines: read `?debug=1`, call the HUD)

- [ ] **Step 1: Create `src/render/debugHud.ts`**

```ts
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
```

- [ ] **Step 2: Wire it into `src/App.tsx`**

Add near the top of the component:

```tsx
const debugEnabled = new URLSearchParams(window.location.search).has('debug');
const fpsRef = useRef({ frames: 0, lastSample: 0, value: 0 });
```

Add the import: `import { drawDebugHud } from './render/debugHud';`

At the end of `tick()` (after `drawScene(...)`):

```tsx
if (debugEnabled) {
  const fps = fpsRef.current;
  fps.frames += 1;
  if (now - fps.lastSample > 500) {
    fps.value = (fps.frames * 1000) / (now - fps.lastSample);
    fps.frames = 0;
    fps.lastSample = now;
  }
  drawDebugHud(ctx, hands, fps.value, width);
}
```

(`debugEnabled` is read once per mount from the URL; add it to the effect's dependency array or leave the effect's deps as `[detect]` since the value never changes during a session.)

- [ ] **Step 3: Verify**

Run: `npm run build && npm test` → Expected: clean.
Run: `npm run dev`, open with `?debug=1` → Expected: live pinch ratio / curl / phase / speed overlay; without the query param, nothing.

- [ ] **Step 4: Commit**

```bash
git add src/render/debugHud.ts src/App.tsx
git commit -m "feat: gesture telemetry HUD behind ?debug=1"
```

---

### Task 15: Star attraction (holes consume the starfield) + tuning pass

**Files:**
- Modify: `src/render/starfield.ts` (stars become dynamic when holes exist)
- Modify: `src/App.tsx` (pass holes to the starfield update)
- Test: `tests/starfield.test.ts`

This is the "advanced feel" payoff: black holes visibly bend and swallow the starfield.

- [ ] **Step 1: Write the failing test**

Create `tests/starfield.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { updateStars } from '../src/render/starfield';
import type { Star } from '../src/render/starfield';

const WIDTH = 1280;
const HEIGHT = 720;

function star(x: number, y: number): Star {
  return { x, y, size: 1, phase: 0 };
}

const hole = { x: 0.5 * WIDTH, y: 0.5 * HEIGHT, radius: 60 };

describe('updateStars', () => {
  it('pulls nearby stars toward the hole', () => {
    const stars = [star(0.4, 0.5)];
    updateStars(stars, [hole], 1 / 30, WIDTH, HEIGHT);
    expect(stars[0].x).toBeGreaterThan(0.4);
    expect(stars[0].y).toBeCloseTo(0.5, 3);
  });

  it('barely affects distant stars', () => {
    const distant = [star(0.02, 0.02)];
    const nearby = [star(0.4, 0.5)];
    updateStars(distant, [hole], 1 / 30, WIDTH, HEIGHT);
    updateStars(nearby, [hole], 1 / 30, WIDTH, HEIGHT);
    const distantPull = Math.abs(distant[0].x - 0.02);
    const nearbyPull = Math.abs(nearby[0].x - 0.4);
    // Inverse-square falloff: a far star drifts a tiny fraction of a near one's pull.
    expect(distantPull).toBeLessThan(0.005);
    expect(distantPull).toBeLessThan(nearbyPull * 0.1);
  });

  it('respawns a star consumed by the hole at a screen edge', () => {
    const stars = [star(0.5 + 1 / WIDTH, 0.5)]; // basically at the center
    updateStars(stars, [hole], 1 / 30, WIDTH, HEIGHT);
    const distanceFromHole = Math.hypot(stars[0].x - 0.5, stars[0].y - 0.5);
    expect(distanceFromHole).toBeGreaterThan(0.3); // teleported away, not stuck inside
  });

  it('does nothing without holes', () => {
    const stars = [star(0.4, 0.5)];
    updateStars(stars, [], 1 / 30, WIDTH, HEIGHT);
    expect(stars[0]).toEqual(star(0.4, 0.5));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/starfield.test.ts` → Expected: FAIL (`updateStars` not exported).

- [ ] **Step 3: Implement star attraction in `src/render/starfield.ts`**

Append to the file:

```ts
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
```

Because stars now move, the pre-rendered twinkle layers from Task 13 must be invalidated whenever holes exist. In `StarfieldRenderer.draw`, add a `dirty` mechanism:

```ts
  /** Call when star positions changed (attraction active). */
  invalidate(): void {
    this.dimLayer = null;
  }
```

And in `App.tsx`'s `tick()`, before `drawScene(...)`:

```tsx
if (worldRef.current.holes.length > 0) {
  updateStars(
    starfieldRef.current.stars,
    worldRef.current.holes,
    dt,
    width,
    height,
  );
  starfieldRef.current.invalidate();
}
```

Make `stars` accessible: in `StarfieldRenderer`, change the constructor field to `constructor(readonly stars: Star[]) {}` and add the import `updateStars` in App.tsx.

(With no holes, the cached two-layer fast path still applies — the common idle state stays cheap. With holes active, the per-frame layer rebuild costs one 96-arc pass, the same as the old code did every frame.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` → Expected: all PASS.

- [ ] **Step 5: Manual tuning pass with the HUD**

Run: `npm run dev` with `?debug=1`. Verify on a real camera, adjusting only `src/gesture/config.ts` values:
- Resting open hand: pinch ratio comfortably above 0.6, curl above 1.5, speed near 0.
- Deliberate pinch: ratio drops below 0.4 within a couple of frames; exactly one spawn.
- Fist: curl below 1.1; grab engages; no grab when pinching.
- Flick: peak speed on release exceeds 1.2 w/s for a natural throw; lower `flick.minSpeed` if throws feel hard to trigger.
- Slash: a deliberate swipe exceeds 2.0 w/s; casual hand repositioning does not.
- Stars visibly spiral into holes and respawn at edges.

Record any constant changes in the commit message.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: black holes attract and consume the starfield; tune gesture constants"
```

---

### Task 16: Final verification and docs

**Files:**
- Modify: `README.md` (gesture vocabulary section)

- [ ] **Step 1: Full gate**

Run: `npm run build && npm test` → Expected: clean build, all tests green.

- [ ] **Step 2: Cross-mode manual checklist** (`npm run dev`)

- Multi mode: several pinches → several holes; each expires; grab/flick/slash all work on any hole.
- Solo mode: one hole max; no phantom spawn sound; hole persists until slashed.
- Mode switch mid-interaction: no stuck grabs, no ghost holes (world is recreated).
- Two hands crossing each other: holes don't teleport between hands (identity holds).
- Tab in background 5 s, return: hole doesn't fly off screen (dt clamp).
- File-size check: `wc -l src/**/*.ts src/**/*.tsx | sort -n` → every file under 500 lines.

- [ ] **Step 3: Update `README.md`**

Replace the "What it does" bullet list with the new gesture vocabulary (pinch = spawn, fist = grab/drag, two fists = stretch, fast release = throw, open-hand swipe = delete), and add a "Development" section:

```markdown
## Development

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (gesture engine, physics, world)
npm run build      # type-check + production build
```

Open the app with `?debug=1` to see live gesture telemetry (pinch ratio, finger curl,
state machines, hand speed) — useful when tuning `src/gesture/config.ts`.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: new gesture vocabulary and development guide"
```

---

## Self-review notes

- **Spec coverage:** every verified defect (1-12 in Background) maps to a task; "advanced" is delivered by Tasks 13 (affordances, event audio), 14 (HUD), 15 (star attraction); "well made" by Tasks 1-12 (typed, tested modules under 500 lines).
- **Type consistency:** `TrackedHand`, `GestureEvent`, `World`, `StepResult` are defined once (Tasks 2, 10) and consumed with matching shapes in Tasks 11-15; `stepFreeHole` (Task 9) is the name used by `world.ts` (Task 10).
- **Known tuning risk:** filter and threshold constants are informed starting points; Task 15's HUD pass is where feel is finalized. Unit tests pin semantics (hysteresis, debounce, refractory, dt-invariance), not feel.
