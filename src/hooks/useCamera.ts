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
