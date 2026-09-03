const BASE = "/api";
const TOKEN_KEY = "wp-checkin-token";

export class AuthError extends Error {}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) {
    setToken(null);
    throw new AuthError(json.error || "Please log in again");
  }
  if (!res.ok) {
    throw new Error(json.error || `Request failed: ${res.status}`);
  }
  return json;
}

export const api = {
  authStatus: () => request("/auth-status"),
  login: async (password) => {
    const { token } = await request("/login", { method: "POST", body: JSON.stringify({ password }) });
    setToken(token);
    return token;
  },
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
