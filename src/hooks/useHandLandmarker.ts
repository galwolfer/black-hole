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
