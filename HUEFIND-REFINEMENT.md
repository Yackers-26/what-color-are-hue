# HueFind contour refinement — November 14, 2026

This revision starts from the **Original Sidebar / Labels Only** workspace. It does not overwrite the team's GitHub branches.

## What changed

- The former unlabeled dark circular control is now a visibly labeled **Hide color labels / Show color labels** button. It works in HueSee and HueFind and retains its pressed state for screen readers.
- HueFind no longer outlines each colored grid cell with dotted line segments. It now forms a binary color mask, closes small gaps, removes isolated pixels, identifies substantial connected components, traces the *outer* boundary, smooths and resamples the contour, and blends its points across camera frames.
- A substantial connected region gets exactly one ordered, continuous, **solid** outline and one chip label. Tiny disconnected speckles and smaller satellites relative to the main region are suppressed.
- HueFind targets are processed approximately every 95 ms. The cursor-based HueSee HEX/RGB display remains independent and responsive.
- Webcam video is displayed by the native video element, while the other canvas is a transparent overlay (removing a stale frame being painted into that overlay).
- The existing HueSee labels-only mode, pinned color readings, HueMemory, HueDo, and four tabs are otherwise retained.

## Files changed

1. `public/index.html` — descriptive color-label toggle.
2. `public/workbench.css` — toggle styling and responsive layout.
3. `public/script.js` — continuous HueFind contours, transparent canvas, tracking, mode reset.
4. `src/vision/smoothContours.js` — new mask, smoothing, contour and temporal tracking logic.
5. `tests/smoothContours.test.js` — eight new synthetic-frame tests.

## Verification

- `npm test`: 29 passed, 0 failed.
- Browser simulation: four tabs work; labels toggle changes between Show/Hide; HueFind targets one red object with a single solid outline; no JS errors; HueSee hover still reads HEX/RGB; no horizontal overflow at a 390px mobile viewport.
- An **offline still-frame check** against the provided HueFind screenshot produced one continuous contour surrounding the face-shaped color region rather than many scattered lines.

## Limitations

This is **color-region tracking, not ML-powered semantic object segmentation**. If an object contains vastly different shades, if objects overlap, if the foreground and background share a similar color, or if a target is extremely small, the mask may only outline a portion, merge multiple regions, or miss the object. Full arbitrary-object instance segmentation requires a suitable model (e.g. MediaPipe Image Segmenter), and even those models are category/model-limited. Physical webcam tracking on your device is still a required QA step.

## Run locally

```powershell
npm install
npm test
npm run dev
```

Open http://localhost:3000, allow the camera, then select HueFind and Red, Blue, or another target. HueSee should only display labels, while HueFind alone draws contours. Avoid Live Server: this project uses an Express backend.

## GitHub

Review/test before pushing. Prefer a new branch rather than merging directly into `main` while teammates are making changes. The changed-files ZIP contains just the five modified/new source files; it is a patch against the previously shared Original Sidebar / Labels Only project, not a blanket replacement for unrelated branches.
