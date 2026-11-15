// HueDo color-only fallback when a precise catalog swatch is not a reliable
// match for camera pixels. Gemini locates objects; local pixels decide whether
// the requested COLOR is actually present. No extra API calls are required.
import { resolveFindShade, normalizeShadeText } from "./hueFindSearch.js";
import { rgbToLab, rgbHue } from "./colorPerception.js";
import { describeDetailedShade } from "./perceptualShade.js";
import { findSmoothColorContours, matchesTargetColor } from "./smoothContours.js";

const DESCRIPTIVE_SHADE = /^(dark|deep|navy|light|pale|pastel)\s+(red|orange|yellow|green|blue|cyan|purple|pink|teal|brown|olive|gray)$/;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

function descriptiveColor(color) {
  const query = normalizeShadeText(color);
  const match = DESCRIPTIVE_SHADE.exec(query);
  if (!match) return null;
  return { modifier: match[1], family: match[2] === "navy" ? "blue" : match[2] };
}

function sampleRegionLightness(frame, region, family) {
  const { width, height, data } = frame;
  const { x, y, width: w, height: h } = region.bounds;
  const x0 = clamp(Math.floor(x), 0, width - 1);
  const y0 = clamp(Math.floor(y), 0, height - 1);
  const x1 = clamp(Math.ceil(x + w), 0, width);
  const y1 = clamp(Math.ceil(y + h), 0, height);
  const levels = [];
  // Sampling all broad-family pixels in this connected component's bounds
  // is robust to highlights, printing and small compression artifacts.
  for (let yy = y0; yy < y1; yy += 2) {
    for (let xx = x0; xx < x1; xx += 2) {
      const at = (yy * width + xx) * 4;
      if (data[at + 3] < 128) continue;
      const rgb = { r: data[at], g: data[at + 1], b: data[at + 2] };
      if (matchesTargetColor(rgb.r, rgb.g, rgb.b, family)) levels.push(rgbToLab(rgb).L);
    }
  }
  if (levels.length < 5) return null;
  levels.sort((a, b) => a - b);
  return levels[Math.floor(levels.length / 2)];
}

// HueFind and HueDo share the same catalog and contour engine. Muted real-world
// purple surfaces may be called gray by a generic saturation threshold, even
// though the camera records a distinct violet cast. Detect that cast without
// treating neutral gray, pink, or blue as purple.
export function matchesHueDoFamilyPixel(rgb, family) {
  if (!rgb) return false;
  const name = normalizeShadeText(family);
  if (matchesTargetColor(rgb.r, rgb.g, rgb.b, name)) return true;
  if (name !== "purple") return false;
  const hue = rgbHue(rgb);
  const lab = rgbToLab(rgb);
  return hue.hue >= 250 && hue.hue <= 319 && hue.saturation >= .085 &&
    lab.a >= 4.5 && lab.b <= -4.5 && Math.hypot(lab.a, lab.b) >= 7;
}

// Returns only verified, locally masked color regions, never a semantic bbox.
// Named hues like "burgundy" remain exact; freeform light/dark hues may match
// their real-world appearance without requiring pixel equality to a CSS chip.
export function findHueDoColorRegions(frame, color, { roiBounds = null, whiteBalance = null } = {}) {
  if (!frame?.data || !color) return [];
  const shade = resolveFindShade(color);
  const adjective = descriptiveColor(color);
  const family = adjective?.family || (shade.ok ? shade.family.toLowerCase() : "");
  if (!family) return [];
  const opts = { color: family, roiBounds, whiteBalance,
    minAreaFraction: .002, relativeMinArea: .12, maxRegions: 8 };

  if (!adjective) {
    // A specific named shade should never silently turn into a broad-family
    // match, otherwise lavender can highlight a navy object, for example.
    const strict = Boolean(shade.ok && !shade.broad);
    const regions = findSmoothColorContours(frame, {
      ...opts, rgb: strict ? shade.rgb : null,
      strictShade: strict,
      // An unqualified family ("purple") should match a real dusty-lavender
      // camera surface, not require its pixels to look like saturated CSS purple.
      pixelMatcher: strict ? null : (rgb) => matchesHueDoFamilyPixel(rgb, family)
    });
    return regions.map(region => ({
      ...region,
      observedShade: describeDetailedShade(region.rgb).name,
      requestedShade: shade.name,
      broadMatch: !strict
    }));
  }

  const candidates = findSmoothColorContours(frame, opts);
  if (!candidates.length) return [];
  const dark = ["dark", "deep", "navy"].includes(adjective.modifier);
  const limit = adjective.modifier === "deep" || adjective.modifier === "navy" ? 49
    : adjective.modifier === "dark" ? 55 : 55;
  const filtered = candidates.map(region => ({
    region, lightness: sampleRegionLightness(frame, region, family)
  })).filter(({ lightness }) => lightness !== null && (dark ? lightness <= limit : lightness >= limit));
  if (!filtered.length) return [];
  const ideal = adjective.modifier === "deep" || adjective.modifier === "navy" ? 35
    : adjective.modifier === "dark" ? 41 : adjective.modifier === "light" ? 70 : 83;
  filtered.sort((a, b) =>
    (Math.abs(a.lightness - ideal) - Math.min(10, a.region.samples / 55)) -
    (Math.abs(b.lightness - ideal) - Math.min(10, b.region.samples / 55))
  );
  // Only one object for a requested descriptive shade. Do not draw every
  // colored object in the scene or swap the entire screen's outline.
  return [{ ...filtered[0].region,
    observedShade: describeDetailedShade(filtered[0].region.rgb).name,
    requestedShade: String(color).trim(), broadMatch: true }];
}

export function isReliableHueDoOutline(target) {
  return Boolean(target?.visible && target?.points?.length >= 4 && target?.source === "color");
}
