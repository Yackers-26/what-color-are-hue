# HueSee — richer shade catalog and lighting-consistency test

## Scope
This is a HueSee-only iteration of the successful Camo + HueDo project. It does not redesign the UI or change HueFind, HueDo, HueMemory, or login behavior. The existing four tabs remain present. Camo device selection and the measured HEX/RGB readout are preserved.

## Implemented
- **281 static named-color references**: the 148 standard CSS named colors plus 133 approximate specialty shades. All 24-bit RGB inputs can be measured, but only these references have catalog names. The rest fall back to the previous descriptive family name if no nearby reference is found. There is no claim that every unique RGB value has a unique standardized English name.
- **Perceptual color naming**: CIEDE2000 matching within the original HueSee families avoids broad RGB-only matching and tries not to confuse brown/orange or chartreuse/yellow. This is local, instant, and does not require Gemini or MongoDB.
- **Lighting-aware hover**: a color-identity tracker retains the current SHADE NAME at one camera point when its chromaticity is consistent with an exposure/shadow shift; it waits for repeated evidence before changing to a new color. Moving the cursor farther resets identity. Measured HEX/RGB stays the original camera reading and may vary naturally under different light.
- **Paired-image Gemini**: on pinning a spot, HueSee stores a small 224x224 reference crop in browser memory (no database). When you click **Refine shade with Gemini**, it sends that crop plus a fresh crop to `/api/shades` and the reference/current RGB. Gemini can compare lighting and attempt to recognize the base shade of the same material. Press the SAME button again with a shadow/changed light while keeping the spot selected. If Gemini confidently sees the same material, the name is kept across checks. If it's uncertain, a prior shade name stays visible but is flagged as uncertain; if the target changes, the user is instructed to re-pin.
- **No per-frame Gemini calls**: photos are transmitted to Google only on button click. They are not saved to MongoDB. Gemini can be unavailable without breaking the local detector. Requires your `GEMINI_API_KEY` in `.env`.

## Limits that matter
A camera cannot always recover an object's true reflectance from a single image; colored artificial lighting, heavy shadows, clipped whites, reflections, and different objects with similar colors introduce ambiguity. Matching chromaticity is not proof of material identity. Gemini itself is advisory and its same-surface comparison can be wrong. For stronger physical accuracy, use consistent illumination, disable camera auto-white-balance/exposure if your Camo setup supports it, or calibrate against a known neutral reference. Do NOT use shade labels for safety-critical judgments.

## Windows live test
1. Extract the FULL ZIP, open the folder that contains `package.json` in VS Code.
2. In PowerShell run `npm install` then `npm test`. Expect **65 passing tests**.
3. Copy `.env.example` to `.env` if needed using `Copy-Item .env.example .env`. Add your private `GEMINI_API_KEY`, set `GEMINI_MODEL=gemini-3.5-flash-lite`, set `MONGODB_URI=` (optional for local demo), and `PORT=3001`, `APP_ORIGIN=http://localhost:3001`.
4. Stop any earlier server using port 3001 with Ctrl+C. Run `node .\server\index.js`.
5. Go to `http://localhost:3001/login`, choose **Continue without signing in**, open HueSee, start the Camo camera.
6. Hover over chocolate brown, chartreuse/lime green, gray, and more. Check that local names remain stable as you move a light source while keeping the pointer on the SAME surface.
7. Point Camo at a brown item, **Pin reading**, and click **Refine shade with Gemini**. Record the Gemini suggestion and confidence.
8. Without moving the item out of the selected spot, turn on a warmer lamp or introduce a mild shadow. Click **Refine shade with Gemini** AGAIN. The pinned local reading remains the reference; Gemini compares before/after image crops. Report shade names, `sameSurface` feedback, and any errors.
9. Point the camera at a completely different color while still pinned and click **Refine shade with Gemini**. It should flag a different or uncertain surface, not claim it is definitely the same one. Unpin when switching objects.

## Software QA
Automated tests cover palette size, exact named colors, CIEDE2000 numerical correctness, lighting-similarity heuristics, shade-label stability, and safe Gemini response normalization. A LIVE GEMINI API response and real Camo color accuracy are not verified here because the private API key and hardware are on the user's computer. The MongoDB catalog is not implemented in this iteration; this static palette could become its seed in a later step.

Do not push directly onto `main`; validate first, then update `Newest-Version` with normal Git branch management.
