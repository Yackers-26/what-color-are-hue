# WhatColorAreHue — Original Sidebar + Refined HueFind

This is the same four-tab original-sidebar build with smoother HueFind outlines and a clear label-toggle button. No database credentials are bundled.

1. Extract the ZIP and open the resulting project folder in VS Code.
2. Run `npm install`, `npm test`, then `npm run dev`.
3. Open `http://localhost:3000` in Chrome, start the webcam, and choose HueFind > Red, Blue, etc.
4. Move a large colored object slowly; verify one smooth, solid boundary and one label. Switch back to HueSee; only labels should show, and hover + pin + HEX/RGB should still work.
5. Read `HUEFIND-REFINEMENT.md` for technical details and limitations.

The application still contains HueMemory/MongoDB and HueDo/Gemini server routes, but database/AI credentials must be configured separately. These integrations have not been tested end-to-end as part of this patch.
