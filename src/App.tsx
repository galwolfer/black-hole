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
  velocityX: number;
  velocityY: number;
  grabbedBy: number | null;
};

type Mode = 'multi' | 'solo';

type HandMotion = {
  palmPoint: Point;
  time: number;
  velocityX: number;
  velocityY: number;
  speed: number;
  wasGrabbing: boolean;
};

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm';

function makeStarfield(): Star[] {
  return generateStars(96);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isHoleInRange(hole: BlackHole, hand: HandFrame, frameWidth: number, frameHeight: number): boolean {
  const handPoint = {
    x: hand.palmPoint.x * frameWidth,
    y: hand.palmPoint.y * frameHeight,
  };
  return getDistance(handPoint, { x: hole.x, y: hole.y }) < hole.radius * 0.7;
}

function createHole(point: Point, handSpan: number, width: number, height: number, now: number): BlackHole {
  return {
    id: now,
    x: point.x * width,
    y: point.y * height,
    createdAt: now,
    lifespan: 3200 + handSpan * 1200,
    radius: Math.min(width, height) * (0.07 + handSpan * 0.12),
    seed: Math.random() * Math.PI * 2,
    velocityX: 0,
    velocityY: 0,
    grabbedBy: null,
  };
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(false);
  const starsRef = useRef<Star[]>(makeStarfield());
  const handsRef = useRef<HandFrame[]>([]);
  const holesRef = useRef<BlackHole[]>([]);
  const soloHoleRef = useRef<BlackHole | null>(null);
  const handMotionRef = useRef<Record<number, HandMotion | undefined>>({});
  const pinchStatesRef = useRef<boolean[]>([]);
  const holeIdRef = useRef(1);
  const streamRef = useRef<MediaStream | null>(null);
  const modeRef = useRef<Mode>('multi');

  const [mode, setMode] = useState<Mode>('multi');
  const [status, setStatus] = useState('Starting camera...');
  const [error, setError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);

  const triggerSound = (frequency: number, duration: number, type: OscillatorType, gainValue: number) => {
    const context = audioContextRef.current;
    if (!context) {
      return;
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(18, frequency * 0.2), context.currentTime + duration);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(1200, frequency * 8), context.currentTime);

    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(gainValue, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);

    oscillator.start();
    oscillator.stop(context.currentTime + duration + 0.03);

    oscillator.onended = () => {
      oscillator.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  };

  const enableSound = async () => {
    const context = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = context;

    if (context.state === 'suspended') {
      await context.resume();
    }

    soundEnabledRef.current = true;
    setSoundEnabled(true);
    setStatus('Sound enabled. Pinch to open a black hole.');
    triggerSound(220, 0.08, 'sine', 0.02);
  };

  useEffect(() => {
    let cancelled = false;

    const stopStream = () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };

    const spawnHole = (point: Point, handSpan: number, width: number, height: number, now: number) => {
      if (soundEnabledRef.current) {
        triggerSound(96 + handSpan * 90, 0.14, 'sine', 0.05);
        window.setTimeout(() => {
          triggerSound(320 + handSpan * 220, 0.12, 'triangle', 0.025);
        }, 24);
      }

      if (modeRef.current === 'solo' && soloHoleRef.current) {
        return;
      }

      const hole = createHole(point, handSpan, width, height, now);
      hole.id = holeIdRef.current;
      holeIdRef.current += 1;

      if (modeRef.current === 'solo') {
        soloHoleRef.current = hole;
        return;
      }

      holesRef.current = [...holesRef.current.filter((currentHole) => now - currentHole.createdAt < currentHole.lifespan), hole].slice(-10);
    };

    const updateSoloHole = (hands: HandFrame[], width: number, height: number, now: number) => {
      const hole = soloHoleRef.current;
      if (!hole) {
        return;
      }

      let grabbedBy: number | null = hole.grabbedBy;
      let shouldDelete = false;

      hands.forEach((hand, index) => {
        const handPoint = {
          x: hand.palmPoint.x * width,
          y: hand.palmPoint.y * height,
        };
        const previous = handMotionRef.current[index];
        const deltaTime = previous ? Math.max(0.016, (now - previous.time) / 1000) : 0.016;
        const velocityX = previous ? (handPoint.x - previous.palmPoint.x) / deltaTime : 0;
        const velocityY = previous ? (handPoint.y - previous.palmPoint.y) / deltaTime : 0;
        const speed = Math.hypot(velocityX, velocityY);
        const isGrabbing = hand.openness < 1.35;
        const isSlashing = !isGrabbing && hand.openness > 1.65 && speed > 1100 && Math.abs(velocityX) > Math.abs(velocityY) * 0.7;
        const isFlicking = previous?.wasGrabbing && !isGrabbing && speed > 900;

        if (isSlashing && isHoleInRange(hole, hand, width, height)) {
          shouldDelete = true;
          return;
        }

        if (isGrabbing && isHoleInRange(hole, hand, width, height)) {
          grabbedBy = index;
          hole.x = handPoint.x;
          hole.y = handPoint.y;
          const minDimension = Math.min(width, height);
          hole.radius = clamp(minDimension * (0.035 + hand.openness * 0.014), minDimension * 0.03, minDimension * 0.18);
        }

        if (grabbedBy === index && isFlicking) {
          grabbedBy = null;
          hole.velocityX = velocityX * 0.36;
          hole.velocityY = velocityY * 0.36;
        }

        handMotionRef.current[index] = {
          palmPoint: handPoint,
          time: now,
          velocityX,
          velocityY,
          speed,
          wasGrabbing: isGrabbing,
        };
      });

      if (shouldDelete) {
        soloHoleRef.current = null;
        return;
      }

      hole.grabbedBy = grabbedBy;

      if (hole.grabbedBy === null) {
        hole.x += hole.velocityX * 0.016;
        hole.y += hole.velocityY * 0.016;
        hole.velocityX *= 0.985;
        hole.velocityY *= 0.985;

        const bounceX = hole.x - hole.radius < 0 || hole.x + hole.radius > width;
        const bounceY = hole.y - hole.radius < 0 || hole.y + hole.radius > height;

        if (bounceX) {
          hole.velocityX *= -0.82;
          hole.x = clamp(hole.x, hole.radius, width - hole.radius);
        }

        if (bounceY) {
          hole.velocityY *= -0.82;
          hole.y = clamp(hole.y, hole.radius, height - hole.radius);
        }
      }

      soloHoleRef.current = hole;
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

      if (modeRef.current === 'solo' && !soloHoleRef.current) {
        const pinchingHand = nextHands.find((hand) => hand.isPinching && hand.pinchPoint);
        if (pinchingHand?.pinchPoint) {
          spawnHole(pinchingHand.pinchPoint, pinchingHand.handSpan, frame.width, frame.height, now);
        }
      }

      nextHands.forEach((hand, index) => {
        const wasPinching = pinchStatesRef.current[index] ?? false;
        if (hand.isPinching && !wasPinching && hand.pinchPoint) {
          spawnHole(hand.pinchPoint, hand.handSpan, frame.width, frame.height, now);
        }
      });

      pinchStatesRef.current = nextHands.map((hand) => hand.isPinching);
      handsRef.current = nextHands;
      holesRef.current = holesRef.current.filter((hole) => now - hole.createdAt < hole.lifespan);

      if (modeRef.current === 'solo') {
        updateSoloHole(nextHands, frame.width, frame.height, now);
      }

      const activeHoles = modeRef.current === 'solo'
        ? (soloHoleRef.current ? [soloHoleRef.current] : holesRef.current.slice(-1))
        : holesRef.current;
      drawScene(frame.context, frame.width, frame.height, starsRef.current, handsRef.current, activeHoles, now);
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
        setStatus(modeRef.current === 'solo' ? 'One-hole mode: pinch to create, grab to resize, flick to throw, slash to delete.' : 'Pinch your fingers to open a black hole.');
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
      audioContextRef.current?.close();
      audioContextRef.current = null;
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

          <div className="mode-switcher">
            <button className={mode === 'multi' ? 'mode-button is-active' : 'mode-button'} type="button" onClick={() => {
              modeRef.current = 'multi';
              soloHoleRef.current = null;
              handMotionRef.current = {};
              pinchStatesRef.current = [];
              setMode('multi');
              setStatus('Multi-hole mode: pinch to spawn black holes.');
            }}>
              Multi-hole mode
            </button>
            <button className={mode === 'solo' ? 'mode-button is-active' : 'mode-button'} type="button" onClick={() => {
              modeRef.current = 'solo';
              holesRef.current = [];
              soloHoleRef.current = null;
              handMotionRef.current = {};
              pinchStatesRef.current = [];
              setMode('solo');
              setStatus('One-hole mode: pinch to create the hole, grab to resize, flick to throw, slash to delete.');
            }}>
              One-hole mode
            </button>
          </div>

          <button className="sound-button" type="button" onClick={() => void enableSound()}>
            {soundEnabled ? 'Sound active' : 'Enable sound'}
          </button>

          <div className="guide-list">
            <div>
              <strong>1</strong>
              <span>Allow webcam access and pick a mode.</span>
            </div>
            <div>
              <strong>2</strong>
              <span>In one-hole mode, bring thumb and index finger close together to create the hole, then grab it to resize or move it.</span>
            </div>
            <div>
              <strong>3</strong>
              <span>Flick the hole to throw it, slash it to delete it.</span>
            </div>
          </div>

          {error ? <p className="error">{error}</p> : <p className="hint">Best results come from even lighting and a plain background.</p>}
        </aside>

        <section className="stage">
          <div className="video-shell">
            <video ref={videoRef} className="camera" autoPlay muted playsInline />
            <canvas ref={canvasRef} className="overlay" />

            <div className="hud hud-top-left">Selfie view</div>
            <div className="hud hud-top-right">Gesture: {mode === 'solo' ? 'pinch / grab / flick / slash' : 'pinch'}</div>
            <div className="hud hud-bottom-left">{mode === 'solo' ? 'One hole active' : 'Hands tracked live'}</div>
          </div>
        </section>
      </section>
    </main>
  );
}