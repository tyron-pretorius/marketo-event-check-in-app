import "dotenv/config";
import express from "express";
import cors from "cors";
import { router } from "./routes/api.js";
import { authRouter, requireAuth, isAuthEnabled } from "./auth.js";

const app = express();
const PORT = process.env.PORT || 4000;

// If you deploy behind a reverse proxy (Replit, ngrok, etc.), trust exactly
// one hop so req.ip resolves to the real client's address from
// X-Forwarded-For instead of the proxy's own address. This matters for
// login rate-limiting (server/src/auth.js): without it, every visitor could
// resolve to the same IP. If you add another proxy layer in front of this
// one (e.g. a CDN), bump this to match the real number of hops.
app.set("trust proxy", 1);

// The app performs authenticated, high-impact staff actions. Prevent it from
// being embedded by an attacker-controlled origin and clickjacked.
app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

app.use(cors());
app.use(express.json());
app.use("/api", authRouter);
app.use("/api", requireAuth, router);

if (isAuthEnabled()) {
  console.log("Password protection enabled (APP_PASSWORD set).");
}

app.listen(PORT, () => {
  console.log(`Marketo event check-in server listening on http://localhost:${PORT}`);
});
