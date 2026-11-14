import { analyzeVideoFrame } from "/src/vision/cameraProcessor.js";
import { classifyColor, TemporalMaskStabilizer } from "/src/vision/colorDetector.js";
import {
  saveColor,
  createTask,
  loadTasks,
  completeTask,
  interpret
} from "/js/huememory.js";
import { mountPalette } from "/js/palettePanel.js";
import { mountImagePicker } from "/js/imagePicker.js";

const $ = (id) => document.getElementById(id);

const video = $("webcam");
const canvas = $("outputCanvas");
const ctx = canvas.getContext("2d");

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
const cameraChipLayer = $("cameraChipLayer");
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
const analysisCanvas = document.createElement("canvas");
const colorMaskStabilizer = new TemporalMaskStabilizer({ holdFrames: 2 });
const shadeMaskStabilizer = new TemporalMaskStabilizer({ holdFrames: 2 });
const shadeRegionSmoother = new TemporalMaskStabilizer({ holdFrames: 2 });
const ANALYSIS_INTERVAL_MS = 80;

let streaming = false;
let animationFrameId = null;
let lastAnalysisAt = 0;
let lastSampleAt = 0;
let latestColors = [];
let latestTargetRegions = [];
let smoothedSampleRgb = null;
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
let instructionImage = null;
let instructionImageUrl = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));


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

  if (nextMode !== "see" && nextMode !== "find" && nextMode !== "do") setCameraChips([]);
}

modeButtons.forEach((button, index) => {
  button.addEventListener("click", () => setActiveMode(button.dataset.modeButton));
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
    const labelNode = chip.querySelector(".camera-chip-label");
    if (labelNode.textContent !== entry.label) labelNode.textContent = entry.label;
    const frameWidth = cameraFrame.clientWidth;
    const halfChip = (chip.offsetWidth || 110) / 2;
    const left = clamp(stage.stageX * frameWidth, halfChip + 7, frameWidth - halfChip - 7);
    const nextLeft = `${left}px`;
    const nextTop = `${stage.stageY * 100}%`;
    const nextColor = entry.hex || chipColors[String(entry.color || "").toLowerCase()] || "#dbe8df";
    if (chip.style.left !== nextLeft) chip.style.left = nextLeft;
    if (chip.style.top !== nextTop) chip.style.top = nextTop;
    if (chip.style.getPropertyValue("--chip-color") !== nextColor) {
      chip.style.setProperty("--chip-color", nextColor);
    }
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
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = "rgba(24,27,24,.72)";
  strokeSegments();
  ctx.lineWidth = 1.8;
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

function removeIsolatedMaskNoise(mask, columns, rows) {
  const filtered = new Uint8Array(mask);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const index = y * columns + x;
      let neighbors = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const nx = x + offsetX;
          const ny = y + offsetY;
          if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
          neighbors += mask[ny * columns + nx] ? 1 : 0;
        }
      }
      if (mask[index] && neighbors <= 1) filtered[index] = 0;
      else if (!mask[index] && neighbors >= 8) filtered[index] = 1;
    }
  }
  return filtered;
}

function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  const merged = [sorted[0].slice()];
  for (let index = 1; index < sorted.length; index += 1) {
    const interval = sorted[index];
    const last = merged[merged.length - 1];
    if (interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else merged.push(interval.slice());
  }
  return merged;
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
    visited[start] = 1;
    let cursor = 0;
    let minX = columns, minY = rows, maxX = -1, maxY = -1;

    while (cursor < queue.length) {
      const index = queue[cursor++];
      cells.push(index);
      const gx = index % columns;
      const gy = Math.floor(index / columns);
      minX = Math.min(minX, gx);
      minY = Math.min(minY, gy);
      maxX = Math.max(maxX, gx);
      maxY = Math.max(maxY, gy);
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

    const cellSet = new Set(cells);
    const horizontal = new Map();
    const vertical = new Map();
    const addInterval = (map, key, left, right) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push([left, right]);
    };

    for (const index of cells) {
      const gx = index % columns;
      const gy = Math.floor(index / columns);
      const left = gx * step, top = gy * step;
      const right = Math.min(width, left + step), bottom = Math.min(height, top + step);
      if (!cellSet.has(index - columns)) addInterval(horizontal, top, left, right);
      if (gx === columns - 1 || !cellSet.has(index + 1)) addInterval(vertical, right, top, bottom);
      if (gy === rows - 1 || !cellSet.has(index + columns)) addInterval(horizontal, bottom, left, right);
      if (gx === 0 || !cellSet.has(index - 1)) addInterval(vertical, left, top, bottom);
    }

    const outline = [];
    for (const [y, intervals] of horizontal) {
      for (const [left, right] of mergeIntervals(intervals)) outline.push([left, y, right, y]);
    }
    for (const [x, intervals] of vertical) {
      for (const [top, bottom] of mergeIntervals(intervals)) outline.push([x, top, x, bottom]);
    }
    outline.sort((a, b) => {
      const aHorizontal = a[1] === a[3];
      const bHorizontal = b[1] === b[3];
      if (aHorizontal !== bHorizontal) return aHorizontal ? -1 : 1;
      return aHorizontal ? (a[1] - b[1] || a[0] - b[0]) : (a[0] - b[0] || a[1] - b[1]);
    });

    const x = minX * step, y = minY * step;
    const right = Math.min(width, (maxX + 1) * step);
    const bottom = Math.min(height, (maxY + 1) * step);
    const center = { x: (x + right) / 2, y: (y + bottom) / 2 };
    const bucketX = Math.max(step * 4, Math.round(width / 8));
    const bucketY = Math.max(step * 4, Math.round(height / 6));
    regions.push({
      id: `${Math.round(center.x / bucketX)}-${Math.round(center.y / bucketY)}`,
      samples: cells.length,
      bounds: { x, y, width: right - x, height: bottom - y },
      center,
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
  const thresholdSquared = 90 * 90;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      let red = 0, green = 0, blue = 0, count = 0;
      for (let sampleY = y; sampleY < Math.min(height, y + step); sampleY += 1) {
        for (let sampleX = x; sampleX < Math.min(width, x + step); sampleX += 1) {
          const index = (sampleY * width + sampleX) * 4;
          red += data[index];
          green += data[index + 1];
          blue += data[index + 2];
          count += 1;
        }
      }
      if (!count) continue;
      const r = Math.round(red / count), g = Math.round(green / count), b = Math.round(blue / count);
      if (classifyColor(r, g, b).name.toLowerCase() !== targetColor.toLowerCase()) continue;
      const dr = r - targetRgb.r, dg = g - targetRgb.g, db = b - targetRgb.b;
      if (dr * dr + dg * dg + db * db > thresholdSquared) continue;
      mask[Math.floor(y / step) * columns + Math.floor(x / step)] = 1;
    }
  }

  const spatialMask = removeIsolatedMaskNoise(mask, columns, rows);
  const stableMask = shadeMaskStabilizer.stabilize(spatialMask, columns, rows);
  const regions = getBinaryRegions(stableMask, width, height, step)
    .map((region) => ({ ...region, hex: rgbToHex(targetRgb) }));
  const [smoothedGroup] = shadeRegionSmoother.smoothRegions([
    { name: targetColor, regions, bounds: null, samples: regions.reduce((sum, region) => sum + region.samples, 0) }
  ], width, height);
  return smoothedGroup?.regions || [];
}

function refreshTargetRegions() {
  const color = latestColors.find((item) => item.name.toLowerCase() === targetColor.toLowerCase());
  latestTargetRegions = targetRgb
    ? getShadeMatchRegions()
    : (color?.regions || (color ? [{ bounds: color.bounds, center: getRegionCenter(color), id: "all" }] : []));
}

function updateTargetChips() {
  if (!latestTargetRegions.length) {
    setCameraChips([]);
    setFeedback(findResult, `Looking for ${targetShade || targetColor}…`);
    return;
  }

  const chips = latestTargetRegions.slice(0, 8).map((region, index) => ({
    key: `find-${region.id || index}`,
    label: targetShade || targetColor,
    color: targetColor,
    point: getRegionCenter(region),
    hex: targetRgb ? rgbToHex(targetRgb) : region.hex
  }));
  setCameraChips(showColorChips ? chips : []);
  setFeedback(findResult, `${targetShade || targetColor} detected · ${getApproximateRegion(latestTargetRegions[0])}`);
}

function drawTargetOverlay() {
  latestTargetRegions.slice(0, 8).forEach((region) => drawRegionOutline(region, "#f5e6a1"));
}

function drawTaskGuidance(updateChips = false) {
  if (!activeTask || !canvas.width || !canvas.height) {
    if (updateChips) setCameraChips([]);
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
          key: `task-${cueIndex}-${region.id || regionIndex}`,
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
      chips.push({ key: `task-target-${region.id || index}`, label: activeTask.color || activeTask.normalizedColor, color: activeTask.normalizedColor, hex: region.hex, point });
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
  if (updateChips) setCameraChips(showColorChips ? chips : []);
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
    lastAnalysisAt = 0;
    lastSampleAt = 0;
    latestTargetRegions = [];
    smoothedSampleRgb = null;
    colorMaskStabilizer.reset();
    shadeMaskStabilizer.reset();
    shadeRegionSmoother.reset();
    toggleCamBtn.disabled = false;
    toggleCamBtn.setAttribute("aria-pressed", "true");
    toggleCamBtn.classList.add("is-active");
    toggleCamLabel.textContent = "Stop camera";
    colorSelect.disabled = false;
    taskBtn.disabled = Boolean(activeTask?.completed) || Boolean(activeTask?.canAutoVerify && !streaming);
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
  lastAnalysisAt = 0;
  lastSampleAt = 0;
  latestColors = [];
  latestTargetRegions = [];
  smoothedSampleRgb = null;
  colorMaskStabilizer.reset();
  shadeMaskStabilizer.reset();
  shadeRegionSmoother.reset();
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
  taskBtn.disabled = Boolean(activeTask?.completed) || Boolean(activeTask?.canAutoVerify);

  cameraPlaceholder.classList.remove("is-hidden");
  sampleIndicator.classList.remove("is-visible", "is-below");
  setCameraChips([]);
  sampleSwatch.style.backgroundColor = "";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  samplingContext.clearRect(0, 0, samplingCanvas.width, samplingCanvas.height);

  setCameraStatus("Camera off", "off");
  setFeedback(findResult, "Choose a target to begin.");
  if (activeTask && !activeTask.completed) {
    setFeedback(taskResult, activeTask.canAutoVerify ? "Start the camera to check placement." : "Start the camera to show visual cues.");
  }
}

function updateModeGuidance() {
  if (currentMode === "see") {
    const chips = showColorChips
      ? latestColors.flatMap((color) => (color.regions || []).map((region, index) => ({
          key: `see-${color.name}-${region.id || index}`,
          label: color.name,
          color: color.name,
          hex: region.hex,
          point: getRegionCenter(region),
          samples: region.samples
        }))).sort((a, b) => b.samples - a.samples).slice(0, 10)
      : [];
    setCameraChips(chips);
  } else if (currentMode === "find" && targetColor) {
    refreshTargetRegions();
    updateTargetChips();
  } else if (currentMode === "do" && activeTask) {
    drawTaskGuidance(true);
  } else {
    setCameraChips([]);
  }
}

function processLoop(timestamp = performance.now()) {
  if (!streaming) return;

  try {
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const frameWidth = 320;
      const frameHeight = Math.max(1, Math.round(frameWidth * video.videoHeight / video.videoWidth));
      if (canvas.width !== frameWidth || canvas.height !== frameHeight) {
        canvas.width = frameWidth;
        canvas.height = frameHeight;
      }

      // Keep the preview fluid while running the more expensive detector less often.
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      let overlayDrawn = false;
      const shouldAnalyze = !lastAnalysisAt || timestamp - lastAnalysisAt >= ANALYSIS_INTERVAL_MS;

      if (shouldAnalyze) {
        const result = analyzeVideoFrame(video, analysisCanvas, colorMaskStabilizer);
        lastAnalysisAt = timestamp;
        if (result?.ready) {
          latestColors = result.colors || [];
          renderDetectedColors(latestColors);
          updateModeGuidance();
          overlayDrawn = currentMode === "do" && Boolean(activeTask);

          if (activeTask?.canAutoVerify && !activeTask.completed && !taskCompletionPending) {
            taskCheckFrames += 1;
            if (taskCheckFrames % 5 === 0) verifyTaskFrame();
          }
        }
      }

      if (currentMode === "find" && targetColor) {
        drawTargetOverlay();
      } else if (currentMode === "do" && activeTask && !overlayDrawn) {
        drawTaskGuidance(false);
      }

      if ((pointerIsOverCanvas || pointerIsDown || keyboardSamplingActive) && lastSamplePosition && timestamp - lastSampleAt >= 64) {
        const source = pointerIsDown ? "touch" : keyboardSamplingActive ? "keyboard" : "pointer";
        sampleImagePoint(lastSamplePosition, source);
        lastSampleAt = timestamp;
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
    const left = Math.max(0, pixelX - 2);
    const top = Math.max(0, pixelY - 2);
    const patchWidth = Math.min(width - left, 5);
    const patchHeight = Math.min(height - top, 5);
    const pixels = samplingContext.getImageData(left, top, patchWidth, patchHeight).data;
    let red = 0, green = 0, blue = 0, count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      red += pixels[index];
      green += pixels[index + 1];
      blue += pixels[index + 2];
      count += 1;
    }
    const rawRgb = [Math.round(red / count), Math.round(green / count), Math.round(blue / count)];
    const moved = !lastSamplePosition || Math.hypot(point.x - lastSamplePosition.x, point.y - lastSamplePosition.y) > 0.012;
    if (moved || !smoothedSampleRgb) {
      smoothedSampleRgb = rawRgb;
    } else {
      const blend = 0.38;
      smoothedSampleRgb = smoothedSampleRgb.map((value, index) => Math.round(value + (rawRgb[index] - value) * blend));
    }
    const color = classifyColor(...smoothedSampleRgb);

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

function renderColorDetails(sample) {
  const { r, g, b } = sample.rgb;
  const hsl = rgbToHsl(r, g, b);

  colorPreview.style.backgroundColor = sample.hex;
  colorNameDisplay.textContent = sample.name;
  colorHex.textContent = sample.hex;
  colorRgb.textContent = `(${r}, ${g}, ${b})`;
  colorHsl.textContent = `(${hsl.h}°, ${hsl.s}%, ${hsl.l}%)`;

  speakDetailsBtn.disabled = false;
  saveColorBtn.disabled = ["Unknown", "White", "Gray"].includes(sample.name);
}

function resetColorDetails() {
  colorPreview.style.backgroundColor = "#e4e8e5";
  colorNameDisplay.textContent = "No sample yet";
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
  const orderedColors = [...colors].sort((a, b) => a.name.localeCompare(b.name));
  const signature = orderedColors.map((color) => color.name).join("|");

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

    if (orderedColors.length === 0) {
      const empty = document.createElement("li");
      empty.className = "detected-empty";
      empty.textContent = "No supported color groups in view.";
      detectedColorsList.append(empty);
      return;
    }

    for (const color of orderedColors) {
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
      detectedItemsByName.set(color.name, { count, region });
    }
  }

  for (const color of orderedColors) {
    const nodes = detectedItemsByName.get(color.name);
    if (!nodes) continue;
    const points = Number(color.samples) || 0;
    const countText = `${points.toLocaleString()} sampled points`;
    const regionText = getApproximateRegion(color);
    if (nodes.count.textContent !== countText) nodes.count.textContent = countText;
    if (nodes.region.textContent !== regionText) nodes.region.textContent = regionText;
  }
}

function sampleFromPointer(event) {
  const point = getImagePoint(event.clientX, event.clientY);
  if (!point) {
    lastSamplePosition = null;
    smoothedSampleRgb = null;
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
  lastSamplePosition = null;
  smoothedSampleRgb = null;
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
    smoothedSampleRgb = null;
    sampleIndicator.classList.remove("is-visible");
  }
});

canvas.addEventListener("focus", () => {
  if (!streaming || pointerIsDown) return;
  keyboardPosition = { x: 0.5, y: 0.5 };
  lastSamplePosition = null;
  smoothedSampleRgb = null;
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
  latestTargetRegions = [];
  shadeMaskStabilizer.reset();
  shadeRegionSmoother.reset();
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
  latestTargetRegions = [];
  shadeMaskStabilizer.reset();
  shadeRegionSmoother.reset();
  colorSelect.value = "";
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
      destination: result.destination || ""
    };
    taskSummaryInput.value = pendingTaskDraft.summary;
    renderTaskDraftPreview(pendingTaskDraft);
    parsedTask.hidden = false;
    setFeedback(interpretStatus, "Guide ready to review.");
  } catch (error) {
    const fallbackSummary = text || "Follow the instruction in the attached photo.";
    pendingTaskDraft = {
      summary: fallbackSummary,
      steps: [fallbackSummary],
      visualCues: [],
      color: "",
      object: "",
      action: "",
      destination: ""
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
    const saved = await createTask(draft);
    setActiveTask(saved);
    setActiveMode("do");
    await refreshTaskLibrary();
    setFeedback(interpretStatus, "Visual guide is ready in the camera view.");
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
    canAutoVerify: Boolean(normalizedColor && zoneKey)
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
  taskBtn.disabled = Boolean(task.completed) || Boolean(activeTask.canAutoVerify && !streaming);
  taskBtn.textContent = task.completed ? "Completed" : activeTask.canAutoVerify ? "Check placement" : "Mark complete";
  setFeedback(taskResult, task.completed
    ? "This guide is complete."
    : activeTask.canAutoVerify
      ? "Camera is checking the target color in the named area."
      : streaming
        ? "Follow the visual cues, then confirm when finished."
        : "Start the camera to show visual cues.");
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

taskBtn.addEventListener("click", () => {
  if (!activeTask || activeTask.completed) return;
  if (!activeTask.canAutoVerify) {
    completeActiveTask(false);
    return;
  }
  if (!streaming) return;

  const result = sampleColorInDestination();
  if (result.found) {
    setFeedback(taskResult, `Target found in ${activeTask.zoneKey}. Holding for confirmation…`);
    speak(`${activeTask.color || activeTask.normalizedColor} detected in ${activeTask.zoneKey}.`);
  } else {
    setFeedback(taskResult, `Target not confirmed in ${activeTask.zoneKey}.`);
    speak(`The target was not confirmed in ${activeTask.zoneKey}.`);
  }
});

async function completeActiveTask(cameraVerified = false) {
  if (!activeTask || taskCompletionPending) return;
  taskCompletionPending = true;
  activeTask.completed = true;
  taskStateMark.textContent = "✓";
  taskStateMark.style.color = "var(--success)";
  taskBtn.disabled = true;
  taskBtn.textContent = "Completed";
  setFeedback(taskResult, cameraVerified ? "Task verified by the camera." : "Task marked complete.");
  speak(cameraVerified ? "Task completed and verified." : "Task marked complete.");

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
