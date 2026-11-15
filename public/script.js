import { analyzeVideoFrame } from "/src/vision/cameraProcessor.js";
import { classifyColor, TemporalMaskStabilizer } from "/src/vision/colorDetector.js";
import { selectDisplayRegions } from "/src/vision/regionPresentation.js";
import { findSmoothColorContours, SmoothContourTracker, pickFocusedContour } from "/src/vision/smoothContours.js";
import { calculateNeutralGains, neutralReferenceFromCenter } from "/src/vision/cameraCalibration.js";
import { closestReferenceShade } from "/src/vision/referenceColors.js";
import { sanitizeGeminiShade } from "/src/vision/shadeNaming.js";
import { describeDetailedShade, createShadeIdentityTracker } from "/src/vision/perceptualShade.js";
import { resolveFindShade, suggestFindShadeNames, findClosestVisibleShade, listFindShadeNames } from "/src/vision/hueFindSearch.js";
import { averagePixelRegion } from "/src/vision/sampleColor.js";
import { LiveObjectTracker } from "/src/vision/liveObjectTracker.js";
import { findHueDoColorRegions, isReliableHueDoOutline } from "/src/vision/hueDoColorGuide.js";
import { createFluidReading } from "/src/vision/fluidReading.js";
import {
  saveColor,
  createTask,
  loadTasks,
  completeTask,
  deleteTask,
  interpret,
  checkTask
} from "/js/huememory.js";
import {
  parseInstruction, buildGuideSteps, describeTask, describeTarget, cleanTaskSummary,
  normalizeRelation, normalizeColorName, isPlural, isSortTask, taskTypeOf, isMultiObjectTask
} from "/js/hueDoParser.js";
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
const findShadeBtn = $("findShadeBtn");
const findSuggestionDialog = $("findSuggestionDialog");
const findSuggestionTitle = $("findSuggestionTitle");
const findSuggestionText = $("findSuggestionText");
const findSuggestionOptions = $("findSuggestionOptions");
const findSuggestionClose = $("findSuggestionClose");
const findSuggestionKeep = $("findSuggestionKeep");
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
const refineShadeBtn = $("refineShadeBtn");
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
const themeToggle = $("themeToggle");
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
const taskSourceNote = $("taskSourceNote");
const taskKindSummary = $("taskKindSummary");
const taskSimpleFields = $("taskSimpleFields");
const taskReadback = $("taskReadback");
const taskColorInput = $("taskColorInput");
const taskObjectInput = $("taskObjectInput");
const taskActionInput = $("taskActionInput");
const taskDestinationInput = $("taskDestinationInput");
const taskAnswer = $("taskAnswer");
const snapshotBtn = $("snapshotBtn");
const clearSceneBtn = $("clearSceneBtn");
const checkPictureBtn = $("checkPictureBtn");
const hueDoShadeHint = $("hueDoShadeHint");
const hueDoCheckFeedback = $("hueDoCheckFeedback");
const readTaskBtn = $("readTaskBtn");
const taskStepsPreview = $("taskStepsPreview");
const guideStepCard = $("guideStepCard");
const guideStepCount = $("guideStepCount");
const guideStepText = $("guideStepText");
const guideDone = $("guideDone");
const guideDoneText = $("guideDoneText");
const prevStepBtn = $("prevStepBtn");
const repeatStepBtn = $("repeatStepBtn");
const soundToggle = $("soundToggle");
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
let targetStrictShade = false;
let findNoMatchFrames = 0;
let findSuggestionShown = false;
let pointerIsDown = false;
let pointerIsOverCanvas = false;
let keyboardSamplingActive = false;
let currentSample = null;
let pinnedSample = null;
let pinnedPosition = null;
let pinnedReferenceImage = null;
let geminiShade = null;
let geminiShadeBusy = false;
let geminiShadeRequestId = 0;
let geminiShadeAbort = null;
let pointerStart = null;
let lastSampleTime = 0;
let lastFrameAnalysis = 0;
let scanSceneRequested = false;
let hasScannedScene = false;
const steadyReading = createFluidReading();
const hueSeeShadeIdentity = createShadeIdentityTracker();
const SAMPLE_INTERVAL_MS = 32;
const FRAME_INTERVAL_MS = 180;
const FIND_INTERVAL_MS = 95;
const hueFindTracker = new SmoothContourTracker({ blend: .32, confirmationFrames: 2, holdFrames: 2 });
const hueDoColorTracker = new SmoothContourTracker({ blend: .42, confirmationFrames: 2, holdFrames: 1 });
const hueDoTrackers = { target: new LiveObjectTracker(), destination: new LiveObjectTracker() };
const hueDoMultiTrackers = []; // independent templates for objects in sort/group/match tasks
let hueDoLastResults = { target: null, destination: null };
let hueDoLastFrame = 0;
let hueDoHasVerifiedTarget = false;
let hueDoCheckReference = null;
let hueDoReferenceLabels = { target: "Target", destination: "Destination" };
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
let guideStepIndex = 0;
let scenePhoto = null;
let sceneLocations = [];
let soundOn = true;
try { soundOn = localStorage.getItem("hue-sound") !== "off"; } catch { /* storage disabled */ }
let activeTheme = "light";
try { activeTheme = localStorage.getItem("hue-theme") || (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"); } catch { /* storage disabled */ }

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const modeDescriptions = {
  see: "Identify colors in your camera view.",
  find: "Search for a shade and follow its outline.",
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

function updateColorChipToggleCopy() {
  if (!colorChipToggle) return;
  const noun = currentMode === "do" ? "guide labels" : "color labels";
  const action = showColorChips ? "Hide" : "Show";
  colorChipToggle.setAttribute("aria-label", `${action} ${noun}`);
  colorChipToggle.title = `${action} ${noun}`;
  if (colorChipToggleText) colorChipToggleText.textContent = `${action} ${noun}`;
}

function setActiveMode(mode) {
  const allowed = ["see", "find", "do", "memory"];
  const nextMode = allowed.includes(mode) ? mode : "see";
  if (currentMode !== nextMode) { hueFindTracker.reset(); focusedContourId = null; pendingFocusPoint = null; hueSeeShadeIdentity.reset(); }
  const leavingScene = currentMode === "do" && nextMode !== "do" && Boolean(scenePhoto);
  currentMode = nextMode;
  // Photo capture belongs exclusively to HueDo, even while the camera is live.
  snapshotBtn.hidden = nextMode !== "do";
  snapshotBtn.disabled = !streaming || nextMode !== "do";
  updateColorChipToggleCopy();
  if (leavingScene) {
    cameraFrame.classList.remove("is-scene");
    canvas.width = 320;
    canvas.height = video.videoWidth ? Math.max(1, Math.round(320 * video.videoHeight / video.videoWidth)) : 240;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setCameraChips([]);
  }
  const pageTitle = document.getElementById("pageTitle");
  const pageHint = document.getElementById("pageHint");
  if (pageTitle) {
    const words = { see: ["Hue", "See"], find: ["Hue", "Find"], do: ["Hue", "Do"], memory: ["Hue", "Memory"] };
    const [first, second] = words[nextMode];
    pageTitle.innerHTML = `${first}<span>${second}</span>`;
  }
  if (pageHint) pageHint.textContent = { see: "Move to inspect. Click or tap to pin.", find: "Choose a color to find its matching areas.", do: "Follow live target and destination markers.", memory: "Your saved colors and shades." }[nextMode];
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
  if (nextMode === "do") renderScene();
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

// Keep photo-check errors visible even while the live camera refreshes taskResult.
function showHueDoCheckFeedback(result = null) {
  if (!hueDoCheckFeedback) return;
  if (!result) {
    hueDoCheckFeedback.hidden = true;
    hueDoCheckFeedback.classList.remove("is-uncertain");
    hueDoCheckFeedback.textContent = "";
    return;
  }
  const uncertain = result.outcome === "uncertain";
  const label = uncertain ? "Can't verify yet" : "Task not completed";
  const detail = result.issues?.length ? ` ${result.issues.join(" ")}` : "";
  hueDoCheckFeedback.textContent = `${label}: ${result.message}${detail}`;
  hueDoCheckFeedback.classList.toggle("is-uncertain", uncertain);
  hueDoCheckFeedback.hidden = false;
}

function showHueDoObservedShade(region, query, { anchored = false } = {}) {
  if (!hueDoShadeHint) return;
  const requested = String(query || "").trim();
  const found = String(region?.observedShade || "").trim();
  if (!requested || !found || !region?.broadMatch) {
    hueDoShadeHint.hidden = true;
    hueDoShadeHint.textContent = "";
    return;
  }
  hueDoShadeHint.textContent = `Requested ${requested} → matched visible shade: ${found}. ${anchored ? "Color region is inside the suggested object." : "Possible matching color; confirm the object."}`;
  hueDoShadeHint.hidden = false;
}

function normalizeColorCategory(value = "") {
  const color = String(value).trim().toLowerCase();
  const supported = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "black", "white", "gray", "brown", "pink", "teal", "olive", "beige"];
  return supported.find((name) => color === name || color.includes(name)) || "";
}

const chipColors = {
  red: "#ee7772", orange: "#e9a16b", yellow: "#e8d16d", green: "#81b88d",
  cyan: "#7ccbc6", blue: "#7e9fdf", purple: "#b59ad9", black: "#68716d",
  gray: "#808080", white: "#ffffff", brown: "#8b4513", pink: "#ffc0cb",
  teal: "#008080", olive: "#808000", beige: "#f5f5dc"
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
    label: region.rgb ? describeDetailedShade(region.rgb).name : region.name,
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
    color: targetColor, rgb: targetRgb, strictShade: targetStrictShade, minAreaFraction: .015,
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
    if (!focusedContourId && !pendingFocusPoint && !findSuggestionShown && currentMode === "find") {
      findNoMatchFrames++;
      // Wait for a few seconds of stable no-match evidence before suggesting another camera color.
      if (findNoMatchFrames >= 27) {
        findSuggestionShown = true;
        const alternative = findClosestVisibleShade(frame, targetRgb || resolveFindShade(targetShade)?.rgb);
        showFindSuggestions("not-visible", targetShade || targetColor, alternative ? [alternative] : []);
      }
    }
    setFeedback(findResult, focusedContourId ? "Object temporarily lost. Keep it in view or tap another object."
      : pendingFocusPoint ? "No matching region at that point. Tap the object again."
      : `Looking for ${targetShade || targetColor}…${findSuggestionShown ? " Try a suggested alternative if needed." : ""}`);
    return;
  }
  findNoMatchFrames = 0;

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
    hueSeeShadeIdentity.reset();
    pinnedReferenceImage = null;
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
    snapshotBtn.disabled = currentMode !== "do";
    refreshGuideStatus();
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
  clearGeminiShade();
  latestColors = [];
  currentSample = null;
  pinnedSample = null;
  pinnedPosition = null;
  pinnedReferenceImage = null;
  steadyReading.reset();
  hueSeeShadeIdentity.reset();
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
  colorSelect.disabled = false;
  scanSceneBtn.disabled = true;
  snapshotBtn.disabled = true;
  sampleFindBtn.disabled = true;
  refreshGuideStatus();

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
  renderScene();
}

function processLoop(time = 0) {
  if (!streaming) return;

  try {
    if (currentMode === "do") {
      // Track the seeded target/destination continuously while the webcam stays live.
      if (time - hueDoLastFrame >= 80) {
        hueDoLastFrame = time;
        drawHueDoLiveOverlay();
      }
    } else {
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
            renderDetectedColors(currentMode === "see"
              ? latestColors.map(group => ({ ...group, name: group.regions?.[0]?.rgb
                  ? describeDetailedShade(group.regions[0].rgb).name : group.name }))
              : latestColors);
            scanSceneBtn.textContent = "Scan scene";
          }
          scanSceneRequested = false;

          if (currentMode === "see") showHueSeeRegionLabels(latestColors);
          else if (currentMode === "find" && targetColor) drawTargetOverlay();
          else setCameraChips([]);
        }
      }
    }

    if (currentMode !== "do" && !pinnedSample && (pointerIsOverCanvas || pointerIsDown || keyboardSamplingActive) &&
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
    const displayShade = hueSeeShadeIdentity.observe(sample.rgb, point, { immediate });
    const nextSample = {
      ...sample,
      displayShade,
      source,
      position: { x: point.x, y: point.y }
    };

    const changed = !currentSample || currentSample.hex !== nextSample.hex || currentSample.name !== nextSample.name || currentSample.displayShade?.name !== nextSample.displayShade?.name;
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
  sampleName.textContent = (sample.displayShade || describeDetailedShade(sample.rgb)).name;
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
  refineShadeBtn.disabled = !streaming || !pinned || geminiShadeBusy;
  refineShadeBtn.textContent = geminiShadeBusy ? "Checking shade…" : "Refine shade with Gemini";
  setFeedback(readingStatus, pinned
    ? `Pinned ${(pinnedSample.displayShade || describeDetailedShade(pinnedSample.rgb)).name} (${pinnedSample.hex}). Recheck with Gemini under different lighting.`
    : "Hover to explore. Click or tap to pin the color you want to keep.");
}

function pinReading(point = lastSamplePosition) {
  if (!streaming) return;
  clearGeminiShade();
  if (pinnedSample) {
    pinnedSample = null;
    pinnedPosition = null;
    pinnedReferenceImage = null;
    hueSeeShadeIdentity.reset();
    steadyReading.reset();
    if (currentSample) renderSample(currentSample);
    sampleIndicator.classList.remove("is-visible");
    sampleReticle.classList.remove("is-visible");
    updatePinState();
    return;
  }
  if (point) sampleImagePoint(point, "pin", { immediate: true });
  if (!currentSample) return;
  // Keep a reference crop from pin time for optional lighting/surface comparison.
  try { pinnedReferenceImage = capturePinnedShadeCrop(point || currentSample.position); }
  catch { pinnedReferenceImage = null; }
  pinnedSample = {
    name: currentSample.name,
    hex: currentSample.hex,
    rgb: { ...currentSample.rgb },
    displayShade: currentSample.displayShade || describeDetailedShade(currentSample.rgb),
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

// Gemini is opt-in: only small still-image crops are sent after the user clicks the button.
function clearGeminiShade() {
  geminiShadeRequestId += 1;
  geminiShadeAbort?.abort();
  geminiShadeAbort = null;
  geminiShadeBusy = false;
  geminiShade = null;
}

function capturePinnedShadeCrop(point) {
  if (!streaming || !video.videoWidth || !video.videoHeight || !point) {
    throw new Error("Start the camera and pin a color first.");
  }
  const side = Math.min(video.videoWidth, video.videoHeight) * .27;
  const sx = clamp(point.x * video.videoWidth - side / 2, 0, video.videoWidth - side);
  const sy = clamp(point.y * video.videoHeight - side / 2, 0, video.videoHeight - side);
  const crop = document.createElement("canvas");
  crop.width = 224;
  crop.height = 224;
  crop.getContext("2d").drawImage(video, sx, sy, side, side, 0, 0, 224, 224);
  return { mimeType: "image/jpeg", data: crop.toDataURL("image/jpeg", .78).split(",")[1] };
}

function captureCurrentPinnedRgb() {
  const point = pinnedPosition || pinnedSample?.position;
  if (!point || !streaming || !video.videoWidth || !video.videoHeight) return null;
  const image = document.createElement("canvas");
  image.width = 224; image.height = 224;
  const imageContext = image.getContext("2d", { willReadFrequently: true });
  imageContext.drawImage(video, 0, 0, 224, 224);
  const cx = clamp(Math.floor(point.x * 224), 4, 219);
  const cy = clamp(Math.floor(point.y * 224), 4, 219);
  return averagePixelRegion(imageContext.getImageData(cx - 4, cy - 4, 9, 9));
}

refineShadeBtn.addEventListener("click", async () => {
  if (!pinnedSample || geminiShadeBusy || currentMode !== "see") return;
  const reading = pinnedSample;
  const requestId = ++geminiShadeRequestId;
  geminiShadeBusy = true;
  geminiShadeAbort = new AbortController();
  let finalFeedback = "";
  updatePinState();
  setFeedback(readingStatus, "Gemini is comparing your pinned shade with the current camera lighting. Two small photo crops may be sent to Google.");
  try {
    const image = capturePinnedShadeCrop(pinnedPosition || reading.position);
    const currentRgb = captureCurrentPinnedRgb();
    const response = await fetch("/api/shades", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image, rgb: reading.rgb, referenceImage: pinnedReferenceImage,
        currentRgb, previousShadeName: geminiShade?.name || "" }),
      signal: geminiShadeAbort.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Gemini unavailable (${response.status}).`);
    const suggestion = sanitizeGeminiShade({ shadeName: result.name, note: result.note });
    if (!suggestion) throw new Error("Gemini did not return a usable shade name.");
    if (requestId !== geminiShadeRequestId || pinnedSample !== reading) return;
    if (result.sameSurface !== "no") {
      geminiShade = { ...suggestion, hex: reading.hex, confidence: result.confidence,
        sameSurface: result.sameSurface, lightingChanged: result.lightingChanged,
        identityHeld: result.identityHeld, needsConfirmation: result.needsConfirmation };
    }
    renderSample(reading);
    finalFeedback = result.sameSurface === "no"
      ? `Gemini sees a different surface; the original pinned shade remains ${(reading.displayShade || describeDetailedShade(reading.rgb)).name}. Re-pin the intended object if it moved.`
      : `Gemini suggests ${suggestion.name} (${result.confidence || "low"} confidence). ${result.identityHeld ? "Shade identity retained across lighting. " : ""}${result.sameSurface === "uncertain" ? "Object identity uncertain; verify the surface. " : ""}${suggestion.note}`;
  } catch (error) {
    if (requestId === geminiShadeRequestId && pinnedSample === reading) {
      finalFeedback = error.name === "AbortError"
        ? "Gemini shade check cancelled; local shade detection still works."
        : `${error.message} Local shade detection still works.`;
    }
  } finally {
    if (requestId === geminiShadeRequestId) {
      geminiShadeBusy = false;
      geminiShadeAbort = null;
      updatePinState();
      if (finalFeedback) setFeedback(readingStatus, finalFeedback);
    }
  }
});

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
  const shade = sample.displayShade || describeDetailedShade(sample.rgb);
  if (shade.name === "Unknown") return "Outside supported categories";
  if (shade.family === "Black") return "Very dark neutral";
  if (shade.family === "White") return "Very light neutral";
  if (shade.family === "Gray") return "Low-saturation neutral";

  const lightness = hsl.l < 20 ? "Very dark" :
    hsl.l < 40 ? "Dark" :
    hsl.l < 60 ? "Medium" :
    hsl.l < 80 ? "Light" : "Very light";
  const saturation = hsl.s < 20 ? "muted" :
    hsl.s < 45 ? "soft" :
    hsl.s < 70 ? "moderate" : "vivid";
  return `${lightness}, ${saturation} ${shade.name.toLowerCase()}`;
}

function renderColorDetails(sample) {
  const { r, g, b } = sample.rgb;
  const hsl = rgbToHsl(r, g, b);

  colorPreview.style.backgroundColor = sample.hex;
  const shade = sample.displayShade || describeDetailedShade(sample.rgb);
  colorNameDisplay.textContent = shade.name;
  const nearest = closestReferenceShade(sample.rgb);
  colorDescription.textContent = "Camera estimate: " + getPlainLanguageDescription(sample, hsl) +
    (nearest ? ` · closest CSS shade: ${nearest}` : "") +
    (shade.lightingHeld ? " · Shade identity retained through a lighting change; HEX/RGB are measured values" : "") +
    (geminiShade?.hex === sample.hex ? ` · Gemini suggests: ${geminiShade.name} (${geminiShade.confidence || "low"} confidence)${geminiShade.note ? ` · ${geminiShade.note}` : ""}${geminiShade.needsConfirmation ? " · Verify under neutral lighting" : ""}` : "");
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
  if (showingScene()) return;
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
  if (!streaming || !["see", "find"].includes(currentMode)) return;
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
  if (currentMode !== "see") return;
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
  if (!streaming || !["see", "find"].includes(currentMode) || pointerIsDown || pinnedSample) return;
  keyboardPosition = { x: .5, y: .5 };
  keyboardSamplingActive = true;
  const point = { ...keyboardPosition, ...getStagePositionForImagePoint(keyboardPosition.x, keyboardPosition.y) };
  lastSamplePosition = point;
  sampleImagePoint(point, "keyboard", { immediate: true });
});

canvas.addEventListener("keydown", (event) => {
  if (!streaming || !["see", "find"].includes(currentMode)) return;
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
  const shadeName = (sample.displayShade || describeDetailedShade(sample.rgb)).name;
  speak(shadeName);
}

speakDetailsBtn.addEventListener("click", () => {
  if (currentSample) announceSample(currentSample);
});

saveColorBtn.addEventListener("click", async () => {
  if (!pinnedSample || saveColorBtn.disabled) return;
  saveColorBtn.disabled = true;
  const detailedName = (pinnedSample.displayShade || describeDetailedShade(pinnedSample.rgb)).name;
  const snapshot = { ...pinnedSample, rgb: { ...pinnedSample.rgb }, shade: `${detailedName} ${pinnedSample.hex}` };
  setFeedback(saveColorStatus, "Saving…");
  try {
    await saveColor(snapshot);
    setFeedback(saveColorStatus, `${detailedName} ${snapshot.hex} saved to HueMemory.`);
    speak(`${detailedName} saved to your color palette.`);
  } catch (error) {
    setFeedback(saveColorStatus, error.message || "Could not save this color.");
  } finally {
    saveColorBtn.disabled = !pinnedSample || pinnedSample.name === "Unknown";
  }
});

function applyTheme(theme, persist = false) {
  activeTheme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = activeTheme;
  document.documentElement.style.colorScheme = activeTheme;
  const dark = activeTheme === "dark";
  if (themeToggle) {
    themeToggle.setAttribute("aria-pressed", String(dark));
    themeToggle.setAttribute("aria-label", dark ? "Turn dark mode off" : "Turn dark mode on");
    themeToggle.querySelector("span:first-child").textContent = dark ? "☀" : "☾";
    themeToggle.querySelector("span:last-child").textContent = dark ? "Light mode" : "Dark mode";
  }
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = dark ? "#171d1b" : "#f7f4ec";
  if (persist) {
    try { localStorage.setItem("hue-theme", activeTheme); } catch { /* storage disabled */ }
  }
}
applyTheme(activeTheme);
themeToggle?.addEventListener("click", () => applyTheme(activeTheme === "dark" ? "light" : "dark", true));

colorChipToggle.addEventListener("click", () => {
  showColorChips = !showColorChips;
  colorChipToggle.setAttribute("aria-pressed", String(showColorChips));
  updateColorChipToggleCopy();
  if (currentMode === "see") showHueSeeRegionLabels(latestColors);
  else if (currentMode === "do" && !streaming) renderScene();
  else if (!showColorChips) setCameraChips([]);
});

function closeFindSuggestions() {
  if (findSuggestionDialog?.open) findSuggestionDialog.close();
}

function showFindSuggestions(reason, requested, choices = []) {
  if (!findSuggestionDialog) return;
  findSuggestionOptions.replaceChildren();
  const unknown = reason === "unknown";
  findSuggestionTitle.textContent = unknown ? "Shade name not recognized" : "That shade isn't visible yet";
  findSuggestionText.textContent = unknown
    ? `We couldn't match “${requested}” to a known shade name. Choose a similar catalog name, or try a HEX value.`
    : choices.length
      ? `No stable outline for “${requested}” was found. Here's the closest substantial color area detected in the live camera. It's only an approximate match.`
      : `No substantial “${requested}” region was found. Move the camera, improve lighting, or try another color name.`;
  for (const choice of choices) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "hue-find-suggestion-option";
    const swatch = document.createElement("span");
    swatch.className = "hue-find-suggestion-swatch";
    swatch.style.backgroundColor = choice.hex;
    swatch.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = choice.name;
    const details = document.createElement("small");
    details.textContent = unknown ? `Catalog shade · ${choice.hex}`
      : `Closest camera color · ${choice.hex}${choice.distance > 25 ? " · weak similarity" : ""}`;
    copy.append(title, details);
    option.append(swatch, copy);
    option.addEventListener("click", () => {
      closeFindSuggestions();
      setFindTarget(choice.name, true, unknown ? null : { rgb: choice.rgb, shade: choice.name });
    });
    findSuggestionOptions.append(option);
  }
  if (!choices.length && unknown) {
    const help = document.createElement("p");
    help.textContent = "Try a simpler shade name like olive green, a specific HEX (#9CAF88), or RGB (156, 175, 136).";
    findSuggestionOptions.append(help);
  }
  if (!findSuggestionDialog.open) findSuggestionDialog.showModal();
}
findSuggestionClose?.addEventListener("click", closeFindSuggestions);
findSuggestionKeep?.addEventListener("click", closeFindSuggestions);
findSuggestionDialog?.addEventListener("click", event => {
  if (event.target === findSuggestionDialog) closeFindSuggestions();
});

function setFindTarget(value, shouldSpeak = true, colorReference = null) {
  const text = String(value || "").trim();
  let shade = resolveFindShade(text);
  if (colorReference?.rgb && [colorReference.rgb.r, colorReference.rgb.g, colorReference.rgb.b].every(Number.isFinite)) {
    const sampled = colorReference.rgb;
    const detail = describeDetailedShade(sampled);
    shade = { ok: true, name: colorReference.shade || detail.name, rgb: sampled,
      family: detail.family, broad: false };
  }
  if (text && !shade.ok) {
    targetColor = "";
    targetRgb = null;
    targetShade = "";
    targetStrictShade = false;
    clearVectorOutline();
    setCameraChips([]);
    hueFindTracker.reset();
    findSuggestionShown = true;
    findNoMatchFrames = 0;
    colorSelect.value = text;
    showFindSuggestions("unknown", text, shade.suggestions || suggestFindShadeNames(text));
    setFeedback(findResult, `“${text}” isn't in the shade catalog. Select a suggestion or enter a HEX value.`);
    return;
  }
  targetColor = shade.ok ? shade.family.toLowerCase() : "";
  targetRgb = shade.ok && !shade.broad ? shade.rgb : null;
  targetStrictShade = Boolean(shade.ok && !shade.broad);
  targetShade = shade.ok ? shade.name : "";
  colorSelect.value = shade.ok ? (colorReference?.shade || shade.name) : "";
  findNoMatchFrames = 0;
  findSuggestionShown = false;
  hueFindTracker.reset();
  focusedContourId = null;
  pendingFocusPoint = null;
  clearVectorOutline();
  setCameraChips([]);
  if (!targetColor) {
    targetRgb = null;
    targetShade = "";
    setFeedback(findResult, "Type a color or shade name to begin.");
    return;
  }
  const label = targetShade || targetColor;
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
    const sample = describeDetailedShade(rgb);
    if (sample.family === "Unknown") {
      setFeedback(findResult, "Choose a color first, or tap an object."); return;
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
  focusedContourId = null;
  pendingFocusPoint = null;
  targetColor = "";
  targetRgb = null;
  targetShade = "";
  targetStrictShade = false;
  findNoMatchFrames = 0;
  findSuggestionShown = false;
  hueFindTracker.reset();
  colorSelect.value = "";
  closeFindSuggestions();
  clearVectorOutline();
  setCameraChips([]);
  setFeedback(findResult, "Color cleared. Search for another shade or tap an object in the camera.");
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

findShadeBtn?.addEventListener("click", () => setFindTarget(colorSelect.value));
colorSelect.addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); setFindTarget(colorSelect.value); }
});
sampleFindBtn.addEventListener("click", () => {
  if (currentSample) {
    const shadeName = (currentSample.displayShade || describeDetailedShade(currentSample.rgb)).name;
    setFindTarget(shadeName, true, { ...currentSample, shade: shadeName });
  }
});
clearFindBtn.addEventListener("click", () => {
  targetColor = "";
  targetRgb = null;
  targetShade = "";
  targetStrictShade = false;
  findNoMatchFrames = 0;
  findSuggestionShown = false;
  closeFindSuggestions();
  colorSelect.value = "";
  clearVectorOutline();
  focusedContourId = null; pendingFocusPoint = null;
  hueFindTracker.reset();
  setFeedback(findResult, "Type a color or shade name to begin.");
});

// HueDo uses a reference frame for semantic detection, then follows its target live on webcam frames.
const SCENE_MAX_WIDTH = 1280;

function showSoundState() {
  soundToggle.setAttribute("aria-pressed", String(soundOn));
  soundToggle.setAttribute("aria-label", soundOn ? "Turn sound off" : "Turn sound on");
  soundToggle.querySelector("span:first-child").textContent = soundOn ? "🔊" : "🔇";
  soundToggle.querySelector("span:last-child").textContent = soundOn ? "Sound on" : "Sound off";
}
soundToggle.addEventListener("click", () => {
  soundOn = !soundOn;
  try { localStorage.setItem("hue-sound", soundOn ? "on" : "off"); } catch { /* storage disabled */ }
  if (!soundOn && "speechSynthesis" in window) window.speechSynthesis.cancel();
  showSoundState();
  if (soundOn) speak("Sound on.");
});
showSoundState();

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read that picture."));
    image.src = src;
  });
}

// Draws any image source to a JPEG no wider than SCENE_MAX_WIDTH and returns a scene picture.
async function makeScene(source, sourceWidth, sourceHeight, origin, name = "") {
  const scale = Math.min(1, SCENE_MAX_WIDTH / Math.max(sourceWidth, sourceHeight, 1));
  const still = document.createElement("canvas");
  still.width = Math.max(1, Math.round(sourceWidth * scale));
  still.height = Math.max(1, Math.round(sourceHeight * scale));
  const stillContext = still.getContext("2d");
  stillContext.fillStyle = "#fff";
  stillContext.fillRect(0, 0, still.width, still.height);
  stillContext.drawImage(source, 0, 0, still.width, still.height);
  const dataUrl = still.toDataURL("image/jpeg", 0.85);
  const image = await loadImage(dataUrl);
  return {
    mimeType: "image/jpeg",
    data: dataUrl.split(",")[1],
    dataUrl,
    image,
    width: still.width,
    height: still.height,
    origin,
    name
  };
}

function captureCameraScene() {
  if (!streaming || !video.videoWidth || !video.videoHeight) return Promise.resolve(null);
  return makeScene(video, video.videoWidth, video.videoHeight, "camera");
}

async function fileToScene(file) {
  if (file.type && !file.type.startsWith("image/")) throw new Error("Choose an image file.");
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    return await makeScene(image, image.naturalWidth, image.naturalHeight, "upload", file.name);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function showingScene() {
  return currentMode === "do" && Boolean(scenePhoto) && !streaming;
}

function setScenePhoto(scene, { keepLocations = false } = {}) {
  scenePhoto = scene;
  if (!keepLocations) { sceneLocations = []; resetHueDoTracking(); }
  instructionImagePreview.replaceChildren();
  if (scene) {
    const image = document.createElement("img");
    image.src = scene.dataUrl;
    image.alt = "Picture HueDo will use";
    instructionImagePreview.append(image);
  }
  instructionImagePreview.hidden = !scene;
  clearSceneBtn.hidden = !scene;
  instructionFileName.textContent = !scene
    ? "No picture yet"
    : scene.origin === "camera" ? "Picture taken with the camera" : scene.name || "Uploaded picture";
  interpretStatus.classList.remove("is-error");
  renderScene();
}

function drawCircleAround(rect, accent) {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const radiusX = rect.width / 2 * 1.2 + 6;
  const radiusY = rect.height / 2 * 1.15 + 6;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(8,16,13,.8)";
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = accent;
  ctx.stroke();
  ctx.restore();
}

function drawAreaBox(rect, accent, fill = "") {
  ctx.save();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
  ctx.setLineDash([4, 5]);
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = "rgba(8,16,13,.78)";
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = accent;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

function resetHueDoTracking() {
  hueDoTrackers.target.reset();
  hueDoTrackers.destination.reset();
  hueDoMultiTrackers.splice(0).forEach((item) => item.tracker.reset());
  hueDoColorTracker.reset();
  hueDoLastResults = { target: null, destination: null };
  hueDoLastFrame = 0;
  hueDoHasVerifiedTarget = false;
  hueDoReferenceLabels = { target: "Target", destination: "Destination" };
  clearVectorOutline();
}

function seedHueDoTrackers() {
  resetHueDoTracking();
  if (!scenePhoto?.image) return false;
  const width = 320;
  const height = Math.max(1, Math.round(width * scenePhoto.height / scenePhoto.width));
  samplingCanvas.width = width;
  samplingCanvas.height = height;
  samplingContext.drawImage(scenePhoto.image, 0, 0, width, height);
  const referenceFrame = samplingContext.getImageData(0, 0, width, height);
  const targetLocations = sceneLocations.filter((location) => location.role === "target").slice(0, 16);
  const target = targetLocations[0];
  const destination = sceneLocations.find((location) => location.role === "destination");
  if (isMultiObjectTask(activeTask) && targetLocations.length > 1) {
    targetLocations.forEach((location) => {
      const tracker = new LiveObjectTracker();
      tracker.seed(referenceFrame, location.box);
      hueDoMultiTrackers.push({ tracker, label: location.label || "item" });
    });
  }
  if (target) {
    hueDoTrackers.target.seed(referenceFrame, target.box);
    hueDoReferenceLabels.target = target.label || targetLabel();
  }
  if (destination) {
    hueDoTrackers.destination.seed(referenceFrame, destination.box);
    hueDoReferenceLabels.destination = destination.label || destinationLabel();
  }
  return Boolean(target || destination);
}

// Grouping/matching has MULTIPLE relevant objects. Keep an independent
// visual template for each one instead of drawing just the first "target".
// Local contours indicate matching pixels, while dotted boxes are only
// Gemini-suggested objects and must not be claimed as verified color matches.
const hueDoCatalogPhrases = listFindShadeNames().sort((a, b) => b.length - a.length)
  .map(name => ({ name, phrase: ` ${name.toLowerCase().replace(/[^a-z]+/g, " ").trim()} ` }));

function inferGroupColor(label = "") {
  const words = String(label).toLowerCase().trim();
  if (!words) return "";
  const shade = resolveFindShade(words);
  if (shade.ok) return words;
  const padded = ` ${words.replace(/[^a-z]+/g, " ").trim()} `;
  const nestedShade = hueDoCatalogPhrases.find(entry => padded.includes(entry.phrase));
  if (nestedShade) return nestedShade.name;
  const common = ["dark blue", "light blue", "navy blue", "lime green", "olive green", "sky blue",
    "orange", "yellow", "green", "blue", "red", "pink", "purple", "brown", "black", "white", "gray", "grey", "teal", "cyan"];
  return common.find((word) => new RegExp(`\\b${word.replace(/ /g, "\\s+")}\\b`, "i").test(words)) || "";
}

function drawHueDoGroupOverlay(frame, width, height) {
  if (!hueDoMultiTrackers.length) return false;
  const chips = [];
  const verifiedPaths = [];
  let visibleCount = 0;
  let colorMatchCount = 0;
  let firstObserved = null;
  for (const item of hueDoMultiTrackers) {
    const detection = item.tracker.update(frame);
    if (!detection?.visible || !detection.bounds) continue;
    visibleCount += 1;
    const color = inferGroupColor(item.label);
    const regions = color ? findHueDoColorRegions(frame, color, {
      roiBounds: detection.bounds, whiteBalance: neutralGains
    }) : [];
    const match = regions.find((region) => region?.points?.length >= 4);
    if (match) {
      verifiedPaths.push(contourSplinePath(match.points));
      colorMatchCount += 1;
      firstObserved ??= { match, query: color };
    } else {
      // This is the object template, not proof of its label's color.
      drawAreaBox(detection.bounds, "#f3d49a", "rgba(243,212,154,.025)");
    }
    const center = detection.center || { x: detection.bounds.x + detection.bounds.width / 2,
      y: detection.bounds.y + detection.bounds.height / 2 };
    chips.push({
      key: `huedo-group-${chips.length}`,
      label: `${match ? "COLOR REGION" : "POSSIBLE ITEM"} · ${item.label}${match?.broadMatch && match.observedShade ? ` (camera: ${match.observedShade})` : ""}`,
      hex: match ? "#9be3c2" : "#f3d49a",
      point: { x: center.x, y: Math.max(0, detection.bounds.y - 5) }
    });
  }
  const paths = verifiedPaths.join(" ");
  hueFindPath?.setAttribute("d", paths);
  hueFindPathShadow?.setAttribute("d", paths);
  hueDoHasVerifiedTarget = colorMatchCount > 0;
  showHueDoObservedShade(firstObserved?.match, firstObserved?.query, { anchored: true });
  setCameraChips(showColorChips ? chips : []);
  setFeedback(taskResult, visibleCount
    ? `Tracking ${visibleCount} of ${hueDoMultiTrackers.length} suggested items. ${colorMatchCount} color region(s) outlined. Labels and dotted boxes require visual confirmation before grouping.`
    : "The grouped items are not currently tracked. Rebuild the guide with all items visible.");
  return true;
}

function drawHueDoLiveOverlay() {
  if (!streaming || currentMode !== "do" || !video.videoWidth || video.readyState < 2) return;
  const width = 320;
  const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  samplingCanvas.width = width;
  samplingCanvas.height = height;
  samplingContext.drawImage(video, 0, 0, width, height);
  const frame = samplingContext.getImageData(0, 0, width, height);

  ctx.clearRect(0, 0, width, height);
  clearVectorOutline();
  if (!activeTask) {
    setCameraChips([]);
    return;
  }

  hueFindVectorOverlay?.setAttribute("viewBox", `0 0 ${width} ${height}`);
  if (isMultiObjectTask(activeTask) && drawHueDoGroupOverlay(frame, width, height)) return;
  const targetResult = hueDoTrackers.target.update(frame);
  const destinationResult = hueDoTrackers.destination.update(frame);
  const objectTarget = targetResult?.visible ? { ...targetResult, source: "object" } : null;
  const destination = destinationResult?.visible ? { ...destinationResult, source: "object" } : null;

  // A semantic Gemini/template bounding box identifies a likely object, not
  // proof that every pixel inside it is the specified COLOR. For a color task,
  // draw only the isolated, pixel-verified shade contour. Do not fall back to
  // a whole-object rectangle when the requested shade is absent.
  let target = null;
  if (activeTask.color) {
    // Gemini's boxes can drift or be absent. Use the tracked object ROI when
    // available, but if it is lost allow a COLOR-ONLY candidate to be shown
    // rather than silently drawing nothing. The label below distinguishes it.
    let matches = findHueDoColorRegions(frame, activeTask.color, {
      roiBounds: objectTarget?.bounds || null,
      whiteBalance: neutralGains
    });
    let anchoredToObject = Boolean(objectTarget && matches.length);
    // A bounding box can miss the actual pen after camera motion. Recover a
    // candidate from the wider frame, but NEVER label it as the verified pen.
    if (!matches.length && objectTarget) {
      matches = findHueDoColorRegions(frame, activeTask.color, { whiteBalance: neutralGains });
      anchoredToObject = false;
    }
    if (matches.length) {
      const stable = hueDoColorTracker.update(matches, width, height)[0];
      if (stable) {
        const closest = matches.slice().sort((a, b) => Math.hypot(a.center.x - stable.center.x, a.center.y - stable.center.y) -
          Math.hypot(b.center.x - stable.center.x, b.center.y - stable.center.y))[0];
        target = { ...stable, source: "color", visible: true, anchoredToObject,
          observedShade: closest?.observedShade, broadMatch: closest?.broadMatch };
      }
    } else {
      hueDoColorTracker.reset();
    }
  } else {
    target = objectTarget;
  }

  showHueDoObservedShade(target, activeTask.color, { anchored: Boolean(target?.anchoredToObject) });
  hueDoHasVerifiedTarget = activeTask.color
    ? isReliableHueDoOutline(target)
    : Boolean(target?.visible && target.source === "object");
  const chips = [];
  let targetCenter = null;
  let destinationCenter = null;
  if (target) {
    targetCenter = target.center;
    const rect = target.bounds;
    if (target.source === "color") {
      drawSmoothTargetContour(target.points);
    } else {
      drawAreaBox(rect, "#f5df91", "rgba(245,223,145,.08)");
      drawCircleAround(rect, "#f5df91");
    }
    chips.push({
      key: "huedo-live-target",
      label: `${target.source === "color"
        ? (target.anchoredToObject ? "COLOR MATCH · " : "POSSIBLE COLOR · ") : "TARGET · "}${target?.broadMatch && target.observedShade ? target.observedShade : (activeTask.color || hueDoReferenceLabels.target || targetLabel())}`,
      hex: target.source === "color" ? "#9be3c2" : "#f5df91",
      point: { x: targetCenter.x, y: Math.max(0, rect.y - 5) }
    });
  } else if (!activeTask.color && hueDoTrackers.target.template) {
    const last = targetResult?.bounds || hueDoTrackers.target.bounds;
    if (last) drawAreaBox(last, "#efb18e", "rgba(239,177,142,.04)");
  }

  if (destination) {
    destinationCenter = destination.center;
    drawAreaBox(destination.bounds, activeTask.completed ? "#8fe0b0" : "#8fc7ee", "rgba(143,199,238,.10)");
    chips.push({
      key: "huedo-live-destination",
      label: `DESTINATION · ${hueDoReferenceLabels.destination || destinationLabel()}`,
      hex: activeTask.completed ? "#8fe0b0" : "#8fc7ee",
      point: { x: destinationCenter.x, y: Math.max(0, destination.bounds.y - 5) }
    });
  } else if (hueDoTrackers.destination.template) {
    const last = destinationResult?.bounds || hueDoTrackers.destination.bounds;
    if (last) drawAreaBox(last, "#8fc7ee", "rgba(143,199,238,.04)");
  }

  if (targetCenter && destinationCenter && currentStep()?.kind === "place" && !activeTask.completed) {
    drawArrow(targetCenter, destinationCenter, "#f4d989");
  }
  setCameraChips(showColorChips ? chips : []);

  const targetWasDetected = Boolean(hueDoTrackers.target.template);
  const message = target
    ? destination
      ? "Live tracking: follow the arrow from the target to the destination."
      : target.source === "color"
        ? `${target.anchoredToObject ? "Tracked" : "Possible"} ${activeTask.color} color match${target.broadMatch && target.observedShade ? ` (camera shade: ${target.observedShade})` : ""}. Confirm the outlined region is the requested ${activeTask.object || "object"}.`
        : `Live tracking ${hueDoReferenceLabels.target || targetLabel()}. Keep it in view as you move.`
    : targetWasDetected && !activeTask.color
      ? `Target not in view. Move the camera slowly to reacquire ${hueDoReferenceLabels.target || targetLabel()}.`
      : activeTask.color
        ? `Looking for a ${activeTask.color} area. Move the camera closer and check that the outline matches the object.`
        : "Live camera is on. Retake the starting picture with the target clearly visible to add a live outline.";
  setFeedback(taskResult, message);
}

// Shows the picture in the camera area with circles around what Gemini found.
function renderScene() {
  if (streaming && currentMode === "do") {
    cameraFrame.classList.remove("is-scene");
    cameraPlaceholder.classList.add("is-hidden");
    sampleIndicator.classList.remove("is-visible");
    drawHueDoLiveOverlay();
    return;
  }
  if (!showingScene()) {
    cameraFrame.classList.remove("is-scene");
    if (!streaming) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      cameraPlaceholder.classList.remove("is-hidden");
      if (currentMode === "do") setCameraChips([]);
    }
    return;
  }

  cameraFrame.classList.add("is-scene");
  cameraPlaceholder.classList.add("is-hidden");
  sampleIndicator.classList.remove("is-visible");
  canvas.width = scenePhoto.width;
  canvas.height = scenePhoto.height;
  ctx.drawImage(scenePhoto.image, 0, 0, canvas.width, canvas.height);

  // Draw overlays in a 320-wide coordinate space so line widths match the live view.
  const k = canvas.width / 320;
  const width = 320;
  const height = canvas.height / k;
  const chips = [];
  let targetCenter = null;
  let destinationCenter = null;

  ctx.save();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  let photoColorRegions = [];
  if (activeTask?.color) {
    const targetLocation = sceneLocations.find(item => item.role === "target" && item.box);
    samplingCanvas.width = width;
    samplingCanvas.height = Math.round(height);
    samplingContext.drawImage(scenePhoto.image, 0, 0, width, samplingCanvas.height);
    photoColorRegions = findHueDoColorRegions(
      samplingContext.getImageData(0, 0, width, samplingCanvas.height), activeTask.color, {
        roiBounds: targetLocation ? {
          x: targetLocation.box.x * width, y: targetLocation.box.y * height,
          width: targetLocation.box.width * width, height: targetLocation.box.height * height
        } : null,
        whiteBalance: neutralGains
      }).slice(0, 1);
    if (photoColorRegions.length) showHueDoObservedShade(photoColorRegions[0], activeTask.color, { anchored: Boolean(targetLocation) });
    if (photoColorRegions.length) {
      const p = new Path2D(contourSplinePath(photoColorRegions[0].points));
      ctx.strokeStyle = "rgba(8,16,13,.88)";
      ctx.lineWidth = 4.5;
      ctx.stroke(p);
      ctx.strokeStyle = "#f5e6a1";
      ctx.lineWidth = 2.4;
      ctx.stroke(p);
    }
  }
  sceneLocations.forEach((location, index) => {
    const rect = {
      x: location.box.x * width,
      y: location.box.y * height,
      width: location.box.width * width,
      height: location.box.height * height
    };
    const center = location.role === "target" && activeTask?.color && photoColorRegions.length
      ? photoColorRegions[0].center
      : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const done = Boolean(activeTask?.completed);
    if (location.role === "destination") {
      drawAreaBox(rect, done ? "#8fe0b0" : "#f4d78c", done ? "rgba(143,224,176,.18)" : "");
      destinationCenter ??= center;
    } else if (location.role === "target" && activeTask?.color) {
      // The model's region may include neighboring colors. Never draw it as
      // a color outline; only the verified contour above is highlighted.
      if (photoColorRegions.length) targetCenter ??= photoColorRegions[0].center;
      else return;
    } else {
      drawCircleAround(rect, location.role === "target" ? "#f5e6a1" : "#b9e9cf");
      if (location.role === "target") targetCenter ??= center;
    }
    chips.push({
      key: `scene-${index}`,
      label: location.label || (location.role === "destination" ? "Destination" : "Here"),
      hex: location.role === "destination" ? "#f4d78c" : "#f5e6a1",
      point: { x: center.x * k, y: Math.max(0, rect.y - 6) * k }
    });
  });
  if (!targetCenter && photoColorRegions.length) {
    targetCenter = photoColorRegions[0].center;
    chips.push({ key: "photo-color-match", label: `COLOR MATCH · ${photoColorRegions[0]?.broadMatch ? photoColorRegions[0].observedShade : activeTask.color}`,
      hex: "#f5e6a1", point: { x: targetCenter.x * k, y: Math.max(0, targetCenter.y - 16) * k } });
  }
  if (targetCenter && destinationCenter && currentStep()?.kind === "place" && !activeTask?.completed) {
    drawArrow(targetCenter, destinationCenter);
  }
  ctx.restore();

  setCameraChips(showColorChips ? chips : []);
}

snapshotBtn.addEventListener("click", async () => {
  if (!streaming || currentMode !== "do") return;
  const scene = await captureCameraScene();
  if (!scene) return;
  setScenePhoto(scene);
  setActiveMode("do");
  setFeedback(interpretStatus, "Picture taken. Now type what you're looking for and press Build visual guide.");
  speak("Picture taken.");
});

instructionImageInput.addEventListener("change", async () => {
  const file = instructionImageInput.files?.[0];
  instructionImageInput.value = "";
  if (!file) return;
  try {
    setScenePhoto(await fileToScene(file));
    setActiveMode("do");
    setFeedback(interpretStatus, "Picture added. Now type what you're looking for and press Build visual guide.");
  } catch (error) {
    setFeedback(interpretStatus, error.message);
  }
});

clearSceneBtn.addEventListener("click", () => {
  setScenePhoto(null);
  setFeedback(interpretStatus, "Picture cleared.");
});

// --- Steps 2 and 3: show what was understood, let the user fix it and confirm ---
function readDraftFields() {
  return {
    ...(pendingTaskDraft || {}),
    color: taskColorInput.value.trim().toLowerCase(),
    object: taskObjectInput.value.trim(),
    action: taskActionInput.value.trim().toLowerCase(),
    destination: taskDestinationInput.value.trim()
  };
}

function refreshDraftPreview() {
  const draft = readDraftFields();
  // Preserve Gemini's entire instruction and ordered plan. A single
  // color/object/action/destination pair cannot express sorting or sequences.
  const keepFullSentence = !draft.fieldsEdited && draft.summary &&
    (draft.planSource === "gemini" || isMultiObjectTask(draft) || taskTypeOf(draft) === "sequence");
  const sentence = keepFullSentence ? draft.summary : (describeTask(draft) || draft.summary || "");
  const steps = buildGuideSteps({ ...draft, summary: sentence, planSource: draft.fieldsEdited ? "edited" : draft.planSource });
  taskReadback.textContent = sentence;
  taskAnswer.textContent = draft.answer || "";
  taskAnswer.hidden = !draft.answer;
  taskStepsPreview.replaceChildren();
  steps.forEach((step) => {
    const item = document.createElement("li");
    item.textContent = step.text;
    taskStepsPreview.append(item);
  });
  return { draft, sentence, steps };
}

function showDraft(draft, sourceNote) {
  pendingTaskDraft = draft;
  taskColorInput.value = draft.color || "";
  taskObjectInput.value = draft.object || "";
  taskActionInput.value = draft.action || "";
  taskDestinationInput.value = draft.destination || "";
  taskSourceNote.textContent = sourceNote;
  const type = taskTypeOf(draft);
  const simple = ["find", "identify", "inspect", "place"].includes(type);
  // A complex task is represented by its full instruction and steps, not a
  // misleading form with just one color/object/action/destination.
  taskSimpleFields.hidden = !simple;
  const groups = Array.isArray(draft.groups) ? draft.groups : [];
  taskKindSummary.hidden = !draft.planSource && !groups.length;
  taskKindSummary.textContent = `${type === "other" ? "Flexible" : type.charAt(0).toUpperCase() + type.slice(1)} guide${groups.length ? ` · ${groups.length} groups: ${groups.map((g) => `${g.name}${Number(g.count)>0 ? ` (${g.count})` : ""}`).join(", ")}` : ""}. Review the steps below.${!simple ? " To change the instruction, edit it above and build a new guide." : ""}`;
  parsedTask.hidden = false;
  sceneLocations = draft.locations || [];
  renderScene();
  const { sentence } = refreshDraftPreview();
  speak([`I understood: ${sentence}`, draft.answer, "Is that right?"].filter(Boolean).join(" "));
}

[taskColorInput, taskObjectInput, taskActionInput, taskDestinationInput].forEach((field) => {
  field.addEventListener("input", () => {
    // Edited fields should never be presented as if Gemini verified the change.
    if (pendingTaskDraft) pendingTaskDraft.fieldsEdited = true;
    refreshDraftPreview();
  });
});

readTaskBtn.addEventListener("click", () => {
  const { draft, sentence, steps } = refreshDraftPreview();
  speak([sentence, draft.answer, ...steps.map((step, index) => `Step ${index + 1}. ${step.text}`)].filter(Boolean).join(" "));
});

function showInterpretError(message) {
  setFeedback(interpretStatus, message);
  interpretStatus.classList.add("is-error");
  speak(message);
}

interpretBtn.addEventListener("click", async () => {
  const text = instructionInput.value.trim();
  interpretStatus.classList.remove("is-error");
  if (!text) {
    showInterpretError("Type what you need, for example: Where is the pink pen?");
    return;
  }
  interpretBtn.disabled = true;
  interpretBtn.textContent = streaming ? "Reading live camera…" : scenePhoto ? "Looking at the picture…" : "Planning instructions…";
  setFeedback(interpretStatus, "");
  setActiveMode("do");

  try {
    // Use the current webcam frame as the semantic reference when the camera is live.
    // The returned target/destination boxes seed the local, continuous tracker.
    const referenceScene = streaming ? await captureCameraScene() : scenePhoto;
    if (streaming && !referenceScene) throw new Error("The camera frame is not ready yet. Wait a moment and try again.");
    if (streaming) setScenePhoto(referenceScene);
    const result = await interpret(text, referenceScene
      ? { mimeType: referenceScene.mimeType, data: referenceScene.data } : null);
    const basic = parseInstruction(text);
    const target = describeTarget({ color: result.targetColor || basic.color, object: result.targetObject || basic.object });
    const foundTarget = (result.locations || []).some((location) => location.role === "target");
    const missingNote = !referenceScene ? "Add a picture or start the camera to locate objects visually."
      : result.locateBusy ? "Gemini could not locate every requested item just now; try again."
      : "Some requested objects were not located. Try a clearer picture and confirm the suggested regions.";
    showDraft({
      summary: result.summary || text,
      planSource: result.planSource || "gemini",
      planSteps: Array.isArray(result.planSteps) ? result.planSteps : [],
      taskType: result.taskType || "other",
      completionHint: result.completionHint || "",
      steps: Array.isArray(result.steps) ? result.steps : [],
      visualCues: Array.isArray(result.visualCues) ? result.visualCues : [],
      color: result.targetColor || basic.color || "",
      object: result.targetObject || basic.object || "",
      action: result.action || basic.action || "",
      destination: result.destination || basic.destination || "",
      relation: result.relation || basic.relation || "",
      answer: [result.answer, !foundTarget && referenceScene && target && !isMultiObjectTask({ taskType: result.taskType }) ? missingNote : "",
        !referenceScene ? "No photo provided: visual locations are not verified yet." : ""].filter(Boolean).join(" "),
      locations: result.locations || [],
      groups: Array.isArray(result.groups) ? result.groups : []
    }, "Gemini's proposed plan. Review every step and any suggested item locations before starting.");
    setFeedback(interpretStatus, "Check the details below.");
  } catch (error) {
    // Fail closed: the offline one-object parser cannot safely reconstruct a
    // multi-step color-dependent task. Never offer its invented guide as valid.
    pendingTaskDraft = null;
    parsedTask.hidden = true;
    sceneLocations = [];
    renderScene();
    const reason = String(error?.message || "Gemini is temporarily unavailable.");
    showInterpretError(`Couldn't build this guide: ${reason} Your instruction is still here. Check the Gemini configuration and press Build visual guide to retry.`);
  } finally {
    interpretBtn.disabled = false;
    interpretBtn.textContent = "Build visual guide";
  }
});

saveTaskBtn.addEventListener("click", async () => {
  const { draft, sentence, steps } = refreshDraftPreview();
  if (!sentence) {
    setFeedback(interpretStatus, "Add a short description of the task.");
    return;
  }

  const { locations = [], answer = "", ...rest } = draft;
  const task = {
    ...rest,
    summary: sentence,
    steps: steps.map((step) => step.text),
    planSteps: steps,
    planSource: draft.fieldsEdited ? "edited" : draft.planSource,
    taskType: taskTypeOf(draft)
  };

  saveTaskBtn.disabled = true;
  saveTaskBtn.textContent = "Starting…";
  let saved = task;
  let saveNote = "";
  try {
    saved = await createTask({ ...task, locations, answer, sceneImage: scenePhoto
      ? { mimeType: scenePhoto.mimeType, data: scenePhoto.data } : null });
    refreshTaskLibrary();
  } catch (error) {
    console.warn("Could not save guide:", error);
    saveNote = " (Not saved to HueMemory, but the guide still works.)";
  } finally {
    saveTaskBtn.disabled = false;
    saveTaskBtn.textContent = "Yes, start guide";
  }

  parsedTask.hidden = true;
  setFeedback(interpretStatus, `Guide started.${saveNote}`);
  setActiveTask({ ...task, ...saved, planSteps: task.planSteps,
    planSource: task.planSource, taskType: task.taskType,
    completionHint: task.completionHint || "", groups: task.groups || [], answer, locations },
    { prefix: `Starting: ${sentence}` });
  setActiveMode("do");
});

// --- Steps 4 to 7: the guided task ---
function currentStep() {
  return activeTask?.guideSteps?.[guideStepIndex] || null;
}

function targetLabel() {
  return describeTarget({ color: activeTask?.color, object: activeTask?.object }) || "target";
}

function destinationLabel() {
  return activeTask?.destination || "the destination";
}

function setActiveTask(task, { prefix = "" } = {}) {
  const summary = cleanTaskSummary(task) || "Follow the saved task.";
  const guideSteps = buildGuideSteps({ ...task, summary });

  activeTask = { ...task, summary, guideSteps, answer: task.answer || "" };
  hueDoCheckReference = scenePhoto?.data ? { mimeType: scenePhoto.mimeType, data: scenePhoto.data } : null;
  showHueDoCheckFeedback(null);
  showHueDoObservedShade(null, "");
  sceneLocations = Array.isArray(task.locations) ? task.locations : [];
  seedHueDoTrackers();
  if (task.sceneImage?.mimeType === "image/jpeg" && typeof task.sceneImage.data === "string" &&
      scenePhoto?.data !== task.sceneImage.data) {
    // A task loaded from the library may refer to a different original photo.
    scenePhoto = null;
    const originalImage = task.sceneImage;
    loadImage(`data:${originalImage.mimeType};base64,${originalImage.data}`).then((image) => {
      if (activeTask?._id !== task._id) return;
      scenePhoto = { image, data: originalImage.data, dataUrl: image.src,
        mimeType: originalImage.mimeType, width: image.naturalWidth, height: image.naturalHeight, origin: "saved", name: "Saved guide photo" };
      hueDoCheckReference = { mimeType: originalImage.mimeType, data: originalImage.data };
      instructionImagePreview.replaceChildren();
      const thumb = document.createElement("img"); thumb.src = image.src; thumb.alt = "Photo used for this saved guide";
      instructionImagePreview.append(thumb); instructionImagePreview.hidden = false;
      clearSceneBtn.hidden = false;
      instructionFileName.textContent = "Saved guide photo";
      seedHueDoTrackers();
      renderScene();
    }).catch(() => setFeedback(taskResult, "Saved photo unavailable. Add another picture."));
  } else if (!task.sceneImage && task._id) {
    // Old saved guides have no stored picture; don't overlay their old boxes
    // onto whatever another task most recently displayed.
    scenePhoto = null;
    sceneLocations = [];
    resetHueDoTracking();
  }
  taskCompletionPending = false;

  // HueFind can still look for the same color on the live camera.
  targetColor = normalizeColorName(task.color);
  targetRgb = null;
  targetShade = "";
  colorSelect.value = targetColor;

  activeTaskEmpty.hidden = true;
  activeTaskContent.hidden = false;
  activeTaskSummary.textContent = summary;
  guideDone.hidden = true;
  guideStepCard.hidden = false;
  taskStateMark.textContent = "○";
  taskStateMark.style.color = "";

  if (task.completed) {
    showCompletion(false, "", false);
    return;
  }
  goToStep(0, { prefix });
}

function renderGuideSteps() {
  activeTaskSteps.replaceChildren();
  activeTask.guideSteps.forEach((step, index) => {
    const item = document.createElement("li");
    item.textContent = step.text;
    const current = !activeTask.completed && index === guideStepIndex;
    item.classList.toggle("is-done", activeTask.completed || index < guideStepIndex);
    item.classList.toggle("is-current", current);
    if (current) item.setAttribute("aria-current", "step");
    activeTaskSteps.append(item);
  });
}

function stepStatusText(step) {
  if (isMultiObjectTask(activeTask)) {
    if (step.kind === "place") return "Check with a new picture once all requested groups or matches are arranged. Gemini will assess the complete task, not just one object.";
    if (!streaming && !scenePhoto) return "Start the camera or upload a picture to identify the items and their groups.";
    if (step.kind === "find") return `Look for all the items and confirm each suggested group label; ${sceneLocations.filter((x) => x.role === "target").length} item(s) located in the starting image.`;
    return "Follow the group labels and requested instructions. Press Next when ready.";
  }
  if (step.kind === "find") {
    if (streaming) return hueDoHasVerifiedTarget
      ? (activeTask.color
        ? `A ${activeTask.color} color region is outlined. Confirm it is the ${activeTask.object || "requested object"} before continuing.`
        : `A possible ${targetLabel()} is marked. Confirm it visually before continuing.`)
      : `No confirmed ${activeTask.color || targetLabel()} outline yet. Move the camera closer, improve lighting, or try another picture.`;
    if (!scenePhoto) return "Start the camera or upload a picture to build a visual guide.";
    const found = sceneLocations.some((location) => location.role === "target");
    if (!found && activeTask.color) return `No object box was returned. Start the camera to look for a live ${activeTask.color} match.`;
    const isAre = isPlural(activeTask.object) ? "are" : "is";
    return activeTask.color
      ? `Color outlines appear only for matching pixels. ${found ? "Check the highlighted region in the picture." : "No reliable target region was located; try a clearer photo."}`
      : (found ? `A possible ${targetLabel()} location was marked. Confirm it visually.` : `I couldn't find the ${targetLabel()} in this picture.`);
  }
  if (step.kind === "place") {
    if (!activeTask.destination) return "When the requested action is finished, press Check with a new picture. Gemini will assess what is visible and explain any uncertainty.";
    return streaming
      ? `Follow the target and destination markers; press "Check with a new picture" to review the result.`
      : `Start the camera to see target and destination markers, then press "Check with a new picture" to review the result.`;
  }
  return "Press Next when you're ready.";
}

function goToStep(index, { prefix = "", announce = true } = {}) {
  if (!activeTask) return;
  const steps = activeTask.guideSteps;
  const previousIndex = guideStepIndex;
  guideStepIndex = clamp(index, 0, steps.length - 1);
  if (previousIndex !== guideStepIndex) showHueDoCheckFeedback(null);
  const step = steps[guideStepIndex];

  const targetMissing = step.kind === "find" && !sceneLocations.some((location) => location.role === "target") && !activeTask.color;
  const stepText = targetMissing
    ? `The ${targetLabel()} ${isPlural(activeTask.object) ? "aren't" : "isn't"} circled yet. Press Build visual guide again, or take a new picture.`
    : step.text;
  guideStepCount.textContent = `Step ${guideStepIndex + 1} of ${steps.length}`;
  guideStepText.textContent = stepText;
  checkPictureBtn.hidden = step.kind !== "place";
  prevStepBtn.disabled = guideStepIndex === 0;
  taskBtn.disabled = false;
  taskBtn.textContent = guideStepIndex === steps.length - 1 ? "Done" : "Next";
  renderGuideSteps();
  const status = stepStatusText(step);
  setFeedback(taskResult, status);
  renderScene();

  if (announce) {
    const extra = step.kind === "find" ? status : "";
    speak([prefix, `Step ${guideStepIndex + 1} of ${steps.length}.`, stepText, targetMissing ? "" : extra].filter(Boolean).join(" "));
  }
}

function refreshGuideStatus() {
  if (!activeTask || activeTask.completed) return;
  const step = currentStep();
  if (step) setFeedback(taskResult, stepStatusText(step));
}

checkPictureBtn.addEventListener("click", async () => {
  if (!activeTask || activeTask.completed) return;
  if (!streaming) {
    const message = "Start the camera so I can take the check picture.";
    setFeedback(taskResult, message);
    speak(message);
    return;
  }

  checkPictureBtn.disabled = true;
  showHueDoCheckFeedback(null);
  checkPictureBtn.textContent = "Checking…";
  try {
    const before = hueDoCheckReference;
    const scene = await captureCameraScene();
    speak("Checking.");
    const result = await checkTask({ mimeType: scene.mimeType, data: scene.data }, {
      summary: activeTask.summary,
      taskType: taskTypeOf(activeTask),
      groups: activeTask.groups || [],
      completionHint: activeTask.completionHint || "",
      target: targetLabel(),
      destination: activeTask.destination || ""
    }, before);
    setScenePhoto(scene);
    sceneLocations = result.locations || [];
    seedHueDoTrackers();
    if (result.done) {
      showHueDoCheckFeedback(null);
      completeActiveTask(true, result.message);
    } else {
      renderScene();
      const outcome = ["incorrect", "incomplete", "uncertain"].includes(result.outcome) ? result.outcome : "uncertain";
      const message = result.message || "The result cannot be verified yet. Show all relevant objects and try again.";
      showHueDoCheckFeedback({ ...result, outcome, message });
      setFeedback(taskResult, message);
      speak(outcome === "uncertain" ? `Couldn't verify the task. ${message}` : `Task not complete. ${message}`);
    }
  } catch (error) {
    const message = `Picture check failed: ${error.message}. No completion was verified. Try a new picture.`;
    showHueDoCheckFeedback({ outcome: "uncertain", message });
    setFeedback(taskResult, message);
    speak(message);
  } finally {
    checkPictureBtn.disabled = false;
    checkPictureBtn.textContent = "📷 Check with a new picture";
  }
});

prevStepBtn.addEventListener("click", () => {
  if (activeTask && !activeTask.completed) goToStep(guideStepIndex - 1);
});

repeatStepBtn.addEventListener("click", () => {
  if (!activeTask) return;
  if (activeTask.completed) {
    speak(guideDoneText.textContent);
    return;
  }
  const step = currentStep();
  speak(`Step ${guideStepIndex + 1} of ${activeTask.guideSteps.length}. ${step.text} ${taskResult.textContent}`);
});

taskBtn.addEventListener("click", () => {
  if (!activeTask || activeTask.completed) return;
  if (guideStepIndex >= activeTask.guideSteps.length - 1) {
    completeActiveTask(false);
    return;
  }
  goToStep(guideStepIndex + 1);
});

function playChime() {
  if (!soundOn) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audio = new AudioContextClass();
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime + index * 0.14;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.4);
    });
    window.setTimeout(() => audio.close(), 1200);
  } catch (error) {
    console.warn("Chime unavailable:", error);
  }
}

function showCompletion(verified, detail = "", announce = true) {
  activeTask.completed = true;
  checkPictureBtn.hidden = true;
  showHueDoCheckFeedback(null);
  guideStepCard.hidden = true;
  guideDone.hidden = false;
  const message = verified
    ? `Done! ${detail || `The ${targetLabel()} is ${normalizeRelation(activeTask.relation)} ${destinationLabel()}.`}`
    : "Task marked complete manually (not visually verified).";
  guideDoneText.textContent = message;
  taskStateMark.textContent = "✓";
  taskStateMark.style.color = "var(--success)";
  taskBtn.disabled = true;
  taskBtn.textContent = "Completed";
  prevStepBtn.disabled = true;
  setFeedback(taskResult, verified ? "Checked from the picture." : "Completed.");
  renderGuideSteps();
  renderScene();
  if (announce) {
    playChime();
    speak(message);
  }
}

async function completeActiveTask(verified = false, detail = "") {
  if (!activeTask || taskCompletionPending) return;
  taskCompletionPending = true;
  showCompletion(verified, detail);

  if (activeTask._id) {
    try {
      const updated = await completeTask(activeTask._id, true);
      activeTask = { ...activeTask, ...updated, guideSteps: activeTask.guideSteps };
      await refreshTaskLibrary();
    } catch (error) {
      console.error("Could not persist task completion:", error);
    }
  }
}

function clearActiveTask() {
  activeTask = null;
  hueDoCheckReference = null;
  showHueDoCheckFeedback(null);
  showHueDoObservedShade(null, "");
  sceneLocations = [];
  resetHueDoTracking();
  taskCompletionPending = false;
  activeTaskEmpty.hidden = false;
  activeTaskContent.hidden = true;
  taskStateMark.textContent = "○";
  taskStateMark.style.color = "";
  targetColor = "";
  targetRgb = null;
  targetShade = "";
  targetStrictShade = false;
  findNoMatchFrames = 0;
  findSuggestionShown = false;
  closeFindSuggestions();
  colorSelect.value = "";
  setCameraChips([]);
  renderScene();
  setFeedback(findResult, "Type a color or shade name to begin.");
}

clearTaskBtn.addEventListener("click", clearActiveTask);

function capitalize(value = "") {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
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

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.setAttribute("aria-label", `Remove saved guide: ${title.textContent}`);
    removeButton.addEventListener("click", async () => {
      removeButton.disabled = true;
      try {
        await deleteTask(task._id);
        await refreshTaskLibrary();
      } catch (error) {
        removeButton.disabled = false;
        meta.textContent = error.message || "Could not remove guide.";
      }
    });

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
    actions.append(removeButton);

    row.append(copy, actions);
    taskLibrary.append(row);
  });
}

refreshTasksBtn.addEventListener("click", refreshTaskLibrary);

function speak(text) {
  announcer.textContent = text;
  if (soundOn && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  }
}

// Mount persistent color memory and image sampling tools.
mountPalette($("palette"), {
  onFindAgain: (color) => {
    const category = normalizeColorCategory(color.colorName || color.shade);
    const shadeLabel = String(color.shade || color.colorName || "").replace(/\s+#?[0-9A-F]{6}$/i, "").trim();
    setFindTarget(shadeLabel || category, true, { ...color, shade: shadeLabel || category });
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
