import crypto from "crypto";
import express from "express";

// Single shared-password gate: no individual accounts, just one password
// staff enter once per device. Optional — if APP_PASSWORD isn't set, the
// app runs with no login at all, which matters for a self-hosted tool
// where plenty of setups (a laptop on a private LAN, a quick local test)
// don't need one. Sessions are opaque tokens held in memory with a 12h
// expiry, so a server restart (or just time passing) signs everyone out;
// nothing sensitive is persisted to disk.

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const sessions = new Map(); // token -> expiresAt

// Brute-force protection, two tiers:
//
// - Per-DEVICE: 3 wrong guesses locks that device for 15 minutes. Devices
//   are identified by a random id the client generates and stores in
//   localStorage — NOT by IP. Event staff are typically all on the same
//   venue WiFi, which NATs everyone to one public IP, so an IP-only
//   lockout would let one person's typo lock out the entire event. A MAC
//   address would avoid this too, but a web server structurally can
//   never see one — it's a link-layer detail that's stripped at the
//   first router hop and isn't exposed to browsers or servers at all.
// - Per-IP: a much looser backstop (20 attempts) purely to blunt a
//   scripted flood from one source that keeps inventing new device ids —
//   loose enough that it never trips from ordinary shared-WiFi use by a
//   handful of honest staff.
//
// Either lockout is temporary (not permanent) so a typo never requires
// restarting the server to recover from — it just self-heals.
const DEVICE_MAX_ATTEMPTS = 3;
const IP_MAX_ATTEMPTS = 20;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

const deviceAttempts = new Map(); // deviceId -> { count, lockedUntil }
const ipAttempts = new Map(); // ip -> { count, lockedUntil }

export class LockedOutError extends Error {
  constructor(retryAfterSeconds) {
    super(`Too many incorrect attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function isAuthEnabled() {
  return Boolean(process.env.APP_PASSWORD);
}

function checkLocked(map, key) {
  const state = map.get(key) || { count: 0, lockedUntil: 0 };
  if (state.lockedUntil > Date.now()) {
    throw new LockedOutError(Math.ceil((state.lockedUntil - Date.now()) / 1000));
  }
  return state;
}

function recordFailure(map, key, state, maxAttempts) {
  const count = state.count + 1;
  if (count >= maxAttempts) {
    map.set(key, { count: 0, lockedUntil: Date.now() + LOCKOUT_MS });
    return true; // just locked
  }
  map.set(key, { count, lockedUntil: 0 });
  return false;
}

export const authRouter = express.Router();

authRouter.get("/auth-status", (req, res) => {
  res.json({ required: isAuthEnabled() });
});

authRouter.post("/login", (req, res) => {
  if (!isAuthEnabled()) return res.json({ token: null });

  const { password } = req.body || {};
  const ipKey = req.ip || "unknown";
  const deviceKey = req.headers["x-device-id"] || ipKey; // curl/API callers fall back to IP

  try {
    const deviceState = checkLocked(deviceAttempts, deviceKey);
    const ipState = checkLocked(ipAttempts, ipKey);

    if (password !== process.env.APP_PASSWORD) {
      const deviceLocked = recordFailure(deviceAttempts, deviceKey, deviceState, DEVICE_MAX_ATTEMPTS);
      const ipLocked = recordFailure(ipAttempts, ipKey, ipState, IP_MAX_ATTEMPTS);
      if (deviceLocked || ipLocked) {
        throw new LockedOutError(Math.ceil(LOCKOUT_MS / 1000));
      }
      return res.status(401).json({ error: "Incorrect password" });
    }

    // A correct password clears this device's and this IP's strike count.
    deviceAttempts.delete(deviceKey);
    ipAttempts.delete(ipKey);

    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    res.json({ token });
  } catch (err) {
    if (err instanceof LockedOutError) {
      res.set("Retry-After", String(err.retryAfterSeconds));
      return res.status(429).json({ error: err.message, retryAfterSeconds: err.retryAfterSeconds });
    }
    throw err;
  }
});

export function requireAuth(req, res, next) {
  if (!isAuthEnabled()) return next();

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const expiresAt = token && sessions.get(token);

  if (expiresAt && Date.now() < expiresAt) return next();
  if (token && expiresAt) sessions.delete(token); // expired — clean up

  res.status(401).json({ error: "Not authenticated" });
}
