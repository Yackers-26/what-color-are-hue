// Average an image-data patch to reduce single-pixel camera noise.
export function averagePixelRegion(imageData) {
  if (!imageData || !imageData.data || imageData.data.length < 4) {
    throw new Error("An image patch is required.");
  }
  const data = imageData.data;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    count++;
  }
  if (!count) return { r: 0, g: 0, b: 0 };
  return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
}
