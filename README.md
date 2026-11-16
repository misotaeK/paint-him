# Paint Him

Paint on your face in real time, right in the browser. Draw on a flat face map and watch it wrap onto your webcam image, following your head and expressions.

*Türkçe: Tarayıcıda gerçek zamanlı yüz boyama. Sağdaki yüz haritasına çiz, çizim webcam görüntüsündeki yüzüne oturur.*

## How it works

- **Face tracking:** [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) finds 468 landmarks on your face every frame.
- **Face map:** MediaPipe's canonical face model (`public/canonical.obj`) gives each landmark a UV coordinate. You paint on that 2D UV map.
- **Projection:** [Three.js](https://threejs.org) maps the painted canvas as a texture onto the tracked face mesh and blends it over the webcam with **multiply** blending. White leaves skin untouched, dark colors darken it.
- The mouth opening is cut out of the mesh so paint doesn't stretch over teeth or tongue.

## Features

- Brush, eraser, size and softness, color swatches, custom color picker and hex input
- Shapes: circle, ellipse, square, rectangle, triangle, star, heart. Move, rotate and resize them before applying
- Layers: add, delete, reorder, hide, per-layer opacity, rename
- Undo / redo (Ctrl+Z, Ctrl+Shift+Z) including layer changes
- Symmetry mode that mirrors strokes across the face
- Templates: Panda, Clown, Blush, Cat
- Export / import the face map as PNG
- Save a photo or record a `.webm` video of the painted view
- Landmark smoothing to reduce jitter
- Glass UI, works with touch input

## Run it

Needs Node.js 18+ and a webcam.

```bash
npm install
npm run dev
```

Open http://localhost:5173 and allow camera access. Everything runs locally in your browser. Video never leaves your machine; only the MediaPipe model and WASM files are downloaded from Google / jsDelivr CDNs on first load.

```bash
npm run build   # production build in dist/
```

## Stack

Vite, vanilla JS, Three.js, `@mediapipe/tasks-vision`.

## Known limits

- One face at a time.
- Opacity only fades the paint toward white; there is no real lighting model, so paint does not pick up shadows.
- No glow/neon brush (multiply blending can't brighten).

## Credits

Face mesh topology and UVs come from the [MediaPipe](https://github.com/google-ai-edge/mediapipe) canonical face model (Apache-2.0).

## License

MIT
