import { classifyColor } from "./colorDetector.js";

// Responsive camera color smoothing. The indicator follows the pointer immediately;
// this function only smooths the RGB values shown in the interface.
export function createFluidReading({ movingAlpha = 0.84, restingAlpha = 0.17, quantization = 4 } = {}) {
  if (!(movingAlpha > 0 && movingAlpha <= 1) || !(restingAlpha > 0 && restingAlpha <= 1) ||
      !Number.isInteger(quantization) || quantization < 1) {
    throw new Error("Invalid fluid reading settings.");
  }

  let rgb = null;
  let lastPosition = null;
  let visible = null;
  let pendingName = "";
  let nameCount = 0;
  const clamp = (value) => Math.max(0, Math.min(255, value));

  return {
    observe(reading, { immediate = false, position = null } = {}) {
      if (!reading || !reading.rgb || !reading.name) return visible;
      const { r, g, b } = reading.rgb;
      if (![r, g, b].every(Number.isFinite)) return visible;
      const distance = position && lastPosition
        ? Math.hypot(position.x - lastPosition.x, position.y - lastPosition.y)
        : 0;
      // Strong jumps should feel instantaneous when crossing to a new object.
      const jump = distance > 0.075;
      const moving = distance > 0.0015;
      const alpha = immediate || jump || !rgb ? 1 : moving ? movingAlpha : restingAlpha;
      if (!rgb || immediate || jump) rgb = { r, g, b };
      else for (const channel of ["r", "g", "b"]) {
        rgb[channel] += alpha * (reading.rgb[channel] - rgb[channel]);
      }
      const quantized = {};
      for (const channel of ["r", "g", "b"]) {
        quantized[channel] = clamp(Math.round(rgb[channel] / quantization) * quantization);
      }
      const classified = classifyColor(quantized.r, quantized.g, quantized.b);
      let name = classified.name;
      // A stationary borderline hue should not alternate every frame.
      if (!immediate && !jump && !moving && visible && name !== visible.name) {
        if (pendingName === name) nameCount += 1;
        else { pendingName = name; nameCount = 1; }
        if (nameCount < 3) name = visible.name;
        else { pendingName = ""; nameCount = 0; }
      } else { pendingName = ""; nameCount = 0; }
      visible = { ...classified, name };
      if (position) lastPosition = { x: position.x, y: position.y };
      return visible;
    },
    reset() { rgb = null; lastPosition = null; visible = null; pendingName = ""; nameCount = 0; },
    current() { return visible; }
  };
}
