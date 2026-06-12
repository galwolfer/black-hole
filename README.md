# Black Hole Hands

Camera-driven hand tracking demo that lets you pinch in front of the webcam to open animated black holes on screen.

## What it does

- Uses your webcam as the input source and tracks up to two hands with MediaPipe Tasks Vision.
- A filtered, state-machine gesture engine recognizes four gestures:
  - **Pinch** (thumb + index together) — opens a black hole.
  - **Fist near a hole** — grabs it; move your fist to drag it. Two fists on one hole stretch it.
  - **Open your fist fast** — flicks the hole, which then glides and bounces off the edges.
  - **Swipe an open hand through a hole** — deletes it.
- Black holes bend and swallow the starfield around them.
- Renders a mirrored selfie view with an overlaid cosmic effect and per-gesture audio.

## Gesture vocabulary

| Gesture | Action |
| --- | --- |
| Pinch thumb + index | Spawn a black hole |
| Make a fist near a hole | Grab and drag it |
| Two fists on one hole | Stretch / resize it |
| Open the fist quickly | Throw (flick) the hole |
| Swipe an open hand through a hole | Delete it |

In **multi-hole mode** you can have up to 10 holes at once; in **one-hole mode** a single hole persists until you slash it.

## How to Start

1. Open a terminal in this folder.
2. Install the dependencies:

```bash
npm install
```

3. Start the app:

```bash
npm run dev
```

4. Open the local URL shown in the terminal, usually `http://localhost:5173`.
5. Allow camera access when the browser asks.
6. Move your hands into view and pinch thumb + index finger to open a black hole.

## Troubleshooting

- If the camera does not start, make sure the browser has permission to use the webcam.
- If the page is blank, wait a moment for the hand-tracking model to finish loading.
- For the best tracking, use bright lighting and keep your hands inside the frame.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (gesture engine, physics, world)
npm run build      # type-check + production build
```

Open the app with `?debug=1` to see live gesture telemetry (pinch ratio, finger curl,
state machines, hand speed) — useful when tuning the constants in `src/gesture/config.ts`.

The codebase is organized into pure, tested modules: `src/gesture/` (filtering, hand
identity, pinch/grab state machines, motion, engine), `src/sim/` (physics + world
reducer), `src/render/` (canvas drawing), `src/audio/`, and `src/hooks/` (camera +
landmarker lifecycle). `src/App.tsx` is a thin composition root.

## Notes

- The hand model and MediaPipe runtime are fetched at runtime from the network.
- For the best result, use a well-lit room and keep your hands inside the camera frame.