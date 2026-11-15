# WhatColorAreHue? — merged edition

**Base:** `merged-yay-yay`, with the improved HueSee/HueFind color systems integrated from `Newest-Version`. The merged edition's reference-frame HueDo, saved-guide workflows, sound and snapshot controls, account security, MongoDB ownership, and Google OAuth remain in place.

## What is included

- **HueSee:** live camera hover sampling, pin/unpin, stabilized measured HEX/RGB/HSL, descriptive shade labels, lighting-aware shade identity, scene labels and gray-region scans. An optional **Refine shade with Gemini** action compares small still-image crops only when explicitly requested; the local reading remains available without Gemini.
- **HueFind:** smooth connected-region contours, object focus, neutral-card calibration, broad color-family search, and exact named-shade/HEX/RGB search. Unknown names offer catalog suggestions; a sustained no-match can offer the closest substantial color region visible in the camera.
- **HueDo:** Gemini interprets the **complete color-dependent instruction** before creating a guide. It can propose ordered steps for finding, sorting by color, matching pairs, grouping, comparing, identifying, and multi-step tasks rather than reducing everything to "put one color into one destination." With a webcam or uploaded reference photo, Gemini can suggest multiple relevant object locations and color/group labels. In the live Camo feed, each grouped object has its own local appearance tracker; precise color masks are drawn where the camera supports them, while dotted boxes are explicitly labeled as unverified object suggestions. The plan preserves group names, step order, and optional photo-based checks, including a before-and-after photo comparison when both images are available. The tracking and Gemini judgments can still be wrong under glare, shadows, occlusion, or complex scenes: always visually confirm the highlighted objects and never treat a photo judgment as proof of an unseen action. A camera is optional for text-only planning; saving and reloading guides still require a signed-in account.
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
7. In HueDo, try **`Sort these pens by color`** with several pen colors in view. Choose **Build visual guide**, review the grouping labels and ordered steps, and start. Look for a separate object marker per visible item. Compare that with **`Match each lid to the same-color bottle`**, **`Which of these objects is the darkest blue?`**, and **`Find the red pen, then place it next to the black notebook`**. A still photo or Camo camera is optional for interpreting text, but required for locating visible objects. For physical arrangements, use **Check with a new picture**; Gemini compares the original scene and a new frame when possible. Never treat a possible box or a Gemini "done" judgment as guaranteed verification.
8. The unsupported Contrast and Text header toggles have been removed; Dark mode and Sound are retained. Toggle **Dark mode** and verify the workspace surfaces, text, form controls, dialogs, and saved-color panels use the dark palette without changing the live camera image. Test the same flows on a narrow mobile viewport; check camera controls, four mode tabs, search, and HueDo task buttons are reachable without horizontal scrolling.

## Test status and limitations

`npm test` covers camera/color processing, perceptual shade naming, lighting consistency, text-to-shade resolution, exact shade matching, contour smoothing/tracking, HueDo's multi-object plan handling and live tracker, the merged frontend contract, account-scoped task API behavior, and simulated password/Google OAuth handlers. Tests do **not** validate a real MongoDB connection, Google account login, live Gemini responses, or a physical webcam/Camo feed.

A captured HueDo photo is sent to Gemini when you request analysis or checking. When a signed-in user saves a guide, a compressed JPEG copy is stored with it in MongoDB so the guide can restore its reference picture. HueSee's Gemini refinement sends its small crop(s) only after the user clicks; those shade crops are not saved to MongoDB. Avoid photos containing sensitive information. Manual guides and local color naming still work when Gemini is unavailable.

## HueDo flexible task planning (November 2026)

Try these color-dependent instructions, with different objects and colors:

- "Sort the pens into groups by matching color."
- "Pair each colored marker cap with a marker of the same color."
- "Which of these two blue pens is darker?"
- "Arrange the red, yellow, and green objects in that order."
- "Find the yellow notebook and place the green pencil next to it."
- "Identify the color of the left-hand cable, then find the matching cable."

How it works: `/api/interpret` asks Gemini for a `taskType`, `planSteps`, relevant `groups`, and optional visual locations. HueDo preserves those steps, including group-specific labels and a photo-check stage for physical arrangements. The old rule-based parser is a fallback only when Gemini cannot answer; it cannot fully understand every complex instruction. A photo is not needed for **instruction planning**, but is needed to locate objects. With an image, color grouping may make an additional model call to label multiple items. Live tracking uses locally measured pixels, so it does not continuously send video to Gemini.

The app cannot guarantee that every instruction is feasible, safe, or visually verifiable. It does not move objects for users. Some tasks require manual confirmation when the camera view cannot establish completion. For privacy, avoid pointing the camera at private documents or people if you will send a snapshot to Gemini.
