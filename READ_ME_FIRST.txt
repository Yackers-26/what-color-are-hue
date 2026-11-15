WHATCOLORAREHUE — HUESEE + GEMINI SHADE TEST

Use the FULL zip to test in a separate folder.

1. Extract this zip with Windows File Explorer.
2. Open the extracted folder (it contains package.json) in VS Code.
3. VS Code terminal: npm install
4. VS Code terminal: npm test  (expect 56 tests passing)
5. VS Code terminal: Copy-Item .env.example .env
6. In the .env file, set GEMINI_API_KEY to your existing private key,
   GEMINI_MODEL=gemini-3.5-flash-lite, MONGODB_URI=,
   PORT=3001, APP_ORIGIN=http://localhost:3001
7. Stop any old app running on port 3001 (Ctrl+C).
8. VS Code terminal: node .\server\index.js
9. Browser: http://localhost:3001/login
10. Continue without signing in. Choose Camo Camera in HueSee.
11. Hover, pin a shade, then click Refine shade with Gemini.

Do NOT paste your API key into chat.
This zip does not contain your private .env file or node_modules.
This is for local testing only; your GitHub main/Newest-Version branches
are not modified by extracting or running it.

If you already have the Newest-Version code on your PC, the PATCH zip
contains only the eight files that changed. Use the FULL zip if unsure.
