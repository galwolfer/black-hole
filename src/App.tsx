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
