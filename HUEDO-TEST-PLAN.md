# HueDo manual demo checklist

The original cream/charcoal UI, live Camo camera selector, logo, login preview, HueSee, HueFind, and HueMemory are kept from the previous full project. The old Contrast and Text header toggles have been removed as requested.

## Run the full ZIP in Windows VS Code

1. Extract the ZIP. Open the **what-color-are-hue-main** folder containing `package.json`.
2. Open a PowerShell terminal and run `npm ci`, then `npm test`.
3. If the `.env` file does not exist, run `Copy-Item .env.example .env` followed by `code .env`.
4. Set `GEMINI_API_KEY=YOUR_REAL_KEY`, `GEMINI_MODEL=gemini-3.5-flash-lite`, `MONGODB_URI=`, `PORT=3000`, and `APP_ORIGIN=http://localhost:3000`. Do not share your key. Save the file.
5. Run `node .\server\index.js` and leave the terminal open.
6. Open `http://localhost:3000/login`, then choose **Continue without signing in** to use the local demo. Select Camo in HueDo for live camera tests.

## Test scenarios

- **Sorting:** five pens in different colors. Enter "Sort the pens by color." Build a guide. Confirm distinct groups, multiple target labels, and step-by-step sorting guidance. Later take another photo to check the result.
- **Matching:** two caps and two containers of different colors. Enter "Match each cap to the container of the same color." Check the pairing steps and multiple object markers.
- **Comparison:** enter "Which pen is a darker blue?" Confirm the guide doesn't invent a destination or force a photo-completion step.
- **Sequence:** "Find the yellow pencil, move it next to the blue folder, then pick up the red marker." Confirm the step order remains intact.
- **Text only:** stop the camera, clear any uploaded photo, and ask Gemini for a color-dependent instruction plan. Text planning should work, but cannot claim anything is visually located.
- **Capture visibility:** the Take picture control should only appear in HueDo, never in HueSee, HueFind, or HueMemory.
- **Header:** Dark mode and Sound stay available. Contrast and Text are gone.
- **Normal functions:** confirm login preview, logo, HueSee color readout, HueFind outlines, and HueMemory pages still render.

## Limitations

- Gemini can misunderstand task intent and objects, especially under poor lighting. An object box is an **AI suggestion**, not proof that the entire object has a requested shade.
- The photo checker may decline to verify tasks that cannot be established from the before/after photos. An unverified task can be marked complete manually.
- The local color tracker can lose an object if it moves quickly or becomes occluded; re-run Build visual guide with a clearer camera scene.
- MongoDB is not required for local demo planning. Saving guides and colors across sessions requires real sign-in and MongoDB.
