import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const read = (file) => readFile(fileURLToPath(new URL(file, import.meta.url)), "utf8");

test("merged workspace retains HueDo while exposing the integrated HueSee/HueFind controls", async () => {
  const [html, script, server, parser, memory] = await Promise.all([
    read("../public/index.html"), read("../public/script.js"), read("../server/index.js"),
    read("../public/js/hueDoParser.js"), read("../public/js/huememory.js")
  ]);
  for (const id of ["snapshotBtn", "soundToggle", "clearSceneBtn", "checkPictureBtn", "guideStepCard", "findShadeBtn", "findSuggestionDialog", "refineShadeBtn"]) {
    assert.match(html, new RegExp(`id="${id}"`), `Expected #${id} in merged workspace`);
  }
  assert.match(html, /id="colorSelect" type="text"/);
  assert.match(script, /resolveFindShade/);
  assert.match(script, /strictShade: targetStrictShade/);
  assert.match(script, /fetch\("\/api\/shades"/);
  assert.match(server, /app\.use\("\/api\/shades", requireAuthOrLocalDemo, shadesRouter\)/);
  assert.match(parser, /export function isSortTask\(/);
  assert.match(memory, /export function deleteTask\(/);
  assert.match(script, /function renderScene\(/);
});

test("live HueDo, reset behavior, concise speech, and real dark theme are wired", async () => {
  const [html, script, themeCss, tracker, loginHtml, loginScript, loginCss] = await Promise.all([
    read("../public/index.html"), read("../public/script.js"),
    read("../public/hue-upgrades.css"), read("../src/vision/liveObjectTracker.js"),
    read("../public/login.html"), read("../public/login.js"), read("../public/login.css")
  ]);
  assert.match(html, /id="themeToggle"/);
  assert.match(html, /Describe any color-dependent task: sort, group, match, compare/);
  assert.doesNotMatch(html, /LIVE COLOR TOOLS|COLOR WORKSPACE|HACKUMASS XIV/);
  assert.doesNotMatch(loginHtml, /PERSONAL COLOR WORKSPACE|HACKUMASS XIV/);
  assert.match(loginHtml, /id="authThemeToggle"/);
  assert.match(loginScript, /localStorage\.setItem\("hue-theme"/);
  assert.match(loginCss, /html\[data-theme="dark"\]/);
  assert.match(script, /const referenceScene = streaming \? await captureCameraScene\(\) : scenePhoto/);
  assert.match(script, /function drawHueDoLiveOverlay\(/);
  assert.match(script, /drawArrow\(targetCenter, destinationCenter/);
  assert.match(script, /Color cleared\. Search for another shade/);
  assert.match(script, /targetColor = "";\s+targetRgb = null;\s+targetShade = "";/);
  assert.match(script, /const shadeName = \(sample\.displayShade \|\| describeDetailedShade\(sample\.rgb\)\)\.name;\s+speak\(shadeName\)/);
  assert.match(script, /localStorage\.setItem\("hue-theme"/);
  assert.match(themeCss, /body\[data-theme="dark"\]/);
  assert.match(themeCss, /@media \(max-width: 600px\)/);
  assert.match(tracker, /export class LiveObjectTracker/);
});
