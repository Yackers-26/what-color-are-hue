# Local demo without MongoDB or Google OAuth

1. Run `npm install`, then `npm run dev`.
2. Open `http://localhost:3000/login`.
3. Click **Continue without signing in** to open the normal four-tab camera workspace.
4. Use **Back to sign in** when finished.

No email, password, Google account, or MongoDB connection is required to preview HueSee and HueFind. HueMemory persistence, account-owned tasks, and Gemini interpretation remain behind real authentication. The camera still needs browser permission. If you see Google/Mongo unavailable warnings, they are expected until configured.

**Safety:** This demo route works only in local development (localhost or 127.0.0.1, with NODE_ENV other than production). Do not use it as production authentication; real account API routes still require an authenticated account.
