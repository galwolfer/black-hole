# Black Hole Hands

Camera-driven hand tracking demo that lets you pinch in front of the webcam to open animated black holes on screen.

## What it does

- Uses your webcam as the input source.
- Recognizes up to two hands with MediaPipe Tasks Vision.
- Triggers a black hole effect when a pinch gesture is detected.
- Renders a mirrored selfie view with an overlayed cosmic effect.

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

## Notes

- The hand model and MediaPipe runtime are fetched at runtime from the network.
- For the best result, use a well-lit room and keep your hands inside the camera frame.