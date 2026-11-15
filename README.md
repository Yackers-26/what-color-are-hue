# WhatColorAreHue — merged edition

**Base:** `merged-yay-yay`, with the improved HueSee/HueFind color systems integrated from `Newest-Version`. The merged edition's reference-frame HueDo, saved-guide workflows, sound and snapshot controls, account security, MongoDB ownership, and Google OAuth remain in place.

## What is included

- **HueSee:** live camera hover sampling, pin/unpin, stabilized measured HEX/RGB/HSL, descriptive shade labels, lighting-aware shade identity, scene labels and gray-region scans. An optional **Refine shade with Gemini** action compares small still-image crops only when explicitly requested; the local reading remains available without Gemini.
- **HueFind:** smooth connected-region contours, object focus, neutral-card calibration, broad color-family search, and exact named-shade/HEX/RGB search. Unknown names offer catalog suggestions; a sustained no-match can offer the closest substantial color region visible in the camera.
- **HueDo:** start the webcam or upload a picture, describe the task, ask Gemini to locate the target/destination in a reference frame, review/edit the interpretation, and follow a live visual guide. Seeded object templates are tracked locally on subsequent webcam frames with moving circles, outlines, destination boxes, and directional arrows. If Gemini cannot return a target box but the task names a color, HueDo can show a clearly labeled color-family match. Fresh-photo completion checks and saved/reloaded/deleted guides remain available. The tracker is appearance-based, not a full semantic detector; it can lose an object after major occlusion, camera movement, or appearance change and will prompt the user to reacquire it.
- **HueMemory:** MongoDB-backed colors and tasks are scoped by the authenticated user ID, **not a browser-controlled sessionId**. Saved HueSee entries retain the broad family plus a descriptive shade label and exact measured values.
- **Sign in:** email/password creation and login with scrypt-hashed passwords, HttpOnly database-backed sessions, logout, CSRF origin checks, and Google OAuth 2.0 authorization code + PKCE/state validation.
- **Local demo:** `/demo` works only when the server is reached locally and `NODE_ENV` is not `production`. Saving to account storage requires sign-in.

## HueSee/HueFind color-system integration

- A curated catalog of 281 named swatches (CSS colors plus specialty shade names) is searched locally. Arbitrary colors remain searchable by HEX or RGB.
- CIEDE2000/CIELAB matching selects perceptually close named references within the classifier's color family, preserving important brown/orange and chartreuse/yellow distinctions.
- HueSee's shade identity tracker holds a label through plausible exposure/shadow shifts at the same camera point, while HEX/RGB remain the measured camera values. The Speak color control reads only the shade name.
- HueFind uses strict perceptual matching for named shades and exact RGB/HEX references, but keeps broad family matching for terms such as `green` or `blue`.
- Gray regions are included in HueSee scene scans; white backgrounds remain excluded. HueFind contours retain mask cleanup, smoothing, and temporal tracking.
- Gemini shade refinement is optional and click-triggered. It sends a 224×224 JPEG crop, and when available a pin-time reference crop plus current RGB context, to the server-side `/api/shades` route. The API key stays on the server; Gemini output is advisory and never overwrites the measured HEX/RGB.
- **Dark mode** uses a dedicated dark palette and explicit surface, border, control, and text colors; the camera feed and measured color values are never inverted. The preference is stored locally. Mobile layouts use a compact camera-first view, touch-sized controls, and responsive task forms.

## Requirements and setup

Requires **Node.js 20+**, a MongoDB Atlas deployment (or compatible MongoDB server), and a Google Cloud OAuth Web application for Google sign-in. Gemini is needed for automatic HueDo photo analysis/verification and optional HueSee shade refinement. HueSee's local shade naming and HueFind text search do not require Gemini or MongoDB.

```bash
npm ci
cp .env.example .env
```

Edit `.env` using your own secrets (never commit the file):

```dotenv
MONGODB_URI=mongodb+srv://YOUR_USER:YOUR_PASSWORD@YOUR_CLUSTER.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=huememory
APP_ORIGIN=http://localhost:3000
GOOGLE_CLIENT_ID=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=YOUR_WEB_CLIENT_SECRET
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_MODEL=gemini-3.5-flash-lite
PORT=3000
```

MongoDB Atlas: create a dedicated database user with the necessary read/write permissions, and permit **the public IP address of the running server** in Network Access (not the loopback address). URL-encode special characters in the database password. The application creates the user, session, OAuth state, color, and task indexes at startup. The `MONGODB_URI` is server-only.

Google Cloud Console: configure the OAuth consent screen, add your Google test account to **Test users** if the OAuth app is still in testing, then create an **OAuth Client ID** of type **Web application**. Add:

- **Authorized JavaScript origin:** `http://localhost:3000`
- **Authorized redirect URI:** `http://localhost:3000/api/auth/google/callback`

The `APP_ORIGIN` must exactly match the site users open, **without a trailing slash**, and the OAuth redirect URI must match it plus `/api/auth/google/callback`. For production use **HTTPS**, replace both entries with your deployed HTTPS origin and redirect, and set `NODE_ENV=production` (which also disables local demo mode). Never put `GOOGLE_CLIENT_SECRET` in frontend code. Google sign-in requires MongoDB too.

Run:

```bash
npm test
npm run dev
```

Open **http://localhost:3000**. Check `GET /api/health` to inspect configured services, or `GET /api/auth/config` for whether email and Google sign-in can be used. The login page is `/login`; account features are at `/app` after authentication.

## Verification checklist

1. With MongoDB configured, visit `/login`, click **Create account**, enter a name, email, and password of at least 12 characters, then confirm redirect to `/app`.
2. Sign out. Sign in again with the same email/password; a wrong password should produce a readable error. Refresh `/app` to check session persistence.
3. Click **Continue with Google**, choose an authorized Google account, and confirm redirect to `/app`. Sign out and sign in with Google again to confirm the same account is reused. The app deliberately does **not** automatically link a Google login to an existing password-only account with the same email; use the original method in that case.
4. In HueSee, hover over brown, chartreuse, sage, and gray objects; confirm the detailed name changes while HEX/RGB remain measured values. Pin a reading and test the Gemini button only if a key is configured.
5. In HueFind, search for `sage green`, `burgundy`, `chartreuse`, `#7FFF00`, and `rgb(156, 175, 136)`. Test an unknown/misspelled shade and confirm suggestions require an explicit selection.
6. Save a color in HueMemory or start and save a HueDo guide. Sign out, sign back in and confirm it persists. A second account must not see it.
7. In HueDo, start the webcam, enter `Where is the pink pen?`, choose **Build visual guide** (the current live frame is captured automatically), confirm/correct the interpretation, and move the camera/object to confirm that the target marker follows it. For placement tasks, verify that the target and destination markers move and the arrow updates. Uploading a photo remains supported; starting the webcam afterward enables live tracking from that reference image. A new camera picture can optionally be sent to Gemini for a task completion check; it is not infallible proof of a physical action.
8. Toggle **Dark mode** and verify the workspace surfaces, text, form controls, dialogs, and saved-color panels use the dark palette without changing the live camera image. Test the same flows on a narrow mobile viewport; check camera controls, four mode tabs, search, and HueDo task buttons are reachable without horizontal scrolling.

## Test status and limitations

`npm test` covers camera/color processing, perceptual shade naming, lighting consistency, text-to-shade resolution, exact shade matching, contour smoothing/tracking, HueDo's live template tracker, the merged frontend contract, account-scoped task API behavior, and simulated password/Google OAuth handlers. Tests do **not** validate a real MongoDB connection, Google account login, live Gemini responses, or a physical webcam/Camo feed.

A captured HueDo photo is sent to Gemini when you request analysis or checking. When a signed-in user saves a guide, a compressed JPEG copy is stored with it in MongoDB so the guide can restore its reference picture. HueSee's Gemini refinement sends its small crop(s) only after the user clicks; those shade crops are not saved to MongoDB. Avoid photos containing sensitive information. Manual guides and local color naming still work when Gemini is unavailable.
