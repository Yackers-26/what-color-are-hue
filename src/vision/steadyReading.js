import { classifyColor } from "./colorDetector.js";

// Stabilize a camera reading without changing its displayed HEX and RGB every frame.
export function createSteadyReading({ agreement = 3, threshold = 12, windowSize = 4 } = {}) {
  if (!Number.isInteger(agreement) || agreement < 1 || !Number.isInteger(windowSize) || windowSize < 1 || threshold < 0) {
    throw new Error("Invalid reading stability settings.");
  }

  let displayed = null;
  let candidate = "";
  let candidateCount = 0;
  let history = [];

  function formatted(name, readings) {
    const rgb = { r: 0, g: 0, b: 0 };
    for (const reading of readings) {
      rgb.r += reading.rgb.r;
      rgb.g += reading.rgb.g;
      rgb.b += reading.rgb.b;
    }
    for (const channel of ["r", "g", "b"]) {
      rgb[channel] = Math.min(255, Math.max(0, Math.round(rgb[channel] / readings.length)));
    }
    return { ...classifyColor(rgb.r, rgb.g, rgb.b), name };
  }

  return {
    observe(reading, { immediate = false } = {}) {
      if (!reading || !reading.rgb || !reading.name) return displayed;
      if (immediate || !displayed) {
        displayed = formatted(reading.name, [reading]);
        candidate = "";
        candidateCount = 0;
        history = [reading];
        return displayed;
      }

      if (reading.name !== displayed.name) {
        if (candidate === reading.name) candidateCount += 1;
        else { candidate = reading.name; candidateCount = 1; }
        if (candidateCount < agreement) return displayed;
        displayed = formatted(reading.name, [reading]);
        candidate = "";
        candidateCount = 0;
        history = [reading];
        return displayed;
      }

      candidate = "";
      candidateCount = 0;
      history.push(reading);
      if (history.length > windowSize) history.shift();
      const averaged = formatted(reading.name, history);
      const delta = Math.max(...["r", "g", "b"].map((key) => Math.abs(averaged.rgb[key] - displayed.rgb[key])));
      if (delta >= threshold) displayed = averaged;
      return displayed;
    },
    reset() { displayed = null; candidate = ""; candidateCount = 0; history = []; },
    current() { return displayed; }
  };
}
