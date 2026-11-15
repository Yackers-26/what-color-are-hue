# HueSee — F1 editorial + smoother hover

This project is based on the uploaded updated-main-derived HueSee v2 code. The original F1 visual direction is restored (editorial hero, Instrument Serif, cream paper, geometric poster, black ticker, generous section spacing), with existing backend/API code and all existing mode panels left in place.

## HueSee interaction
- Reticle and floating color card follow the pointer with no positional CSS easing.
- Color values update about every 32 ms instead of every 135 ms, without waiting for a three-frame agreement to move to a new object.
- Averaged pixel patches and adaptive RGB smoothing keep moderate camera noise from causing gratuitous flicker; actual device speed can vary.
- Hover shows color name, HEX, RGB. Click/tap or Pin reading freezes those values. Unpin resumes hover.
- Saved colors still use the existing HueMemory backend. Pinning itself does not send to MongoDB.

## How to run
Open this directory in VS Code; run `npm install`, `npm test`, `npm run dev`. Open `http://localhost:3000`. The camera requires localhost or HTTPS.

## Note
The F1 scroll page adds HueFind/HueDo/HueMemory introductions; their existing working tools remain in the mode switcher on the camera workspace, reached by the links on the page. No GitHub branches were changed.
