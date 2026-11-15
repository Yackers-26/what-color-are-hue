import test from "node:test";
import assert from "node:assert/strict";
import { deltaE2000, shadeCatalogSize, describeDetailedShade,
  plausibleLightingChange, createShadeIdentityTracker } from "../src/vision/perceptualShade.js";
import { normalizeGeminiShadeResult, validImage } from "../src/vision/shadeRefinement.js";

const rgb = hex => ({ r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) });

test("CIEDE2000 matches a published reference pair", () => {
  const v = deltaE2000({ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 });
  assert.ok(Math.abs(v - 2.0425) < 0.001, `got ${v}`);
});

test("expanded catalog has hundreds of independently named shades", () => {
  assert.ok(shadeCatalogSize() >= 275);
  for (const [hex, wanted] of [["D2691E", "Chocolate"], ["7FFF00", "Chartreuse"], ["32CD32", "Lime green"],
    ["8B4513", "Saddle brown"], ["708090", "Slate gray"], ["800020", "Burgundy"],
    ["F0F8FF", "Alice blue"], ["006A4E", "Bottle green"], ["50C878", "Emerald green"]]) {
    assert.equal(describeDetailedShade(rgb(hex)).name, wanted, hex);
  }
});

test("brown-orange and lime-yellow remain different color families", () => {
  assert.equal(describeDetailedShade(rgb("6F4E37")).family, "Brown");
  assert.equal(describeDetailedShade(rgb("FF8C00")).family, "Orange");
  assert.equal(describeDetailedShade(rgb("B6E030")).family, "Green");
  assert.equal(describeDetailedShade(rgb("FFFF00")).family, "Yellow");
});

test("plausible lighting shifts preserve chromaticity but not wholly different hues", () => {
  assert.equal(plausibleLightingChange(rgb("9CAF88"), rgb("536047")), true);
  assert.equal(plausibleLightingChange(rgb("B36F3C"), rgb("693E21")), true);
  assert.equal(plausibleLightingChange(rgb("7FFF00"), rgb("397900")), true);
  assert.equal(plausibleLightingChange(rgb("7FFF00"), rgb("0000FF")), false);
  assert.equal(plausibleLightingChange(rgb("F0F0F0"), rgb("565656")), true);
  assert.equal(plausibleLightingChange(rgb("808080"), rgb("010101")), false);
});

test("HueSee local label is held during a shadow change at the same camera point", () => {
  const tracker = createShadeIdentityTracker();
  const point = { x: .45, y: .5 };
  const first = tracker.observe(rgb("9CAF88"), point, { immediate: true });
  const second = tracker.observe(rgb("536047"), point);
  assert.equal(second.name, first.name);
  assert.equal(second.lightingHeld, true);
  assert.equal(tracker.observe(rgb("0000FF"), point).name, first.name);
  assert.equal(tracker.observe(rgb("0000FF"), point).name, first.name);
  assert.equal(tracker.observe(rgb("0000FF"), point).family, "Blue");
  assert.equal(tracker.observe(rgb("32CD32"), { x: .75, y: .5 }).family, "Green");
});

test("bad inputs cannot be labeled with false confidence", () => {
  assert.equal(describeDetailedShade(null).name, "Unknown");
  assert.equal(plausibleLightingChange(null, rgb("808080")), false);
  assert.equal(validImage({ mimeType: "image/jpeg", data: "x" }), false);
});

test("Gemini retains the prior named shade only when image comparison supports it", () => {
  const raw = { shadeName: "Pale orange", colorFamily: "Orange", note: "Under a lamp.", confidence: "high", sameSurface: "yes", lightingChanged: "yes" };
  const same = normalizeGeminiShadeResult(raw, { previousName: "Chocolate brown", hasReference: true });
  assert.equal(same.name, "Chocolate brown");
  assert.equal(same.suggestedName, "Pale orange");
  assert.equal(same.identityHeld, true);
  const different = normalizeGeminiShadeResult({ ...raw, sameSurface: "no" }, { previousName: "Chocolate brown", hasReference: true });
  assert.equal(different.name, "Pale orange");
  assert.equal(different.identityHeld, false);
  assert.equal(different.needsConfirmation, true);
  const uncertain = normalizeGeminiShadeResult(raw, { previousName: "Chocolate brown", hasReference: false });
  assert.equal(uncertain.identityHeld, false);
  assert.equal(uncertain.sameSurface, "uncertain");
});

test("Gemini low-confidence photo cannot silently lock an old label", () => {
  const result = normalizeGeminiShadeResult({ shadeName: "Dark green", colorFamily: "green", note: "Deep shadow", confidence: "low", sameSurface: "yes", lightingChanged: "yes" }, { previousName: "Lime green", hasReference: true });
  assert.equal(result.name, "Lime green");
  assert.equal(result.identityHeld, false);
  assert.equal(result.needsConfirmation, true);
});

test("uncertain paired images do not silently rename a previously pinned shade", () => {
  const result = normalizeGeminiShadeResult({ shadeName: "Orange", colorFamily: "orange", note: "Strong warm shadow", confidence: "medium", sameSurface: "uncertain", lightingChanged: "yes" }, { previousName: "Caramel brown", hasReference: true });
  assert.equal(result.name, "Caramel brown");
  assert.equal(result.provisionalHold, true);
  assert.equal(result.needsConfirmation, true);
});
