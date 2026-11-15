## Try the app without MongoDB or Google (local preview)

Run `npm install` and `npm run dev`, open `http://localhost:3000/login`, then click **Continue without signing in**. Camera and color tools are available in demo mode. Database saves and account-only features will need authentication later. You do not need to configure `.env` for this local preview.

---

# WhatColorAreHue — account sign-in + HueSee / HueFind refinements

This is a **separate copy** of the previous `huefind-refined` project. The original four-tab camera workspace and its cream/charcoal styling remain in place. The `/login` screen appears before `/app`.

## Set up in VS Code (Windows PowerShell)

1. Extract the full ZIP into a new folder, not over your existing Git repository.
2. Open that extracted folder in VS Code, then **Terminal → New Terminal**.
3. Run `npm install`, then `npm test`.
4. Copy `.env.example` to `.env` with `Copy-Item .env.example .env`.
5. Edit `.env` to put in a working `MONGODB_URI` from MongoDB Atlas and set `APP_ORIGIN=http://localhost:3000`. Keep secrets out of GitHub.
6. Run `npm run dev` and visit **http://localhost:3000** (not Live Server; not 127.0.0.1).
7. You should see the new **Sign in / Create account** page. Create a test account with a name, email, and a password of at least 12 characters. After signing in, you should see your original camera workspace.
8. To test Google sign-in, follow the Google section below. The Google button is disabled while credentials are not configured.

**If MONGODB_URI is missing/unreachable:** the sign-in page still loads, but accounts **cannot log in**. This is intentional—no misleading fake authentication or guest bypass. The page explains the setup issue.

## Enable Google OAuth

1. Open **Google Cloud Console** → APIs & Services → Credentials. Set up the OAuth consent screen for your project, adding test users if the app is still in testing mode.
2. Create an **OAuth client ID → Web application**.
3. Add the **Authorized redirect URI** exactly:
   `http://localhost:3000/api/auth/google/callback`
4. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to **.env**. Keep the client secret only on the server.
5. Restart `npm run dev`. Refresh `/login`. The **Continue with Google** button is now enabled.
6. For public deployment, update `APP_ORIGIN` to your HTTPS site and add that site's exact callback URI in Google Cloud.

Google uses an authorization code with PKCE and state protection. Email accounts and Google accounts that share an address are **not silently linked**; the user must sign in using the original method. Account linking can be added later with explicit consent.

## What now uses accounts

- `/api/colors` (HueMemory saved shades) uses the authenticated account ID on the server, not browser-supplied `sessionId`.
- `/api/tasks` (HueDo saved guides and completion state) is likewise account-scoped.
- `/api/interpret` requires a logged-in account; the existing Gemini API key is still needed for AI interpretation.
- Saving an exact HEX captures a distinct shade entry (such as `Blue #467ABD`) instead of overwriting every saved shade with the generic name `Blue`.
- The header shows the signed-in name and **Sign out** button.

Data previously saved to older browser session IDs **will not automatically appear** under a new account. A separate, explicit migration step would be needed to attach old data to users.

## Vision refinements

- HueFind's stored-shade matcher uses **perceptual CIELAB chroma, hue and tolerant lightness** comparison. A darker reading of the same apparent shade can still match.
- HueFind's contour tracker rejects implausibly large area jumps and smooths contour points more strongly while the object is nearly still. It continues to use clean, joined color masks and continuous lines.
- HueSee's live cursor reading smooths minor jitter when the pointer stays in one place but remains responsive to movement. Pinning still freezes the complete sample and HEX/RGB.
- HueSee continues to show **labels only**, with no outlines. HueFind retains the **outlines**.

### Why no full MediaPipe object-segmentation replacement yet?

MediaPipe's **Image Segmenter** can process video, but its masks cover only categories the chosen model knows (for example, foreground people with a person-specific model). **Interactive Segmenter** selects arbitrary objects by click/brush on a *pinned image*, not a continuous live video stream. Neither is a drop-in general-purpose 'outline any object with this color' API. The contour method therefore stays as the working fallback. A future optional video-capable model for your chosen object classes can be added without breaking HueFind.

References:
- Google Image Segmenter: https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter
- Google Interactive Segmenter: https://developers.google.com/edge/mediapipe/solutions/vision/interactive_segmenter
- Google OAuth web server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- OWASP password storage: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

## QA / limits

- `npm test`: **36 passing tests**, including 7 new color-perception tests.
- Login UI rendered on desktop and mobile with no horizontal overflow; sign-in/create-account tab switched correctly.
- Server/auth JavaScript syntax checked, but a full authenticated **MongoDB integration run** and real Google OAuth exchange could not be tested in this environment. Those require your real MongoDB and OAuth credentials.
- An actual physical webcam/phone test is still required to evaluate lighting changes and tracking smoothness.

### Important production readiness work

This is a **working prototype authentication implementation once MongoDB is configured**, not a complete public identity service. Before inviting real users, add email ownership verification, password-reset flow, distributed abuse protection, security/penetration testing, a privacy and retention policy for camera-derived data, and production HTTPS and secret management. Passwords are stored as salted scrypt hashes; login sessions use random opaque HttpOnly cookies with hashes stored in MongoDB. Google credentials remain server-side.

**Do not push `.env` or any MongoDB credentials to GitHub.** Test on a separate branch before any merge into `main`.
