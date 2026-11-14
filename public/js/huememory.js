// HueMemory browser helpers. Talks to the /api routes on our Express server.
// Usage: import { saveColor, loadPalette } from "/js/huememory.js";

const SESSION_KEY = "huememory.sessionId";

// One id per browser, kept in localStorage so the palette survives refreshes.
export function getSessionId() {
  let id = null;
  try {
    id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
  } catch {
    id ??= "guest";
  }
  return id;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
  return body;
}

// Tell any palette panel on the page to refresh.
function announceChange() {
  window.dispatchEvent(new CustomEvent("huememory:changed"));
}

// Save a color. Accepts the object from classifyColor() ({ name, hex, rgb })
// or { colorName, shade, hex, rgb }. Saving the same shade again bumps timesSaved.
export async function saveColor(color) {
  const colorName = color.colorName ?? color.name;
  const shade = color.shade ?? colorName;
  const saved = await request("/api/colors", {
    method: "POST",
    body: JSON.stringify({ colorName, shade, hex: color.hex, rgb: color.rgb, sessionId: getSessionId() })
  });
  announceChange();
  return saved;
}

export function loadPalette() {
  return request(`/api/colors?sessionId=${encodeURIComponent(getSessionId())}`);
}

export async function removeColor(id) {
  const result = await request(`/api/colors/${encodeURIComponent(id)}`, { method: "DELETE" });
  announceChange();
  return result;
}

export async function resetPalette() {
  const result = await request(`/api/colors?sessionId=${encodeURIComponent(getSessionId())}`, { method: "DELETE" });
  announceChange();
  return result;
}

export function getStats() {
  return request(`/api/colors/stats?sessionId=${encodeURIComponent(getSessionId())}`);
}

// Task helpers (accessible task library).
export function createTask({ color, object, action, destination }) {
  return request("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ color, object, action, destination, sessionId: getSessionId() })
  });
}

export function loadTasks({ completed } = {}) {
  const params = new URLSearchParams({ sessionId: getSessionId() });
  if (completed !== undefined) params.set("completed", String(completed));
  return request(`/api/tasks?${params}`);
}

export function completeTask(id, completed = true) {
  return request(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ completed })
  });
}

// Gemini: turn "put my red shirt in the blue bin" into { color, object, action, destination }.
export function interpret(text) {
  return request("/api/interpret", { method: "POST", body: JSON.stringify({ text }) });
}
