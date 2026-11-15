// HueSee's human-friendly labels are estimates of the CAMERA's sRGB pixels.
// They do not change HueFind's broad color buckets or the measured HEX/RGB.
// Using hue AND lightness/chroma is important: brown and orange share a hue,
// and chartreuse sits on the yellow/green boundary.
const clamp = value => Math.min(255, Math.max(0, value));

export function describeShade(rgb) {
  if (!rgb || ![rgb.r, rgb.g, rgb.b].every(value => Number.isFinite(value) && value >= 0 && value <= 255)) {
    return { name: "Unknown", family: "Unknown" };
  }
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(clamp);
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const delta = max - min;
  const l = (max + min) / 2;
  const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  const hsvSat = max ? delta / max : 0;
  let hue = 0;
  if (delta) {
    if (r / 255 === max) hue = ((g - b) / 255 / delta) % 6;
    else if (g / 255 === max) hue = (b - r) / 255 / delta + 2;
    else hue = (r - g) / 255 / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const named = (name, family) => ({ name, family });

  // Off-whites and cool grays have real chroma; classify them before true neutrals.
  if (l > .84 && hsvSat < .21 && r - b >= 11 && g - b >= 9)
    return named(l > .91 ? "Ivory" : "Cream", "Beige");
  if (sat < .22 && hsvSat < .28 && hue >= 195 && hue < 250 && l < .75)
    return named(l < .43 ? "Dark slate gray" : "Slate gray", "Gray");

  // Neutrals first, including camera grays that have a small warm/cool cast.
  if (max < 0.11 && (hsvSat < 0.40 || max < 0.055)) return named("Black", "Black");
  if (hsvSat < 0.115 || (hsvSat < 0.17 && sat < 0.19)) {
    if (l > 0.93) return named("White", "White");
    if (l > 0.82) return named("Off-white", "White");
    if (l > 0.68) return named("Light gray", "Gray");
    if (l > 0.42) return named("Gray", "Gray");
    if (l > 0.25) return named("Dark gray", "Gray");
    return named("Charcoal gray", "Gray");
  }

  if (sat < 0.31 && l > 0.67 && hue >= 23 && hue < 70)
    return named(l > 0.87 ? "Cream" : "Beige", "Beige");
  if (sat < 0.31 && l > 0.32 && l < 0.7 && hue >= 65 && hue < 168)
    return named(l > .53 ? "Sage green" : "Muted olive green", "Green");
  if (sat < 0.30 && hue >= 192 && hue < 256 && l < 0.67)
    return named(l < .38 ? "Slate blue" : "Dusty blue", "Blue");

  // Pinkish reds around the hue wrap-around.
  if (hue >= 341 || hue < 14) {
    if (l < .37 && hue > 339 && hue < 360 && b > g + 12 && r > b) return named("Burgundy", "Red");
    if (l < .47 && max < .76 && g > r * .14 && b > r * .14 && hue < 9)
      return named("Reddish brown", "Brown");
    if (l < .16) return named("Deep burgundy", "Red");
    if (l < .36 && (hue >= 347 || hue < 9)) return named("Burgundy", "Red");
    if (l < .47 && hue >= 9 && hue < 14) return named("Reddish brown", "Brown");
    if (l > .75 && sat < .66) return named("Blush pink", "Pink");
    if (hue >= 341 && hue < 360 && l > .56) return named("Rose pink", "Pink");
    if (hue < 14 && l > .55 && sat < .73) return named("Salmon", "Pink");
    if (hue >= 5 && hue < 14 && l >= .43) return named("Coral red", "Red");
    return named(l < .44 ? "Deep red" : l > .70 ? "Light red" : "Red", "Red");
  }

  if (hue < 45) {
    // Brown is a *dark* orange/yellow, not a separate hue on the wheel.
    if (l < .52 && max < .86) {
      if (l < .26) return named("Dark chocolate brown", "Brown");
      if (hue < 24) return named("Rust brown", "Brown");
      if (l > .40) return named("Caramel brown", "Brown");
      return named("Brown", "Brown");
    }
    if (l > .78 && sat < .75) return named("Peach", "Orange");
    if (l > .61 && sat < .57) return named(hue > 27 ? "Tan" : "Apricot", "Brown");
    if (hue < 23) return named(l < .44 ? "Burnt orange" : "Red-orange", "Orange");
    return named(l < .40 ? "Dark orange" : l > .68 ? "Light orange" : "Orange", "Orange");
  }

  if (hue < 68) {
    if (l < .46 && max < .75) return named(hue >= 57 ? "Olive" : "Mustard", "Olive");
    if (sat < .42 && l > .60) return named("Khaki", "Beige");
    if (hue < 55) return named(l > .78 ? "Pale yellow" : "Golden yellow", "Yellow");
    return named(l > .80 ? "Pale yellow" : "Yellow", "Yellow");
  }

  if (hue < 104) {
    if (l < .43 || (max < .62 && sat < .60)) return named("Olive green", "Olive");
    if (sat < .40) return named("Yellow-green", "Green");
    return named(hue < 99 ? "Chartreuse" : "Lime green", "Green");
  }

  if (hue < 169) {
    if (l < .26) return named("Forest green", "Green");
    if (l > .77 && sat < .68) return named("Mint green", "Green");
    if (sat < .35) return named("Sage green", "Green");
    if (hue < 130 && max > .68 && sat > .45 && r > g * .12 && b > g * .12)
      return named("Lime green", "Green");
    if (hue >= 150 && l < .49) return named("Emerald green", "Green");
    return named(l < .40 ? "Dark green" : l > .68 ? "Light green" : "Green", "Green");
  }

  if (hue < 197) {
    if (l < .37) return named("Deep teal", "Teal");
    if (sat < .38) return named("Muted teal", "Teal");
    return named(hue < 181 ? "Turquoise" : "Cyan", "Cyan");
  }

  if (hue < 257) {
    if (l < .24) return named("Navy blue", "Blue");
    if (sat < .36) return named("Slate blue", "Blue");
    if (l > .76) return named("Powder blue", "Blue");
    if (hue < 222) return named(l > .58 ? "Sky blue" : "Azure blue", "Blue");
    if (l < .44) return named("Royal blue", "Blue");
    return named("Blue", "Blue");
  }

  if (hue < 301) {
    if (l < .27) return named("Deep purple", "Purple");
    if (l > .74 && sat < .68) return named("Lavender", "Purple");
    if (hue < 274) return named("Indigo", "Purple");
    return named(l > .64 ? "Violet" : "Purple", "Purple");
  }

  if (hue < 341) {
    if (l < .34) return named("Plum", "Purple");
    if (l > .73 && sat < .62) return named("Pale pink", "Pink");
    if (hue < 322) return named("Magenta", "Pink");
    return named(l < .57 ? "Raspberry pink" : "Hot pink", "Pink");
  }
  return named("Unknown", "Unknown");
}

// Gemini is advisory; measurements and local HueSee labels remain usable offline.
export function sanitizeGeminiShade(value) {
  if (!value || typeof value !== "object") return null;
  const name = String(value.shadeName || "").trim().replace(/\s+/g, " ");
  if (!/^[a-zA-Z -]{3,44}$/.test(name)) return null;
  const note = String(value.note || "").replace(/[\r\n]+/g, " ").trim().slice(0, 140);
  return { name, note };
}
