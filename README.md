# WhatColorAreHue

**See it. Find it. Do it.**

A camera-first accessibility workspace for color identification, color finding, and general visual task guidance.

## Features

- **HueSee** — live color recognition, pointer/touch sampling, HEX/RGB/HSL values, speech, and floating color chips anchored to major detected color regions.
- **HueFind** — find a selected or saved shade with dotted contours that follow separate connected color regions instead of large category-wide rectangles.
- **HueDo** — Gemini interprets open-ended typed or photographed instructions into concise steps and optional visual cues. The camera view can show target chips, dotted outlines, and directional arrows when the instruction provides usable spatial or color information.
- **HueMemory** — save and reuse color references with MongoDB Atlas.
- **Image color picker** — sample a point in an uploaded photo and save that color.
- **Saved guides** — store, reload, and complete interpreted tasks in MongoDB Atlas.

## Interface

The app uses one camera-centered workspace. The mode dock switches between HueSee, HueFind, HueDo, and HueMemory without stopping the camera. Desktop uses a contextual side panel; mobile keeps the mode dock inside the bottom of the camera frame. Hovering or focusing a mode shows a short preview above the dock.

The color-chip toggle controls floating labels in the camera view. HueFind and HueDo use thin dotted contours around detected connected color regions rather than broad bounding boxes.

## Run locally

Requirements: Node.js 20 or newer and a MongoDB Atlas connection string.

```bash
npm install
cp .env.example .env
```

Add your credentials to `.env`:

```env
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=huememory
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
PORT=3000
```

Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

The camera works on `localhost` or on an HTTPS deployment. MongoDB-backed palette and task storage require `MONGODB_URI`. Gemini instruction interpretation requires `GEMINI_API_KEY`. The camera scanner can be tested independently of those services.

## Tests

```bash
npm test
```

Tests cover common color classification, multiple colors in one frame, disconnected regions of the same color, and camera-frame processing.

## Visual guidance limitations

The detector groups sampled pixels into approximate connected color regions. It can outline color regions and use explicit directions or color landmarks from Gemini to place visual cues. It does **not** identify arbitrary objects, read every scene element, or understand unrestricted physical actions from the webcam. For tasks without a camera-verifiable color and supported destination zone, the app presents the guide and lets the user mark the task complete. Camera verification remains a controlled color-sampling check, not general object recognition.

## Security notes

- Keep `.env` out of source control.
- Gemini and MongoDB credentials are used only by the server.
- Palette and task API operations are scoped to a browser-generated session identifier.
- Use restricted MongoDB Atlas network access and a dedicated database user.
