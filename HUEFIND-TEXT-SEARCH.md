# HueFind v4: any-shade text search and nearest visible alternative

This is an additive HueFind change built on **HueSee Lighting v3**. The rest of the app, its four tabs, and the Camo camera selector are unchanged.

## How to use it

1. Start the camera and choose **Camo Camera** if available.
2. Open **HueFind**. Type a color in the search box; press Enter or **Find**.
   Examples: `sage green`, `burgundy`, `chartreuse`, `gray`, `brown`, `#7FFF00`, `#ABC`, `rgb(156, 175, 136)`.
3. A **general family** (e.g. `green`) looks for all matching green regions. A **named shade or HEX/RGB** uses a more selective perceptual match with modest shadow tolerance.
4. HueFind retains the existing **high-resolution SVG contour**, its smoothing and focus-by-tap features.
5. For a name that isn't recognized, a dialog suggests similar known shade names. Nothing is selected without confirmation. Names cannot convey a color faithfully without a catalog reference or HEX/RGB.
6. If a known shade doesn't produce a stable outline for about 2–3 seconds, a dialog suggests a substantial camera color region close to the requested color. Confirm **that** alternative to search it, or choose **Keep searching**. If no substantial region is detected, it asks you to improve the view instead of inventing a result.

## Notes and limitations

- The catalog is the existing offline shared collection of ~281 named swatches, not an infinite color dictionary. Arbitrary specific shades can still be searched by HEX or RGB.
- The nearest-visible suggestion is a best-effort interpretation of the visible *camera pixels*, not a guarantee that an object of that named shade is physically present. Glare, texture, white balance, tiny regions and colored lighting can cause error.
- No frame is uploaded for HueFind search; the picker and fallback are local and responsive. Camo and optional white-card calibration are unchanged.
- HueSee's Gemini refinement, HueDo, HueMemory, login and MongoDB integrations are not altered.
- This version was covered by `npm test` (73 tests). Live Camo webcam behavior and popup suggestions should be checked on your computer.

## Start in Windows PowerShell

From the folder containing `package.json`:

```powershell
npm install
npm test
# Keep your working, PRIVATE .env file in this project's root folder.
node .\server\index.js
```

In the browser open `http://localhost:3001/login` if your `.env` has `PORT=3001`; continue in local demo mode, select Camo, and switch to HueFind.
