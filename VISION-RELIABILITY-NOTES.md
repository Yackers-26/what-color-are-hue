# HueSee/HueFind reliability update

This version starts from the latest **login demo** project; the login, guest access, MongoDB endpoints, Gemini endpoints, four tabs, and pin-to-HueMemory flow are preserved.

## Changes

- HueFind now draws a single strongest matching region by default, not every similarly colored patch.
- Smooth outlines use a **vector SVG cubic spline**, not a 320px raster overlay stretched to fill the screen.
- **Tap one object** in HueFind to lock onto that region. Tap another to change focus; use Reset object focus to go back to the strongest match.
- HueFind's tracker keeps short detection losses for up to six analysis frames. It does not infer hidden or occluded silhouettes.
- **Calibrate from white card**: hold plain white/gray paper in the center of the camera, click the button. The resulting capped channel gains are used only to improve HueFind matching. Use reset to undo it. Do not treat this as laboratory color calibration.
- Red targets use a less permissive chroma/hue threshold to reduce accidental matches on skin/warm objects. The supported color categories remain as before.
- HueSee's inspector now shows a secondary **closest CSS shade** label from a small documented subset of standard CSS named colors. Main name/HEX/RGB/pin remain unchanged. Standard reference is from MDN CSS `<named-color>`: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/named-color
- New **Camera** dropdown in the live-video toolbar, populated after camera permission. Browser asks for 1280×720 / 30 fps where supported but may choose something else.

## What this does not solve

A mask from a color range is not arbitrary object segmentation. A multicolored object, a low-contrast edge, a person's skin, or two touching similarly colored objects will often give inaccurate contours. MediaPipe Image Segmenter offers pretrained semantic masks such as people/hair, not an arbitrary `find red toy` mask. Interactive Segmenter lets you select an arbitrary object in a pinned still image, not track it continuously in video. For a true object boundary on arbitrary moving objects, use an appropriate video segmentation / tracking model, and evaluate its hardware requirements.

## Test

```
npm install
npm test
npm run dev
```

Open http://localhost:3000/login and click Continue without signing in. After selecting HueFind, pick a color and tap one object to focus it. Use a plain backdrop and a white card to calibrate if colors drift. For a better camera, install Camo Studio / Camo Camera and choose `Camo Camera` from the app's Camera dropdown.

No external model/network service is added to the camera pipeline. No MongoDB or Google OAuth configuration is needed for local demo mode. Physical webcam and account/database integration still require live testing. All code is new and installed in a standalone copy, not pushed to GitHub.

## Research references

- MDN reference color names: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/named-color
- OpenCV contour segmentation: https://docs.opencv.org/5.0/py_tutorials/py_imgproc/py_contours/py_contours_begin/py_contours_begin.html
- OpenCV gray-world white balance: https://docs.opencv.org/5.0/extra_modules/classcv_1_1xphoto_1_1GrayworldWB.html
- MediaPipe Image Segmenter limitations: https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter
- MediaPipe Interactive Segmenter (still images): https://developers.google.com/edge/mediapipe/solutions/vision/interactive_segmenter
- Camo Studio: https://camo.com/studio

## Live test priorities

1. Start in demo mode, HueSee hover and pin still work.
2. Go to HueFind, select Red, show a red card and move it. The one SVG outline should follow the single strongest region.
3. Tap the red card to focus it. The outline should not jump to another same-colored object.
4. Place a white card at the center and press Calibrate. If the color cast is too strong, use Reset lighting calibration.
5. If using a phone as camera, select Camo Camera in the top Camera selector. Webcam camera/source switching should stop the old stream first.
6. On a phone or slow laptop, ensure frame cadence stays responsive; high-resolution capture is a request, not a guarantee.

## Known limitations

The outline still follows *similar-color connected pixels*. It can be wrong when an object has complex colors, occupies the same-color background, or moves quickly under changing light. This release does not include arbitrary-object ML segmentation or the ability to see hidden object boundaries. The new SVG rendering removes blocky scaling of the outline, but it cannot invent missing mask pixels.
