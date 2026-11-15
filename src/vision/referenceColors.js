// Reference shades from the standard CSS named-color keywords (MDN).
// These are approximate names for captured sRGB, not guaranteed physical colors.
import { labDifference } from "./colorPerception.js";
const CSS_SHADES = [
  ["Black", "000000"], ["Dim gray", "696969"], ["Silver", "C0C0C0"], ["White", "FFFFFF"],
  ["Maroon", "800000"], ["Crimson", "DC143C"], ["Red", "FF0000"], ["Tomato", "FF6347"],
  ["Coral", "FF7F50"], ["Salmon", "FA8072"], ["Orange red", "FF4500"], ["Orange", "FFA500"],
  ["Gold", "FFD700"], ["Yellow", "FFFF00"], ["Olive", "808000"], ["Brown", "A52A2A"],
  ["Chocolate", "D2691E"], ["Tan", "D2B48C"], ["Forest green", "228B22"],
  ["Sea green", "2E8B57"], ["Medium sea green", "3CB371"], ["Lime green", "32CD32"],
  ["Cyan", "00FFFF"], ["Teal", "008080"], ["Turquoise", "40E0D0"],
  ["Steel blue", "4682B4"], ["Cornflower blue", "6495ED"], ["Royal blue", "4169E1"],
  ["Blue", "0000FF"], ["Navy", "000080"], ["Indigo", "4B0082"],
  ["Purple", "800080"], ["Blue violet", "8A2BE2"], ["Violet", "EE82EE"],
  ["Hot pink", "FF69B4"], ["Pink", "FFC0CB"], ["Light gray", "D3D3D3"],
];
const palette = CSS_SHADES.map(([name, hex]) => ({ name, rgb: {r: parseInt(hex.slice(0,2),16),g: parseInt(hex.slice(2,4),16),b:parseInt(hex.slice(4,6),16)} }));
export function closestReferenceShade(rgb) {
  if (!rgb || ![rgb.r,rgb.g,rgb.b].every(n => Number.isFinite(n) && n >= 0 && n <= 255)) return null;
  let best = null, distance = Infinity;
  for (const entry of palette) {
    const d = labDifference(rgb,entry.rgb);
    if (d < distance) { best = entry.name; distance = d; }
  }
  return best;
}
