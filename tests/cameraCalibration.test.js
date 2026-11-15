import test from "node:test";
import assert from "node:assert/strict";
import { calculateNeutralGains, applyNeutralGains, neutralReferenceFromCenter } from "../src/vision/cameraCalibration.js";
import { closestReferenceShade } from "../src/vision/referenceColors.js";
import { pickFocusedContour } from "../src/vision/smoothContours.js";

test("white card corrects warm illumination without changing video pixels", () => {
  const gains = calculateNeutralGains({r:210,g:190,b:155});
  assert.ok(gains.b>gains.g && gains.g>gains.r);
  const corrected = applyNeutralGains({r:210,g:190,b:155},gains);
  assert.ok(Math.abs(corrected.r-corrected.b)<1);
});
test("refuses dark or saturated calibration targets", () => {
  assert.equal(calculateNeutralGains({r:15,g:12,b:10}),null);
  assert.equal(calculateNeutralGains({r:240,g:20,b:20}),null);
});
test("sample white card pixels from center", () => {
  const w=12,h=12,data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<w*h;i++)data.set([220,198,185,255],i*4);
  const rgb=neutralReferenceFromCenter({width:w,height:h,data},2);
  assert.deepEqual(rgb,{r:220,g:198,b:185});
});
test("standard CSS reference names help interpret captured samples", () => {
  assert.equal(closestReferenceShade({r:70,g:130,b:180}),"Steel blue");
  assert.equal(closestReferenceShade({r:255,g:0,b:0}),"Red");
});
test("focus chooses the tapped region, not another equally colored object", () => {
  const regions = [{id:"left",center:{x:40,y:40},bounds:{x:10,y:10,width:55,height:60}},
    {id:"right",center:{x:220,y:40},bounds:{x:195,y:10,width:55,height:60}}];
  assert.equal(pickFocusedContour(regions,{x:218,y:30},.19,300,100)?.id,"right");
  assert.equal(pickFocusedContour(regions,{x:110,y:90},.19,300,100),null);
});
