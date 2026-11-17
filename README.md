
<div align="center">
  <img src="https://github.com/Yackers-26/what-color-are-hue/blob/main/wcahtypography.png?raw=true" alt="WhatColorAreHue? logo" width="220" />
  <h1>WhatColorAreHue?</h1>
  <p><strong>AI-powered color accessibility assistant built with JavaScript, Express, Gemini, and MongoDB.</strong></p>
  <p>
    See it. Find it. Hue it.<br /><br />
    Try it out: https://whatcolorarehue.us
  </p>
</div>

## Why WhatColorAreHue?

Everyday instructions assume that everyone can distinguish the same colors. Finding a blue pen, identifying a shade, or sorting objects by color can be frustrating for people with color-vision deficiencies.

WhatColorAreHue? turns a phone camera or laptop webcam into a practical accessibility tool. Instead of stopping at color identification, it supports a **See → Find → Do → Remember** workflow:

- identify a color and communicate it through text and speech
- locate matching colors in a live camera view using visible outlines
- translate natural-language tasks into guided, checkable steps
- save useful colors and task guides to a personal library

The goal is to make color-dependent tasks easier to understand and complete independently.

## Core features

- **HueSee — real-time color identification**
  - reads colors from a live camera feed and identifies named shades
  - displays HEX, RGB, and HSL values alongside readable labels
  - offers spoken readings, steadier sampling, and camera calibration

- **HueFind — accessible color search**
  - searches for colors by name, HEX value, or RGB value
  - detects matching image regions and highlights them with high-contrast contours
  - uses perceptual color matching and region filtering to reduce visual noise

- **HueDo — AI-guided task assistance**
  - uses Gemini to interpret instructions and identify relevant objects in an image
  - turns a goal into accessible, actionable steps
  - supports follow-up image checks to help verify whether a task was completed
  - tracks localized objects between AI requests for more responsive guidance

- **HueMemory — persistent personalization**
  - saves favorite or useful colors and reusable task guides in MongoDB
  - keeps saved content associated with authenticated users
  - lets users revisit and manage their personal library

- **Accessible interface and accounts**
  - provides high-contrast presentation, adjustable text, and audio cues
  - supports email/password accounts and optional Google sign-in
  - includes a localhost-only demo entry point for trying the interface without an account

## Technical highlights

### 1) Camera-based color detection with perceptual matching

A camera's raw RGB values are affected by lighting, white balance, and sensor noise. The client-side vision pipeline combines color sampling and classification with shade naming, perceptual similarity, and temporal stabilization.

- nearby readings can be smoothed to avoid constant label changes
- neutral-card calibration can compensate for difficult camera conditions
- perceptual shade matching provides a better basis for human-readable color names than exact RGB equality

### 2) Region detection designed for accessible feedback

HueFind does more than return a color name. It finds candidate regions in the live image, applies spatial filtering, and smooths their boundaries before drawing high-contrast outlines.

Users can look for a requested color without needing to distinguish that color from its surroundings. Text labels and outlines provide alternative visual signals.

### 3) Semantic AI guidance paired with local object tracking

Gemini supplies the semantic understanding needed to turn instructions and camera images into object locations and task guidance. Local JavaScript logic handles subsequent tracking between requests.

This division of work reduces the need to send a new AI request for every camera frame while keeping live guidance responsive. HueDo also includes parsing, recovery, and verification logic for uncertain or incomplete AI results.

### 4) Account-scoped storage and session security

The Express backend separates user-owned resources from image-interpretation endpoints:

- MongoDB stores users, sessions, saved colors, and saved tasks
- sign-in sessions use `HttpOnly`, `SameSite=Lax` cookies, with `Secure` enabled for HTTPS origins
- protected color and task routes require a real authenticated account
- same-origin checks protect state-changing requests
- the local demo does not grant access to another user's saved data

### 5) Modular vision logic with automated tests

Color sampling, camera calibration, shade detection, search, region presentation, task interpretation helpers, and object tracking live in separate modules. The repository includes Node.js tests for these components as well as authentication and HueDo behavior.

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | HTML5, CSS, JavaScript |
| Camera and rendering | WebRTC camera access, Canvas API |
| Color vision | Custom JavaScript sampling, perceptual shade matching, region detection, object tracking |
| Backend API | Node.js, Express 5 |
| AI understanding | Google Gemini via `@google/genai` |
| Database | MongoDB / MongoDB Atlas |
| Authentication | Email/password, Google OAuth, cookie-backed sessions |
| Accessibility | Speech synthesis, high-contrast UI, adjustable text, keyboard support |
| Deployment | Vercel Express configuration |
| Testing | Node.js built-in test runner |

## Architecture overview

```text
what-color-are-hue/
  public/
    index.html, script.js, style.css
      -> camera-powered HueSee, HueFind, HueDo, HueMemory UI
    login.html, login.js
      -> sign-in and account entry

  src/vision/
    cameraProcessor.js, cameraCalibration.js
      -> camera frames, color sampling, calibration
    colorDetector.js, colorPerception.js, perceptualShade.js
      -> color classification and shade matching
    hueFindSearch.js, regionPresentation.js, smoothContours.js
      -> matching-region search and accessible outlines
    liveObjectTracker.js, hueDoVerification.js
      -> object tracking and task-checking helpers

  server/
    index.js
      -> Express app, static assets, protected API routes
    auth.js, db.js
      -> sessions, login, MongoDB connection
    routes/
      colors.js, tasks.js
        -> account-owned HueMemory data
      interpret.js, shades.js
        -> Gemini-assisted task understanding and shade refinement

  tests/
    -> Node.js tests for color vision, HueDo, tracking, and auth
```

## Local setup

### 1) Requirements

- A recent Node.js version and npm
- A webcam or smartphone camera, with camera permissions enabled
- MongoDB Atlas or another reachable MongoDB instance for accounts and HueMemory
- A Gemini API key for AI-powered HueDo and optional shade refinement
- Optional Google OAuth credentials for Google sign-in

### 2) Install dependencies

```bash
npm install
cp .env.example .env
```

### 3) Configure environment variables

Edit `.env` with your own credentials:

```env
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/
MONGODB_DB=huememory
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_FALLBACK_MODELS=
PORT=3000
APP_ORIGIN=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

- Set `APP_ORIGIN` to the exact URL where the application is served.
- For Google sign-in, register `http://localhost:3000/api/auth/google/callback` as an authorized redirect URI in Google Cloud Console. Use the equivalent callback URL for production.
- Keep database credentials, Gemini keys, and the Google client secret server-side. Never commit `.env`.
- MongoDB is required for working account sign-in and saved data; without it, the login page can still load.

### 4) Run the app

```bash
npm run dev
```

Open `http://localhost:3000`. For a production-style local start, run `npm start` instead.

To preview the interface locally without signing in, visit `http://localhost:3000/demo`. The demo is restricted to localhost, and saved colors and tasks still require an authenticated account.

### 5) Run tests

```bash
npm test
```

## Example user flows

### HueSee and HueFind

1. Sign in and allow camera access.
2. Point the camera at an object to read its color name and HEX/RGB/HSL values.
3. Switch to HueFind and enter a color name or code.
4. Follow the outlined matching regions rather than relying on the color itself.

### HueDo task guidance

1. Describe a task involving colors or objects.
2. Let HueDo analyze the instruction and available image context.
3. Follow the generated steps and object-location guidance.
4. Provide a new image for a completion check when prompted.

### HueMemory

1. Identify a useful shade or create a reusable task guide.
2. Save it to your account's library.
3. Return to the library to find or manage the saved item later.

## Future improvements

- test the interface with people across different types of color-vision deficiencies
- improve robustness under difficult lighting, glare, and complex backgrounds
- strengthen live object tracking during motion and partial occlusion
- expand support for multi-step and more complex real-world tasks
- improve screen-reader semantics and end-to-end keyboard navigation
- add broader integration and device-level camera testing

## License

MIT
