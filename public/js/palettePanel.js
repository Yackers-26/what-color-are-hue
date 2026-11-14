import { loadPalette, removeColor, resetPalette } from "./huememory.js";

const STYLE_ID = "huememory-palette-styles";
const STYLES = `
.hm-palette { min-width: 0; padding: 20px; border: 1px solid var(--line, #e4e1d9); border-radius: 19px;
  background: var(--surface, #fffefa); box-shadow: var(--shadow-soft, none); color: var(--ink, #20252a); }
.hm-palette .hm-header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.hm-palette h3 { margin:0; font:800 17px/1.2 Manrope,system-ui,sans-serif; letter-spacing:-.045em; }
.hm-palette .hm-count { margin:4px 0 0; color:var(--muted,#667078); font-size:10px; }
.hm-palette .hm-reset { min-height:32px; padding:6px 10px; border:1px solid var(--line,#e4e1d9); border-radius:9px;
  background:transparent; color:var(--muted,#667078); cursor:pointer; font:750 10px "DM Sans",system-ui,sans-serif; }
.hm-palette .hm-reset:hover:not(:disabled) { border-color:var(--line-strong,#d0ccc2); background:var(--surface-soft,#f8f7f2); color:var(--ink,#20252a); }
.hm-palette .hm-reset:disabled { opacity:.4; cursor:not-allowed; }
.hm-palette ul { display:grid; gap:8px; margin:14px 0 0; padding:0; list-style:none; }
.hm-palette li { display:flex; min-width:0; align-items:center; gap:11px; padding:10px; border:1px solid var(--line,#e4e1d9);
  border-radius:12px; background:var(--surface-soft,#f8f7f2); }
.hm-palette .hm-swatch { display:grid; width:48px; height:48px; flex:0 0 48px; place-items:end center; padding:4px;
  overflow:hidden; border:1px solid rgba(25,30,28,.2); border-radius:10px; font-size:8px; font-weight:850; }
.hm-palette .hm-info { min-width:0; flex:1; }
.hm-palette .hm-name { overflow:hidden; color:var(--ink,#20252a); font:800 12px Manrope,system-ui,sans-serif; text-overflow:ellipsis; white-space:nowrap; }
.hm-palette .hm-meta { margin-top:3px; color:var(--muted,#667078); font-size:9px; line-height:1.4; }
.hm-palette .hm-actions { display:flex; flex:0 0 auto; gap:6px; }
.hm-palette button.hm-action { min-height:32px; padding:6px 9px; border:1px solid var(--line-strong,#d0ccc2); border-radius:8px;
  background:#fff; color:var(--brand,#344e4a); cursor:pointer; font:800 9px "DM Sans",system-ui,sans-serif; }
.hm-palette button.hm-action:hover { background:var(--brand-soft,#e8efeb); }
.hm-palette button.hm-action.hm-danger { color:#9b4242; }
.hm-palette button:focus-visible { outline:3px solid var(--focus,#b65c36); outline-offset:2px; }
.hm-palette .hm-status { min-height:1.2em; margin:10px 0 0; color:var(--muted,#667078); font-size:10px; }
.hm-palette .hm-empty { display:block; padding:12px 2px; border:0; background:transparent; color:var(--muted,#667078); font-size:11px; }
@media (max-width:560px) {
  .hm-palette { padding:15px; }
  .hm-palette li { flex-wrap:wrap; }
  .hm-palette .hm-info { min-width:calc(100% - 70px); }
  .hm-palette .hm-actions { width:100%; padding-left:59px; }
  .hm-palette .hm-actions button { flex:1; }
}
`;

function addStylesOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

function labelColor(rgb) {
  if (!rgb) return "#000";
  const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return brightness > 145 ? "#000" : "#fff";
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of [].concat(children)) node.append(child);
  return node;
}

export function mountPalette(container, { onFindAgain, title = "My Color Palette" } = {}) {
  addStylesOnce();

  const headingId = `hm-title-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 8)}`;
  const heading = el("h3", { id: headingId, textContent: title });
  const count = el("p", { className: "hm-count", textContent: "Loading saved colors…" });
  const resetButton = el("button", { type: "button", className: "hm-reset", textContent: "Reset palette", disabled: true });
  resetButton.setAttribute("aria-label", "Reset palette: remove all saved colors");
  const status = el("p", { className: "hm-status" });
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const list = el("ul");
  list.setAttribute("aria-labelledby", headingId);

  const section = el("section", { className: "hm-palette" }, [
    el("div", { className: "hm-header" }, [
      el("div", {}, [heading, count]),
      resetButton
    ]),
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

    const swatch = el("div", { className: "hm-swatch", textContent: color.colorName });
    swatch.style.background = color.hex || "#ccc";
    swatch.style.color = labelColor(color.rgb);
    swatch.setAttribute("role", "img");
    swatch.setAttribute("aria-label", `Swatch: ${label}, ${color.hex || "no hex"}`);

    const times = color.timesSaved === 1 ? "Saved once" : `Saved ${color.timesSaved || 1} times`;
    const info = el("div", { className: "hm-info" }, [
      el("div", { className: "hm-name", textContent: label }),
      el("div", { className: "hm-meta", textContent: `${color.hex || "No HEX"} · ${times}` })
    ]);

    const findButton = el("button", { type: "button", className: "hm-action", textContent: "Find" });
    findButton.setAttribute("aria-label", `Find ${label} again with the camera`);
    findButton.addEventListener("click", () => {
      const detail = { colorName: color.colorName, shade: color.shade, hex: color.hex, rgb: color.rgb, id: color._id };
      onFindAgain?.(detail);
      window.dispatchEvent(new CustomEvent("huememory:findagain", { detail }));
      say(`Finding ${label}.`);
    });

    const removeButton = el("button", { type: "button", className: "hm-action hm-danger", textContent: "Remove" });
    removeButton.setAttribute("aria-label", `Remove ${label} from palette`);
    removeButton.addEventListener("click", async () => {
      removeButton.disabled = true;
      try {
        await removeColor(color._id);
        await refresh();
        say(`Removed ${label}.`);
        (list.querySelector("button.hm-action") || resetButton).focus();
      } catch (error) {
        say(`Could not remove ${label}: ${error.message}`);
        removeButton.disabled = false;
      }
    });

    return el("li", {}, [swatch, info, el("div", { className: "hm-actions" }, [findButton, removeButton])]);
  }

  function render() {
    list.replaceChildren(...colors.map(renderItem));
    count.textContent = `${colors.length} ${colors.length === 1 ? "saved color" : "saved colors"}`;
    resetButton.disabled = colors.length === 0;
    if (colors.length === 0) {
      list.append(el("li", {
        className: "hm-empty",
        textContent: "No saved colors yet. Save a camera sample or choose one from a photo."
      }));
    }
  }

  async function refresh() {
    try {
      colors = await loadPalette();
      render();
    } catch (error) {
      count.textContent = "Memory unavailable";
      list.replaceChildren(el("li", {
        className: "hm-empty",
        textContent: error.message || "Could not load saved colors."
      }));
      resetButton.disabled = true;
    }
  }

  resetButton.addEventListener("click", async () => {
    if (!window.confirm("Remove all saved colors from this session?")) return;
    resetButton.disabled = true;
    try {
      const { deleted } = await resetPalette();
      await refresh();
      say(`Removed ${deleted} saved ${deleted === 1 ? "color" : "colors"}.`);
    } catch (error) {
      say(`Could not reset palette: ${error.message}`);
      resetButton.disabled = colors.length === 0;
    }
  });

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
