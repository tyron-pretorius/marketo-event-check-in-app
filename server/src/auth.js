import crypto from "crypto";
import express from "express";

// Single shared-password gate: enough to keep casual passersby off a
// laptop or an ngrok link at an event, not meant to withstand a
// determined attacker. Tokens are held in memory only — restarting the
// server logs everyone out.

const sessions = new Set();

export function isAuthEnabled() {
  return Boolean(process.env.APP_PASSWORD);
}

export const authRouter = express.Router();

authRouter.get("/auth-status", (req, res) => {
  res.json({ required: isAuthEnabled() });
});

authRouter.post("/login", (req, res) => {
  if (!isAuthEnabled()) return res.json({ token: null });

  const { password } = req.body || {};
  if (password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: "Incorrect password" });
  }

  const token = crypto.randomBytes(24).toString("hex");
  sessions.add(token);
  res.json({ token });
});

export function requireAuth(req, res, next) {
  if (!isAuthEnabled()) return next();

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token && sessions.has(token)) return next();

  res.status(401).json({ error: "Not authenticated" });
}
