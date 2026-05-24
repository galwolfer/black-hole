import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { drawHandSkeleton, generateStars, getHandFrames, type HandFrame, type Point, type Star } from './handTracking';

type BlackHole = {
  id: number;
  x: number;
  y: number;
  createdAt: number;
  lifespan: number;
  radius: number;
  seed: number;
};

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm';

function makeStarfield(): Star[] {
  return generateStars(96);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function drawBlackHole(
  ctx: CanvasRenderingContext2D,
  hole: BlackHole,
  width: number,
  height: number,
  now: number,
): void {
  const age = now - hole.createdAt;
  const progress = clamp(age / hole.lifespan, 0, 1);
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

  ctx.restore();
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  stars: Star[],
  hands: HandFrame[],
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

  ctx.save();
  for (const star of stars) {
    const twinkle = 0.35 + 0.65 * Math.max(0, Math.sin(now * 0.002 + star.phase));
    ctx.fillStyle = `rgba(255, 255, 255, ${0.14 + twinkle * 0.38})`;
    ctx.beginPath();
    ctx.arc(star.x * width, star.y * height, star.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  for (const hand of hands) {
    drawHandSkeleton(ctx, hand, width, height, now);
  }

  for (const hole of holes) {
    drawBlackHole(ctx, hole, width, height, now);
  }

  const vignette = ctx.createRadialGradient(width * 0.5, height * 0.48, Math.min(width, height) * 0.12, width * 0.5, height * 0.5, Math.max(width, height) * 0.78);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const animationRef = useRef<number | null>(null);
  const starsRef = useRef<Star[]>(makeStarfield());
  const handsRef = useRef<HandFrame[]>([]);
  const holesRef = useRef<BlackHole[]>([]);
  const pinchStatesRef = useRef<boolean[]>([]);
  const holeIdRef = useRef(1);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState('Starting camera...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const stopStream = () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };

    const spawnHole = (point: Point, handSpan: number, width: number, height: number, now: number) => {
      const radius = Math.min(width, height) * (0.07 + handSpan * 0.12);
      holesRef.current = [
        ...holesRef.current.filter((hole) => now - hole.createdAt < hole.lifespan),
        {
          id: holeIdRef.current,
          x: point.x * width,
          y: point.y * height,
          createdAt: now,
          lifespan: 3200 + handSpan * 1200,
          radius,
          seed: Math.random() * Math.PI * 2,
        },
      ].slice(-10);
      holeIdRef.current += 1;
    };

    const resizeCanvas = (canvas: HTMLCanvasElement, video: HTMLVideoElement) => {
      const width = video.videoWidth;
      const height = video.videoHeight;

      if (!width || !height) {
        return null;
      }

      const dpr = window.devicePixelRatio || 1;
      const targetWidth = Math.round(width * dpr);
      const targetHeight = Math.round(height * dpr);

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      const context = canvas.getContext('2d');
      if (!context) {
        return null;
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { context, width, height };
    };

    const draw = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const landmarker = handLandmarkerRef.current;

      if (!video || !canvas || !landmarker || video.readyState < 2) {
        return;
      }

      const frame = resizeCanvas(canvas, video);
      if (!frame) {
        return;
      }

      const now = performance.now();
      const result = landmarker.detectForVideo(video, now);
      const nextHands = getHandFrames(result);

      nextHands.forEach((hand, index) => {
        const wasPinching = pinchStatesRef.current[index] ?? false;
        if (hand.isPinching && !wasPinching && hand.pinchPoint) {
          spawnHole(hand.pinchPoint, hand.handSpan, frame.width, frame.height, now);
        }
      });

      pinchStatesRef.current = nextHands.map((hand) => hand.isPinching);
      handsRef.current = nextHands;
      holesRef.current = holesRef.current.filter((hole) => now - hole.createdAt < hole.lifespan);

      drawScene(frame.context, frame.width, frame.height, starsRef.current, handsRef.current, holesRef.current, now);
    };

    const tick = () => {
      if (cancelled) {
        return;
      }

      draw();
      animationRef.current = window.requestAnimationFrame(tick);
    };

    const init = async () => {
      try {
        setStatus('Requesting camera access...');

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
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

        setStatus('Loading hand model...');

        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        if (cancelled) {
          return;
        }

        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
          },
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

        handLandmarkerRef.current = landmarker;
        setStatus('Pinch your fingers to open a black hole.');
        tick();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Unable to start the camera.';
        setError(message);
        setStatus('Camera setup failed.');
      }
    };

    void init();

    return () => {
      cancelled = true;

      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
      }

      handLandmarkerRef.current?.close();
      handLandmarkerRef.current = null;
      stopStream();
    };
  }, []);

  return (
    <main className="app-shell">
      <section className="frame">
        <aside className="panel">
          <p className="eyebrow">Black Hole Hands</p>
          <h1>Open singularities with a pinch.</h1>
          <p className="lede">
            Hold your hands inside the frame, pinch thumb and index finger together, and the screen will collapse into a living black hole.
          </p>

          <div className="stat-card">
            <span className="stat-label">Status</span>
            <span className="stat-value">{status}</span>
          </div>

          <div className="guide-list">
            <div>
              <strong>1</strong>
              <span>Allow webcam access.</span>
            </div>
            <div>
              <strong>2</strong>
              <span>Bring one or two hands into view.</span>
            </div>
            <div>
              <strong>3</strong>
              <span>Pinch to spawn a black hole.</span>
            </div>
          </div>

          {error ? <p className="error">{error}</p> : <p className="hint">Best results come from even lighting and a plain background.</p>}
        </aside>

        <section className="stage">
          <div className="video-shell">
            <video ref={videoRef} className="camera" autoPlay muted playsInline />
            <canvas ref={canvasRef} className="overlay" />

            <div className="hud hud-top-left">Selfie view</div>
            <div className="hud hud-top-right">Gesture: pinch</div>
            <div className="hud hud-bottom-left">Hands tracked live</div>
          </div>
        </section>
      </section>
    </main>
  );
}