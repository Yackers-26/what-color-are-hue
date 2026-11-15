# HueSee shade upgrade (Camo-ready)

This update focuses on **HueSee**. The approved visual layout, camera selector, HueFind navigation, HueDo, HueMemory, and sign-in code are retained from the `Newest-Version` source.

## What changed
- HueSee's live hover reading and color panel now use shade names based on brightness, saturation and hue. Brown and orange, chartreuse and yellow, olive and green, and neutral grays are no longer treated as identical by the **shade naming layer**.
- HueSee's on-camera labels and **Scan scene** summary use the representative RGB of each region to show descriptive shade names.
- Gray regions can appear in scene scans. White backgrounds remain excluded.
- After pinning a reading, the new **Refine shade with Gemini** button optionally sends a **small 224x224 JPEG crop**, centered on the pin, to Google's Gemini API. The photo is transmitted only on click, not continuously. The server reads `GEMINI_API_KEY` from `.env`.
- Gemini's response is shown as an **AI suggestion** alongside the local name. The local measured HEX/RGB stays unchanged. If Gemini is unavailable, the local shade name continues to work.

No retraining or fine-tuning occurs: Gemini performs image interpretation with a color-specific prompt. It may be wrong. Camera white balance, exposure, shiny materials, and shadows can affect both local and AI labels. Users should avoid relying on the tool for safety-critical color identification.

## Run it locally
1. Extract the complete ZIP and open the folder containing `package.json` in VS Code.
2. In VS Code PowerShell, run `npm install` and `npm test`.
3. Copy `.env.example` to `.env` and add your **existing** `GEMINI_API_KEY` and `GEMINI_MODEL=gemini-3.5-flash-lite` (your previously tested model). Use `MONGODB_URI=` if you don't want database access for this demo.
4. Set `PORT=3001` and `APP_ORIGIN=http://localhost:3001` in `.env`, then start with `node .\server\index.js`. Stop any old server using port 3001 first.
5. Open `http://localhost:3001/login` and choose `Continue without signing in` for the **local** demo. Open HueSee, select Camo Camera in the existing camera picker, and start the camera.
6. Hover over brown, lime green, chartreuse, yellow, gray and orange samples. Click to pin a sample, then click **Refine shade with Gemini** to ask for an optional AI suggestion. Your cropped photo will be sent to Google.

## QA
- 56 Node automated tests pass, including eight new shade-naming and gray-region tests.
- Syntax checks pass for `public/script.js`, `server/routes/shades.js` and `server/index.js`.
- Live Camo use and an actual Gemini shade API response **must still be manually verified** on the user's computer. The API key is not bundled or committed.
- The original CSS, Camo camera-select logic, login files and auth are unchanged.

## Integration notes
From the previous `Newest-Version` source, modified: `public/index.html` (one button), `public/script.js` (HueSee shade presentation and click handler), `src/vision/colorDetector.js` (gray scene regions), and `server/index.js` (new protected route). Added: `src/vision/shadeNaming.js`, `server/routes/shades.js`, `tests/shadeNaming.test.js` and this documentation.

**Do not push this test version onto `main`.** Test the live Camo demo first; push the changes to `Newest-Version` or a new feature branch afterward.
