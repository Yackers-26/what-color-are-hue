
export function classifyColor(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const difference = max - min;

  let name = "Unknown";

  if (max < 45) {
    name = "Black";
  } else if (difference < 35) {
    name = max > 210 ? "White" : "Gray";
  } else {
    let hue;

    if (max === r) {
      hue = ((g - b) / difference) % 6;
    } else if (max === g) {
      hue = (b - r) / difference + 2;
    } else {
      hue = (r - g) / difference + 4;
    }

    hue = (hue * 60 + 360) % 360;

    if (hue < 18 || hue >= 345) name = "Red";
    else if (hue < 45) name = "Orange";
    else if (hue < 75) name = "Yellow";
    else if (hue < 170) name = "Green";
    else if (hue < 200) name = "Cyan";
    else if (hue < 265) name = "Blue";
    else name = "Purple";
  }

  const hex = "#" + [r, g, b]
    .map(value => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  return {
    name,
    hex,
    rgb: { r, g, b }
  };
}

export function summarizeFrameColors(imageData) {
  const { data, width, height } = imageData;
  const colors = new Map();

  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const index = (y * width + x) * 4;

      if (data[index + 3] < 128) continue;

      const result = classifyColor(
        data[index],
        data[index + 1],
        data[index + 2]
      );

      if (result.name === "White" ||
          result.name === "Gray") continue;

      if (!colors.has(result.name)) {
        colors.set(result.name, {
          name: result.name,
          samples: 0,
          minX: x,
          minY: y,
          maxX: x,
          maxY: y
        });
      }

      const color = colors.get(result.name);

      color.samples++;
      color.minX = Math.min(color.minX, x);
      color.minY = Math.min(color.minY, y);
      color.maxX = Math.max(color.maxX, x);
      color.maxY = Math.max(color.maxY, y);
    }
  }

  return Array.from(colors.values())
    .filter(color => color.samples >= 5)
    .map(color => ({
      name: color.name,
      samples: color.samples,
      bounds: {
        x: color.minX,
        y: color.minY,
        width: color.maxX - color.minX + 4,
        height: color.maxY - color.minY + 4
      }
    }))
    .sort((a, b) => b.samples - a.samples);
}
