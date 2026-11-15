// HueFind's independent, local, text-to-shade lookup. One palette powers HueSee
// and HueFind; no API call or MongoDB connection is needed while searching.
import { NAMED_SHADE_SWATCHES } from "./namedShadeCatalog.js";
import { describeShade } from "./shadeNaming.js";
import { describeDetailedShade, deltaE2000 } from "./perceptualShade.js";
import { rgbToLab, rgbHue } from "./colorPerception.js";

const rgbFromHex = hex => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16)
});
const clamp = n => Math.max(0, Math.min(255, Math.round(n)));
const broadGroups = new Set(["red", "orange", "yellow", "green", "cyan", "blue", "purple", "black", "white", "gray", "brown", "pink", "teal", "olive", "beige"]);

export const normalizeShadeText = text => String(text || "")
  .trim().toLowerCase().replace(/\bgrey\b/g, "gray")
  .replace(/[–—_-]+/g, " ").replace(/\s+/g, " ");

const catalog = NAMED_SHADE_SWATCHES.map(([name, hex]) => ({
  name, hex, rgb: rgbFromHex(hex), key: normalizeShadeText(name),
  family: describeShade(rgbFromHex(hex)).family
}));
const byName = new Map();
for (const entry of catalog) if (!byName.has(entry.key)) byName.set(entry.key, entry);
const aliasMap = new Map([
  ["sage", "sage green"], ["olive green", "olive"], ["chartreuse green", "chartreuse"],
  ["lime", "lime green"], ["burgandy", "burgundy"],
  ["turquoise blue", "turquoise"], ["slate", "slate gray"],
  ["off white", "off-white"], ["grey", "gray"]
]);

export function listFindShadeNames() { return [...new Set(catalog.map(item => item.name))]; }

function changeLightness(rgb, modifier) {
  // Approximate descriptive adjectives conservatively; the user must still
  // confirm a suggested shade if a name cannot be resolved.
  const factor = { dark: .68, deep: .57, light: .40, pale: .28, pastel: .34, muted: .17, dusty: .21 }[modifier];
  if (factor === undefined) return rgb;
  if (["dark", "deep"].includes(modifier)) return { r: clamp(rgb.r * factor), g: clamp(rgb.g * factor), b: clamp(rgb.b * factor) };
  const towards = ["muted", "dusty"].includes(modifier) ? 135 : 255;
  return { r: clamp(rgb.r * (1 - factor) + towards * factor), g: clamp(rgb.g * (1 - factor) + towards * factor), b: clamp(rgb.b * (1 - factor) + towards * factor) };
}

function resolved(entry, query, options = {}) {
  return { ok: true, query, name: options.name || entry.name, hex: entry.hex,
    rgb: options.rgb || entry.rgb, family: String(entry.family || describeShade(entry.rgb).family),
    broad: Boolean(options.broad), source: options.source || "catalog" };
}

export function resolveFindShade(query) {
  const key = normalizeShadeText(query);
  if (!key || key.length > 100) return { ok: false, query: String(query || "").trim(), reason: "empty" };
  const hexInput = key.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (hexInput) {
    const raw = hexInput[1];
    const hex = (raw.length === 3 ? raw.split("").map(c => c + c).join("") : raw).toUpperCase();
    const rgb = rgbFromHex(`#${hex}`);
    return { ok: true, query, name: describeDetailedShade(rgb).name, hex: `#${hex}`, rgb,
      family: describeShade(rgb).family, broad: false, source: "hex" };
  }
  const rgbInput = key.match(/^rgb\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
  if (rgbInput) {
    const [r, g, b] = rgbInput.slice(1).map(Number);
    if (Math.max(r, g, b) <= 255) {
      const rgb = { r, g, b };
      return { ok: true, query, name: describeDetailedShade(rgb).name, rgb,
        hex: `#${[r, g, b].map(n => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`,
        family: describeShade(rgb).family, broad: false, source: "rgb" };
    }
  }
  const lookupKey = aliasMap.get(key) || key;
  const entry = byName.get(lookupKey);
  if (entry) return resolved(entry, query, { broad: broadGroups.has(key) });
  const match = lookupKey.match(/^(dark|deep|light|pale|pastel|muted|dusty) (.+)$/);
  if (match) {
    const base = byName.get(aliasMap.get(match[2]) || match[2]);
    if (base) {
      const rgb = changeLightness(base.rgb, match[1]);
      return resolved(base, query, { name: `${match[1][0].toUpperCase() + match[1].slice(1)} ${base.name}`,
        rgb, source: "modifier" });
    }
  }
  return { ok: false, query, reason: "unknown", suggestions: suggestFindShadeNames(query) };
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let before = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, before + (a[i - 1] === b[j - 1] ? 0 : 1));
      before = previous;
    }
  }
  return row[b.length];
}

export function suggestFindShadeNames(query, limit = 3) {
  const key = normalizeShadeText(query);
  if (!key) return [];
  const words = key.split(" ");
  return catalog.map(entry => {
    const edit = editDistance(key, entry.key);
    const similar = 1 - edit / Math.max(key.length, entry.key.length);
    const sharedWords = words.filter(word => word.length >= 3 && entry.key.split(" ").some(w => w.startsWith(word) || word.startsWith(w))).length;
    const score = Math.max(similar, Math.min(.88, sharedWords * .36)) + (entry.key.startsWith(key) ? .18 : 0);
    return { ...entry, score };
  }).filter(entry => entry.score >= .39).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// Find an alternative *actually represented by a substantial area of camera
// pixels*, not just a name from the catalog. Called once after a persistent
// no-match period, never on every animation frame.
export function findClosestVisibleShade(imageData, referenceRgb, { step = 10, minFraction = .045 } = {}) {
  if (!imageData?.data || !imageData.width || !imageData.height || !referenceRgb) return null;
  const { data, width, height } = imageData;
  const groups = new Map();
  let sampleCount = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      let r = 0, g = 0, b = 0, rr = 0, gg = 0, bb = 0, n = 0;
      for (let dy = 0; dy < Math.min(step, height - y); dy += 2) {
        for (let dx = 0; dx < Math.min(step, width - x); dx += 2) {
          const at = ((y + dy) * width + (x + dx)) * 4;
          if (data[at + 3] < 128) continue;
          r += data[at]; g += data[at + 1]; b += data[at + 2];
          rr += data[at] ** 2; gg += data[at + 1] ** 2; bb += data[at + 2] ** 2; n++;
        }
      }
      if (!n) continue;
      // Ignore tiles that straddle two different objects: their *average*
      // RGB invents a color that does not really exist on either surface.
      const variance = rr / n - (r / n) ** 2 + gg / n - (g / n) ** 2 + bb / n - (b / n) ** 2;
      if (variance > 1700) continue;
      const rgb = { r: r / n, g: g / n, b: b / n };
      const hue = rgbHue(rgb);
      const lab = rgbToLab(rgb);
      const neutral = hue.saturation < .17;
      const bucket = neutral
        ? `n:${Math.floor(lab.L / 11)}`
        : `c:${Math.floor(hue.hue / 15)}:${Math.floor(hue.saturation * 4)}:${Math.floor(lab.L / 17)}`;
      const group = groups.get(bucket) || { r: 0, g: 0, b: 0, count: 0 };
      group.r += rgb.r; group.g += rgb.g; group.b += rgb.b; group.count++;
      groups.set(bucket, group);
      sampleCount++;
    }
  }
  const targetLab = rgbToLab(referenceRgb);
  const minimum = Math.max(8, Math.ceil(sampleCount * minFraction));
  let best = null;
  for (const group of groups.values()) {
    if (group.count < minimum) continue;
    const rgb = { r: clamp(group.r / group.count), g: clamp(group.g / group.count), b: clamp(group.b / group.count) };
    const distance = deltaE2000(targetLab, rgbToLab(rgb));
    // Prefer nearby shades but avoid recommending an irrelevant tiny speck.
    const score = distance + Math.max(0, 12 - group.count) * .09;
    if (!best || score < best.score) {
      best = { rgb, name: describeDetailedShade(rgb).name, family: describeShade(rgb).family,
        hex: `#${[rgb.r, rgb.g, rgb.b].map(n => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`,
        distance: Math.round(distance * 10) / 10, score, sampledFraction: group.count / sampleCount };
    }
  }
  return best;
}
