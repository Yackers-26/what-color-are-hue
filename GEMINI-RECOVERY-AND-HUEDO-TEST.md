# HueDo Gemini recovery and instruction parsing fix

This build fixes the incorrect "model isn't available" fallback behavior and prevents HueDo from showing a misleading offline guide. The app now tries supported alternative Gemini model IDs when the primary returns a model-unavailable or overloaded error. It also parses a common typo such as "Help meput the purple socks on the blue notebook" into the intended "Help me put..." command.

## Windows / VS Code startup

1. Extract the ZIP, then open **what-color-are-hue-main** (the folder with `package.json`) in VS Code.
2. In a PowerShell terminal run `npm ci`, then `npm test`.
3. Run `Copy-Item .env.example .env`, then `code .env`.
4. Add your real `GEMINI_API_KEY` to `.env` and keep `GEMINI_MODEL=gemini-3.5-flash-lite`. Leave `MONGODB_URI=` blank if you are using the local demo without an account. If the model is restricted for your key, the backend will try known text-and-image alternatives automatically. Do not upload `.env` to GitHub.
5. Stop any old server on port 3000 using **Ctrl+C**, then run `node .\server\index.js`.
6. Open `http://localhost:3000/login`, choose **Continue without signing in**, open HueDo, and select Camo.
7. Try **Help me put the purple socks on the blue notebook** and **Sort the pens by color**. If Gemini fails, the app now shows an error and **does not generate a misleading fallback plan**. Check the server terminal for the actual API status, restart after editing `.env`, and retry.

## What is not verified

Automated tests validate the request/model candidate policy, grammar parsing, and error-state code, but a live Gemini API request requires your own key and an internet connection. Camo camera localization needs live testing on your computer. The app should not claim it can always identify an object or verify an action.
