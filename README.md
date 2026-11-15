## Inspiration

Color-dependent tasks are everywhere, but they assume everyone can distinguish colors equally well. For people with color-vision deficiencies, simple activities like finding a blue pen or following sorting instructions can become unnecessary barriers. We wanted to go beyond identifying colors and help people independently understand, locate, and act on color-dependent information.

## What it does

WhatColorAreHue turns an ordinary smartphone camera or laptop webcam into an accessibility assistant with four features:

- **HueSee:** Identifies colors and specific shades, displays HEX/RGB/HSL values, and announces readings aloud.
- **HueFind:** Finds requested colors using names, HEX, or RGB values and highlights matching regions with high-contrast outlines.
- **HueDo:** Uses Gemini to interpret instructions, locate objects, generate accessible steps, and check task completion using a new picture.
- **HueMemory:** Uses MongoDB to save personalized color palettes and reusable task guides across sessions.

## How we built it

We built the frontend with HTML, CSS, and JavaScript, using the browser's webcam and Canvas APIs for real-time color detection. Our vision pipeline includes color classification, perceptual shade matching, spatial filtering, and contour smoothing. Gemini, integrated through Node.js and Express, handles instruction interpretation, image localization, and task verification. A custom JavaScript object tracker follows identified objects between AI requests. MongoDB Atlas stores account-specific color palettes and task guides. We also incorporated keyboard navigation, high-contrast mode, adjustable text, and speech synthesis.

## Challenges we ran into

Camera lighting and white balance made consistent color identification difficult. We addressed this with temporal stabilization, perceptual color matching, and optional neutral-card calibration. Another challenge was translating Gemini's visual understanding into responsive live guidance. We solved this by combining AI-powered object localization with local appearance-based tracking, avoiding continuous AI requests. Making task completion meaningful and handling uncertain AI results also required careful validation and user confirmation.

## Accomplishments that we're proud of

We built an integrated system that goes beyond color detection to help users complete real-world activities. We're especially proud of our custom real-time vision pipeline, Gemini-powered instruction interpretation and object localization, live object tracking, and MongoDB-backed personalized accessibility library. Most importantly, we made color only one of several ways information is communicated, alongside text, outlines, labels, and audio.

## What we learned

We learned that accessibility means addressing the entire task, not just the initial obstacle. We also discovered how effectively generative AI and traditional computer vision complement each other: Gemini provides semantic understanding, while local JavaScript processing enables responsive real-time interaction. Finally, persistent personalization can itself be an accessibility feature, reducing the need to repeatedly identify colors or reconstruct instructions.

## What's next for WhatColorAreHue?

We want to test with people with different types of color-vision deficiencies, improve detection under challenging lighting and complex backgrounds, strengthen object tracking, expand support for more complicated activities, and improve screen-reader and keyboard accessibility. Our long-term goal is to make everyday color-dependent environments accessible without requiring users to rely on color perception.
