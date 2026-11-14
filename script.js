// Adjust path if script.js is placed inside a subfolder (e.g., "../src/vision/cameraProcessor.js")
import { analyzeVideoFrame } from "./src/vision/cameraProcessor.js";

const video = document.getElementById("webcam");
const canvas = document.getElementById("outputCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const toggleCamBtn = document.getElementById("toggleCamBtn");
const announceBtn = document.getElementById("announceBtn");
const taskBtn = document.getElementById("taskBtn");
const colorSelect = document.getElementById("colorSelect");

const seeResult = document.getElementById("seeResult");
const findResult = document.getElementById("findResult");
const taskResult = document.getElementById("taskResult");
const announcer = document.getElementById("audioAnnouncement");

let streaming = false;
let animationFrameId = null;
let latestColors = [];
let targetColor = "";

// 1. Start / Stop Camera (Desktop + Mobile Rear-Facing Support)
toggleCamBtn.addEventListener("click", async () => {
  if (!streaming) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });

      video.srcObject = stream;
      await video.play();

      streaming = true;
      toggleCamBtn.textContent = "Stop Camera";
      toggleCamBtn.style.backgroundColor = "#c1121f";

      announceBtn.disabled = false;
      taskBtn.disabled = false;
      colorSelect.disabled = false;
      seeResult.textContent = "Scanning live feed...";

      processLoop();
    } catch (err) {
      console.error("Webcam access error:", err);
      seeResult.textContent = "Error: Could not access camera. Check HTTPS and permissions.";
    }
  } else {
    stopCamera();
  }
});

function stopCamera() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  const stream = video.srcObject;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  video.srcObject = null;
  streaming = false;
  latestColors = [];

  toggleCamBtn.textContent = "Start Camera";
  toggleCamBtn.style.backgroundColor = "";

  announceBtn.disabled = true;
  taskBtn.disabled = true;
  colorSelect.disabled = true;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  seeResult.textContent = "Status: Camera off";
}

// 2. Continuous Frame Analysis Loop using analyzeVideoFrame()
function processLoop() {
  if (!streaming) return;

  // Match canvas dimensions to live video stream
  if (video.videoWidth && video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  // Call teammate's vision processor
  const result = analyzeVideoFrame(video, canvas);

  // Ensure live video frame is drawn underneath overlays
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  if (result && result.ready) {
    latestColors = result.colors || [];
    updateHueSeeUI(latestColors);
    drawAccessibleOverlays(latestColors);
  }

  animationFrameId = requestAnimationFrame(processLoop);
}

// 3. Update Readable Color Labels in Control Panel
function updateHueSeeUI(colors) {
  if (colors.length === 0) {
    seeResult.textContent = "Detected: No solid colors found";
    return;
  }

  const labels = colors.map((c) => `${c.name.toUpperCase()} (${c.samples} samples)`);
  seeResult.textContent = `Detected: ${labels.join(" | ")}`;
}

// 4. Draw High-Contrast Outlines & Position Cues on Canvas
function drawAccessibleOverlays(colors) {
  colors.forEach((item) => {
    // If a specific color is chosen in HueFind, filter out other colors
    if (targetColor && item.name.toLowerCase() !== targetColor.toLowerCase()) {
      return;
    }

    const { x, y, width, height } = item.bounds;
    const isTargeted = targetColor && item.name.toLowerCase() === targetColor.toLowerCase();

    // High-contrast double-stroke outline (black outer + bright yellow/white inner)
    ctx.lineWidth = isTargeted ? 8 : 5;
    ctx.strokeStyle = "#000000";
    ctx.setLineDash(isTargeted ? [14, 6] : []);
    ctx.strokeRect(x, y, width, height);

    ctx.lineWidth = isTargeted ? 4 : 2;
    ctx.strokeStyle = isTargeted ? "#ffbe0b" : "#ffffff";
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);

    // Calculate horizontal position cue (Left / Center / Right)
    const centerX = x + width / 2;
    const positionCue =
      centerX < canvas.width * 0.33
        ? "Left"
        : centerX > canvas.width * 0.66
        ? "Right"
        : "Center";

    const labelText = `${item.name.toUpperCase()} (${positionCue})`;

    // High-contrast label badge
    ctx.font = "bold 18px system-ui, sans-serif";
    const textWidth = ctx.measureText(labelText).width;
    const badgeY = Math.max(28, y);

    ctx.fillStyle = "#000000";
    ctx.fillRect(x, badgeY - 28, textWidth + 16, 28);

    ctx.fillStyle = "#ffffff";
    ctx.fillText(labelText, x + 8, badgeY - 8);

    if (isTargeted) {
      findResult.textContent = `${item.name} detected on the ${positionCue.toLowerCase()}`;
    }
  });

  if (targetColor && !colors.some((c) => c.name.toLowerCase() === targetColor.toLowerCase())) {
    findResult.textContent = `Searching for ${targetColor}...`;
  }
}

// 5. HueFind Filter Selection
colorSelect.addEventListener("change", (e) => {
  targetColor = e.target.value;
  if (targetColor) {
    findResult.textContent = `Searching for ${targetColor}...`;
    speak(`Highlighting ${targetColor}`);
  } else {
    findResult.textContent = "Showing all colors";
  }
});

// 6. Audio Feedback & HueDo Hook
announceBtn.addEventListener("click", () => {
  if (latestColors.length === 0) {
    speak("No colors currently detected.");
  } else {
    const names = latestColors.map((c) => c.name).join(", ");
    speak(`Detected colors: ${names}`);
  }
});

taskBtn.addEventListener("click", () => {
  const hasGreen = latestColors.some((c) => c.name.toLowerCase() === "green");
  if (hasGreen) {
    taskResult.textContent = "Green detected! Task verified in Box B.";
    speak("Task completed. Green block detected in Box B.");
  } else {
    taskResult.textContent = "Green block not yet detected in frame.";
    speak("Green block not detected yet.");
  }
});

function speak(text) {
  announcer.textContent = text;
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  }
}