import test from "node:test";
import assert from "node:assert/strict";
import { resolveFindShade, suggestFindShadeNames, findClosestVisibleShade, listFindShadeNames } from "../src/vision/hueFindSearch.js";
import { matchesTargetColor, findSmoothColorContours } from "../src/vision/smoothContours.js";

const rgb = (r, g, b) => ({r, g, b});
const frame = (width, height, color = [243, 242, 235]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i=0; i<width*height; i++) data.set([...color, 255], i*4);
  return {data, width, height, paint(x, y, w, h, [r,g,b]) {
    for (let row=y; row<y+h; row++) for(let col=x;col<x+w;col++)
      data.set([r,g,b,255], (row*width+col)*4);
  }};
};

test("HueFind text box resolves many named shades, not just eight family choices", () => {
  assert.ok(listFindShadeNames().length >= 280);
  for (const word of ["sage green", "chartreuse", "burgundy", "chocolate", "lime green", "beige", "gray", "olive", "slate gray", "teal", "royal blue"]) {
    const hit = resolveFindShade(word);
    assert.ok(hit.ok, `${word} must resolve`);
    assert.ok(hit.rgb);
  }
});

test("specific shades are exact-match searches; broad colors still search broad regions", () => {
  assert.equal(resolveFindShade("green").broad, true);
  assert.equal(resolveFindShade("lime green").broad, false);
  assert.equal(resolveFindShade("gray").broad, true);
  assert.equal(resolveFindShade("brown").family, "Brown");
});

test("HueFind accepts exact HEX, short HEX, and RGB strings", () => {
  assert.deepEqual(resolveFindShade("#7fff00").rgb, rgb(127,255,0));
  assert.equal(resolveFindShade("#abc").hex, "#AABBCC");
  assert.equal(resolveFindShade("rgb(156, 175, 136)").hex, "#9CAF88");
  assert.equal(resolveFindShade("rgb(256, 100, 100)").ok, false);
});

test("shade names support alternate spellings and modifiers", () => {
  assert.equal(resolveFindShade("grey").family, "Gray");
  assert.ok(resolveFindShade("Deep sage green").ok);
  assert.ok(resolveFindShade("olive green").ok);
  assert.ok(resolveFindShade("LIME").ok);
});

test("unknown and misspelled shade names suggest catalog alternatives but don't auto-choose", () => {
  assert.equal(resolveFindShade("sgae gren").ok, false);
  assert.equal(suggestFindShadeNames("sgae gren")[0]?.name, "Sage green");
  assert.equal(resolveFindShade("this color does not exist whatsoever").ok, false);
});

test("exact shade matching doesn't confuse yellow and chartreuse or orange and brown", () => {
  assert.equal(matchesTargetColor(127,255,0,"green",rgb(127,255,0),{strictShade:true}),true);
  assert.equal(matchesTargetColor(255,255,0,"green",rgb(127,255,0),{strictShade:true}),false);
  assert.equal(matchesTargetColor(220,110,18,"brown",rgb(140,60,35),{strictShade:true}),false);
  assert.equal(matchesTargetColor(154,171,138,"green",rgb(156,175,136),{strictShade:true}),true);
});

test("HueFind retains crisp, closed smooth contours on an exact shade", () => {
  const image = frame(180,120);
  image.paint(25,20,90,75,[156,175,136]);
  image.paint(130,20,40,60,[240,220,50]);
  const found = findSmoothColorContours(image,{color:"green",rgb:rgb(156,175,136),strictShade:true});
  assert.equal(found.length,1);
  assert.equal(found[0].points.length,72);
  assert.ok(found[0].bounds.width>=75);
});

test("when target is absent, camera fallback suggests a substantial visible alternative", () => {
  const image = frame(160,120,[240,240,238]);
  image.paint(35,25,85,70,[90,150,120]);
  const found = findClosestVisibleShade(image,rgb(156,175,136));
  assert.ok(found);
  assert.ok(found.sampledFraction>.1);
  assert.ok(found.rgb.g>found.rgb.r);
});
