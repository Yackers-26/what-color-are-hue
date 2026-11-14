// Browser client for the Express API. Session-scoped records stay in MongoDB Atlas.
const SESSION_KEY = "huememory.sessionId";

export function getSessionId() {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() ||
        `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "guest-session";
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || body?.details || `Request failed (${response.status})`);
  }
  return body;
}

function announceChange() {
  window.dispatchEvent(new CustomEvent("huememory:changed"));
}

export async function saveColor(color) {
  const colorName = color.colorName ?? color.name;
  const shade = color.shade ?? colorName;
  const saved = await request("/api/colors", {
    method: "POST",
    body: JSON.stringify({
      colorName,
      shade,
      hex: color.hex,
      rgb: color.rgb,
      sessionId: getSessionId()
    })
  });
  announceChange();
  return saved;
}

export function loadPalette() {
  return request(`/api/colors?sessionId=${encodeURIComponent(getSessionId())}`);
}

export async function removeColor(id) {
  const result = await request(
    `/api/colors/${encodeURIComponent(id)}?sessionId=${encodeURIComponent(getSessionId())}`,
    { method: "DELETE" }
  );
  announceChange();
  return result;
}

export async function resetPalette() {
  const result = await request(`/api/colors?sessionId=${encodeURIComponent(getSessionId())}`, {
    method: "DELETE"
  });
  announceChange();
  return result;
}

export function getStats() {
  return request(`/api/colors/stats?sessionId=${encodeURIComponent(getSessionId())}`);
}

export function createTask({ summary, steps = [], visualCues = [], color = "", object = "", action = "", destination = "", relation = "" }) {
  return request("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      summary,
      steps,
      visualCues,
      color,
      object,
      action,
      destination,
      relation,
      sessionId: getSessionId()
    })
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
    body: JSON.stringify({ completed, sessionId: getSessionId() })
  });
}

// Optional image payload: { mimeType, data } where data is base64 without the data URL prefix.
export function interpret(text = "", image = null) {
  return request("/api/interpret", {
    method: "POST",
    body: JSON.stringify({ text, image })
  });
}

// Checks a new picture to see if the guided task is finished. Returns { done, message, locations }.
export function checkTask(image, task) {
  return request("/api/interpret/check", {
    method: "POST",
    body: JSON.stringify({ image, task })
  });
}
