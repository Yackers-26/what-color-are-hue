# WhatColorAreHue? — HueDo color & photo-check update

This full project includes all previous Camo/HueSee/HueFind/HueMemory features, official branding, the login animation, and the expanded Gemini HueDo guide.

## What's new

- HueDo and HueFind share the named-shade catalog and the same pixel-contour engine. HueDo can recognize muted purple surfaces (including a dusty-lavender camera sample) when the instruction asks for the purple family, while preserving the precise contour instead of outlining the whole object box.
- HueDo displays the **requested color** and a separate **closest observed camera shade**. The observation is a local, lighting-dependent estimate, not proof that Gemini identified the physical material correctly.
- The full user instruction is retained for the Gemini guide and before/after photo check. Complex sorting, matching, comparison, and multi-step requests are not replaced with a generic move action.
- After-photo verification now displays a persistent, accessible **Task not completed** or **Can't verify yet** message when the result is wrong or uncertain. It is never silently marked complete from an uncertain response. The original starting photo remains the reference across repeated checks.
- The displayed name on the login and application is **WhatColorAreHue?** (one word, exact capitalization, trailing question mark).

## Windows / VS Code

1. Extract the ZIP. Open the `what-color-are-hue-main` directory containing `package.json` in VS Code.
2. From **Terminal > New Terminal**, run `npm ci`, then `npm test`.
3. Run `Copy-Item .env.example .env`, then `code .env` to enter your existing Gemini key. Set `GEMINI_MODEL=gemini-3.5-flash-lite`, `PORT=3000`, `APP_ORIGIN=http://localhost:3000`. Leave `MONGODB_URI=` empty for local demo mode.
4. Stop an older server if port 3000 is in use. Run `node .\server\index.js` and keep the terminal open.
5. Visit `http://localhost:3000/login`, use **Continue without signing in**, choose your Camo camera, and open HueDo.

## Live demo checks

- Put a **dusty-lavender** object next to a gray and blue object; ask HueDo to find the **purple** one. It should label the actual camera shade when a matching color region is found and should not outline neutral gray or blue.
- Ask HueDo to **sort several pens by color**. Check Gemini's complete plan and each suggested location before following it.
- For an action such as "Put the purple pen inside the case," take a starting picture, intentionally leave it outside, and press **Check with a new picture**. A clear failure message should persist even while the camera refreshes. Correct the task and recheck.
- The model can be uncertain or wrong under shadows, glare, clutter, or obstruction. Confirm object identity before acting. The after-photo result is an AI assessment, not definitive proof of a physical action.

Do not publish `.env` or the Gemini key. MongoDB-backed saving and account login require separate database configuration. No GitHub branch is changed by this ZIP.
