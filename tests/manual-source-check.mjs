import fs from 'node:fs';
import { findSmoothColorContours } from '../src/vision/smoothContours.js';
const imageData={width:320,height:240,data:new Uint8ClampedArray(fs.readFileSync('/mnt/data/huefind-camera-frame.rgba'))};
for (const color of ['Red','Orange','Yellow','Black']) {
 const found=findSmoothColorContours(imageData,{color,minAreaFraction:.014,relativeMinArea:.28,maxRegions:3});
 console.log(color,found.map(r=>({samples:r.samples,bounds:r.bounds})))
 if(color==='Red') fs.writeFileSync('/mnt/data/huefind-contours-from-user.json',JSON.stringify(found.map(r=>r.points)));
}
