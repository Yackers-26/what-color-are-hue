# HueSee — original sidebar + labels only

Based on the earlier F1 Smooth layout and right-side inspector. Restored HueSee, HueFind, HueDo, and HueMemory as separate tabs in the original dark camera tab bar. The landing-page sections and marketing hero are removed.

- **HueSee:** prominent color region names placed at stable region centers. No region outlines or boxes. Hover card shows name, HEX, RGB; clicking pins snapshot; saved pinned data still calls the original HueMemory API.
- **HueFind:** target region outlines preserved from the previous implementation.
- **HueDo:** existing Gemini-backed task panel and related server routes preserved.
- **HueMemory:** existing palette and image picker preserved.

The code imports the newer region segmentation and temporal stabilizer from the Brodie/camera-only version, but reuses the previously liked F1 right-sidebar layout and functionality.

Run `npm install`, `npm test`, `npm run dev`, and visit `http://localhost:3000`.

The camera labels are approximate and depend on lighting. Camera permission is required and actual MongoDB/Gemini actions need configured credentials. No remote Git branch has been changed.
