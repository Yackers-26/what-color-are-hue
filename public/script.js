import { analyzeVideoFrame } from "/src/vision/cameraProcessor.js";
import { classifyColor } from "/src/vision/colorDetector.js";
import {
  saveColor,
  createTask,
  loadTasks,
  completeTask,
  deleteTask,
  interpret,
  checkTask
} from "/js/huememory.js";
import { mountPalette } from "/js/palettePanel.js";
import {
  parseInstruction,
  buildGuideSteps,
  describeTask,
  describeTarget,
  normalizeColorName,
  normalizeRelation,
  isPlural,
  isSortTask
} from "/js/hueDoParser.js";
import { mountImagePicker } from "/js/imagePicker.js";

const $ = (id) => document.getElementById(id);

const video = $("webcam");
const canvas = $("outputCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const toggleCamBtn = $("toggleCamBtn");
const toggleCamLabel = $("toggleCamLabel");
const colorSelect = $("colorSelect");
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
const soundToggle = $("soundToggle");
const colorChipToggle = $("colorChipToggle");
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
const taskReadback = $("taskReadback");
const taskColorInput = $("taskColorInput");
const taskAnswer = $("taskAnswer");
const snapshotBtn = $("snapshotBtn");
const clearSceneBtn = $("clearSceneBtn");
const checkPictureBtn = $("checkPictureBtn");
const taskObjectInput = $("taskObjectInput");
const taskActionInput = $("taskActionInput");
const taskDestinationInput = $("taskDestinationInput");
const readTaskBtn = $("readTaskBtn");
const taskStepsPreview = $("taskStepsPreview");
const saveTaskBtn = $("saveTaskBtn");
const activeTaskEmpty = $("activeTaskEmpty");
const activeTaskContent = $("activeTaskContent");
const activeTaskSummary = $("activeTaskSummary");
const activeTaskSteps = $("activeTaskSteps");
const taskStateMark = $("taskStateMark");
const clearTaskBtn = $("clearTaskBtn");
const taskLibrary = $("taskLibrary");
const refreshTasksBtn = $("refreshTasksBtn");
const guideStepCard = $("guideStepCard");
const guideStepCount = $("guideStepCount");
const guideStepText = $("guideStepText");
const guideDone = $("guideDone");
const guideDoneText = $("guideDoneText");
const prevStepBtn = $("prevStepBtn");
const repeatStepBtn = $("repeatStepBtn");

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
let lastSamplePosition = null;
let keyboardPosition = { x: 0.5, y: 0.5 };
let detectedLayoutSignature = "";
let detectedItemsByName = new Map();
let showColorChips = true;
let currentMode = "see";
let cameraChipNodes = new Map();
let pendingTaskDraft = null;
let activeTask = null;
let taskCheckFrames = 0;
let taskSuccessStreak = 0;
let taskCompletionPending = false;
let guideStepIndex = 0;
let scenePhoto = null; // HueDo picture: taken with the camera button or uploaded
let sceneLocations = []; // boxes Gemini found in scenePhoto, as fractions of the picture

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
  currentMode = nextMode;

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
  if (nextMode !== "see" && nextMode !== "find" && nextMode !== "do") setCameraChips([]);
  renderScene();
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

const chipColors = {
  red: "#ee7772", orange: "#e9a16b", yellow: "#e8d16d", green: "#81b88d",
  cyan: "#7ccbc6", blue: "#7e9fdf", purple: "#b59ad9", black: "#68716d"
};

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

function getBinaryRegions(mask, width, height, step = 4) {
  const columns = Math.ceil(width / step);
  const rows = Math.ceil(height / step);
  const visited = new Uint8Array(mask.length);
  const regions = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start];
    const cells = [];
    const cellSet = new Set();
    visited[start] = 1;
    let cursor = 0;
    let minX = columns, minY = rows, maxX = -1, maxY = -1;

    while (cursor < queue.length) {
      const index = queue[cursor++];
      cells.push(index);
      cellSet.add(index);
      const gx = index % columns;
      const gy = Math.floor(index / columns);
      minX = Math.min(minX, gx); minY = Math.min(minY, gy);
      maxX = Math.max(maxX, gx); maxY = Math.max(maxY, gy);
      const neighbors = [
        gy > 0 ? index - columns : -1,
        gx < columns - 1 ? index + 1 : -1,
        gy < rows - 1 ? index + columns : -1,
        gx > 0 ? index - 1 : -1
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || !mask[neighbor] || visited[neighbor]) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }

    if (cells.length < 7) continue;
    const outline = [];
    for (const index of cells) {
      const gx = index % columns;
      const gy = Math.floor(index / columns);
      const left = gx * step, top = gy * step;
      const right = Math.min(width, left + step), bottom = Math.min(height, top + step);
      if (!cellSet.has(index - columns)) outline.push([left, top, right, top]);
      if (gx === columns - 1 || !cellSet.has(index + 1)) outline.push([right, top, right, bottom]);
      if (gy === rows - 1 || !cellSet.has(index + columns)) outline.push([right, bottom, left, bottom]);
      if (gx === 0 || !cellSet.has(index - 1)) outline.push([left, bottom, left, top]);
    }
    const x = minX * step, y = minY * step;
    const right = Math.min(width, (maxX + 1) * step);
    const bottom = Math.min(height, (maxY + 1) * step);
    regions.push({
      samples: cells.length,
      bounds: { x, y, width: right - x, height: bottom - y },
      center: { x: (x + right) / 2, y: (y + bottom) / 2 },
      outline
    });
  }
  return regions.sort((a, b) => b.samples - a.samples);
}

function getShadeMatchRegions() {
  if (!targetRgb || !video.videoWidth || !video.videoHeight) return [];
  const width = 320;
  const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
  if (samplingCanvas.width !== width || samplingCanvas.height !== height) {
    samplingCanvas.width = width;
    samplingCanvas.height = height;
  }
  samplingContext.drawImage(video, 0, 0, width, height);
  const { data } = samplingContext.getImageData(0, 0, width, height);
  const step = 4;
  const columns = Math.ceil(width / step);
  const rows = Math.ceil(height / step);
  const mask = new Uint8Array(columns * rows);
  const thresholdSquared = 82 * 82;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4;
      const r = data[index], g = data[index + 1], b = data[index + 2];
      if (classifyColor(r, g, b).name.toLowerCase() !== targetColor.toLowerCase()) continue;
      const dr = r - targetRgb.r, dg = g - targetRgb.g, db = b - targetRgb.b;
      if (dr * dr + dg * dg + db * db > thresholdSquared) continue;
      mask[Math.floor(y / step) * columns + Math.floor(x / step)] = 1;
    }
  }
  return getBinaryRegions(mask, width, height, step).map((region) => ({ ...region, hex: rgbToHex(targetRgb) }));
}

function drawTargetOverlay() {
  const color = latestColors.find((item) => item.name.toLowerCase() === targetColor.toLowerCase());
  const regions = targetRgb ? getShadeMatchRegions() : (color?.regions || (color ? [{ bounds: color.bounds, center: getRegionCenter(color) }] : []));

  if (!regions.length) {
    setCameraChips([]);
    setFeedback(findResult, `Looking for ${targetShade || targetColor}…`);
    return;
  }

  const chips = [];
  regions.slice(0, 8).forEach((region, index) => {
    drawRegionOutline(region, "#f5e6a1");
    chips.push({
      key: `find-${index}`,
      label: targetShade || targetColor,
      color: targetColor,
      point: getRegionCenter(region),
      hex: targetRgb ? rgbToHex(targetRgb) : region.hex
    });
  });
  setCameraChips(showColorChips ? chips : []);
  const region = regions[0];
  setFeedback(findResult, `${targetShade || targetColor} detected · ${getApproximateRegion(region)}`);
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
    colorSelect.disabled = false;
    snapshotBtn.disabled = false;
    refreshGuideStatus();
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
  taskCheckFrames = 0;
  taskSuccessStreak = 0;

  toggleCamBtn.disabled = false;
  toggleCamBtn.setAttribute("aria-pressed", "false");
  toggleCamBtn.classList.remove("is-active");
  toggleCamLabel.textContent = "Start camera";
  colorSelect.disabled = true;
  sampleFindBtn.disabled = true;

  cameraPlaceholder.classList.remove("is-hidden");
  sampleIndicator.classList.remove("is-visible", "is-below");
  setCameraChips([]);
  sampleSwatch.style.backgroundColor = "";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  samplingContext.clearRect(0, 0, samplingCanvas.width, samplingCanvas.height);

  setCameraStatus("Camera off", "off");
  setFeedback(findResult, "Choose a target to begin.");
  snapshotBtn.disabled = true;
  refreshGuideStatus();
  renderScene();
}

function processLoop() {
  if (!streaming) return;

  // HueDo shows a still picture instead of the live view.
  if (showingScene()) {
    animationFrameId = requestAnimationFrame(processLoop);
    return;
  }

  try {
    const result = analyzeVideoFrame(video, canvas);
    if (result?.ready) {
      // analyzeVideoFrame draws the source frame to the canvas.
      latestColors = result.colors || [];
      renderDetectedColors(latestColors);

      if (currentMode === "see") {
        const chips = showColorChips
          ? latestColors.flatMap((color) => (color.regions || []).map((region, index) => ({
              key: `see-${color.name}-${index}`,
              label: color.name,
              color: color.name,
              hex: region.hex,
              point: getRegionCenter(region),
              samples: region.samples
            }))).sort((a, b) => b.samples - a.samples).slice(0, 10)
          : [];
        setCameraChips(chips);
      } else if (currentMode === "find" && targetColor) {
        drawTargetOverlay();
      } else if (currentMode === "do") {
        setCameraChips([{
          key: "do-take-picture",
          label: "📷 Take a picture to use HueDo",
          color: "yellow",
          point: { x: canvas.width / 2, y: canvas.height * 0.14 }
        }]);
      } else {
        setCameraChips([]);
      }

      if ((pointerIsOverCanvas || pointerIsDown || keyboardSamplingActive) && lastSamplePosition) {
        const source = pointerIsDown ? "touch" : keyboardSamplingActive ? "keyboard" : "pointer";
        sampleImagePoint(lastSamplePosition, source);
      }

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
    const [r, g, b] = samplingContext.getImageData(pixelX, pixelY, 1, 1).data;
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
  sampleFindBtn.disabled = !streaming || ["Unknown", "White", "Gray"].includes(sample.name);
  saveColorBtn.disabled = !streaming || ["Unknown", "White", "Gray"].includes(sample.name);
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
  colorDescription.textContent = getPlainLanguageDescription(sample, hsl);
  colorHex.textContent = sample.hex;
  colorRgb.textContent = `(${r}, ${g}, ${b})`;
  colorHsl.textContent = `(${hsl.h}°, ${hsl.s}%, ${hsl.l}%)`;

  speakDetailsBtn.disabled = false;
  saveColorBtn.disabled = ["Unknown", "White", "Gray"].includes(sample.name);
}

function resetColorDetails() {
  colorPreview.style.backgroundColor = "#e4e8e5";
  colorNameDisplay.textContent = "No sample yet";
  colorDescription.textContent = "Tap the camera view to sample.";
  colorHex.textContent = "—";
  colorRgb.textContent = "—";
  colorHsl.textContent = "—";
  speakDetailsBtn.disabled = true;
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
      empty.textContent = "Start the camera to scan the scene.";
      detectedColorsList.append(empty);
      return;
    }

    if (colors.length === 0) {
      const empty = document.createElement("li");
      empty.className = "detected-empty";
      empty.textContent = "No supported color groups in view.";
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

function sampleFromPointer(event) {
  if (showingScene()) return null;
  const point = getImagePoint(event.clientX, event.clientY);
  if (!point) {
    lastSamplePosition = null;
    sampleIndicator.classList.remove("is-visible");
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
  if (event.pointerType === "mouse") {
    pointerIsOverCanvas = Boolean(sampleFromPointer(event));
  } else if (pointerIsDown) {
    sampleFromPointer(event);
  }
});

canvas.addEventListener("pointerdown", (event) => {
  if (!streaming) return;
  pointerIsDown = true;
  keyboardSamplingActive = false;
  canvas.focus({ preventScroll: true });
  if (event.pointerType !== "mouse") event.preventDefault();
  if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
  sampleFromPointer(event);
});

function finishPointerSample(event) {
  pointerIsDown = false;
  if (event?.pointerType !== "mouse") pointerIsOverCanvas = false;
  if (currentSample) announceSample(currentSample);
}

canvas.addEventListener("pointerup", finishPointerSample);
canvas.addEventListener("pointercancel", finishPointerSample);

canvas.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "mouse" && !pointerIsDown) {
    pointerIsOverCanvas = false;
    lastSamplePosition = null;
    sampleIndicator.classList.remove("is-visible");
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
  if (!pointerIsOverCanvas && !pointerIsDown) sampleIndicator.classList.remove("is-visible");
});

function announceSample(sample) {
  speak(getSpokenColorDetails(sample));
}

speakDetailsBtn.addEventListener("click", () => {
  if (currentSample) announceSample(currentSample);
});

saveColorBtn.addEventListener("click", async () => {
  if (!currentSample || saveColorBtn.disabled) return;
  saveColorBtn.disabled = true;
  setFeedback(saveColorStatus, "Saving…");
  try {
    await saveColor(currentSample);
    setFeedback(saveColorStatus, `${currentSample.name} saved to HueMemory.`);
    speak(`${currentSample.name} saved to your color palette.`);
  } catch (error) {
    setFeedback(saveColorStatus, error.message || "Could not save this color.");
  } finally {
    saveColorBtn.disabled = !currentSample || ["Unknown", "White", "Gray"].includes(currentSample.name);
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

// Spoken directions and the chime can be turned off. The choice is remembered on this computer.
let soundOn = true;
try {
  soundOn = localStorage.getItem("hue-sound") !== "off";
} catch {
  soundOn = true;
}

function showSoundState() {
  soundToggle.setAttribute("aria-pressed", String(soundOn));
  soundToggle.setAttribute("aria-label", soundOn ? "Turn sound off" : "Turn sound on");
  soundToggle.querySelector("span:first-child").textContent = soundOn ? "🔊" : "🔇";
  soundToggle.querySelector("span:last-child").textContent = soundOn ? "Sound on" : "Sound off";
}

soundToggle.addEventListener("click", () => {
  soundOn = !soundOn;
  try {
    localStorage.setItem("hue-sound", soundOn ? "on" : "off");
  } catch {
    // Not remembered, but the switch still works for this visit.
  }
  if (!soundOn && "speechSynthesis" in window) window.speechSynthesis.cancel();
  showSoundState();
  if (soundOn) speak("Sound on.");
});
showSoundState();

colorChipToggle.addEventListener("click", () => {
  showColorChips = !showColorChips;
  colorChipToggle.setAttribute("aria-pressed", String(showColorChips));
  colorChipToggle.setAttribute("aria-label", showColorChips ? "Hide color chips" : "Show color chips");
  colorChipToggle.title = showColorChips ? "Hide color chips" : "Show color chips";
  if (!showColorChips) setCameraChips([]);
});

function setFindTarget(value, shouldSpeak = true, colorReference = null) {
  const normalized = normalizeColorCategory(value);
  targetColor = normalized;
  targetRgb = colorReference?.rgb || null;
  targetShade = colorReference?.shade || "";
  colorSelect.value = normalized;
  if (!normalized) {
    targetRgb = null;
    targetShade = "";
    setFeedback(findResult, "Choose a target to begin.");
    return;
  }
  const label = targetShade || normalized;
  setFeedback(findResult, streaming ? `Looking for ${label}…` : `Target set: ${label}. Start the camera to find it.`);
  if (shouldSpeak) speak(`Finding ${label}`);
}

colorSelect.addEventListener("change", (event) => setFindTarget(event.target.value));
sampleFindBtn.addEventListener("click", () => {
  if (currentSample) setFindTarget(currentSample.name, true, { ...currentSample, shade: currentSample.name });
});
clearFindBtn.addEventListener("click", () => {
  targetColor = "";
  targetRgb = null;
  targetShade = "";
  colorSelect.value = "";
  setFeedback(findResult, "Choose a target to begin.");
});

// HueDo works from a still picture (taken with the camera button or uploaded), not the live webcam.
const SCENE_MAX_WIDTH = 1280;

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
  return currentMode === "do" && Boolean(scenePhoto);
}

function setScenePhoto(scene, { keepLocations = false } = {}) {
  scenePhoto = scene;
  if (!keepLocations) sceneLocations = [];
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

// Shows the picture in the camera area with circles around what Gemini found.
function renderScene() {
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
  sceneLocations.forEach((location, index) => {
    const rect = {
      x: location.box.x * width,
      y: location.box.y * height,
      width: location.box.width * width,
      height: location.box.height * height
    };
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const done = Boolean(activeTask?.completed);
    if (location.role === "destination") {
      drawAreaBox(rect, done ? "#8fe0b0" : "#f4d78c", done ? "rgba(143,224,176,.18)" : "");
      destinationCenter ??= center;
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
  if (targetCenter && destinationCenter && currentStep()?.kind === "place" && !activeTask?.completed) {
    drawArrow(targetCenter, destinationCenter);
  }
  ctx.restore();

  setCameraChips(chips);
}

snapshotBtn.addEventListener("click", async () => {
  if (!streaming) return;
  const scene = await captureCameraScene();
  if (!scene) return;
  setActiveMode("do");
  setScenePhoto(scene);
  setFeedback(interpretStatus, "Picture taken. Now type what you're looking for and press Build visual guide.");
  speak("Picture taken.");
});

instructionImageInput.addEventListener("change", async () => {
  const file = instructionImageInput.files?.[0];
  instructionImageInput.value = "";
  if (!file) return;
  try {
    setScenePhoto(await fileToScene(file));
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
  const sentence = describeTask(draft) || draft.summary || "";
  const steps = buildGuideSteps({ ...draft, summary: sentence });
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
  parsedTask.hidden = false;
  sceneLocations = draft.locations || [];
  renderScene();
  const { sentence } = refreshDraftPreview();
  speak([`I understood: ${sentence}`, draft.answer, "Is that right?"].filter(Boolean).join(" "));
}

[taskColorInput, taskObjectInput, taskActionInput, taskDestinationInput].forEach((field) => {
  field.addEventListener("input", refreshDraftPreview);
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

  if (!scenePhoto) {
    showInterpretError(streaming
      ? "HueDo doesn't work on the live webcam. Press 📷 Take picture on the camera, or upload a picture, then try again."
      : "HueDo needs a picture. Start the camera and press 📷 Take picture, or upload a picture, then try again.");
    return;
  }
  if (!text) {
    showInterpretError("Type what you need, for example: Where is the pink pen?");
    return;
  }

  interpretBtn.disabled = true;
  interpretBtn.textContent = "Looking at the picture…";
  setFeedback(interpretStatus, "");
  setActiveMode("do");

  try {
    const result = await interpret(text, { mimeType: scenePhoto.mimeType, data: scenePhoto.data });
    const basic = parseInstruction(text);
    const target = describeTarget({ color: result.targetColor || basic.color, object: result.targetObject || basic.object });
    const foundTarget = (result.locations || []).some((location) => location.role === "target");
    const missingNote = result.locateBusy
      ? `Gemini was too busy to circle the ${target} just now. Press Build visual guide again in a few seconds.`
      : `I couldn't find the ${target} in this picture. Try another picture.`;
    showDraft({
      summary: result.summary || text,
      steps: Array.isArray(result.steps) ? result.steps : [],
      visualCues: Array.isArray(result.visualCues) ? result.visualCues : [],
      color: result.targetColor || basic.color || "",
      object: result.targetObject || basic.object || "",
      action: result.action || basic.action || "",
      destination: result.destination || basic.destination || "",
      relation: result.relation || basic.relation || "",
      answer: [result.answer, target && !foundTarget ? missingNote : ""].filter(Boolean).join(" "),
      locations: result.locations || [],
      groups: Array.isArray(result.groups) ? result.groups : []
    }, "Read by Gemini. Fix anything that's wrong, then start.");
    setFeedback(interpretStatus, "Check the details below.");
  } catch (error) {
    // Without Gemini nothing is circled: guessing by color alone circles faces and lips.
    const basic = parseInstruction(text);
    const target = describeTarget(basic);
    showDraft({
      ...basic,
      steps: [],
      visualCues: [],
      locations: [],
      answer: target ? `Nothing is circled because Gemini didn't answer: ${error.message}` : ""
    }, `Gemini didn't answer (${error.message}), so I used a basic reading and couldn't look at the picture.`);
    setFeedback(interpretStatus, `Gemini: ${error.message}`);
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
  const task = { ...rest, summary: sentence, steps: steps.map((step) => step.text) };

  saveTaskBtn.disabled = true;
  saveTaskBtn.textContent = "Starting…";
  let saved = task;
  let saveNote = "";
  try {
    saved = await createTask(task);
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
  setActiveTask({ ...saved, groups: task.groups || [], answer, locations }, { prefix: `Starting: ${sentence}` });
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
  const summary = task.summary || describeTask(task) || "Follow the saved task.";
  const guideSteps = buildGuideSteps({ ...task, summary });

  activeTask = { ...task, summary, guideSteps, answer: task.answer || "" };
  sceneLocations = Array.isArray(task.locations) ? task.locations : [];
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
  if (step.kind === "find") {
    if (!scenePhoto) return "Take or upload a picture, then press Build visual guide to circle it.";
    const found = sceneLocations.some((location) => location.role === "target");
    const isAre = isPlural(activeTask.object) ? "are" : "is";
    return activeTask.answer || (found ? `The ${targetLabel()} ${isAre} circled.` : `I couldn't find the ${targetLabel()} in this picture.`);
  }
  if (step.kind === "place") {
    return streaming
      ? `When it's done, press "Check with a new picture".`
      : `Start the camera, then press "Check with a new picture" when it's done.`;
  }
  return "Press Next when you're ready.";
}

function goToStep(index, { prefix = "", announce = true } = {}) {
  if (!activeTask) return;
  const steps = activeTask.guideSteps;
  guideStepIndex = clamp(index, 0, steps.length - 1);
  const step = steps[guideStepIndex];

  const targetMissing = step.kind === "find" && !sceneLocations.some((location) => location.role === "target");
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
  checkPictureBtn.textContent = "Checking…";
  try {
    const scene = await captureCameraScene();
    setScenePhoto(scene);
    speak("Checking.");
    const result = await checkTask({ mimeType: scene.mimeType, data: scene.data }, {
      summary: activeTask.summary,
      target: targetLabel(),
      destination: activeTask.destination || ""
    });
    sceneLocations = result.locations || [];
    if (result.done) {
      completeActiveTask(true, result.message);
    } else {
      renderScene();
      const message = result.message || (isSortTask(activeTask) || !activeTask.destination
        ? "Not done yet. Fix it, then check again."
        : `Not done yet. Put the ${targetLabel()} ${normalizeRelation(activeTask.relation)} ${destinationLabel()}, then check again.`);
      setFeedback(taskResult, message);
      speak(message);
    }
  } catch (error) {
    const message = `I couldn't check automatically (${error.message}). Press Done when it's finished.`;
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
  guideStepCard.hidden = true;
  guideDone.hidden = false;
  const message = verified
    ? `Done! ${detail || `The ${targetLabel()} is ${normalizeRelation(activeTask.relation)} ${destinationLabel()}.`}`
    : "Done! Task marked complete.";
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
  sceneLocations = [];
  taskCompletionPending = false;
  activeTaskEmpty.hidden = false;
  activeTaskContent.hidden = true;
  taskStateMark.textContent = "○";
  taskStateMark.style.color = "";
  targetColor = "";
  colorSelect.value = "";
  setCameraChips([]);
  renderScene();
  setFeedback(findResult, "Choose a target to begin.");
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
});
