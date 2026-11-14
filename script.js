import { analyzeVideoFrame } from "./src/vision/cameraProcessor.js";
import { classifyColor } from "./src/vision/colorDetector.js";
import { averagePixelRegion } from "./src/vision/sampleColor.js";

const video = document.getElementById("webcam");
const canvas = document.getElementById("outputCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const toggleCamBtn = document.getElementById("toggleCamBtn");
const toggleCamLabel = document.getElementById("toggleCamLabel");
const taskBtn = document.getElementById("taskBtn");
const colorSelect = document.getElementById("colorSelect");
const sampleFindBtn = document.getElementById("sampleFindBtn");
const findResult = document.getElementById("findResult");
const taskResult = document.getElementById("taskResult");
const announcer = document.getElementById("audioAnnouncement");
const cameraStatus = document.getElementById("cameraStatus");
const cameraStatusText = document.getElementById("cameraStatusText");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");
const cameraFrame = document.getElementById("cameraFrame");
const sampleIndicator = document.getElementById("sampleIndicator");
const sampleSwatch = document.getElementById("sampleSwatch");
const sampleName = document.getElementById("sampleName");
const sampleHex = document.getElementById("sampleHex");
const sampleTarget = document.getElementById("sampleTarget");
const colorPreview = document.getElementById("colorPreview");
const colorNameDisplay = document.getElementById("colorName");
const colorDescription = document.getElementById("colorDescription");
const colorHex = document.getElementById("colorHex");
const colorRgb = document.getElementById("colorRgb");
const colorHsl = document.getElementById("colorHsl");
const luminanceValue = document.getElementById("luminanceValue");
const luminanceMeter = document.getElementById("luminanceMeter");
const luminanceBar = document.getElementById("luminanceBar");
const blackContrast = document.getElementById("blackContrast");
const whiteContrast = document.getElementById("whiteContrast");
const contrastRecommendation = document.getElementById("contrastRecommendation");
const speakDetailsBtn = document.getElementById("speakDetailsBtn");
const detectedColorsList = document.getElementById("detectedColors");
const contrastToggle = document.getElementById("contrastToggle");
const textSizeToggle = document.getElementById("textSizeToggle");
const regionOverlayToggle = document.getElementById("regionOverlayToggle");

// Sample from the unmodified camera image so optional find outlines never
// change the color value read beneath the pointer.
const samplingCanvas = document.createElement("canvas");
const samplingContext = samplingCanvas.getContext("2d", {
  willReadFrequently: true
});

let streaming = false;
let animationFrameId = null;
let latestColors = [];
let targetColor = "";
let pointerIsDown = false;
let touchHoldTimer = null;
let touchHoldActive = false;
let pendingTouchPoint = null;
let lastProcessedAt = 0;
let pointerIsOverCanvas = false;
let keyboardSamplingActive = false;
let currentSample = null;
let lastSamplePosition = null;
let keyboardPosition = { x: 0.5, y: 0.5 };
let detectedLayoutSignature = "";
let detectedItemsByName = new Map();
let showRegionOutlines = true;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function setCameraStatus(message, state = "off") {
  cameraStatusText.textContent = message;
  cameraStatus.classList.toggle("is-live", state === "live");
  cameraStatus.classList.toggle("is-error", state === "error");
}

function setFeedback(element, message) {
  if (element.textContent !== message) element.textContent = message;
}

toggleCamBtn.addEventListener("click", async () => {
  if (streaming) {
    stopCamera();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraStatus("Camera unavailable", "error");
    return;
  }

  toggleCamBtn.disabled = true;
  toggleCamLabel.textContent = "Starting…";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });

    video.srcObject = stream;
    await video.play();

    streaming = true;
    toggleCamBtn.disabled = false;
    toggleCamBtn.setAttribute("aria-pressed", "true");
    toggleCamBtn.classList.add("is-active");
    toggleCamLabel.textContent = "Stop camera";

    cameraPlaceholder.classList.add("is-hidden");
    setCameraStatus("Camera on", "live");
    detectedLayoutSignature = "__reset__";
    renderDetectedColors([]);
    processLoop();
  } catch (error) {
    console.error("Webcam access error:", error);
    toggleCamBtn.disabled = false;
    toggleCamBtn.setAttribute("aria-pressed", "false");
    toggleCamLabel.textContent = "Start camera";
    setCameraStatus("Camera access needed", "error");
  }
});

function stopCamera() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach((track) => track.stop());

  video.srcObject = null;
  streaming = false;
  latestColors = [];
  currentSample = null;
  lastSamplePosition = null;
  resetColorDetails();
  detectedLayoutSignature = "__reset__";
  renderDetectedColors([]);
  pointerIsDown = false;
  pointerIsOverCanvas = false;
  keyboardSamplingActive = false;
  targetColor = "";
  clearTimeout(touchHoldTimer);
  touchHoldTimer = null;
  touchHoldActive = false;
  pendingTouchPoint = null;

  toggleCamBtn.disabled = false;
  toggleCamBtn.setAttribute("aria-pressed", "false");
  toggleCamBtn.classList.remove("is-active");
  toggleCamLabel.textContent = "Start camera";


  cameraPlaceholder.classList.remove("is-hidden");
  sampleIndicator.classList.remove("is-visible", "is-below");
  sampleTarget.classList.remove("is-visible");
  sampleSwatch.style.backgroundColor = "";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  samplingContext.clearRect(0, 0, samplingCanvas.width, samplingCanvas.height);

  setCameraStatus("Camera off", "off");

}

// Keep the existing frame-analysis logic running, but do not draw the
// all-color detection boxes. Only an explicitly selected HueFind target
// receives a single outline.
function processLoop(now = 0) {
  if (!streaming) return;
  if (now - lastProcessedAt < 110) {
    animationFrameId = requestAnimationFrame(processLoop);
    return;
  }
  lastProcessedAt = now;

  try {
    const result = analyzeVideoFrame(video, canvas);
    if (result?.ready) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      latestColors = result.colors || [];
      renderDetectedColors(latestColors);
      if (showRegionOutlines) drawRegionOverlays(latestColors);


      // Resample each frame so the displayed color stays current even when
      // an object moves beneath a stationary pointer or held finger.
      if ((pointerIsOverCanvas || touchHoldActive || keyboardSamplingActive) && lastSamplePosition) {
        const source = touchHoldActive ? "touch" : keyboardSamplingActive ? "keyboard" : "pointer";
        sampleImagePoint(lastSamplePosition, source);
      }
    }
  } catch (error) {
    console.error("Camera frame processing error:", error);
  }

  animationFrameId = requestAnimationFrame(processLoop);
}

function drawRegionOverlays(colors) {
  ctx.save();
  ctx.setLineDash([8, 5]);

  for (const color of colors) {
    if (targetColor && color.name.toLowerCase() === targetColor.toLowerCase()) continue;
    const { x, y, width, height } = color.bounds;
    if (!width || !height) continue;

    // These bounds describe the extent of sampled pixels for a color family,
    // not the outline of an individually recognized object.
    ctx.lineWidth = 7;
    ctx.strokeStyle = "#101820";
    ctx.strokeRect(x, y, width, height);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.strokeRect(x, y, width, height);

    const label = `${color.name.toUpperCase()} · AREA`;
    ctx.font = "bold 12px system-ui, sans-serif";
    const labelWidth = ctx.measureText(label).width + 14;
    const labelX = clamp(x, 0, Math.max(0, canvas.width - labelWidth));
    const labelY = y >= 25 ? y - 23 : Math.min(canvas.height - 3, y + 17);
    ctx.setLineDash([]);
    ctx.fillStyle = "#101820";
    ctx.fillRect(labelX, labelY - 15, labelWidth, 21);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, labelX + 7, labelY);
    ctx.setLineDash([8, 5]);
  }

  ctx.restore();
}

function drawTargetOverlay(colors) {
  const target = colors.find((color) => color.name.toLowerCase() === targetColor.toLowerCase());
  if (!target) {
    setFeedback(findResult, `Looking for ${targetColor}…`);
    return;
  }

  const { x, y, width, height } = target.bounds;
  ctx.save();
  ctx.lineWidth = 5;
  ctx.setLineDash([12, 7]);
  ctx.strokeStyle = "#101820";
  ctx.strokeRect(x, y, width, height);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#ffd166";
  ctx.strokeRect(x, y, width, height);
  ctx.setLineDash([]);
  ctx.font = "bold 17px system-ui, sans-serif";
  const label = target.name.toUpperCase();
  const labelWidth = ctx.measureText(label).width + 18;
  const labelY = Math.max(26, y);
  ctx.fillStyle = "#101820";
  ctx.fillRect(x, labelY - 26, labelWidth, 26);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, x + 9, labelY - 8);
  ctx.restore();

  setFeedback(findResult, `${target.name} found.`);
}

// Convert the pointer position on the displayed canvas into coordinates in
// the actual camera image, accounting for any letterboxing.
function getImagePoint(clientX, clientY) {
  if (!canvas.width || !canvas.height) return null;

  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const renderedWidth = canvas.width * scale;
  const renderedHeight = canvas.height * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  const localX = clientX - rect.left - offsetX;
  const localY = clientY - rect.top - offsetY;

  if (localX < 0 || localY < 0 || localX > renderedWidth || localY > renderedHeight) return null;

  return {
    x: clamp(localX / renderedWidth, 0, 1),
    y: clamp(localY / renderedHeight, 0, 1),
    stageX: (offsetX + localX) / rect.width,
    stageY: (offsetY + localY) / rect.height
  };
}

function getStagePositionForImagePoint(x, y) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return { stageX: x, stageY: y };

  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const renderedWidth = canvas.width * scale;
  const renderedHeight = canvas.height * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;

  return {
    stageX: (offsetX + x * renderedWidth) / rect.width,
    stageY: (offsetY + y * renderedHeight) / rect.height
  };
}

function sampleImagePoint(point, source = "pointer") {
  if (!streaming || !video.videoWidth || !video.videoHeight || !point) return null;

  try {
    const width = 320;
    const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
    if (samplingCanvas.width !== width || samplingCanvas.height !== height) {
      samplingCanvas.width = width;
      samplingCanvas.height = height;
    }

    samplingContext.drawImage(video, 0, 0, width, height);
    const pixelX = clamp(Math.floor(point.x * width), 0, width - 1);
    const pixelY = clamp(Math.floor(point.y * height), 0, height - 1);
    const radius = 2;
    const left = Math.max(0, pixelX - radius);
    const top = Math.max(0, pixelY - radius);
    const regionWidth = Math.min(width - left, pixelX + radius + 1 - left);
    const regionHeight = Math.min(height - top, pixelY + radius + 1 - top);
    const patch = samplingContext.getImageData(left, top, regionWidth, regionHeight);
    const { r, g, b } = averagePixelRegion(patch);
    const color = classifyColor(r, g, b);

    currentSample = { ...color, source, position: { x: point.x, y: point.y } };
    lastSamplePosition = point;
    renderSample(currentSample, point);
    return currentSample;
  } catch (error) {
    console.error("Color sample error:", error);
    return null;
  }
}

function renderSample(sample, point) {
  sampleName.textContent = sample.name;
  sampleHex.textContent = sample.hex;
  sampleSwatch.style.backgroundColor = sample.hex;
  renderColorDetails(sample);

  const frameRect = cameraFrame.getBoundingClientRect();
  const indicatorWidth = sampleIndicator.offsetWidth || 120;
  const horizontalPadding = indicatorWidth / 2 + 8;
  const left = clamp(point.stageX * frameRect.width, horizontalPadding, frameRect.width - horizontalPadding);

  sampleIndicator.style.left = `${left}px`;
  sampleIndicator.style.top = `${point.stageY * frameRect.height}px`;
  sampleIndicator.classList.toggle("is-below", point.stageY < 0.18);
  sampleIndicator.classList.add("is-visible");
  sampleTarget.style.left = `${point.stageX * 100}%`;
  sampleTarget.style.top = `${point.stageY * 100}%`;
  sampleTarget.classList.add("is-visible");
}

function rgbToHsl(r, g, b) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  let saturation = 0;
  const lightness = (max + min) / 2;

  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    switch (max) {
      case red: hue = ((green - blue) / delta) % 6; break;
      case green: hue = (blue - red) / delta + 2; break;
      default: hue = (red - green) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  return {
    h: Math.round(hue),
    s: Math.round(saturation * 100),
    l: Math.round(lightness * 100)
  };
}

function linearizeChannel(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function getRelativeLuminance({ r, g, b }) {
  return 0.2126 * linearizeChannel(r) +
    0.7152 * linearizeChannel(g) +
    0.0722 * linearizeChannel(b);
}

function getContrastRatio(luminanceA, luminanceB) {
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

function getPlainLanguageDescription(sample, hsl) {
  if (sample.name === "Unknown") return "Outside the supported color categories";
  if (sample.name === "Black") return "Very dark neutral black";
  if (sample.name === "White") return "Very light neutral white";
  if (sample.name === "Gray") return "Low-saturation neutral gray";

  const lightness = hsl.l < 20 ? "Very dark" :
    hsl.l < 40 ? "Dark" :
    hsl.l < 60 ? "Medium" :
    hsl.l < 80 ? "Light" : "Very light";
  const saturation = hsl.s < 20 ? "muted" :
    hsl.s < 45 ? "soft" :
    hsl.s < 70 ? "moderately saturated" : "highly saturated";
  return `${lightness}, ${saturation} ${sample.name.toLowerCase()}`;
}

function renderColorDetails(sample) {
  const { r, g, b } = sample.rgb;
  const hsl = rgbToHsl(r, g, b);
  const luminance = getRelativeLuminance(sample.rgb);
  const blackRatio = getContrastRatio(luminance, 0);
  const whiteRatio = getContrastRatio(luminance, 1);
  const preferredText = blackRatio >= whiteRatio ? "Black" : "White";
  const preferredRatio = Math.max(blackRatio, whiteRatio);

  colorPreview.style.backgroundColor = sample.hex;
  colorNameDisplay.textContent = sample.name;
  colorDescription.textContent = `Approximate appearance: ${getPlainLanguageDescription(sample, hsl)}.`;
  colorHex.textContent = sample.hex;
  colorRgb.textContent = `(${r}, ${g}, ${b})`;
  colorHsl.textContent = `(${hsl.h}°, ${hsl.s}%, ${hsl.l}%)`;
  luminanceValue.textContent = `${Math.round(luminance * 100)}%`;
  luminanceBar.style.width = `${luminance * 100}%`;
  luminanceMeter.setAttribute("aria-valuenow", String(Math.round(luminance * 100)));
  blackContrast.textContent = `${blackRatio.toFixed(2)}:1`;
  whiteContrast.textContent = `${whiteRatio.toFixed(2)}:1`;

  if (preferredRatio >= 4.5) {
    contrastRecommendation.textContent = `${preferredText} text has stronger contrast (${preferredRatio.toFixed(2)}:1) and meets the 4.5:1 guideline for normal-size text.`;
  } else {
    contrastRecommendation.textContent = `${preferredText} text has stronger contrast (${preferredRatio.toFixed(2)}:1), but neither option reaches 4.5:1 for normal-size text.`;
  }

  speakDetailsBtn.disabled = false;
}

function resetColorDetails() {
  colorPreview.style.backgroundColor = "#e4e8eb";
  colorNameDisplay.textContent = "No sample yet";
  colorDescription.textContent = "Start the camera, then choose a point in the image.";
  colorHex.textContent = "—";
  colorRgb.textContent = "—";
  colorHsl.textContent = "—";
  luminanceValue.textContent = "—";
  luminanceBar.style.width = "0%";
  luminanceMeter.setAttribute("aria-valuenow", "0");
  blackContrast.textContent = "—";
  whiteContrast.textContent = "—";
  contrastRecommendation.textContent = "Select a color to see which text color has stronger contrast.";
  speakDetailsBtn.disabled = true;
}

function getSpokenColorDetails(sample) {
  const { r, g, b } = sample.rgb;
  const hsl = rgbToHsl(r, g, b);
  const luminance = getRelativeLuminance(sample.rgb);
  const blackRatio = getContrastRatio(luminance, 0);
  const whiteRatio = getContrastRatio(luminance, 1);
  const preferredText = blackRatio >= whiteRatio ? "black" : "white";
  const preferredRatio = Math.max(blackRatio, whiteRatio);
  return `Color category: ${sample.name}. Hex ${sample.hex}. RGB ${r}, ${g}, ${b}. H S L: ${hsl.h} degrees, ${hsl.s} percent saturation, ${hsl.l} percent lightness. Relative luminance ${Math.round(luminance * 100)} percent. ${preferredText} text has the stronger contrast at ${preferredRatio.toFixed(2)} to 1.`;
}

function getApproximateRegion(color) {
  const bounds = color.bounds;
  const frameWidth = canvas.width || 320;
  const frameHeight = canvas.height || 180;
  const centerX = (bounds.x + bounds.width / 2) / frameWidth;
  const centerY = (bounds.y + bounds.height / 2) / frameHeight;
  const horizontal = centerX < 0.34 ? "left" : centerX > 0.66 ? "right" : "center";
  const vertical = centerY < 0.34 ? "upper" : centerY > 0.66 ? "lower" : "middle";
  return `${vertical} ${horizontal}`;
}

function renderDetectedColors(colors) {
  const signature = colors.map((color) => `${color.name}:${getApproximateRegion(color)}`).join("|");

  if (signature !== detectedLayoutSignature) {
    detectedLayoutSignature = signature;
    detectedItemsByName = new Map();
    detectedColorsList.replaceChildren();

    if (!streaming) {
      const empty = document.createElement("li");
      empty.className = "detected-empty";
      empty.textContent = "Start the camera to see broad color groups detected in the frame.";
      detectedColorsList.append(empty);
      return;
    }

    if (colors.length === 0) {
      const empty = document.createElement("li");
      empty.className = "detected-empty";
      empty.textContent = "No supported color groups detected in this frame.";
      detectedColorsList.append(empty);
      return;
    }

    for (const color of colors) {
      const item = document.createElement("li");
      item.className = "detected-color-item";

      const name = document.createElement("span");
      name.className = "detected-color-name";
      name.textContent = color.name;

      const count = document.createElement("span");
      count.className = "detected-color-meta";
      count.dataset.role = "sample-count";

      const region = document.createElement("span");
      region.className = "detected-color-region";
      region.textContent = `Approx. region: ${getApproximateRegion(color)}`;

      item.append(name, count, region);
      detectedColorsList.append(item);
      detectedItemsByName.set(color.name, count);
    }
  }

  for (const color of colors) {
    const count = detectedItemsByName.get(color.name);
    if (count) {
      const points = Number(color.samples) || 0;
      count.textContent = `${points.toLocaleString()} sampled ${points === 1 ? "point" : "points"}`;
    }
  }
}

function sampleFromPointer(event) {
  const point = getImagePoint(event.clientX, event.clientY);
  if (!point) {
    lastSamplePosition = null;
    sampleIndicator.classList.remove("is-visible");
    sampleTarget.classList.remove("is-visible");
    return null;
  }

  keyboardPosition = { x: point.x, y: point.y };
  sampleImagePoint(point, event.pointerType === "touch" ? "touch" : "pointer");
  return point;
}

canvas.addEventListener("pointerenter", (event) => {
  if (event.pointerType === "mouse") pointerIsOverCanvas = true;
});

canvas.addEventListener("pointermove", (event) => {
  if (!streaming) return;
  if (event.pointerType === "mouse") {
    pointerIsOverCanvas = Boolean(sampleFromPointer(event));
  } else if (pointerIsDown) {
    pendingTouchPoint = getImagePoint(event.clientX, event.clientY);
    if (touchHoldActive && pendingTouchPoint) sampleFromPointer(event);
  }
});

canvas.addEventListener("pointerdown", (event) => {
  if (!streaming) return;
  pointerIsDown = true;
  keyboardSamplingActive = false;
  canvas.focus({ preventScroll: true });
  if (event.pointerType !== "mouse") event.preventDefault();
  if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);

  if (event.pointerType === "mouse") {
    sampleFromPointer(event);
  } else {
    pendingTouchPoint = getImagePoint(event.clientX, event.clientY);
    touchHoldActive = false;
    clearTimeout(touchHoldTimer);
    touchHoldTimer = setTimeout(() => {
      if (!pointerIsDown || !pendingTouchPoint) return;
      touchHoldActive = true;
      sampleImagePoint(pendingTouchPoint, "touch");
    }, 320);
  }
});

function finishPointerSample(event) {
  const wasHeld = touchHoldActive;
  clearTimeout(touchHoldTimer);
  touchHoldTimer = null;
  pointerIsDown = false;
  touchHoldActive = false;

  // A quick tap is also supported as an accessible alternative to holding.
  if (event.pointerType !== "mouse") {
    if (!wasHeld && pendingTouchPoint) sampleImagePoint(pendingTouchPoint, "touch");
    pointerIsOverCanvas = false;
  }
  pendingTouchPoint = null;
  if (currentSample && event.type !== "pointercancel") {
    announceSample(currentSample);
  }
}

canvas.addEventListener("pointerup", finishPointerSample);
canvas.addEventListener("pointercancel", (event) => {
  clearTimeout(touchHoldTimer);
  touchHoldTimer = null;
  pointerIsDown = false;
  touchHoldActive = false;
  pendingTouchPoint = null;
});

canvas.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "mouse" && !pointerIsDown) {
    pointerIsOverCanvas = false;
    lastSamplePosition = null;
    sampleIndicator.classList.remove("is-visible");
    sampleTarget.classList.remove("is-visible");
  }
});

canvas.addEventListener("focus", () => {
  if (!streaming || pointerIsDown) return;
  keyboardPosition = { x: 0.5, y: 0.5 };
  keyboardSamplingActive = true;
  sampleImagePoint({
    ...keyboardPosition,
    ...getStagePositionForImagePoint(keyboardPosition.x, keyboardPosition.y)
  }, "keyboard");
});

canvas.addEventListener("keydown", (event) => {
  if (!streaming) return;

  const step = event.shiftKey ? 0.1 : 0.025;
  let moved = true;

  switch (event.key) {
    case "ArrowLeft": keyboardPosition.x = clamp(keyboardPosition.x - step, 0, 1); break;
    case "ArrowRight": keyboardPosition.x = clamp(keyboardPosition.x + step, 0, 1); break;
    case "ArrowUp": keyboardPosition.y = clamp(keyboardPosition.y - step, 0, 1); break;
    case "ArrowDown": keyboardPosition.y = clamp(keyboardPosition.y + step, 0, 1); break;
    case "Enter":
    case " ":
      event.preventDefault();
      if (currentSample) announceSample(currentSample);
      return;
    default: moved = false;
  }

  if (moved) {
    event.preventDefault();
    keyboardSamplingActive = true;
    sampleImagePoint({
      ...keyboardPosition,
      ...getStagePositionForImagePoint(keyboardPosition.x, keyboardPosition.y)
    }, "keyboard");
  }
});

canvas.addEventListener("blur", () => {
  keyboardSamplingActive = false;
  if (!pointerIsOverCanvas && !pointerIsDown) {
    sampleIndicator.classList.remove("is-visible");
    sampleTarget.classList.remove("is-visible");
  }
});

function announceSample(sample) {
  speak(`${sample.name}. Approximate hex ${sample.hex}.`);
}

speakDetailsBtn.addEventListener("click", () => {
  if (currentSample) speak(getSpokenColorDetails(currentSample));
});

contrastToggle.addEventListener("click", () => {
  const enabled = document.body.classList.toggle("high-contrast");
  contrastToggle.setAttribute("aria-pressed", String(enabled));
  contrastToggle.querySelector("span:last-child").textContent = enabled ? "Standard contrast" : "High contrast";
});

textSizeToggle.addEventListener("click", () => {
  const enabled = document.documentElement.classList.toggle("large-text");
  textSizeToggle.setAttribute("aria-pressed", String(enabled));
  textSizeToggle.querySelector("span:last-child").textContent = enabled ? "Standard text" : "Larger text";
});

regionOverlayToggle.addEventListener("click", () => {
  showRegionOutlines = !showRegionOutlines;
  regionOverlayToggle.setAttribute("aria-pressed", String(showRegionOutlines));
  regionOverlayToggle.textContent = showRegionOutlines ? "Hide region outlines" : "Show region outlines";
});

function speak(text) {
  announcer.textContent = text;
  if ("speechSynthesis" in window && "SpeechSynthesisUtterance" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  }
}

// Small section reveals are decorative only and respect reduced-motion settings.
const reveals = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.08 });
  reveals.forEach((element) => observer.observe(element));
} else {
  reveals.forEach((element) => element.classList.add("is-visible"));
}

window.addEventListener("pagehide", () => {
  if (streaming) stopCamera();
});
