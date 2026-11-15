// Preserve the shade actually requested in a natural-language instruction.
// Gemini can add an observed shade, but cannot replace the user's constraint.
import { listFindShadeNames, normalizeShadeText } from './hueFindSearch.js';
const names = [...new Set([...listFindShadeNames(), 'grey', 'gray'])].map(normalizeShadeText)
  .sort((a,b) => b.length - a.length);
const patterns = names.map(name => ({name, pattern: new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i')}));

export function requestedHueDoColor(text = '') {
  const value = normalizeShadeText(text);
  let best = null;
  for (const entry of patterns) {
    const found = entry.pattern.exec(value);
    if (!found) continue;
    if (!best || found.index < best.index || (found.index === best.index && entry.name.length > best.name.length)) {
      best = { name: entry.name, index: found.index };
    }
  }
  return best?.name || '';
}
