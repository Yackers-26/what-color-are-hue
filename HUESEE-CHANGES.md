# HueSee v2 — hover color + pin reading

## Source of truth

Built from the user-uploaded `what-color-are-hue-main (2).zip`, not the previous `huesee-f1-interactive` branch. The server, APIs, HueFind, HueDo, HueMemory, image picker, existing color region detector, original styles, and original tests were carried forward unchanged unless explicitly named below.

## Changed/added files

- `public/index.html`: adds color HEX/RGB hover card, sample reticle, Pin/Unpin control, separate Save Pinned Color action, Scan Scene control, and one new stylesheet link.
- `public/script.js`: throttles HueSee pixel sampling, stabilizes displayed values, implements click/tap/keyboard pinning and unpinning, preserves a pinned snapshot for MongoDB saving, displays the native video for smooth camera playback, and leaves other modes' overlays in place.
- `public/huesee-polish.css`: small warm editorial polish, accessible sizing, floating color card, reticle and color transitions, reduced-motion support.
- `src/vision/sampleColor.js`: samples an averaged image patch instead of a noisy single pixel.
- `src/vision/steadyReading.js`: pure RGB/category stability filter.
- `tests/steadyReading.test.js`: color sampling and stability checks.

## Deliberate interaction decisions

- The color card and sidebar show the same stabilized HEX/RGB. Tiny sensor fluctuations do not update the numbers.
- Moving the cursor a significant distance allows an immediate change rather than leaving a stale reading.
- Hovering previews; a click or tap **pins**. The pinned snapshot will not be replaced by new camera samples until unpinned.
- Save requires a deliberate second action and an online MongoDB connection, avoiding accidental database writes while exploring.
- If two objects have similar color values, the name/HEX are approximate camera measurements, not calibrated colorimetry.
- The scene scan is on demand. Other modes' processing and UI are untouched.

## Validation performed

- `npm test`: **14 tests passed, 0 failed**.
- `node --check public/script.js`: passed.
- Desktop and phone-width layout tests: no horizontal overflow at 1440px and 390px.
- Browser synthetic camera interaction: hover readout, click-to-pin, frozen HEX on simulated color change, normalized save payload, unpin, HueFind tab navigation and simulated mobile tap-to-pin. No page exceptions in the harness.
- **Not yet verified:** webcam on a real laptop/phone; network calls to your actual MongoDB/Gemini deployments; integration conflicts with commits newer than the uploaded ZIP.

## Integration advice

1. Run this complete build separately via `npm install` and `npm run dev`.
2. If it passes real-device checks, start a new branch from the latest `origin/main`.
3. Copy only the six changed/added code files above, preserving their directories, and run tests again.
4. Push that branch and open a pull request; do not force-push or overwrite teammates' main branch.
