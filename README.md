> **New: Authentication + vision refinements.** Read [START-HERE.md](START-HERE.md) first for the login setup, Google OAuth and MongoDB configuration.

# WhatColorAreHue — Original Sidebar / Labels Only

This version restores the earlier F1 warm editorial camera workspace, with the original right-hand inspector and the four separate tabs: **HueSee**, **HueFind**, **HueDo**, **HueMemory**.

- **HueSee:** names of up to six prominent color regions appear on the video **without outlines**. The smooth hover card shows name, HEX, RGB. Click/tap to pin, unpin to resume, save pinned color to HueMemory when the MongoDB API is configured.
- **HueFind:** keeps the original target-region **outlines**.
- **HueDo:** retains existing task tools and Gemini server integration.
- **HueMemory:** retains the palette, photo picker, and existing API integration.

The marketing/scroll page has been removed. This is one camera workspace with four tabs. Region detection is based on the uploaded Brodie implementation and temporal stabilization; the UI/inspector was restored from the F1 Smooth version.

## Run locally

```powershell
npm install
npm test
npm run dev
```

Then open `http://localhost:3000`. Camera permission is required. Use **npm run dev**, not Live Server, because the project has an Express backend. Database and Gemini calls require configured credentials in `.env`. Camera colors are approximate and depend on lighting.

This is a separate generated project; no GitHub branch was modified. The browser checks used a simulated video frame, so the physical webcam still needs testing.
