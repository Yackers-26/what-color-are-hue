# HueDo + Gemini integration — Camo demo build

**Starting point:** `whatcolorarehue-vision-reliability-full.zip` (the version with Camo camera picker, login, local demo access, and the original four-tab editorial interface).

**Imported functionality:** `what-color-are-hue-test-merge.zip`, the teammate's tested HueDo Gemini text/image interpretation, extra object-localization, picture-based completion-checking route, and rule-based task parser.

## Exactly what changed

- `server/routes/interpret.js` — upgraded to the teammate's tested structured interpretation, image localization, and `POST /api/interpret/check` endpoint.
- `server/index.js` — enables `/api/interpret` only for an authenticated user **or** a local loopback demo browser that explicitly entered through **Continue without signing in**. `/api/colors` and `/api/tasks` remain authenticated; public nonlocal demo access stays blocked.
- `public/js/huememory.js` — adds a `checkTask(image, task)` API client, while retaining account-based saved-color and saved-task API behavior.
- `public/js/hueDoParser.js` — adds teammate's no-dependency parsing helpers as a fallback for manual guidance when Gemini fails.
- `public/script.js` — wires the existing HueDo tab to the richer Gemini response; allows **Use this guide** locally in demo mode without claiming it was saved; uses an **on-demand fresh frame from the chosen camera** for Gemini completion checks; removes automatic completion based on color entering a guessed screen area.
- `tests/hueDoParser.test.js` — imports teammate's original seven parser tests.
- `.env.example` — recommends the tested working `gemini-3.5-flash-lite` model.

**Unchanged visual assets:** `public/index.html`, `public/login.html`, every CSS file, all icons, and the right-hand sidebar layout. HueSee, HueFind, HueMemory, and the Camo selector remain unchanged.

## Run on Windows (new, separate folder — do not overwrite main)

1. Extract the full ZIP and open the folder containing `package.json` in VS Code.
2. In PowerShell run `npm install`, then `npm test`.
3. Run `Copy-Item .env.example .env` and open `.env`. Set your **existing** `GEMINI_API_KEY` (never post or commit it), `GEMINI_MODEL=gemini-3.5-flash-lite`, and `MONGODB_URI=`. Set `APP_ORIGIN=http://localhost:3000` and `PORT=3000` for the example URLs below.
4. Stop any other local server using port 3000 and run `npm run dev`.
5. Open `http://localhost:3000/login` in Chrome and click **Continue without signing in**.
6. In the camera selector choose **Camo**, then start the camera. Use the **HueDo** tab to enter instructions, optionally add an image, and select **Build visual guide**.
7. Select **Use this guide**. In demo mode it runs locally and is **not saved to MongoDB**.
8. For tasks with a target and a destination, move the object, then click **Check with camera**. This explicitly captures the currently selected Camo frame and asks Gemini for an assessment. For a task without a destination, the guide can be marked complete manually.

**Note:** Gemini is a remote service; pressing Build visual guide or Check with camera sends instruction text and, if provided, a photo/camera frame to Google. Only capture images you intend to share. Gemini completion is a fallible visual judgment, not reliable proof of a real-world action.

## Important constraints

- MongoDB and Google OAuth are **not** needed to test local demo interpretation; saved account records still require sign-in and a MongoDB connection.
- Non-local or production users must authenticate to use the Gemini route. Avoid exposing a development server or enabling an unauthenticated public endpoint using a paid API key.
- The demo-mode guide is not persisted and disappears if you refresh the browser.
- **Camo video selection remains the user's choice.** The same video source is used for a fresh verification photo; no camera hardware changes are required.
- The existing camera-overlaid guidance is still approximate color guidance. Gemini's object bounding boxes are returned for uploaded images, but this build does **not** project those boxes onto a different live camera frame or claim to track arbitrary objects in real time.
- Real Google API calls and live Camo camera operation must be verified in your environment; automated tests run without credentials.

## GitHub

Nothing is pushed automatically. After testing, create a **separate branch**, review the changed files with teammates, and merge only if approved.
