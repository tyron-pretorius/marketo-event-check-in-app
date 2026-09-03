import "dotenv/config";
import express from "express";
import cors from "cors";
import { router } from "./routes/api.js";
import { authRouter, requireAuth, isAuthEnabled } from "./auth.js";

const app = express();
const PORT = process.env.PORT || 4000;

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
