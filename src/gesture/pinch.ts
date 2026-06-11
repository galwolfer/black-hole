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
