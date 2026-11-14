
import { summarizeFrameColors } from "./colorDetector.js";

export function analyzeVideoFrame(video, canvas) {
  if (!video || !canvas) {
    throw new Error("Video and canvas are required.");
  }

  // Wait until the camera has a usable frame.
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
    return {
      ready: false,
      colors: []
    };
  }

  // Analyze a smaller frame for better performance.
  const width = 320;
  const height = Math.max(
    1,
    Math.round(width * video.videoHeight / video.videoWidth)
  );

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", {
    willReadFrequently: true
  });

  if (!context) {
    throw new Error("Could not access the canvas.");
  }

  // Copy the current camera frame into the canvas.
  context.drawImage(video, 0, 0, width, height);

  // Extract the pixels.
  const imageData = context.getImageData(
    0, 0, width, height
  );

  // Identify the colors using our existing code.
  const colors = summarizeFrameColors(imageData);

  return {
    ready: true,
    colors
  };
}