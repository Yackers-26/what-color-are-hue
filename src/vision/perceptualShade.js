// HueSee-specific shade naming. These functions are side-effect free and can
// eventually be shared by HueFind/HueDo/HueMemory without changing those tabs.
import { rgbToLab, rgbHue } from "./colorPerception.js";
import { describeShade } from "./shadeNaming.js";
import { NAMED_SHADE_SWATCHES } from "./namedShadeCatalog.js";

const validRgb = rgb => Boolean(rgb) && [rgb.r, rgb.g, rgb.b].every(n => Number.isFinite(n) && n >= 0 && n <= 255);
const hexRgb = hex => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });
const toRad = degrees => degrees * Math.PI / 180;
const toDeg = radians => radians * 180 / Math.PI;
const angle = degrees => (degrees % 360 + 360) % 360;
const POW_25_7 = 6103515625;

// CIEDE2000, including low-chroma and hue wrap-around handling. A perceptual
// distance is more appropriate than Euclidean RGB for naming close shades.
export function deltaE2000(left, right) {
  const [L1, a1, b1] = [left.L, left.a, left.b];
  const [L2, a2, b2] = [right.L, right.a, right.b];
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const meanC = (C1 + C2) / 2;
  const g = 0.5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + POW_25_7)));
  const ap1 = (1 + g) * a1, ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1), cp2 = Math.hypot(ap2, b2);
  const h1 = cp1 < 1e-9 ? 0 : angle(toDeg(Math.atan2(b1, ap1)));
  const h2 = cp2 < 1e-9 ? 0 : angle(toDeg(Math.atan2(b2, ap2)));
  const dL = L2 - L1, dC = cp2 - cp1;
  let dh = h2 - h1;
  if (cp1 * cp2 < 1e-9) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin(toRad(dh / 2));
  const avgL = (L1 + L2) / 2, avgCp = (cp1 + cp2) / 2;
  let avgH = h1 + h2;
  if (cp1 * cp2 < 1e-9) avgH = h1 + h2;
  else if (Math.abs(h1 - h2) <= 180) avgH /= 2;
  else if (h1 + h2 < 360) avgH = (h1 + h2 + 360) / 2;
  else avgH = (h1 + h2 - 360) / 2;
  const T = 1 - 0.17 * Math.cos(toRad(avgH - 30))
    + 0.24 * Math.cos(toRad(2 * avgH))
    + 0.32 * Math.cos(toRad(3 * avgH + 6))
    - 0.20 * Math.cos(toRad(4 * avgH - 63));
  const deltaTheta = 30 * Math.exp(-(((avgH - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(avgCp ** 7 / (avgCp ** 7 + POW_25_7));
  const sL = 1 + (0.015 * (avgL - 50) ** 2) / Math.sqrt(20 + (avgL - 50) ** 2);
  const sC = 1 + 0.045 * avgCp, sH = 1 + 0.015 * avgCp * T;
  const rT = -Math.sin(toRad(2 * deltaTheta)) * rC;
  const l = dL / sL, c = dC / sC, h = dH / sH;
  return Math.sqrt(Math.max(0, l * l + c * c + h * h + rT * c * h));
}

// Each palette sample is preconverted just once, not on every camera frame.
const PALETTE = Object.freeze(NAMED_SHADE_SWATCHES.map(([name, hex]) => {
  const rgb = hexRgb(hex);
  return { name, hex, rgb, lab: rgbToLab(rgb), family: describeShade(rgb).family };
}));

export function shadeCatalogSize() { return PALETTE.length; }

export function describeDetailedShade(rgb) {
  const basic = describeShade(rgb);
  if (!validRgb(rgb) || basic.family === "Unknown") return { ...basic, referenceHex: null, distance: null };
  const lab = rgbToLab(rgb);
  let best = null;
  let bestDistance = Infinity;
  for (const entry of PALETTE) {
    // Preserve the original classifier's important brown/orange and
    // yellow/green boundaries rather than allowing an adjacent family to win.
    if (entry.family !== basic.family) continue;
    const distance = deltaE2000(lab, entry.lab);
    if (distance < bestDistance) { best = entry; bestDistance = distance; }
  }
  // Don't make up a precise named swatch when the sample isn't close to one.
  if (!best || bestDistance > 15) return { ...basic, referenceHex: null, distance: bestDistance };
  return { name: best.name, family: basic.family, referenceHex: best.hex, distance: Math.round(bestDistance * 10) / 10 };
}

// This is only evidence of similar CHROMATICITY, not proof of the same object.
// A pinned camera position or the Gemini reference-photo comparison supplies
// the missing spatial/contextual evidence.
export function plausibleLightingChange(reference, current) {
  if (!validRgb(reference) || !validRgb(current)) return false;
  const a = rgbHue(reference), b = rgbHue(current);
  const brightnessRatio = (b.brightness + 0.025) / (a.brightness + 0.025);
  if (brightnessRatio < 0.23 || brightnessRatio > 3.9) return false;
  const neutralA = a.saturation < .16, neutralB = b.saturation < .16;
  if (neutralA || neutralB) return neutralA && neutralB && brightnessRatio >= .33 && brightnessRatio <= 3;
  if (Math.abs(a.saturation - b.saturation) > .38) return false;
  const hueDiff = Math.abs(a.hue - b.hue);
  if (Math.min(hueDiff, 360 - hueDiff) > 31) return false;
  const normalized = rgb => {
    const total = Math.max(1, rgb.r + rgb.g + rgb.b);
    return [rgb.r / total, rgb.g / total, rgb.b / total];
  };
  const first = normalized(reference), second = normalized(current);
  return Math.hypot(...first.map((n, i) => n - second[i])) <= .20;
}

// Track a color identity while the pointer stays in one area. Light/shadow
// changes keep the previous named shade, but relocation or several strongly
// different chromatic readings start a new identity. Displayed HEX/RGB always
// come from actual camera measurements and are NEVER frozen or rewritten.
export function createShadeIdentityTracker({ changeAgreement = 3, maxMove = .045 } = {}) {
  let anchor = null, shade = null, position = null, pending = null, pendingCount = 0;
  return {
    observe(rgb, point = null, { immediate = false } = {}) {
      if (!validRgb(rgb)) return describeDetailedShade(rgb);
      const distance = point && position ? Math.hypot(point.x - position.x, point.y - position.y) : 0;
      const proposed = describeDetailedShade(rgb);
      if (!anchor || immediate || distance > maxMove) {
        anchor = { ...rgb }; shade = proposed; pending = null; pendingCount = 0;
      } else if (!plausibleLightingChange(anchor, rgb)) {
        // A real hue change must be observed repeatedly before switching.
        if (pending?.name === proposed.name && pending.family === proposed.family) pendingCount++;
        else { pending = proposed; pendingCount = 1; }
        if (pendingCount >= changeAgreement) {
          anchor = { ...rgb }; shade = proposed; pending = null; pendingCount = 0;
        }
      } else {
        pending = null; pendingCount = 0;
      }
      if (point) position = { x: point.x, y: point.y };
      return { ...shade, lightingHeld: !immediate && (shade.name !== proposed.name) };
    },
    reset() { anchor = null; shade = null; position = null; pending = null; pendingCount = 0; }
  };
}
