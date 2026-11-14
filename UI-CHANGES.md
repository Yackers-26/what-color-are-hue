# HueSee accessible UI update

This update changes the HueSee presentation layer only.

## UI changes

- Adds a color-information panel with the sampled color name, HEX, RGB, and derived HSL values.
- Adds a plain-language appearance description based on the sampled RGB values.
- Calculates relative luminance and black/white text contrast ratios for the sampled color.
- Adds a spoken readout for the color name and values.
- Adds a detected-color overview using the existing detector's sample counts and approximate bounds.
- Adds optional high-contrast camera-region outlines, plus high-contrast and larger-text display controls.
- Keeps keyboard sampling and touch/pointer sampling available, with visible instructions.

## Implementation boundary

Only `index.html`, `style.css`, and `script.js` were changed. The existing `src/vision/colorDetector.js` and `src/vision/cameraProcessor.js` files are unchanged. The detector still classifies the same sampled camera pixels and returns the same result shape. HSL, luminance, and contrast are presentation values derived from the RGB values already returned by the existing sampler.

Region outlines and location cues represent approximate extents of grouped same-color samples. They are not individual object boundaries or object recognition.

## Test

Run `npm test` from this directory. All 6 existing tests pass.
