# WhatColorAreHue — merged edition

**HueSee and HueFind from `Newest-Version` + HueDo from `test-merge`**, with Newest-Version's HueMemory, visual presentation, MongoDB account ownership, and Google OAuth authentication.

## What is included

- **HueSee:** native live camera, color sampling and pinning, up to six stabilized color-region labels, RGB/HEX/HSL, speech, save to HueMemory.
- **HueFind:** smooth color-contour tracking, selection of a specific region, lighting calibration, camera selection, and saved-shade matching.
- **HueDo:** take a photo or upload one, describe the task, ask Gemini to locate objects, review/edit the interpretation, follow spoken steps, request an optional fresh-photo completion check, and save/reload/delete guides. Sorting tasks are supported. **HueDo uses a frozen photo, not ungrounded object detection on live video.**
- **HueMemory:** MongoDB-backed colors and tasks are scoped by the authenticated user ID, **not a browser-controlled sessionId**.
- **Sign in:** email/password creation and login with scrypt-hashed passwords, HttpOnly database-backed sessions, logout, CSRF origin checks, and Google OAuth 2.0 authorization code + PKCE/state validation.
- **Local demo:** `/demo` works only when the server is reached locally and `NODE_ENV` is not `production`. Saving to account storage requires sign-in.

## Requirements and setup

Requires **Node.js 20+**, a MongoDB Atlas deployment (or compatible MongoDB server), and a Google Cloud OAuth Web application for Google sign-in. Gemini is needed for automatic HueDo photo analysis and verification.

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
4. Save a color in HueMemory or start and save a HueDo guide. Sign out, sign back in and confirm it persists. A second account must not see it.
5. In HueDo, upload a photo, enter `Where is the pink pen?`, choose **Build visual guide**, confirm/correct the interpretation, and follow its steps. A new camera picture can optionally be sent to Gemini for a task completion check; it is not infallible proof of a physical action.

## Test status and limitations

`npm test` runs color/camera and HueDo parsing tests, static merged frontend contract checks, a mocked task database ownership test, and simulated password/Google OAuth handler tests (including PKCE, state and replay checks). These tests do **not** validate a real MongoDB connection, Google account login, or live Gemini key; those still require you to supply credentials, allow the necessary network access, and run the verification checklist.

A captured HueDo photo is sent to Gemini when you request analysis or checking. When a signed-in user saves a guide, a compressed JPEG copy is stored with it in MongoDB so the guide can restore its reference picture. Avoid photos containing sensitive information. Manual guides still work when Gemini is unavailable; they cannot offer reliable object location or camera verification without it.
