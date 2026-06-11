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
