import { Router } from "express";
import { GoogleGenAI, Type } from "@google/genai";
import { describeDetailedShade, plausibleLightingChange } from "../../src/vision/perceptualShade.js";
import { normalizeGeminiShadeResult, validRgb, validImage } from "../../src/vision/shadeRefinement.js";

const router = Router();
let ai;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const schema = {
  type: Type.OBJECT,
  properties: {
    shadeName: { type: Type.STRING, description: "Specific familiar COLOR shade of the central surface, e.g. chartreuse, chocolate brown, or dusty sage green" },
    colorFamily: { type: Type.STRING, description: "Red, orange, brown, yellow, olive, green, teal, cyan, blue, purple, pink, beige, gray, black, or white" },
    note: { type: Type.STRING, description: "Brief description of the perceived BASE color and uncertainties caused by light or shadows" },
    confidence: { type: Type.STRING, description: "high, medium, or low; low if severely shadowed, underexposed, clipped, or ambiguous" },
    sameSurface: { type: Type.STRING, description: "yes, no, or uncertain: is the central material the same between the two photos? Use uncertain when small crops don't establish identity" },
    lightingChanged: { type: Type.STRING, description: "yes, no, or uncertain: is illumination/exposure/warmth/shadow visibly different?" }
  },
  required: ["shadeName", "colorFamily", "note", "confidence", "sameSurface", "lightingChanged"]
};
const hex = rgb => "#" + [rgb.r, rgb.g, rgb.b].map(n => n.toString(16).padStart(2, "0")).join("").toUpperCase();

router.post("/", async (req, res) => {
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: "Add GEMINI_API_KEY to your .env to use Gemini shade refinement." });
  const { image, rgb, referenceImage, currentRgb, previousShadeName } = req.body || {};
  if (!validRgb(rgb)) return res.status(400).json({ error: "A valid original pinned RGB reading is required." });
  if (!validImage(image)) return res.status(400).json({ error: "A small JPG crop of the pinned color is required." });
  if (referenceImage != null && !validImage(referenceImage))
    return res.status(400).json({ error: "The reference photo must be a small JPG crop." });
  if (currentRgb != null && !validRgb(currentRgb))
    return res.status(400).json({ error: "Invalid current RGB sample." });
  const previous = String(previousShadeName || "").trim().slice(0, 50);
  const local = describeDetailedShade(rgb);
  try {
    ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = [
      "You are evaluating a physical surface COLOR for a color-vision accessibility aid, not naming the object.",
      "Estimate the material's underlying shade, accounting for warmer/cooler lights, exposure shifts, cast shadows and specular highlights.",
      "The user PINNED a spot with ORIGINAL camera RGB " + JSON.stringify(rgb) + " and HEX " + hex(rgb) + ".",
      "The CURRENT photo's center has RGB " + JSON.stringify(currentRgb || rgb) + ". These numbers reflect the camera and lighting, not ground-truth pigment.",
      "First image is the CURRENT photo; the central 15% is the intended surface.",
      referenceImage ? "Second image is the REFERENCE photo of the same pinned screen location at pin time. Compare the central material. Distinguish lighting-only changes from different objects/surfaces. If ambiguous answer sameSurface=uncertain." : "There is NO reference image, so sameSurface must be uncertain.",
      "Be cautious: cannot prove object identity from color alone. Do not treat every color difference as merely a shadow.",
      "Ignore adjacent background pixels. For a dark brown in warm light, consider whether it is physically brown rather than orange. Distinguish chartreuse/lime from yellow and gray from tinted colors.",
      "If severely underexposed, overexposed, saturated, or conflicting, use low confidence and explicitly explain uncertainty.",
      "Use a common 1–4 word shade name. Do not claim to measure the surface's true reflectance or change the supplied camera values.",
      "Local color-name estimate for original reading: " + local.name + " (a suggestion, not ground truth).",
      previous ? "Previous Gemini label for this SAME pinned spot: " + previous + ". Keep a consistent base shade when clearly the same physical surface under different light; otherwise identify the mismatch." : "This is the first Gemini estimate for the pinned spot."
    ].join("\n");
    const parts = [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: image.data } }];
    if (referenceImage) parts.push({ inlineData: { mimeType: "image/jpeg", data: referenceImage.data } });
    const result = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts }],
      config: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.1 }
    });
    const parsed = JSON.parse(result.text || "{}");
    const compatibleLighting = currentRgb ? plausibleLightingChange(rgb, currentRgb) : null;
    // Gemini may overclaim identity from two tiny crops. If the pixels have
    // changed beyond a plausible exposure/shadow shift, do not assert YES.
    // Keep the pinned identity with an uncertainty warning instead.
    if (referenceImage && compatibleLighting === false &&
      String(parsed.sameSurface || "").toLowerCase() === "yes") parsed.sameSurface = "uncertain";
    const safe = normalizeGeminiShadeResult(parsed, { previousName: previous, hasReference: Boolean(referenceImage) });
    if (!safe) return res.status(422).json({ error: "Gemini could not identify a reliable shade. Try a more evenly lit view." });
    res.json({ ...safe, measuredHex: hex(rgb), currentHex: currentRgb ? hex(currentRgb) : hex(rgb),
      localShade: local.name, cameraLightingPlausible: compatibleLighting });
  } catch (error) {
    console.error("HueSee Gemini shade error:", error);
    res.status(503).json({ error: "Gemini shade refinement is temporarily unavailable. Local shade naming still works." });
  }
});

export default router;
