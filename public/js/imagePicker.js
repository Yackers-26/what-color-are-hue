import { classifyColor } from "/src/vision/colorDetector.js";
import { saveColor } from "./huememory.js";

const STYLE_ID = "huememory-picker-styles";
const STYLES = `
.hm-picker { color:var(--ink,#20252a); }
.hm-picker h4 { margin:0 0 10px; color:var(--muted,#667078); font-size:10px; font-weight:800; }
.hm-picker .hm-file { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
.hm-picker input[type=file] { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }
.hm-picker .hm-choose { display:inline-flex; min-height:36px; align-items:center; padding:7px 11px; border:1px solid var(--line,#e4e1d9);
  border-radius:9px; background:var(--surface-soft,#f8f7f2); color:var(--brand,#344e4a); cursor:pointer; font-size:10px; font-weight:800; }
.hm-picker .hm-canvas { display:block; width:100%; max-height:280px; margin-top:12px; border:1px solid var(--line,#e4e1d9);
  border-radius:12px; background:#182321; object-fit:contain; cursor:crosshair; touch-action:pan-y; }
.hm-picker .hm-canvas:focus-visible { outline:3px solid var(--focus,#b65c36); outline-offset:3px; }
.hm-picker .hm-picked-row { display:flex; align-items:center; gap:10px; margin-top:12px; }
.hm-picker .hm-swatch { width:38px; height:38px; flex:0 0 38px; border:1px solid rgba(0,0,0,.18); border-radius:10px; }
.hm-picker .hm-picked-copy { min-width:0; flex:1; }
.hm-picker .hm-picked-name { color:var(--ink,#20252a); font-size:11px; font-weight:800; }
.hm-picker .hm-picked-hex { color:var(--muted,#667078); font:10px ui-monospace,monospace; }
.hm-picker .hm-save { min-height:36px; padding:7px 11px; border:0; border-radius:9px; background:var(--brand,#344e4a);
  color:#fff; cursor:pointer; font-size:10px; font-weight:800; }
.hm-picker button:disabled { opacity:.45; cursor:not-allowed; }
.hm-picker .hm-status { min-height:1.2em; margin:9px 0 0; color:var(--muted,#667078); font-size:10px; }
.hm-picker [hidden] { display:none !important; }
`;

const SAMPLE = 5;
const STEP = 10;

function addStylesOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

export function mountImagePicker(container, { title = "Pick a color", onSaved } = {}) {
  addStylesOnce();

  const id = `hm-pick-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 8)}`;
  container.innerHTML = `
    <section class="hm-picker" aria-labelledby="${id}-title">
      <h4 id="${id}-title">${title}</h4>
      <div class="hm-file">
        <label class="hm-choose" for="${id}-file">Choose image</label>
        <input id="${id}-file" type="file" accept="image/*">
        <span class="hm-file-name" aria-live="polite">No image selected</span>
      </div>
      <p class="hm-help" hidden>Choose a point in the image. Use arrow keys for precise sampling.</p>
      <canvas class="hm-canvas" tabindex="0" hidden></canvas>
      <div class="hm-picked-row" hidden>
        <span class="hm-swatch" aria-hidden="true"></span>
        <span class="hm-picked-copy">
          <span class="hm-picked-name"></span><br>
          <span class="hm-picked-hex"></span>
        </span>
        <button class="hm-save" type="button" disabled>Save color</button>
      </div>
      <p class="hm-status" role="status" aria-live="polite"></p>
    </section>`;

  const fileInput = container.querySelector("input[type=file]");
  const fileName = container.querySelector(".hm-file-name");
  const help = container.querySelector(".hm-help");
  const canvas = container.querySelector("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const row = container.querySelector(".hm-picked-row");
  const swatch = row.querySelector(".hm-swatch");
  const pickedName = row.querySelector(".hm-picked-name");
  const pickedHex = row.querySelector(".hm-picked-hex");
  const saveButton = row.querySelector(".hm-save");
  const status = container.querySelector(".hm-status");

  let image = null;
  let marker = { x: 0, y: 0 };
  let picked = null;

  function draw() {
    if (!image) return;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (!picked) return;

    for (const [color, radius] of [["#111", 9], ["#fff", 7]]) {
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function pickAt(x, y) {
    if (!image) return;
    marker = {
      x: Math.max(0, Math.min(canvas.width - 1, Math.round(x))),
      y: Math.max(0, Math.min(canvas.height - 1, Math.round(y)))
    };

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const half = Math.floor(SAMPLE / 2);
    const sx = Math.max(0, Math.min(canvas.width - 1, marker.x - half));
    const sy = Math.max(0, Math.min(canvas.height - 1, marker.y - half));
    const sw = Math.min(SAMPLE, canvas.width - sx);
    const sh = Math.min(SAMPLE, canvas.height - sy);
    const { data } = ctx.getImageData(sx, sy, sw, sh);

    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
    }
    if (!count) return;

    picked = classifyColor(Math.round(r / count), Math.round(g / count), Math.round(b / count));
    swatch.style.background = picked.hex;
    pickedName.textContent = picked.name;
    pickedHex.textContent = picked.hex;
    canvas.setAttribute("aria-label", `Image color sampler. Selected ${picked.name}, ${picked.hex}. Use arrow keys to move.`);
    row.hidden = false;
    saveButton.disabled = false;
    status.textContent = `Selected ${picked.name}.`;
    draw();
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      status.textContent = "Choose an image file.";
      return;
    }

    fileName.textContent = file.name;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 720 / img.width, 420 / img.height);
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      image = img;
      picked = null;
      row.hidden = true;
      canvas.hidden = false;
      help.hidden = false;
      canvas.setAttribute("aria-label", "Image color sampler. No color selected.");
      draw();
      URL.revokeObjectURL(url);
      pickAt(canvas.width / 2, canvas.height / 2);
      canvas.focus();
    };
    img.onerror = () => {
      status.textContent = "Could not open that image.";
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });

  function getPoint(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  canvas.addEventListener("pointerdown", (event) => {
    const point = getPoint(event);
    if (!point) return;
    if (event.pointerType !== "mouse") event.preventDefault();
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    pickAt(point.x, point.y);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse" && event.buttons === 0) return;
    const point = getPoint(event);
    if (point) pickAt(point.x, point.y);
  });

  canvas.addEventListener("keydown", (event) => {
    const moves = {
      ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0],
      ArrowUp: [0, -STEP], ArrowDown: [0, STEP]
    };
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
      await saveColor(picked);
      status.textContent = `${picked.name} saved to HueMemory.`;
      onSaved?.(picked);
    } catch (error) {
      status.textContent = `Could not save: ${error.message}`;
    } finally {
      saveButton.disabled = false;
    }
  });
}
