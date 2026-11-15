import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { findHueDoColorRegions, matchesHueDoFamilyPixel } from '../src/vision/hueDoColorGuide.js';
import { normalizeHueDoVerification } from '../src/vision/hueDoVerification.js';
import { resolveFindShade } from '../src/vision/hueFindSearch.js';
import { findSmoothColorContours } from '../src/vision/smoothContours.js';

const rgb = hex => {
  const [r,g,b] = hex.slice(1).match(/../g).map(x => parseInt(x,16));
  return {r,g,b};
};
function frame(width=170, height=110, halves=[['#B0A4BA',0,60],['#708BD5',60,120],['#AAAAAA',120,170]]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const [hex] = halves.find(([_,a,b])=>x>=a && x<b) || halves[0];
    const c=rgb(hex),i=(y*width+x)*4;
    data[i]=c.r;data[i+1]=c.g;data[i+2]=c.b;data[i+3]=255;
  }
  return {width,height,data};
}
const read = name => readFile(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

test('Purple family accepts dusty lavender but not blue or neutral gray', () => {
  assert.equal(matchesHueDoFamilyPixel(rgb('#B0A4BA'),'purple'),true);
  assert.equal(matchesHueDoFamilyPixel(rgb('#7D6CA4'),'purple'),true);
  assert.equal(matchesHueDoFamilyPixel(rgb('#708BD5'),'purple'),false);
  assert.equal(matchesHueDoFamilyPixel(rgb('#AAAAAA'),'purple'),false);
  assert.equal(matchesHueDoFamilyPixel(rgb('#82737D'),'purple'),false);
});

test('A purple HueDo instruction outlines dusty lavender and auto-names the visible shade', () => {
  const found = findHueDoColorRegions(frame(), 'purple');
  assert.equal(found.length,1);
  assert.equal(found[0].observedShade,'Dusty lavender');
  assert.equal(found[0].broadMatch,true);
  assert.ok(found[0].bounds.x+found[0].bounds.width < 62);
  assert.equal(resolveFindShade('Dusty lavender').ok, true);
});

test('Exact shade searches remain pixel-specific rather than spreading to blue', () => {
  const exact = findHueDoColorRegions(frame(), 'Dusty lavender');
  assert.equal(exact.length,1);
  assert.equal(exact[0].broadMatch,false);
  assert.ok(exact[0].bounds.x+exact[0].bounds.width < 62);
  const blue = findHueDoColorRegions(frame(), 'Cornflower blue');
  assert.ok(blue.every(region => region.bounds.x >= 58));
});

test('HueFind shared contour behavior is not loosened by HueDo-only muted matcher', () => {
  const data=frame();
  assert.equal(findSmoothColorContours(data,{color:'purple',minAreaFraction:.002}).length,0);
});

test('Photo checks fail closed for wrong, unfinished or contradictory Gemini assessments',()=>{
  assert.deepEqual(normalizeHueDoVerification({done:true,outcome:'incorrect',message:'Wrong box'}),{
    done:false,outcome:'incorrect',message:'Wrong box',issues:[]
  });
  assert.equal(normalizeHueDoVerification({done:false,outcome:'incomplete'}).outcome,'incomplete');
  assert.equal(normalizeHueDoVerification({done:false}).outcome,'uncertain');
  assert.equal(normalizeHueDoVerification({done:true,outcome:'complete'}).done,true);
  assert.equal(normalizeHueDoVerification({done:true,outcome:'uncertain'}).done,false);
});

test('HueDo uses original task, persistent error banner, and initial reference photo',async()=>{
  const [client,api,markup] = await Promise.all([read('../public/script.js'),read('../server/routes/interpret.js'),read('../public/index.html')]);
  assert.match(api,/summary: instruction \|\| String\(parsed.summary\)/);
  assert.match(api,/normalizeHueDoVerification\(parsed\)/);
  assert.match(api,/Classify outcome as complete, incorrect/);
  assert.match(client,/const before = hueDoCheckReference;/);
  assert.match(client,/showHueDoCheckFeedback\(\{ \.\.\.result, outcome, message \}\)/);
  assert.match(markup,/id="hueDoCheckFeedback"[^>]+role="alert"/);
  assert.match(markup,/id="hueDoShadeHint"/);
});

test('The exact brand WhatColorAreHue? appears in both headers and page titles',async()=>{
  const [login,app] = await Promise.all([read('../public/login.html'),read('../public/index.html')]);
  for(const html of [login,app]) {
    assert.match(html,/>WhatColorAreHue\?<\/a>/);
    assert.match(html,/<title>[^<]*WhatColorAreHue\?/);
    assert.doesNotMatch(html,/>whatcolorarehue<span/);
  }
});

test('HueDo preserves the exact user-requested color phrase rather than Gemini substituting a camera shade',async()=>{
  const { requestedHueDoColor } = await import('../src/vision/hueDoLanguage.js');
  assert.equal(requestedHueDoColor('Find the purple pen.'),'purple');
  assert.equal(requestedHueDoColor('Find the dusty lavender pen.'),'dusty lavender');
  assert.equal(requestedHueDoColor('Put the dark blue pen into the case.'),'dark blue');
  assert.equal(requestedHueDoColor('Sort all the pens by their color.'),'');
  const route=await read('../server/routes/interpret.js');
  assert.match(route,/targetColor: multiItemTask \? "" : \(originalColor \|\|/);
});

test('Photo check status does not disappear when the live guide refreshes',async()=>{
  const [client,ui,css] = await Promise.all([read('../public/script.js'),read('../public/index.html'),read('../public/hue-upgrades.css')]);
  assert.match(client,/hueDoCheckFeedback\.hidden = false/);
  assert.match(client,/showHueDoCheckFeedback\(\{ outcome: "uncertain", message \}\)/);
  assert.match(client,/hueDoCheckReference = scenePhoto\?\.data/);
  assert.match(ui,/huedo-check-feedback/);
  assert.match(css,/huedo-check-feedback/);
});
