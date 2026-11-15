async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (response.status === 401) {
    throw new Error("Sign in to save colors and guides. You can still use the camera in demo mode.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || body?.details || `Request failed (${response.status})`);
  return body;
}
function announceChange() { window.dispatchEvent(new CustomEvent("huememory:changed")); }

export async function saveColor(color) {
  const saved = await request("/api/colors", {
    method: "POST",
    body: JSON.stringify({ colorName: color.colorName ?? color.name, shade: color.shade ?? (color.hex ? `${color.name} ${color.hex.toUpperCase()}` : color.name), hex: color.hex, rgb: color.rgb })
  });
  announceChange();
  return saved;
}
export function loadPalette() { return request("/api/colors"); }
export async function removeColor(id) { const result = await request(`/api/colors/${encodeURIComponent(id)}`, { method: "DELETE" }); announceChange(); return result; }
export async function resetPalette() { const result = await request("/api/colors", { method: "DELETE" }); announceChange(); return result; }
export function getStats() { return request("/api/colors/stats"); }
export function createTask({ summary, steps = [], visualCues = [], color = "", object = "", action = "", destination = "", relation = "", groups = [], locations = [], answer = "", sceneImage = null }) {
  return request("/api/tasks", { method: "POST", body: JSON.stringify({ summary, steps, visualCues, color, object, action, destination, relation, groups, locations, answer, sceneImage }) });
}
export function loadTasks({ completed } = {}) {
  const params = new URLSearchParams();
  if (completed !== undefined) params.set("completed", String(completed));
  return request(`/api/tasks${params.size ? "?" + params : ""}`);
}
export function deleteTask(id) { return request(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }); }
export function completeTask(id, completed = true) { return request(`/api/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ completed }) }); }
export function interpret(text = "", image = null) { return request("/api/interpret", { method: "POST", body: JSON.stringify({ text, image }) }); }
// Gemini checks a NEW still frame, not old color-zone heuristics. It reports a
// visual assessment, which users should not treat as infallible physical proof.
export function checkTask(image, task) { return request("/api/interpret/check", { method: "POST", body: JSON.stringify({ image, task }) }); }
