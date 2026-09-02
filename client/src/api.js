const BASE = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Request failed: ${res.status}`);
  }
  return json;
}

export const api = {
  health: () => request("/health"),
  getState: () => request("/state"),
  getLatestEventFolder: (refresh) => request(`/event-folders/latest${refresh ? "?refresh=1" : ""}`),
  pull: (programId, programName) =>
    request("/pull", { method: "POST", body: JSON.stringify({ programId, programName }) }),
  checkIn: (id) => request(`/checkin/${encodeURIComponent(id)}`, { method: "POST" }),
  undoCheckIn: (id) => request(`/checkin/${encodeURIComponent(id)}/undo`, { method: "POST" }),
  addWalkIn: (person) => request("/walkin", { method: "POST", body: JSON.stringify(person) }),
  sync: () => request("/sync", { method: "POST" }),
};
