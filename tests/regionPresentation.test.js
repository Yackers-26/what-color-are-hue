import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDisplayRegions, getContainedVideoRect } from '../src/vision/regionPresentation.js';
test('only substantial regions get camera labels', () => {
  const groups = [{ name: 'Blue', regions: [
    { id: 'a', samples: 65, bounds: {x:0,y:0,width:20,height:20}, center:{x:10,y:10} },
    { id: 'b', samples: 2, bounds: {x:70,y:50,width:4,height:4}, center:{x:72,y:52} }
  ] }];
  assert.deepEqual(selectDisplayRegions(groups).map(region => region.key), ['Blue:a']);
});
test('caps labels to prevent clutter', () => {
  const regions = Array.from({length:12},(_,i)=>({id:String(i),samples:40+i,bounds:{x:0,y:0,width:20,height:20},center:{x:i*10,y:10}}));
  assert.equal(selectDisplayRegions([{name:'Red',regions}]).length, 6);
});
test('contained video coordinates preserve aspect ratio', () => {
  assert.deepEqual(getContainedVideoRect(400,400,640,480), {x:0,y:50,width:400,height:300});
  assert.equal(getContainedVideoRect(0,400,640,480), null);
});
