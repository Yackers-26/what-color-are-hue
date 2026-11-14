// "My Color Palette" panel. Drop it in a page with:
//   <div id="palette"></div>
//   <script type="module">
//     import { mountPalette } from "/js/palettePanel.js";
//     mountPalette(document.getElementById("palette"), {
//       onFindAgain: (color) => { /* HueFind: look for color.rgb */ }
//     });
//   </script>
// Find Again also fires a "huememory:findagain" event on window with the color in event.detail.

import { loadPalette, removeColor, resetPalette } from "./huememory.js";

const STYLE_ID = "huememory-palette-styles";
const STYLES = `
.hm-palette { font-family: system-ui, sans-serif; max-width: 640px; color: #111; background: #fff;
  border: 2px solid #222; border-radius: 12px; padding: 16px; }
.hm-palette h2 { margin: 0 0 8px; font-size: 1.4rem; }
.hm-palette .hm-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.hm-palette ul { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 10px; }
.hm-palette li { display: flex; align-items: center; gap: 12px; border: 1px solid #555; border-radius: 10px; padding: 10px; flex-wrap: wrap; }
.hm-palette .hm-swatch { width: 64px; height: 64px; border-radius: 8px; border: 2px solid #000;
  display: flex; align-items: flex-end; justify-content: center; font-size: 0.7rem; font-weight: 700;
  padding-bottom: 4px; box-sizing: border-box; flex-shrink: 0; }
.hm-palette .hm-info { flex: 1; min-width: 140px; line-height: 1.4; }
.hm-palette .hm-name { font-weight: 700; font-size: 1.1rem; }
.hm-palette .hm-actions { display: flex; gap: 8px; }
.hm-palette button { font: inherit; font-size: 1rem; padding: 8px 14px; min-height: 44px; border-radius: 8px;
  border: 2px solid #111; background: #fff; color: #111; cursor: pointer; }
.hm-palette button:hover { background: #eee; }
.hm-palette button:focus-visible { outline: 3px solid #0057d9; outline-offset: 2px; }
.hm-palette button.hm-primary { background: #111; color: #fff; }
.hm-palette button.hm-danger { border-color: #a40000; color: #a40000; }
.hm-palette .hm-status { margin: 8px 0 0; min-height: 1.2em; }
.hm-palette .hm-empty { color: #444; }
`;

function addStylesOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

// Black or white label text, whichever reads better on the swatch.
function labelColor(rgb) {
  if (!rgb) return "#000";
  const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return brightness > 140 ? "#000" : "#fff";
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of [].concat(children)) node.append(child);
  return node;
}

export function mountPalette(container, { onFindAgain, title = "My Color Palette" } = {}) {
  addStylesOnce();

  const headingId = `hm-title-${Math.random().toString(36).slice(2, 8)}`;
  const heading = el("h2", { id: headingId, textContent: title });
  const resetButton = el("button", { type: "button", className: "hm-danger", textContent: "Reset palette" });
  resetButton.setAttribute("aria-label", "Reset palette: remove all saved colors");
  const status = el("p", { className: "hm-status" });
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const list = el("ul");
  list.setAttribute("aria-labelledby", headingId);

  const section = el("section", { className: "hm-palette" }, [
    el("div", { className: "hm-header" }, [heading, resetButton]),
    status,
    list
  ]);
  section.setAttribute("aria-labelledby", headingId);
  container.replaceChildren(section);

  let colors = [];

  function say(message) {
    status.textContent = message;
  }

  function renderItem(color) {
    const label = color.shade && color.shade !== color.colorName
      ? `${color.colorName}, ${color.shade}`
      : color.colorName;
    const times = color.timesSaved === 1 ? "Saved 1 time" : `Saved ${color.timesSaved} times`;

    const swatch = el("div", { className: "hm-swatch", textContent: color.colorName });
    swatch.style.background = color.hex || "#ccc";
    swatch.style.color = labelColor(color.rgb);
    swatch.setAttribute("role", "img");
    swatch.setAttribute("aria-label", `Swatch: ${label}, ${color.hex || "no hex"}`);

    const info = el("div", { className: "hm-info" }, [
      el("div", { className: "hm-name", textContent: color.colorName }),
      el("div", { textContent: `Shade: ${color.shade}` }),
      el("div", { textContent: `Hex: ${color.hex || "unknown"}` }),
      el("div", { textContent: times })
    ]);

    const findButton = el("button", { type: "button", className: "hm-primary", textContent: "Find again" });
    findButton.setAttribute("aria-label", `Find ${label} again with the camera`);
    findButton.addEventListener("click", () => {
      const detail = { colorName: color.colorName, shade: color.shade, hex: color.hex, rgb: color.rgb, id: color._id };
      onFindAgain?.(detail);
      window.dispatchEvent(new CustomEvent("huememory:findagain", { detail }));
      say(`Looking for ${label}.`);
    });

    const removeButton = el("button", { type: "button", textContent: "Remove" });
    removeButton.setAttribute("aria-label", `Remove ${label} from palette`);
    removeButton.addEventListener("click", async () => {
      try {
        await removeColor(color._id);
        await refresh();
        say(`Removed ${label}.`);
        // Keep keyboard focus somewhere sensible after the item disappears.
        (list.querySelector("button.hm-primary") || resetButton).focus();
      } catch (err) {
        say(`Could not remove ${label}: ${err.message}`);
      }
    });

    return el("li", {}, [swatch, info, el("div", { className: "hm-actions" }, [findButton, removeButton])]);
  }

  function render() {
    list.replaceChildren(...colors.map(renderItem));
    resetButton.disabled = colors.length === 0;
    if (colors.length === 0) {
      list.append(el("li", { className: "hm-empty", textContent: "No saved colors yet. Save a color from the camera to see it here." }));
    }
  }

  async function refresh() {
    try {
      colors = await loadPalette();
      render();
    } catch (err) {
      say(`Could not load palette: ${err.message}`);
    }
  }

  resetButton.addEventListener("click", async () => {
    if (!window.confirm("Remove all saved colors?")) return;
    try {
      const { deleted } = await resetPalette();
      say(`Palette reset. Removed ${deleted} color${deleted === 1 ? "" : "s"}.`);
    } catch (err) {
      say(`Could not reset palette: ${err.message}`);
    }
  });

  // saveColor/removeColor/resetPalette fire this, so the panel stays up to date.
  const onChange = () => refresh();
  window.addEventListener("huememory:changed", onChange);

  refresh();

  return {
    refresh,
    destroy() {
      window.removeEventListener("huememory:changed", onChange);
      container.replaceChildren();
    }
  };
}
