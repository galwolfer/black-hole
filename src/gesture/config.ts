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
