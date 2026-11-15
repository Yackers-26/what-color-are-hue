import { analyzeVideoFrame } from "/src/vision/cameraProcessor.js";
import { classifyColor, TemporalMaskStabilizer } from "/src/vision/colorDetector.js";
import { selectDisplayRegions } from "/src/vision/regionPresentation.js";
import { findSmoothColorContours, SmoothContourTracker, pickFocusedContour } from "/src/vision/smoothContours.js";
import { calculateNeutralGains, neutralReferenceFromCenter } from "/src/vision/cameraCalibration.js";
import { closestReferenceShade } from "/src/vision/referenceColors.js";
import { averagePixelRegion } from "/src/vision/sampleColor.js";
import { createFluidReading } from "/src/vision/fluidReading.js";
import {
  saveColor,
  createTask,
  loadTasks,
  completeTask,
  interpret,
  checkTask
} from "/js/huememory.js";
import { parseInstruction, buildGuideSteps } from "/js/hueDoParser.js";
import { mountPalette } from "/js/palettePanel.js";
import { mountImagePicker } from "/js/imagePicker.js";

document.documentElement.classList.add("js");
const $ = (id) => document.getElementById(id);
// Account ownership is enforced on the server. This display is informational only.
fetch("/api/auth/me", { credentials: "same-origin" })
  .then(response => response.json())
  .then(({ user, demo }) => {
    if (!user && !demo) { window.location.assign("/login"); return; }
    const label = $("accountName");
    if (label) label.textContent = demo ? "Demo mode" : (user.name || user.email);
    if (demo) $("signOutBtn").textContent = "Back to sign in";
    window.hueDemoMode = Boolean(demo);
  }).catch(() => {});
$("signOutBtn")?.addEventListener("click", async () => {
  if (window.hueDemoMode) { window.location.assign("/exit-demo"); return; }
  const button = $("signOutBtn");
  button.disabled = true;
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    window.location.assign("/login");
  } catch {
    button.disabled = false;
  }
});

const video = $("webcam");
const canvas = $("outputCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const hueFindVectorOverlay = $("hueFindVectorOverlay");
const hueFindPath = $("hueFindPath");
const hueFindPathShadow = $("hueFindPathShadow");

// Never draw camera frames on the overlay: only HueFind contours and HueDo guides.
const analysisCanvas = document.createElement("canvas");

const toggleCamBtn = $("toggleCamBtn");
const toggleCamLabel = $("toggleCamLabel");
const colorSelect = $("colorSelect");
const cameraDeviceSelect = $("cameraDeviceSelect");
const focusResetBtn = $("focusResetBtn");
const calibrateBtn = $("calibrateBtn");
const calibrationStatus = $("calibrationStatus");
const sampleFindBtn = $("sampleFindBtn");
const clearFindBtn = $("clearFindBtn");
const findResult = $("findResult");
const taskBtn = $("taskBtn");
const taskResult = $("taskResult");
const announcer = $("audioAnnouncement");
const cameraStatus = $("cameraStatus");
const cameraStatusText = $("cameraStatusText");
const cameraPlaceholder = $("cameraPlaceholder");
const cameraFrame = $("cameraFrame");
const sampleIndicator = $("sampleIndicator");
const sampleSwatch = $("sampleSwatch");
const sampleName = $("sampleName");
const sampleHex = $("sampleHex");
const sampleRgb = $("sampleRgb");
const sampleReticle = $("sampleReticle");
const pinColorBtn = $("pinColorBtn");
const readingStatus = $("readingStatus");
const scanSceneBtn = $("scanSceneBtn");
const colorPreview = $("colorPreview");
const colorNameDisplay = $("colorName");
const colorDescription = $("colorDescription");
const colorHex = $("colorHex");
const colorRgb = $("colorRgb");
const colorHsl = $("colorHsl");
const speakDetailsBtn = $("speakDetailsBtn");
const saveColorBtn = $("saveColorBtn");
const saveColorStatus = $("saveColorStatus");
const detectedColorsList = $("detectedColors");
const contrastToggle = $("contrastToggle");
const textSizeToggle = $("textSizeToggle");
const colorChipToggle = $("colorChipToggle");
const colorChipToggleText = $("colorChipToggleText");
const cameraChipLayer = $("cameraChipLayer");
const modePreview = $("modePreview");
const modeButtons = [...document.querySelectorAll("[data-mode-button]")];
const modePanels = [...document.querySelectorAll("[data-mode-panel]")];

const instructionInput = $("instructionInput");
const instructionImageInput = $("instructionImageInput");
const instructionFileName = $("instructionFileName");
const instructionImagePreview = $("instructionImagePreview");
const interpretBtn = $("interpretBtn");
const interpretStatus = $("interpretStatus");
const parsedTask = $("parsedTask");
const taskSummaryInput = $("taskSummaryInput");
const taskStepsPreview = $("taskStepsPreview");
const taskCuePreview = $("taskCuePreview");
const saveTaskBtn = $("saveTaskBtn");
const activeTaskEmpty = $("activeTaskEmpty");
const activeTaskContent = $("activeTaskContent");
const activeTaskSummary = $("activeTaskSummary");
const activeTaskSteps = $("activeTaskSteps");
const taskStateMark = $("taskStateMark");
const clearTaskBtn = $("clearTaskBtn");
const taskLibrary = $("taskLibrary");
const refreshTasksBtn = $("refreshTasksBtn");

// Read pixels from the clean camera image so overlays never affect sampling.
const samplingCanvas = document.createElement("canvas");
const samplingContext = samplingCanvas.getContext("2d", { willReadFrequently: true });

let streaming = false;
let animationFrameId = null;
let latestColors = [];
let targetColor = "";
let targetRgb = null;
let targetShade = "";
let pointerIsDown = false;
let pointerIsOverCanvas = false;
let keyboardSamplingActive = false;
let currentSample = null;
let pinnedSample = null;
let pinnedPosition = null;
let pointerStart = null;
let lastSampleTime = 0;
let lastFrameAnalysis = 0;
let scanSceneRequested = false;
let hasScannedScene = false;
const steadyReading = createFluidReading();
const SAMPLE_INTERVAL_MS = 32;
const FRAME_INTERVAL_MS = 180;
const FIND_INTERVAL_MS = 95;
const hueFindTracker = new SmoothContourTracker({ blend: .32, confirmationFrames: 2, holdFrames: 6 });
let focusedContourId = null;
let pendingFocusPoint = null;
let neutralGains = null;
let lastSamplePosition = null;
let keyboardPosition = { x: 0.5, y: 0.5 };
let detectedLayoutSignature = "";
let detectedItemsByName = new Map();
let showColorChips = true;
const hueSeeRegionStabilizer = new TemporalMaskStabilizer({ holdFrames: 2 });
let currentMode = "see";
let cameraChipNodes = new Map();
let pendingTaskDraft = null;
let activeTask = null;
let taskCheckFrames = 0;
let taskSuccessStreak = 0;
let taskCompletionPending = false;
let instructionImage = null;
let instructionImageUrl = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const modeDescriptions = {
  see: "Identify colors in your camera view.",
  find: "Choose a color and follow its dotted outline.",
  do: "Turn any instruction into an on-camera visual guide.",
  memory: "Save shades and bring them back when you need them."
};

let modePreviewTimer = null;

function placeModePreview(mode) {
  const button = modeButtons.find((item) => item.dataset.modeButton === mode);
  if (!button || !modePreview) return;
  const frameRect = cameraFrame.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  const halfWidth = (modePreview.offsetWidth || 180) / 2;
  const centerX = buttonRect.left + buttonRect.width / 2 - frameRect.left;
  const left = clamp(centerX, halfWidth + 12, frameRect.width - halfWidth - 12);
  const top = Math.max(8, buttonRect.top - frameRect.top - modePreview.offsetHeight - 10);
  modePreview.style.left = `${left}px`;
  modePreview.style.top = `${top}px`;
  modePreview.style.bottom = "auto";
}

function setModePreview(mode) {
  if (!modePreview) return;
  if (modePreviewTimer) window.clearTimeout(modePreviewTimer);
  modePreview.classList.add("is-changing");
  modePreviewTimer = window.setTimeout(() => {
    modePreview.textContent = modeDescriptions[mode] || modeDescriptions.see;
    placeModePreview(mode);
    modePreview.classList.remove("is-changing");
  }, 90);
}

function setActiveMode(mode) {
  const allowed = ["see", "find", "do", "memory"];
  const nextMode = allowed.includes(mode) ? mode : "see";
  if (currentMode !== nextMode) { hueFindTracker.reset(); focusedContourId = null; pendingFocusPoint = null; }
  currentMode = nextMode;
  const pageTitle = document.getElementById("pageTitle");
  const pageHint = document.getElementById("pageHint");
  if (pageTitle) {
    const words = { see: ["Hue", "See"], find: ["Hue", "Find"], do: ["Hue", "Do"], memory: ["Hue", "Memory"] };
    const [first, second] = words[nextMode];
    pageTitle.innerHTML = `${first}<span>${second}</span>`;
  }
  if (pageHint) pageHint.textContent = { see: "Move to inspect. Click or tap to pin.", find: "Choose a color to find its matching areas.", do: "Follow a color-guided task.", memory: "Your saved colors and shades." }[nextMode];
  cameraFrame.classList.toggle("is-see-mode", nextMode === "see");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  clearVectorOutline();
  // The hovering HueSee tooltip must not cover the HueFind contour or task guides.
  if (nextMode !== "see") {
    sampleIndicator.classList.remove("is-visible");
    sampleReticle.classList.remove("is-visible");
  } else if (pinnedSample && pinnedPosition) {
    movePinnedIndicator(pinnedPosition);
  }
  if (nextMode === "see") showHueSeeRegionLabels(latestColors);
  if (nextMode === "find" && streaming && targetColor) drawTargetOverlay();

  modeButtons.forEach((button) => {
    const active = button.dataset.modeButton === nextMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });

  modePanels.forEach((panel) => {
    const active = panel.dataset.modePanel === nextMode;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });

  setModePreview(nextMode);
  if (nextMode === "memory") setCameraChips([]);
}

window.addEventListener("resize", () => placeModePreview(currentMode));

modeButtons.forEach((button, index) => {
  button.addEventListener("click", () => setActiveMode(button.dataset.modeButton));
  button.addEventListener("pointerenter", () => setModePreview(button.dataset.modeButton));
  button.addEventListener("focus", () => setModePreview(button.dataset.modeButton));
  button.addEventListener("pointerleave", () => setModePreview(currentMode));
  button.addEventListener("blur", () => setModePreview(currentMode));
  button.addEventListener("keydown", (event) => {
    const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const next = (index + direction + modeButtons.length) % modeButtons.length;
    modeButtons[next].focus();
    setActiveMode(modeButtons[next].dataset.modeButton);
  });
});
setActiveMode("see");

function setCameraStatus(message, state = "off") {
  cameraStatusText.textContent = message;
  cameraStatus.classList.toggle("is-live", state === "live");
  cameraStatus.classList.toggle("is-error", state === "error");
}

function setFeedback(element, message) {
  if (element && element.textContent !== message) element.textContent = message;
}

function normalizeColorCategory(value = "") {
  const color = String(value).trim().toLowerCase();
  const supported = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "black"];
  return supported.find((name) => color === name || color.includes(name)) || "";
}

function normalizeZone(value = "") {
  const match = String(value).match(/\b(?:box|container|bin|zone)?\s*([ABC])\b/i);
  return match ? `Box ${match[1].toUpperCase()}` : "";
}

function getZoneBounds(zoneName) {
  const width = canvas.width || 320;
  const height = canvas.height || 180;
  const zoneWidth = width * 0.27;
  const zoneHeight = height * 0.20;
  const xByZone = {
    "Box A": width * 0.035,
    "Box B": width * 0.365,
    "Box C": width * 0.695
  };
  const zoneX = xByZone[zoneName];
  if (zoneX === undefined) return null;
  return {
    x: Math.round(zoneX),
    y: Math.round(height * 0.62),
    width: Math.round(zoneWidth),
    height: Math.round(zoneHeight)
  };
}

const chipColors = {
  red: "#ee7772", orange: "#e9a16b", yellow: "#e8d16d", green: "#81b88d",
  cyan: "#7ccbc6", blue: "#7e9fdf", purple: "#b59ad9", black: "#68716d"
};

// In HueSee, show ONLY text labels at stabilized region centers. No outlines.
function showHueSeeRegionLabels(colors = []) {
  if (currentMode !== "see" || !showColorChips) {
    setCameraChips([]);
    return;
  }
  const regions = selectDisplayRegions(colors, { limit: 6, minSamples: 30 });
  setCameraChips(regions.map((region) => ({
    key: region.key,
    label: region.name,
    color: region.name,
    point: region.center,
    hex: chipColors[String(region.name).toLowerCase()] || region.hex
  })));
}

function setCameraChips(entries = []) {
  const visible = entries.slice(0, 12);
  const activeKeys = new Set();

  visible.forEach((entry, index) => {
    const key = entry.key || `${entry.label}-${index}`;
    activeKeys.add(key);
    let chip = cameraChipNodes.get(key);

    if (!chip) {
      chip = document.createElement("div");
      chip.className = "camera-chip";
      const dot = document.createElement("span");
      dot.className = "camera-chip-dot";
      const label = document.createElement("span");
      label.className = "camera-chip-label";
      chip.append(dot, label);
      cameraChipLayer.append(chip);
      cameraChipNodes.set(key, chip);
    }

    const point = entry.point || { x: canvas.width / 2, y: canvas.height / 2 };
    const stage = getStagePositionForImagePoint(
      clamp(point.x / Math.max(1, canvas.width), 0, 1),
      clamp(point.y / Math.max(1, canvas.height), 0, 1)
    );
    chip.querySelector(".camera-chip-label").textContent = entry.label;
    const frameWidth = cameraFrame.clientWidth;
    const halfChip = (chip.offsetWidth || 110) / 2;
    const left = clamp(stage.stageX * frameWidth, halfChip + 7, frameWidth - halfChip - 7);
    chip.style.left = `${left}px`;
    chip.style.top = `${stage.stageY * 100}%`;
    chip.style.setProperty("--chip-color", entry.hex || chipColors[String(entry.color || "").toLowerCase()] || "#dbe8df");
    chip.classList.toggle("is-below", stage.stageY < .2);
  });

  for (const [key, chip] of cameraChipNodes) {
    if (!activeKeys.has(key)) {
      chip.remove();
      cameraChipNodes.delete(key);
    }
  }
}

function rgbToHex(rgb = {}) {
  return "#" + [rgb.r, rgb.g, rgb.b].map((value) => clamp(Math.round(Number(value) || 0), 0, 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function getRegionCenter(region) {
  if (region.center) return region.center;
  const { x, y, width, height } = region.bounds;
  return { x: x + width / 2, y: y + height / 2 };
}

function drawRegionOutline(region, accent = "#f7e8a6") {
  if (!region?.outline?.length) {
    if (!region?.bounds) return;
    const { x, y, width, height } = region.bounds;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = accent;
    ctx.strokeRect(x + 2, y + 2, Math.max(1, width - 4), Math.max(1, height - 4));
    ctx.restore();
    return;
  }

  const strokeSegments = () => {
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of region.outline) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  };

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([1.5, 3.5]);
  ctx.lineWidth = 4.5;
  ctx.strokeStyle = "rgba(8,16,13,.78)";
  ctx.shadowColor = "rgba(0,0,0,.28)";
  ctx.shadowBlur = 4;
  strokeSegments();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = accent;
  strokeSegments();
  ctx.restore();
}

function drawGuideBoxAt(point, label, accent = "#f3d88c") {
  if (!point) return;
  const width = Math.max(42, canvas.width * .19);
  const height = Math.max(30, canvas.height * .17);
  const x = clamp(point.x - width / 2, 3, canvas.width - width - 3);
  const y = clamp(point.y - height / 2, 3, canvas.height - height - 3);
  ctx.save();
  ctx.lineWidth = 2.2;
  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = "rgba(8,16,13,.78)";
  ctx.strokeRect(x, y, width, height);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = accent;
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
  return { x: x + width / 2, y: y + height / 2 };
}

function drawZoneGuide(zoneName, accent = "#f4d78c") {
  const zone = getZoneBounds(zoneName);
  if (!zone) return null;
  ctx.save();
  ctx.lineWidth = 2.2;
  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = "rgba(8,16,13,.78)";
  ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = accent;
  ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);
  ctx.restore();
  return { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 };
}

function drawArrow(from, to, accent = "#f4d989") {
  if (!from || !to) return;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 12) return;
  const ux = dx / distance;
  const uy = dy / distance;
  const startX = from.x + ux * 12;
  const startY = from.y + uy * 12;
  const endX = to.x - ux * 14;
  const endY = to.y - uy * 14;
  const angle = Math.atan2(endY - startY, endX - startX);

  ctx.save();
  ctx.lineCap = "round";
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(8,16,13,.72)";
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = accent;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - 10 * Math.cos(angle - Math.PI / 6), endY - 10 * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(endX - 10 * Math.cos(angle + Math.PI / 6), endY - 10 * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function cuePoint(cue = {}) {
  const zone = normalizeZone(`${cue.location || ""} ${cue.label || ""}`);
  if (zone) {
    const bounds = getZoneBounds(zone);
    if (bounds) return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }

  const words = `${cue.direction || ""} ${cue.location || ""}`.toLowerCase();
  const horizontal = /\b(left|leftward)\b/.test(words) ? .2 : /\b(right|rightward)\b/.test(words) ? .8 : .5;
  const vertical = /\b(above|upper|top|up)\b/.test(words) ? .2 : /\b(below|lower|bottom|down)\b/.test(words) ? .8 : .5;
  const hasDirection = /\b(left|leftward|right|rightward|above|upper|top|up|below|lower|bottom|down|center|middle)\b/.test(words);
  return hasDirection ? { x: canvas.width * horizontal, y: canvas.height * vertical } : null;
}

// Vector paths render sharply even when the canvas's 320px processing resolution
// is scaled to a large laptop display. A closed Catmull-Rom spline smooths corners.
function clearVectorOutline() {
  hueFindPath?.setAttribute("d", "");
  hueFindPathShadow?.setAttribute("d", "");
}
function contourSplinePath(points) {
  if (!points || points.length < 3) return "";
  const f = value => Number(value.toFixed(2));
  let d = `M ${f(points[0][0])} ${f(points[0][1])}`;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i + n - 1) % n], p1 = points[i];
    const p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + " Z";
}
function drawSmoothTargetContour(points) {
  const d = contourSplinePath(points);
  hueFindPath?.setAttribute("d", d);
  hueFindPathShadow?.setAttribute("d", d);
}

function drawTargetOverlay() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  clearVectorOutline();
  if (!targetColor || video.readyState < 2 || !video.videoWidth) {
    setCameraChips([]);
    return;
  }

  const width = canvas.width || 320;
  const height = canvas.height || Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
  if (samplingCanvas.width !== width || samplingCanvas.height !== height) {
    samplingCanvas.width = width;
    samplingCanvas.height = height;
  }
  hueFindVectorOverlay?.setAttribute("viewBox", `0 0 ${width} ${height}`);
  samplingContext.drawImage(video, 0, 0, width, height);
  const frame = samplingContext.getImageData(0, 0, width, height);
  const found = findSmoothColorContours(frame, {
    color: targetColor, rgb: targetRgb, minAreaFraction: .015,
    relativeMinArea: .28, maxRegions: 6, whiteBalance: neutralGains
  });
  const allRegions = hueFindTracker.update(found, width, height);
  if (pendingFocusPoint && !focusedContourId) {
    const match = pickFocusedContour(allRegions, pendingFocusPoint, .19, width, height);
    if (match) { focusedContourId = match.id; pendingFocusPoint = null; }
  }
  const regions = focusedContourId
    ? allRegions.filter(region => region.id === focusedContourId)
    : pendingFocusPoint ? [] : allRegions.slice(0, 1);
  if (!regions.length) {
    setCameraChips([]);
    setFeedback(findResult, focusedContourId ? "Object temporarily lost. Keep it in view or tap another object."
      : pendingFocusPoint ? "No matching region at that point. Tap the object again." : `Looking for ${targetShade || targetColor}…`);
    return;
  }

  const chips = [];
  for (const region of regions) {
    drawSmoothTargetContour(region.points);
    chips.push({
      key: region.id,
      label: targetShade || targetColor,
      color: targetColor,
      point: region.center,
      hex: targetRgb ? rgbToHex(targetRgb) : chipColors[targetColor.toLowerCase()]
    });
  }
  setCameraChips(showColorChips ? chips : []);
  setFeedback(findResult, focusedContourId ? `Following one ${targetShade || targetColor} object`
    : `${targetShade || targetColor} · showing the strongest match. Tap to follow another.`);
}

function drawTaskGuidance() {
  if (!activeTask || !canvas.width || !canvas.height) {
    setCameraChips([]);
    return;
  }

  const cues = Array.isArray(activeTask.visualCues) ? activeTask.visualCues : [];
  const chips = [];
  let targetPoint = null;
  let destinationPoint = null;
  let cueIndex = 0;

  cues.forEach((cue) => {
    const role = String(cue.role || "reference").toLowerCase();
    const colorName = normalizeColorCategory(cue.color || (role === "target" ? activeTask.color : ""));
    const colorGroup = colorName ? latestColors.find((item) => item.name.toLowerCase() === colorName) : null;
    const regions = colorGroup?.regions || [];

    if (regions.length) {
      regions.slice(0, role === "target" ? 3 : 1).forEach((region, regionIndex) => {
        const accent = role === "destination" ? "#f4d78c" : "#b9e9cf";
        drawRegionOutline(region, accent);
        const point = getRegionCenter(region);
        chips.push({
          key: `task-${cueIndex}-${regionIndex}`,
          label: cue.label || cue.object || colorName,
          color: colorName,
          hex: region.hex,
          point
        });
        if (role === "target" && !targetPoint) targetPoint = point;
        if (role === "destination" && !destinationPoint) destinationPoint = point;
      });
    } else {
      const zoneName = normalizeZone(`${cue.location || ""} ${cue.label || ""}`);
      const point = cuePoint(cue) || (role === "target" ? { x: canvas.width * .5, y: canvas.height * .48 } : null);
      if (point) {
        const center = zoneName && role === "destination"
          ? drawZoneGuide(zoneName)
          : drawGuideBoxAt(point, cue.label, role === "destination" ? "#f4d78c" : "#b9e9cf");
        if (role === "target" && !targetPoint) targetPoint = center;
        if (role === "destination" && !destinationPoint) destinationPoint = center;
      }
      const fallbackPoint = point || { x: canvas.width * .5, y: role === "destination" ? canvas.height * .20 : canvas.height * .36 };
      const cueLabel = cue.label || cue.object || cue.location || role;
      chips.push({
        key: `task-${cueIndex}`,
        label: role === "target" && !colorName ? `Look for ${cueLabel}` : cueLabel,
        color: role === "destination" ? "yellow" : colorName,
        point: fallbackPoint
      });
    }
    cueIndex += 1;
  });

  if (!cues.length && activeTask.normalizedColor) {
    const colorGroup = latestColors.find((item) => item.name.toLowerCase() === activeTask.normalizedColor);
    (colorGroup?.regions || []).slice(0, 3).forEach((region, index) => {
      drawRegionOutline(region, "#b9e9cf");
      const point = getRegionCenter(region);
      if (!targetPoint) targetPoint = point;
      chips.push({ key: `task-target-${index}`, label: activeTask.color || activeTask.normalizedColor, color: activeTask.normalizedColor, hex: region.hex, point });
    });
  }

  const hasExplicitZoneCue = cues.some((cue) =>
    String(cue.role || "").toLowerCase() === "destination" && normalizeZone(`${cue.location || ""} ${cue.label || ""}`)
  );
  if (activeTask.zoneKey && !hasExplicitZoneCue) {
    const point = drawZoneGuide(activeTask.zoneKey);
    if (!destinationPoint) destinationPoint = point;
    chips.push({ key: "task-destination-zone", label: activeTask.zoneKey, color: "yellow", point });
  }

  if (targetPoint && destinationPoint) drawArrow(targetPoint, destinationPoint);
  else if (targetPoint) drawArrow({ x: canvas.width * .5, y: canvas.height * .88 }, targetPoint);
  else if (destinationPoint) drawArrow({ x: canvas.width * .5, y: canvas.height * .50 }, destinationPoint);

  if (!chips.length) {
    chips.push({ key: "task-summary", label: "Follow the steps", color: "green", point: { x: canvas.width * .5, y: canvas.height * .16 } });
  }
  setCameraChips(showColorChips ? chips : []);
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
    const chosenCamera = cameraDeviceSelect?.value || "";
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        ...(chosenCamera ? { deviceId: { exact: chosenCamera } } : { facingMode: { ideal: "environment" } }),
        width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();
    if (cameraDeviceSelect && navigator.mediaDevices.enumerateDevices) {
      try {
        const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
        const activeId = stream.getVideoTracks()[0]?.getSettings()?.deviceId || chosenCamera;
        cameraDeviceSelect.replaceChildren();
        const fallback = document.createElement("option"); fallback.value = ""; fallback.textContent = "Default";
        cameraDeviceSelect.append(fallback);
        cameras.forEach((device, index) => {
          const option = document.createElement("option"); option.value = device.deviceId;
          option.textContent = device.label || `Camera ${index + 1}`;
          cameraDeviceSelect.append(option);
        });
        cameraDeviceSelect.value = cameras.some(d => d.deviceId === activeId) ? activeId : "";
      } catch { /* Some browsers do not enumerate camera names. */ }
    }

    streaming = true;
    cameraFrame.classList.add("is-live-video");
    // Native video remains smooth; the canvas is retained for HueFind/HueDo overlays.
    canvas.width = 320;
    canvas.height = Math.max(1, Math.round(320 * video.videoHeight / video.videoWidth));
    steadyReading.reset();
    pinnedSample = null;
    lastSampleTime = 0;
    lastFrameAnalysis = 0;
    hasScannedScene = false;
    updatePinState();
    toggleCamBtn.disabled = false;
    toggleCamBtn.setAttribute("aria-pressed", "true");
    toggleCamBtn.classList.add("is-active");
    toggleCamLabel.textContent = "Stop camera";
    colorSelect.disabled = false;
    scanSceneBtn.disabled = false;
    taskBtn.disabled = Boolean(activeTask?.completed) || Boolean(activeTask?.requiresPhotoCheck && !streaming);
    cameraPlaceholder.classList.add("is-hidden");
    setCameraStatus("Camera on", "live");
    detectedLayoutSignature = "__reset__";
    renderDetectedColors([]);
    setFeedback(readingStatus, "Hover to explore colors. Click or tap to pin a reading.");
    processLoop();
  } catch (error) {
    console.error("Webcam access error:", error);
    toggleCamBtn.disabled = false;
    toggleCamBtn.setAttribute("aria-pressed", "false");
    toggleCamLabel.textContent = "Start camera";
    setCameraStatus("Camera access needed", "error");
  }
});

cameraDeviceSelect?.addEventListener("change", () => {
  if (!streaming) return;
  stopCamera();
  toggleCamBtn.click();
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
  pinnedSample = null;
  pinnedPosition = null;
  steadyReading.reset();
  lastSamplePosition = null;
  lastSampleTime = 0;
  lastFrameAnalysis = 0;
  hueSeeRegionStabilizer.reset();
  hueFindTracker.reset();
  scanSceneRequested = false;
  hasScannedScene = false;
  scanSceneBtn.textContent = "Scan scene";
  cameraFrame.classList.remove("is-live-video", "has-pinned-reading");
  updatePinState();
  resetColorDetails();
  detectedLayoutSignature = "__reset__";
  renderDetectedColors([]);
  pointerIsDown = false;
  pointerStart = null;
  pointerIsOverCanvas = false;
  keyboardSamplingActive = false;
  taskCheckFrames = 0;
  taskSuccessStreak = 0;

  toggleCamBtn.disabled = false;
  toggleCamBtn.setAttribute("aria-pressed", "false");
  toggleCamBtn.classList.remove("is-active");
  toggleCamLabel.textContent = "Start camera";
  colorSelect.disabled = true;
  scanSceneBtn.disabled = true;
  sampleFindBtn.disabled = true;
  taskBtn.disabled = Boolean(activeTask?.completed) || Boolean(activeTask?.requiresPhotoCheck);

  cameraPlaceholder.classList.remove("is-hidden");
  sampleIndicator.classList.remove("is-visible", "is-below");
  sampleReticle.classList.remove("is-visible");
  setCameraChips([]);
  clearVectorOutline();
  sampleSwatch.style.backgroundColor = "";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  samplingContext.clearRect(0, 0, samplingCanvas.width, samplingCanvas.height);

  setCameraStatus("Camera off", "off");
  setFeedback(findResult, "Choose a target to begin.");
  if (activeTask && !activeTask.completed) {
    setFeedback(taskResult, activeTask.canAutoVerify ? "Start the camera to check placement." : "Start the camera to show visual cues.");
  }
}

function processLoop(time = 0) {
  if (!streaming) return;

  try {
    // Analyze color regions at a modest cadence, independently of fast cursor sampling.
    // HueSee shows labels only; HueFind retains the original outlined target regions.
    const shouldAnalyze = scanSceneRequested || time - lastFrameAnalysis >= (currentMode === "find" && targetColor ? FIND_INTERVAL_MS : FRAME_INTERVAL_MS);

    if (shouldAnalyze) {
      lastFrameAnalysis = time;
      const result = currentMode === "find" && targetColor && !scanSceneRequested
        ? { ready: true, colors: latestColors }
        : analyzeVideoFrame(video, analysisCanvas, hueSeeRegionStabilizer);
      if (result?.ready) {
        latestColors = result.colors || [];
        if (scanSceneRequested) {
          hasScannedScene = true;
          renderDetectedColors(latestColors);
          scanSceneBtn.textContent = "Scan scene";
        }
        scanSceneRequested = false;

        if (currentMode === "see") showHueSeeRegionLabels(latestColors);
        else if (currentMode === "find" && targetColor) drawTargetOverlay();
        else if (currentMode === "do" && activeTask) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          drawTaskGuidance();
        }
        else setCameraChips([]);


      }
    }

    if (!pinnedSample && (pointerIsOverCanvas || pointerIsDown || keyboardSamplingActive) &&
        lastSamplePosition && time - lastSampleTime >= SAMPLE_INTERVAL_MS) {
      const source = pointerIsDown ? "touch" : keyboardSamplingActive ? "keyboard" : "pointer";
      sampleImagePoint(lastSamplePosition, source);
      lastSampleTime = time;
    }
  } catch (error) {
    console.error("Camera frame processing error:", error);
  }

  animationFrameId = requestAnimationFrame(processLoop);
}

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
  if (!rect.width || !rect.height || !canvas.width || !canvas.height) return { stageX: x, stageY: y };

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

function sampleImagePoint(point, source = "pointer", { immediate = false } = {}) {
  if (!streaming || !video.videoWidth || !video.videoHeight || !point || pinnedSample) return null;

  try {
    const width = 240;
    const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
    if (samplingCanvas.width !== width || samplingCanvas.height !== height) {
      samplingCanvas.width = width;
      samplingCanvas.height = height;
    }

    samplingContext.drawImage(video, 0, 0, width, height);
    const pixelX = clamp(Math.floor(point.x * width), 0, width - 1);
    const pixelY = clamp(Math.floor(point.y * height), 0, height - 1);
    const patchSize = 7;
    const x = Math.max(0, pixelX - 3);
    const y = Math.max(0, pixelY - 3);
    const patch = samplingContext.getImageData(
      x, y, Math.min(patchSize, width - x), Math.min(patchSize, height - y)
    );
    const rgb = averagePixelRegion(patch);
    const raw = classifyColor(rgb.r, rgb.g, rgb.b);
    const sample = steadyReading.observe(raw, { immediate, position: point });

    if (!sample) return null;
    const nextSample = {
      ...sample,
      source,
      position: { x: point.x, y: point.y }
    };

    const changed = !currentSample || currentSample.hex !== nextSample.hex || currentSample.name !== nextSample.name;
    currentSample = nextSample;
    lastSamplePosition = point;
    if (changed) {
      renderSample(currentSample);
      // Only change button state when pinning, not on every color sample.
    }
    moveSampleIndicator(point);
    return currentSample;
  } catch (error) {
    console.error("Color sample error:", error);
    return null;
  }
}

function moveSampleIndicator(point) {
  if (!point || pinnedSample) return;
  const width = cameraFrame.clientWidth;
  const height = cameraFrame.clientHeight;
  const halfWidth = (sampleIndicator.offsetWidth || 175) / 2 + 8;
  const left = clamp(point.stageX * width, halfWidth, Math.max(halfWidth, width - halfWidth));
  const top = clamp(point.stageY * height, 15, Math.max(15, height - 15));
  sampleIndicator.style.left = `${left}px`;
  sampleIndicator.style.top = `${top}px`;
  sampleIndicator.classList.toggle("is-below", point.stageY < .25);
  sampleIndicator.classList.add("is-visible");
  sampleReticle.style.left = `${point.stageX * 100}%`;
  sampleReticle.style.top = `${point.stageY * 100}%`;
  sampleReticle.classList.add("is-visible");
}

function renderSample(sample) {
  sampleName.textContent = sample.name;
  sampleHex.textContent = sample.hex;
  const { r, g, b } = sample.rgb;
  sampleRgb.textContent = `RGB ${r}, ${g}, ${b}`;
  sampleSwatch.style.backgroundColor = sample.hex;
  renderColorDetails(sample);
  sampleFindBtn.disabled = false;
}

function updatePinState() {
  const pinned = Boolean(pinnedSample);
  cameraFrame.classList.toggle("has-pinned-reading", pinned);
  pinColorBtn.disabled = !streaming || (!pinned && !currentSample);
  pinColorBtn.textContent = pinned ? "Unpin reading" : "Pin reading";
  pinColorBtn.setAttribute("aria-pressed", String(pinned));
  saveColorBtn.disabled = !streaming || !pinned || pinnedSample?.name === "Unknown";
  setFeedback(readingStatus, pinned
    ? `Pinned ${pinnedSample.name} (${pinnedSample.hex}). You can save this snapshot to HueMemory.`
    : "Hover to explore. Click or tap to pin the color you want to keep.");
}

function pinReading(point = lastSamplePosition) {
  if (!streaming) return;
  if (pinnedSample) {
    pinnedSample = null;
    pinnedPosition = null;
    steadyReading.reset();
    sampleIndicator.classList.remove("is-visible");
    sampleReticle.classList.remove("is-visible");
    updatePinState();
    return;
  }
  if (point) sampleImagePoint(point, "pin", { immediate: true });
  if (!currentSample) return;
  pinnedSample = {
    name: currentSample.name,
    hex: currentSample.hex,
    rgb: { ...currentSample.rgb },
    position: { ...currentSample.position },
    source: "pin"
  };
  pinnedPosition = point ? { ...point } : null;
  currentSample = pinnedSample;
  if (pinnedPosition) movePinnedIndicator(pinnedPosition);
  sampleFindBtn.disabled = pinnedSample.name === "Unknown";
  updatePinState();
}

function movePinnedIndicator(point) {
  // Reuse the same visual cursor, but prevent further hover sampling until unpinned.
  const width = cameraFrame.clientWidth;
  const height = cameraFrame.clientHeight;
  const halfWidth = (sampleIndicator.offsetWidth || 175) / 2 + 8;
  sampleIndicator.style.left = `${clamp(point.stageX * width, halfWidth, Math.max(halfWidth, width - halfWidth))}px`;
  sampleIndicator.style.top = `${point.stageY * height}px`;
  sampleIndicator.classList.toggle("is-below", point.stageY < .25);
  sampleIndicator.classList.add("is-visible");
  sampleReticle.style.left = `${point.stageX * 100}%`;
  sampleReticle.style.top = `${point.stageY * 100}%`;
  sampleReticle.classList.add("is-visible");
}

pinColorBtn.addEventListener("click", () => pinReading());
scanSceneBtn.addEventListener("click", () => {
  if (!streaming) return;
  scanSceneRequested = true;
  scanSceneBtn.textContent = "Scanning…";
});

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

function getPlainLanguageDescription(sample, hsl) {
  if (sample.name === "Unknown") return "Outside supported categories";
  if (sample.name === "Black") return "Very dark neutral";
  if (sample.name === "White") return "Very light neutral";
  if (sample.name === "Gray") return "Low-saturation neutral";

  const lightness = hsl.l < 20 ? "Very dark" :
    hsl.l < 40 ? "Dark" :
    hsl.l < 60 ? "Medium" :
    hsl.l < 80 ? "Light" : "Very light";
  const saturation = hsl.s < 20 ? "muted" :
    hsl.s < 45 ? "soft" :
    hsl.s < 70 ? "moderate" : "vivid";
  return `${lightness}, ${saturation} ${sample.name.toLowerCase()}`;
}

function renderColorDetails(sample) {
  const { r, g, b } = sample.rgb;
  const hsl = rgbToHsl(r, g, b);

  colorPreview.style.backgroundColor = sample.hex;
  colorNameDisplay.textContent = sample.name;
  const nearest = closestReferenceShade(sample.rgb);
  colorDescription.textContent = getPlainLanguageDescription(sample, hsl) +
    (nearest ? ` · closest CSS shade: ${nearest}` : "");
  colorHex.textContent = sample.hex;
  colorRgb.textContent = `(${r}, ${g}, ${b})`;
  colorHsl.textContent = `(${hsl.h}°, ${hsl.s}%, ${hsl.l}%)`;

  speakDetailsBtn.disabled = false;
  pinColorBtn.disabled = false;
}

function resetColorDetails() {
  colorPreview.style.backgroundColor = "#e4e8e5";
  colorNameDisplay.textContent = "No sample yet";
  colorDescription.textContent = "Tap the camera view to sample.";
  colorHex.textContent = "—";
  colorRgb.textContent = "—";
  colorHsl.textContent = "—";
  speakDetailsBtn.disabled = true;
  pinColorBtn.disabled = true;
  saveColorBtn.disabled = true;
  setFeedback(saveColorStatus, "");
}

function getSpokenColorDetails(sample) {
  const { r, g, b } = sample.rgb;
  const hsl = rgbToHsl(r, g, b);
  return `${sample.name}. Hex ${sample.hex}. RGB ${r}, ${g}, ${b}. HSL ${hsl.h} degrees, ${hsl.s} percent saturation, ${hsl.l} percent lightness.`;
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
      empty.textContent = "Use Scan scene to analyze visible colors.";
      detectedColorsList.append(empty);
      return;
    }

    if (colors.length === 0) {
      const empty = document.createElement("li");
      empty.className = "detected-empty";
      empty.textContent = hasScannedScene ? "No prominent color groups detected. Move closer and scan again." : "Choose Scan scene for an overview.";
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
      region.textContent = getApproximateRegion(color);

      item.append(name, count, region);
      detectedColorsList.append(item);
      detectedItemsByName.set(color.name, count);
    }
  }

  for (const color of colors) {
    const count = detectedItemsByName.get(color.name);
    if (count) {
      const points = Number(color.samples) || 0;
      count.textContent = `${points.toLocaleString()} sampled points`;
    }
  }
}

function sampleFromPointer(event, { immediate = false } = {}) {
  if (!streaming || pinnedSample) return null;
  const point = getImagePoint(event.clientX, event.clientY);
  if (!point) return null;
  const previous = lastSamplePosition;
  const movedFar = Boolean(previous && Math.hypot(point.x - previous.x, point.y - previous.y) > .13);
  keyboardPosition = { x: point.x, y: point.y };
  lastSamplePosition = point;
  moveSampleIndicator(point);
  const now = performance.now();
  if (immediate || now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    sampleImagePoint(point, event.pointerType === "touch" ? "touch" : "pointer", { immediate: immediate || movedFar });
    lastSampleTime = now;
  }
  return point;
}

canvas.addEventListener("pointerenter", (event) => {
  if (currentMode !== "see") return;
  if (event.pointerType === "mouse") {
    pointerIsOverCanvas = true;
    sampleFromPointer(event);
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (currentMode !== "see" || pinnedSample) return;
  if (event.pointerType === "mouse") {
    pointerIsOverCanvas = Boolean(sampleFromPointer(event));
  } else if (pointerIsDown) {
    sampleFromPointer(event);
  }
});

canvas.addEventListener("pointerdown", (event) => {
  if (!streaming) return;
  if (currentMode === "find") {
    const point = getImagePoint(event.clientX, event.clientY);
    if (point) focusHueFindAt(point);
    if (event.pointerType !== "mouse") event.preventDefault();
    return;
  }
  pointerIsDown = true;
  pointerStart = { x: event.clientX, y: event.clientY, time: performance.now() };
  keyboardSamplingActive = false;
  canvas.focus({ preventScroll: true });
  if (event.pointerType !== "mouse") event.preventDefault();
  if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
  sampleFromPointer(event, { immediate: true });
});

function finishPointerSample(event) {
  if (currentMode === "find") return;
  const start = pointerStart;
  pointerIsDown = false;
  pointerStart = null;
  if (event?.pointerType !== "mouse") pointerIsOverCanvas = false;
  const isTap = start && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 13 &&
    performance.now() - start.time < 520;
  if (isTap) {
    if (!pinnedSample) sampleFromPointer(event, { immediate: true });
    pinReading(lastSamplePosition);
  } else if (currentSample && !pinnedSample) {
    // Dragging explores the view; it does not accidentally pin.
    sampleIndicator.classList.remove("is-visible");
    sampleReticle.classList.remove("is-visible");
  }
}

canvas.addEventListener("pointerup", finishPointerSample);
canvas.addEventListener("pointercancel", () => { pointerIsDown = false; pointerStart = null; });

canvas.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "mouse" && !pointerIsDown) {
    pointerIsOverCanvas = false;
    if (!pinnedSample) {
      lastSamplePosition = null;
      sampleIndicator.classList.remove("is-visible");
      sampleReticle.classList.remove("is-visible");
      steadyReading.reset();
    }
  }
});

canvas.addEventListener("focus", () => {
  if (!streaming || pointerIsDown || pinnedSample) return;
  keyboardPosition = { x: .5, y: .5 };
  keyboardSamplingActive = true;
  const point = { ...keyboardPosition, ...getStagePositionForImagePoint(keyboardPosition.x, keyboardPosition.y) };
  lastSamplePosition = point;
  sampleImagePoint(point, "keyboard", { immediate: true });
});

canvas.addEventListener("keydown", (event) => {
  if (!streaming) return;
  if (event.key === "Escape" && pinnedSample) {
    event.preventDefault();
    pinReading();
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (currentMode === "find") focusHueFindAt({ ...keyboardPosition, ...getStagePositionForImagePoint(keyboardPosition.x, keyboardPosition.y) });
    else pinReading();
    return;
  }
  if (pinnedSample) return;

  const step = event.shiftKey ? .10 : .025;
  let moved = true;
  switch (event.key) {
    case "ArrowLeft": keyboardPosition.x = clamp(keyboardPosition.x - step, 0, 1); break;
    case "ArrowRight": keyboardPosition.x = clamp(keyboardPosition.x + step, 0, 1); break;
    case "ArrowUp": keyboardPosition.y = clamp(keyboardPosition.y - step, 0, 1); break;
    case "ArrowDown": keyboardPosition.y = clamp(keyboardPosition.y + step, 0, 1); break;
    default: moved = false;
  }
  if (moved) {
    event.preventDefault();
    keyboardSamplingActive = true;
    steadyReading.reset();
    const point = { ...keyboardPosition, ...getStagePositionForImagePoint(keyboardPosition.x, keyboardPosition.y) };
    lastSamplePosition = point;
    sampleImagePoint(point, "keyboard", { immediate: true });
  }
});

canvas.addEventListener("blur", () => {
  keyboardSamplingActive = false;
  if (!pinnedSample && !pointerIsOverCanvas && !pointerIsDown) {
    sampleIndicator.classList.remove("is-visible");
    sampleReticle.classList.remove("is-visible");
  }
});

function announceSample(sample) {
  speak(getSpokenColorDetails(sample));
}

speakDetailsBtn.addEventListener("click", () => {
  if (currentSample) announceSample(currentSample);
});

saveColorBtn.addEventListener("click", async () => {
  if (!pinnedSample || saveColorBtn.disabled) return;
  saveColorBtn.disabled = true;
  const snapshot = { ...pinnedSample, rgb: { ...pinnedSample.rgb }, shade: `${pinnedSample.name} ${pinnedSample.hex}` };
  setFeedback(saveColorStatus, "Saving…");
  try {
    await saveColor(snapshot);
    setFeedback(saveColorStatus, `${snapshot.name} ${snapshot.hex} saved to HueMemory.`);
    speak(`${snapshot.name} saved to your color palette.`);
  } catch (error) {
    setFeedback(saveColorStatus, error.message || "Could not save this color.");
  } finally {
    saveColorBtn.disabled = !pinnedSample || pinnedSample.name === "Unknown";
  }
});

contrastToggle.addEventListener("click", () => {
  const enabled = document.body.classList.toggle("high-contrast");
  contrastToggle.setAttribute("aria-pressed", String(enabled));
  contrastToggle.querySelector("span:last-child").textContent = enabled ? "Standard" : "Contrast";
});

textSizeToggle.addEventListener("click", () => {
  const enabled = document.documentElement.classList.toggle("large-text");
  textSizeToggle.setAttribute("aria-pressed", String(enabled));
  textSizeToggle.querySelector("span:last-child").textContent = enabled ? "Standard" : "Text size";
});

colorChipToggle.addEventListener("click", () => {
  showColorChips = !showColorChips;
  colorChipToggle.setAttribute("aria-pressed", String(showColorChips));
  colorChipToggle.setAttribute("aria-label", showColorChips ? "Hide detected color labels" : "Show detected color labels");
  colorChipToggle.title = showColorChips ? "Hide detected color labels" : "Show detected color labels";
  if (colorChipToggleText) colorChipToggleText.textContent = showColorChips ? "Hide color labels" : "Show color labels";
  if (currentMode === "see") showHueSeeRegionLabels(latestColors);
  else if (!showColorChips) setCameraChips([]);
});

function setFindTarget(value, shouldSpeak = true, colorReference = null) {
  const normalized = normalizeColorCategory(value);
  targetColor = normalized;
  targetRgb = colorReference?.rgb || null;
  targetShade = colorReference?.shade || "";
  colorSelect.value = normalized;
  hueFindTracker.reset();
  focusedContourId = null;
  pendingFocusPoint = null;
  if (!normalized) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    clearVectorOutline();
    setCameraChips([]);
    targetRgb = null;
    targetShade = "";
    setFeedback(findResult, "Choose a target to begin.");
    return;
  }
  const label = targetShade || normalized;
  setFeedback(findResult, streaming ? `Looking for ${label}…` : `Target set: ${label}. Start the camera to find it.`);
  if (shouldSpeak) speak(`Finding ${label}`);
}

// A point selects a particular real-world region instead of every patch of that color.
function focusHueFindAt(point) {
  if (!streaming || !point || video.readyState < 2) return;
  if (!targetColor) {
    // Read directly from the camera; a color pinned earlier in HueSee must not
    // block the selection of a new HueFind target.
    const width = 320, height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
    samplingCanvas.width = width; samplingCanvas.height = height;
    samplingContext.drawImage(video, 0, 0, width, height);
    const x = clamp(Math.round(point.x * width) - 4, 0, Math.max(0, width - 9));
    const y = clamp(Math.round(point.y * height) - 4, 0, Math.max(0, height - 9));
    const rgb = averagePixelRegion(samplingContext.getImageData(x, y, 9, 9));
    const sample = classifyColor(rgb.r, rgb.g, rgb.b);
    if (!normalizeColorCategory(sample.name)) {
      setFeedback(findResult, "Choose a color first, or tap a colorful object."); return;
    }
    setFindTarget(sample.name, false, { rgb, shade: sample.name });
  }
  focusedContourId = null;
  pendingFocusPoint = { x: point.x * (canvas.width || 320), y: point.y * (canvas.height || 240) };
  hueFindTracker.reset();
  setFeedback(findResult, `Selecting a ${targetShade || targetColor} region…`);
  drawTargetOverlay();
}

focusResetBtn?.addEventListener("click", () => {
  focusedContourId = null; pendingFocusPoint = null; hueFindTracker.reset();
  setFeedback(findResult, "Following the strongest matching region. Tap an object to focus it.");
});
calibrateBtn?.addEventListener("click", () => {
  if (neutralGains) {
    neutralGains = null; calibrateBtn.textContent = "Calibrate from white card";
    calibrationStatus.textContent = "Calibration cleared. Camera uses its default color response.";
    hueFindTracker.reset(); focusedContourId = null; pendingFocusPoint = null;
    return;
  }
  if (!streaming || video.readyState < 2) {
    calibrationStatus.textContent = "Start the camera, then hold a white card at its center."; return;
  }
  const width = 320, height = Math.round(width * video.videoHeight / video.videoWidth);
  samplingCanvas.width = width; samplingCanvas.height = height;
  samplingContext.drawImage(video, 0, 0, width, height);
  const neutral = neutralReferenceFromCenter(samplingContext.getImageData(0, 0, width, height));
  const gains = calculateNeutralGains(neutral || {});
  if (!gains) {
    calibrationStatus.textContent = "No usable neutral card detected at center. Try plain white or gray paper with even light.";
    return;
  }
  neutralGains = gains; calibrateBtn.textContent = "Reset lighting calibration";
  calibrationStatus.textContent = "Neutral-card correction on for HueFind matching. Camera image and saved HEX remain unaltered.";
  hueFindTracker.reset(); focusedContourId = null; pendingFocusPoint = null;
});

colorSelect.addEventListener("change", (event) => setFindTarget(event.target.value));
sampleFindBtn.addEventListener("click", () => {
  if (currentSample) setFindTarget(currentSample.name, true, { ...currentSample, shade: currentSample.name });
});
clearFindBtn.addEventListener("click", () => {
  targetColor = "";
  targetRgb = null;
  targetShade = "";
  colorSelect.value = "";
  clearVectorOutline();
  focusedContourId = null; pendingFocusPoint = null;
  hueFindTracker.reset();
  setFeedback(findResult, "Choose a target to begin.");
});

// HueDo interprets open-ended instructions and turns supported details into camera cues.
instructionImageInput.addEventListener("change", () => {
  const file = instructionImageInput.files?.[0];
  instructionImage = file || null;
  instructionFileName.textContent = file ? file.name : "No photo";
  instructionImagePreview.replaceChildren();

  if (instructionImageUrl) URL.revokeObjectURL(instructionImageUrl);
  instructionImageUrl = null;

  if (file) {
    instructionImageUrl = URL.createObjectURL(file);
    const image = document.createElement("img");
    image.src = instructionImageUrl;
    image.alt = "Selected instruction";
    instructionImagePreview.append(image);
    instructionImagePreview.hidden = false;
  } else {
    instructionImagePreview.hidden = true;
  }
});

async function fileToInlineImage(file) {
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("Choose an image smaller than 8 MB.");
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
  const [header, data] = dataUrl.split(",");
  const mimeType = header.match(/data:(.*?);base64/)?.[1] || file.type || "image/jpeg";
  return { mimeType, data };
}

function renderTaskDraftPreview(draft) {
  taskStepsPreview.replaceChildren();
  (draft.steps || []).forEach((step) => {
    const item = document.createElement("li");
    item.textContent = step;
    taskStepsPreview.append(item);
  });
  if (!draft.steps?.length) {
    const item = document.createElement("li");
    item.textContent = "Follow the instruction as written.";
    taskStepsPreview.append(item);
  }

  taskCuePreview.replaceChildren();
  (draft.visualCues || []).forEach((cue) => {
    const pill = document.createElement("span");
    pill.className = "task-cue-pill";
    pill.textContent = cue.label || cue.object || cue.role || "Visual cue";
    pill.style.setProperty("--cue-color", chipColors[String(cue.color || "").toLowerCase()] || "var(--brand)");
    taskCuePreview.append(pill);
  });
}

interpretBtn.addEventListener("click", async () => {
  const text = instructionInput.value.trim();
  if (!text && !instructionImage) {
    setFeedback(interpretStatus, "Add an instruction or photo first.");
    return;
  }

  interpretBtn.disabled = true;
  interpretBtn.textContent = "Building guide…";
  setFeedback(interpretStatus, "");

  try {
    const image = instructionImage ? await fileToInlineImage(instructionImage) : null;
    const result = await interpret(text, image);
    pendingTaskDraft = {
      summary: result.summary || text,
      steps: Array.isArray(result.steps) ? result.steps : [],
      visualCues: Array.isArray(result.visualCues) ? result.visualCues : [],
      color: result.targetColor || "",
      object: result.targetObject || "",
      action: result.action || "",
      destination: result.destination || "",
      relation: result.relation || "",
      answer: result.answer || "",
      locations: Array.isArray(result.locations) ? result.locations : []
    };
    taskSummaryInput.value = pendingTaskDraft.summary;
    renderTaskDraftPreview(pendingTaskDraft);
    parsedTask.hidden = false;
    setFeedback(interpretStatus, result.answer
      ? `Guide ready. ${result.answer}`
      : "Guide ready to review.");
  } catch (error) {
    const fallbackSummary = text || "Follow the instruction in the attached photo.";
    const parsed = text ? parseInstruction(text) : {};
    const steps = text ? buildGuideSteps(parsed).map(step => step.text) : [fallbackSummary];
    pendingTaskDraft = {
      summary: fallbackSummary,
      steps,
      visualCues: [],
      color: parsed.color || "",
      object: parsed.object || "",
      action: parsed.action || "",
      destination: parsed.destination || "",
      relation: parsed.relation || ""
    };
    taskSummaryInput.value = fallbackSummary;
    renderTaskDraftPreview(pendingTaskDraft);
    parsedTask.hidden = false;
    setFeedback(interpretStatus, `${error.message} You can still save this as a manual guide.`);
  } finally {
    interpretBtn.disabled = false;
    interpretBtn.textContent = "Build visual guide";
  }
});

saveTaskBtn.addEventListener("click", async () => {
  const draft = {
    ...(pendingTaskDraft || {}),
    summary: taskSummaryInput.value.trim()
  };

  if (!draft.summary) {
    setFeedback(interpretStatus, "Add a short description of the task.");
    return;
  }

  saveTaskBtn.disabled = true;
  saveTaskBtn.textContent = "Saving…";
  try {
    // Local demo intentionally cannot write to account-owned MongoDB records.
    const isDemo = Boolean(window.hueDemoMode);
    const saved = isDemo ? { ...draft, completed: false } : await createTask(draft);
    setActiveTask(saved);
    setActiveMode("do");
    if (!isDemo) await refreshTaskLibrary();
    setFeedback(interpretStatus, isDemo
      ? "Guide ready for this demo. It won't be stored until you sign in."
      : "Visual guide is ready in the camera view.");
    speak(draft.summary);
  } catch (error) {
    setFeedback(interpretStatus, error.message || "Could not save the guide.");
  } finally {
    saveTaskBtn.disabled = false;
    saveTaskBtn.textContent = "Use this guide";
  }
});

function setActiveTask(task) {
  const summary = task.summary || task.task || [task.action, task.color, task.object, task.destination].filter(Boolean).join(" ") || "Follow the saved task.";
  const visualCues = Array.isArray(task.visualCues) ? [...task.visualCues] : [];
  if (!visualCues.length && task.color) {
    visualCues.push({
      label: [task.color, task.object].filter(Boolean).join(" ") || task.color,
      role: "target",
      color: task.color,
      object: task.object || ""
    });
  }
  if (task.destination && !visualCues.some((cue) => String(cue.role || "").toLowerCase() === "destination")) {
    visualCues.push({
      label: task.destination,
      role: "destination",
      location: task.destination,
      direction: ""
    });
  }

  const normalizedColor = normalizeColorCategory(task.targetColor || task.color || visualCues.find((cue) => cue.color)?.color || "");
  if (normalizedColor && !visualCues.some((cue) => cue.color)) {
    visualCues.push({ label: task.color || normalizedColor, role: "target", color: task.color || normalizedColor });
  }
  const zoneKey = normalizeZone(task.destination || visualCues.find((cue) => String(cue.role || "").toLowerCase() === "destination")?.location || "");
  activeTask = {
    ...task,
    summary,
    visualCues,
    normalizedColor,
    zoneKey,
    // Never auto-mark a task complete just because matching colors are visible
    // inside an assumed zone. Completion checking is explicitly photo-based.
    canAutoVerify: false,
    requiresPhotoCheck: Boolean(task.destination && (task.object || task.color))
  };

  taskSuccessStreak = 0;
  taskCompletionPending = false;
  activeTaskEmpty.hidden = true;
  activeTaskContent.hidden = false;
  taskStateMark.textContent = task.completed ? "✓" : "○";
  taskStateMark.style.color = task.completed ? "var(--success)" : "";
  activeTaskSummary.textContent = summary;
  activeTaskSteps.replaceChildren();
  (Array.isArray(task.steps) ? task.steps : []).forEach((step) => {
    const item = document.createElement("li");
    item.textContent = step;
    activeTaskSteps.append(item);
  });
  targetColor = normalizedColor;
  targetRgb = null;
  targetShade = "";
  colorSelect.value = targetColor;
  colorSelect.disabled = !streaming;
  taskBtn.disabled = Boolean(task.completed) || Boolean(activeTask.requiresPhotoCheck && !streaming);
  taskBtn.textContent = task.completed ? "Completed" : activeTask.requiresPhotoCheck ? "Check with camera" : "Mark complete";
  setFeedback(taskResult, task.completed
    ? "This guide is complete."
    : activeTask.requiresPhotoCheck
      ? "Move the object, then use Check with camera for Gemini's assessment."
      : "Follow the steps, then mark complete when you're ready.");
  if (task.completed) taskStateMark.textContent = "✓";
}

function clearActiveTask() {
  activeTask = null;
  taskSuccessStreak = 0;
  taskCompletionPending = false;
  activeTaskEmpty.hidden = false;
  activeTaskContent.hidden = true;
  taskStateMark.textContent = "○";
  targetColor = "";
  colorSelect.value = "";
  setCameraChips([]);
  setFeedback(findResult, "Choose a target to begin.");
}

clearTaskBtn.addEventListener("click", clearActiveTask);

function capitalize(value = "") {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

function sampleColorInDestination() {
  if (!activeTask?.canAutoVerify || !video.videoWidth || !video.videoHeight) {
    return { found: false, hits: 0, ratio: 0 };
  }

  const width = 320;
  const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
  if (samplingCanvas.width !== width || samplingCanvas.height !== height) {
    samplingCanvas.width = width;
    samplingCanvas.height = height;
  }
  samplingContext.drawImage(video, 0, 0, width, height);

  const zone = getZoneBounds(activeTask.zoneKey);
  if (!zone) return { found: false, hits: 0, ratio: 0 };
  const left = clamp(zone.x, 0, width - 1);
  const top = clamp(zone.y, 0, height - 1);
  const zoneWidth = clamp(zone.width, 1, width - left);
  const zoneHeight = clamp(zone.height, 1, height - top);
  const pixels = samplingContext.getImageData(left, top, zoneWidth, zoneHeight).data;

  let hits = 0;
  let total = 0;
  const target = activeTask.normalizedColor;
  if (!target) return { found: false, hits: 0, ratio: 0 };

  const step = 6;
  for (let y = 0; y < zoneHeight; y += step) {
    for (let x = 0; x < zoneWidth; x += step) {
      const index = (y * zoneWidth + x) * 4;
      const detected = classifyColor(pixels[index], pixels[index + 1], pixels[index + 2]).name.toLowerCase();
      if (detected === target) hits += 1;
      total += 1;
    }
  }

  const ratio = total ? hits / total : 0;
  return { found: hits >= 4 && ratio >= 0.025, hits, ratio };
}

function verifyTaskFrame() {
  if (!activeTask?.canAutoVerify) return;
  const result = sampleColorInDestination();
  if (result.found) {
    taskSuccessStreak += 1;
    setFeedback(taskResult, `Target detected in ${activeTask.zoneKey}. Confirming…`);
    if (taskSuccessStreak >= 4) completeActiveTask(true);
  } else {
    taskSuccessStreak = 0;
    setFeedback(taskResult, `Looking for ${activeTask.color || activeTask.normalizedColor} in ${activeTask.zoneKey}.`);
  }
}

// Capture a fresh frame from whichever camera the user selected, including Camo.
// This is sent only when the user explicitly presses Check with camera.
function captureHueDoPhoto() {
  if (!streaming || !video.videoWidth || !video.videoHeight) {
    throw new Error("Start your camera (Camo is supported) before checking the task.");
  }
  const photo = document.createElement("canvas");
  photo.width = Math.min(960, video.videoWidth);
  photo.height = Math.round(photo.width * video.videoHeight / video.videoWidth);
  photo.getContext("2d").drawImage(video, 0, 0, photo.width, photo.height);
  return { mimeType: "image/jpeg", data: photo.toDataURL("image/jpeg", 0.83).split(",")[1] };
}

taskBtn.addEventListener("click", async () => {
  if (!activeTask || activeTask.completed || taskCompletionPending) return;
  if (!activeTask.requiresPhotoCheck) {
    await completeActiveTask(false);
    return;
  }

  taskCompletionPending = true;
  taskBtn.disabled = true;
  taskBtn.textContent = "Checking picture…";
  setFeedback(taskResult, "Gemini is checking the current camera picture…");
  try {
    const image = captureHueDoPhoto();
    const task = {
      summary: activeTask.summary,
      target: [activeTask.color, activeTask.object].filter(Boolean).join(" ").trim(),
      destination: activeTask.destination
    };
    const result = await checkTask(image, task);
    const message = result.message || (result.done ? "Task appears complete." : "Task not yet confirmed.");
    if (result.done === true) {
      // Gemini is an assessment of visible evidence; no automatic pixel-zone verification.
      await completeActiveTask(true);
      setFeedback(taskResult, `Gemini assessment: ${message} Check the result yourself.`);
    } else {
      setFeedback(taskResult, `Gemini assessment: ${message}`);
      speak(message);
    }
  } catch (error) {
    setFeedback(taskResult, error.message || "Could not check the camera picture.");
  } finally {
    taskCompletionPending = false;
    if (activeTask && !activeTask.completed) {
      taskBtn.disabled = !streaming;
      taskBtn.textContent = "Check with camera";
    }
  }
});

async function completeActiveTask(cameraVerified = false) {
  if (!activeTask || activeTask.completed) return;
  taskCompletionPending = true;
  activeTask.completed = true;
  taskStateMark.textContent = "✓";
  taskStateMark.style.color = "var(--success)";
  taskBtn.disabled = true;
  taskBtn.textContent = "Completed";
  setFeedback(taskResult, cameraVerified ? "Gemini's picture check suggests completion; verify the result yourself." : "Task marked complete.");
  speak(cameraVerified ? "Gemini says the task appears complete." : "Task marked complete.");

  if (activeTask._id) {
    try {
      const updated = await completeTask(activeTask._id, true);
      activeTask = { ...activeTask, ...updated };
      await refreshTaskLibrary();
    } catch (error) {
      console.error("Could not persist task completion:", error);
      setFeedback(taskResult, "Marked complete here, but could not sync to the saved guides.");
    }
  }
}

async function refreshTaskLibrary() {
  try {
    const tasks = await loadTasks();
    renderTaskLibrary(tasks);
  } catch (error) {
    taskLibrary.replaceChildren();
    const message = document.createElement("p");
    message.className = "library-empty";
    message.textContent = error.message || "Task library is unavailable.";
    taskLibrary.append(message);
  }
}

function renderTaskLibrary(tasks) {
  taskLibrary.replaceChildren();
  if (!tasks.length) {
    const empty = document.createElement("p");
    empty.className = "library-empty";
    empty.textContent = "No saved guides yet.";
    taskLibrary.append(empty);
    return;
  }

  tasks.forEach((task) => {
    const row = document.createElement("article");
    row.className = "task-library-item";

    const copy = document.createElement("div");
    copy.className = "task-library-copy";
    const title = document.createElement("p");
    title.className = "task-library-title";
    title.textContent = task.summary || task.task || [task.action, task.color, task.object, task.destination].filter(Boolean).join(" ") || "Saved guide";
    const meta = document.createElement("p");
    meta.className = "task-library-meta";
    meta.textContent = task.completed ? "Completed" : "Saved guide";
    copy.append(title, meta);

    const actions = document.createElement("div");
    actions.className = "task-library-actions";
    const useButton = document.createElement("button");
    useButton.type = "button";
    useButton.textContent = "Use guide";
    useButton.addEventListener("click", () => {
      setActiveTask(task);
      setActiveMode("do");
    });
    actions.append(useButton);

    if (!task.completed) {
      const doneButton = document.createElement("button");
      doneButton.type = "button";
      doneButton.textContent = "Mark done";
      doneButton.addEventListener("click", async () => {
        doneButton.disabled = true;
        try {
          const updated = await completeTask(task._id, true);
          if (activeTask?._id === task._id) setActiveTask(updated);
          await refreshTaskLibrary();
        } catch (error) {
          doneButton.disabled = false;
          meta.textContent = error.message || "Could not update task.";
        }
      });
      actions.append(doneButton);
    }

    row.append(copy, actions);
    taskLibrary.append(row);
  });
}

refreshTasksBtn.addEventListener("click", refreshTaskLibrary);

function speak(text) {
  announcer.textContent = text;
  if ("speechSynthesis" in window && "SpeechSynthesisUtterance" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  }
}

// Mount persistent color memory and image sampling tools.
mountPalette($("palette"), {
  onFindAgain: (color) => {
    const category = normalizeColorCategory(color.colorName || color.shade);
    setFindTarget(category, true, color);
    setActiveMode("find");
  }
});

mountImagePicker($("image-picker"), {
  title: "Image sampler",
  onSaved: () => setFeedback(saveColorStatus, "Color saved to HueMemory.")
});

refreshTaskLibrary();

// Revoke the temporary preview URL and stop the camera when the page closes.
window.addEventListener("pagehide", () => {
  if (streaming) stopCamera();
  if (instructionImageUrl) URL.revokeObjectURL(instructionImageUrl);
});

// The editorial page is one continuous document; these links open the existing
// working mode panels without creating separate camera streams.
document.querySelectorAll("[data-open-mode]").forEach((link) => {
  link.addEventListener("click", () => setActiveMode(link.dataset.openMode));
});

const f1Reveals = [...document.querySelectorAll(".f1-reveal")];
if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) {
      entry.target.classList.add("is-shown");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.06 });
  f1Reveals.forEach((element) => observer.observe(element));
} else f1Reveals.forEach((element) => element.classList.add("is-shown"));

const scrollProgress = document.getElementById("scrollProgress");
function updateScrollProgress() {
  const range = document.documentElement.scrollHeight - window.innerHeight;
  if (scrollProgress) scrollProgress.style.width = `${range > 0 ? window.scrollY / range * 100 : 0}%`;
}
window.addEventListener("scroll", updateScrollProgress, { passive: true });
updateScrollProgress();
