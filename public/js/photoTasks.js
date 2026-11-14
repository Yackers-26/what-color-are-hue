// "Read instructions from a photo". Take/upload a photo (and/or type the instruction),
// Gemini turns it into tasks, and each task can be sent to HueFind or saved to the task list.
//   import { mountPhotoTasks } from "/js/photoTasks.js";
//   mountPhotoTasks(document.getElementById("photo-tasks"), {
//     onFindColor: (color) => { /* HueFind: color = { colorName, rgb } */ }
//   });
// "Find" also fires window event "huememory:findagain", same as the palette's Find again.

import { interpret, photoToDataUrl, createTask } from "./huememory.js";

// Rough RGB for each basic color name Gemini returns, so HueFind gets a target.
const COLOR_RGB = {
  red: { r: 220, g: 30, b: 40 }, orange: { r: 245, g: 140, b: 30 }, yellow: { r: 245, g: 220, b: 40 },
  green: { r: 40, g: 170, b: 60 }, blue: { r: 30, g: 90, b: 220 }, purple: { r: 130, g: 40, b: 200 },
  pink: { r: 240, g: 120, b: 180 }, brown: { r: 130, g: 80, b: 40 }, black: { r: 20, g: 20, b: 20 },
  white: { r: 245, g: 245, b: 245 }, gray: { r: 128, g: 128, b: 128 }, cyan: { r: 30, g: 200, b: 210 }
};

const STYLE_ID = "huememory-photo-styles";
const STYLES = `
.hm-photo { font-family: system-ui, sans-serif; max-width: 640px; color: #111; background: #fff;
  border: 2px solid #222; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
.hm-photo h2 { margin: 0 0 8px; font-size: 1.4rem; }
.hm-photo label { display: block; margin-top: 10px; font-weight: 600; }
.hm-photo input[type=text] { width: 100%; box-sizing: border-box; padding: 8px; border: 2px solid #555; border-radius: 8px; }
.hm-photo img { display: block; max-width: 100%; max-height: 240px; margin-top: 10px; border: 1px solid #555; }
.hm-photo button, .hm-photo input { font: inherit; font-size: 1rem; }
.hm-photo button { padding: 8px 14px; min-height: 44px; border-radius: 8px; border: 2px solid #111;
  background: #fff; color: #111; cursor: pointer; }
.hm-photo button.hm-primary { background: #111; color: #fff; margin-top: 12px; }
.hm-photo button:disabled { opacity: 0.5; cursor: default; }
.hm-photo button:focus-visible, .hm-photo input:focus-visible { outline: 3px solid #0057d9; outline-offset: 2px; }
.hm-photo ol { padding-left: 1.4em; display: grid; gap: 10px; }
.hm-photo li { line-height: 1.5; }
.hm-photo .hm-task-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
.hm-photo [hidden] { display: none; }
`;

function addStylesOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of [].concat(children)) node.append(child);
  return node;
}

function describe(task) {
  const where = task.destination ? ` to ${task.destination}` : "";
  return `${task.action} the ${task.color} ${task.object}${where}`;
}

export function mountPhotoTasks(container, { onFindColor, title = "Read instructions from a photo" } = {}) {
  addStylesOnce();

  const id = Math.random().toString(36).slice(2, 8);
  container.innerHTML = `
    <section class="hm-photo" aria-labelledby="hm-photo-title-${id}">
      <h2 id="hm-photo-title-${id}">${title}</h2>
      <label for="hm-photo-file-${id}">Take or choose a photo of the instructions or items:</label>
      <input id="hm-photo-file-${id}" type="file" accept="image/*" capture="environment">
      <img alt="" hidden>
      <label for="hm-photo-text-${id}">Or type the instruction (optional):</label>
      <input id="hm-photo-text-${id}" type="text" placeholder="Pick up the red marker and place it in container A">
      <button type="button" class="hm-primary">Read instructions</button>
      <p class="hm-status" role="status" aria-live="polite"></p>
      <ol aria-label="Tasks from Gemini"></ol>
    </section>`;

  const fileInput = container.querySelector("input[type=file]");
  const preview = container.querySelector("img");
  const textInput = container.querySelector("input[type=text]");
  const readButton = container.querySelector("button.hm-primary");
  const status = container.querySelector(".hm-status");
  const list = container.querySelector("ol");

  let imageDataUrl = null;

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      imageDataUrl = await photoToDataUrl(file);
      preview.src = imageDataUrl;
      preview.alt = "Photo to read";
      preview.hidden = false;
      status.textContent = "Photo ready. Press Read instructions.";
    } catch {
      imageDataUrl = null;
      status.textContent = "Could not open that photo. Try a JPEG or PNG.";
    }
  });

  function renderTask(task) {
    const label = describe(task);
    const findButton = el("button", { type: "button", textContent: `Find ${task.color}` });
    findButton.setAttribute("aria-label", `Find ${task.color} with the camera`);
    findButton.addEventListener("click", () => {
      const detail = { colorName: task.color, rgb: COLOR_RGB[task.color.toLowerCase()] ?? null, task };
      onFindColor?.(detail);
      window.dispatchEvent(new CustomEvent("huememory:findagain", { detail }));
      status.textContent = `Looking for ${task.color}.`;
    });

    const saveButton = el("button", { type: "button", textContent: "Add to task list" });
    saveButton.setAttribute("aria-label", `Add task: ${label}`);
    saveButton.addEventListener("click", async () => {
      saveButton.disabled = true;
      try {
        await createTask(task);
        saveButton.textContent = "Added";
        status.textContent = `Added: ${label}.`;
      } catch (err) {
        saveButton.disabled = false;
        status.textContent = `Could not add task: ${err.message}`;
      }
    });

    const text = label.charAt(0).toUpperCase() + label.slice(1);
    return el("li", {}, [
      el("div", { textContent: text }),
      el("div", { className: "hm-task-actions" }, [findButton, saveButton])
    ]);
  }

  readButton.addEventListener("click", async () => {
    const text = textInput.value.trim();
    if (!imageDataUrl && !text) {
      status.textContent = "Add a photo or type an instruction first.";
      return;
    }

    readButton.disabled = true;
    list.replaceChildren();
    status.textContent = "Reading instructions…";
    try {
      const { tasks, summary } = await interpret({ text: text || undefined, image: imageDataUrl || undefined });
      list.replaceChildren(...tasks.map(renderTask));
      status.textContent = tasks.length
        ? `Found ${tasks.length} task${tasks.length === 1 ? "" : "s"}. ${summary || ""}`
        : summary || "No color tasks found.";
    } catch (err) {
      status.textContent = err.message;
    } finally {
      readButton.disabled = false;
    }
  });
}
