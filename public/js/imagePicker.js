// "Add a color from an image". Pick an image, click (or use arrow keys + Enter on)
// a spot, preview the color, then save it to the HueMemory palette.
//   import { mountImagePicker } from "/js/imagePicker.js";
//   mountImagePicker(document.getElementById("image-picker"));

import { classifyColor } from "/src/vision/colorDetector.js";
import { saveColor } from "./huememory.js";

const STYLE_ID = "huememory-picker-styles";
const STYLES = `
.hm-picker { font-family: system-ui, sans-serif; max-width: 640px; color: #111; background: #fff;
  border: 2px solid #222; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
.hm-picker h2 { margin: 0 0 8px; font-size: 1.4rem; }
.hm-picker canvas { display: block; max-width: 100%; margin-top: 12px; cursor: crosshair; border: 1px solid #555; }
.hm-picker canvas:focus-visible { outline: 3px solid #0057d9; outline-offset: 2px; }
.hm-picker .hm-pick-row { display: flex; align-items: center; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
.hm-picker .hm-swatch { width: 48px; height: 48px; border-radius: 8px; border: 2px solid #000; }
.hm-picker button, .hm-picker input { font: inherit; font-size: 1rem; }
.hm-picker button { padding: 8px 14px; min-height: 44px; border-radius: 8px; border: 2px solid #111;
  background: #111; color: #fff; cursor: pointer; }
.hm-picker button:disabled { opacity: 0.5; cursor: default; }
.hm-picker button:focus-visible, .hm-picker input:focus-visible { outline: 3px solid #0057d9; outline-offset: 2px; }
.hm-picker [hidden] { display: none; }
`;

const SAMPLE = 5; // average a 5x5 area so one noisy pixel doesn't decide the color
const STEP = 10;  // arrow keys move the marker this many pixels

function addStylesOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

export function mountImagePicker(container, { title = "Add a color from an image", onSaved } = {}) {
  addStylesOnce();

  const id = Math.random().toString(36).slice(2, 8);
  container.innerHTML = `
    <section class="hm-picker" aria-labelledby="hm-pick-title-${id}">
      <h2 id="hm-pick-title-${id}">${title}</h2>
      <label for="hm-file-${id}">Choose an image:</label>
      <input id="hm-file-${id}" type="file" accept="image/*">
      <p id="hm-help-${id}" hidden>Click the spot you want, or focus the image and use the arrow keys, then press Enter.</p>
      <canvas tabindex="0" hidden role="img" aria-describedby="hm-help-${id}"></canvas>
      <div class="hm-pick-row" hidden>
        <div class="hm-swatch" aria-hidden="true"></div>
        <span class="hm-picked"></span>
        <button type="button">Save to palette</button>
      </div>
      <p class="hm-status" role="status" aria-live="polite"></p>
    </section>`;

  const fileInput = container.querySelector("input");
  const help = container.querySelector(`#hm-help-${id}`);
  const canvas = container.querySelector("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const row = container.querySelector(".hm-pick-row");
  const swatch = row.querySelector(".hm-swatch");
  const pickedText = row.querySelector(".hm-picked");
  const saveButton = row.querySelector("button");
  const status = container.querySelector(".hm-status");

  let image = null;
  let marker = { x: 0, y: 0 };
  let picked = null;

  function draw() {
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (!picked) return;
    // Black-and-white ring so the marker shows up on any color.
    for (const [color, radius] of [["#000", 9], ["#fff", 7]]) {
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function pickAt(x, y) {
    marker = {
      x: Math.max(0, Math.min(canvas.width - 1, Math.round(x))),
      y: Math.max(0, Math.min(canvas.height - 1, Math.round(y)))
    };

    // Read pixels from the clean image (redraw without the marker first).
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const half = Math.floor(SAMPLE / 2);
    const sx = Math.max(0, marker.x - half);
    const sy = Math.max(0, marker.y - half);
    const { data } = ctx.getImageData(sx, sy, SAMPLE, SAMPLE);

    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
    }
    if (count === 0) return;

    picked = classifyColor(Math.round(r / count), Math.round(g / count), Math.round(b / count));
    swatch.style.background = picked.hex;
    pickedText.textContent = `${picked.name} (${picked.hex})`;
    canvas.setAttribute("aria-label", `Image. Selected color: ${picked.name}, ${picked.hex}`);
    row.hidden = false;
    saveButton.disabled = false;
    status.textContent = `Selected ${picked.name}.`;
    draw();
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Shrink big photos so they fit; picking still uses the shown pixels.
      const scale = Math.min(1, 600 / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      image = img;
      picked = null;
      row.hidden = true;
      canvas.hidden = false;
      help.hidden = false;
      canvas.setAttribute("aria-label", "Image. No color selected yet.");
      draw();
      URL.revokeObjectURL(url);
      pickAt(canvas.width / 2, canvas.height / 2); // start in the middle
      canvas.focus();
    };
    img.onerror = () => { status.textContent = "Could not open that image."; };
    img.src = url;
  });

  canvas.addEventListener("click", (event) => {
    const rect = canvas.getBoundingClientRect();
    pickAt(
      (event.clientX - rect.left) * (canvas.width / rect.width),
      (event.clientY - rect.top) * (canvas.height / rect.height)
    );
  });

  canvas.addEventListener("keydown", (event) => {
    const moves = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] };
    if (moves[event.key]) {
      event.preventDefault();
      pickAt(marker.x + moves[event.key][0], marker.y + moves[event.key][1]);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      saveButton.click();
    }
  });

  saveButton.addEventListener("click", async () => {
    if (!picked) return;
    saveButton.disabled = true;
    try {
      const saved = await saveColor(picked); // the palette panel refreshes by itself
      status.textContent = `Saved ${picked.name} to your palette.`;
      onSaved?.(saved);
    } catch (err) {
      status.textContent = `Could not save: ${err.message}`;
    } finally {
      saveButton.disabled = false;
    }
  });
}
