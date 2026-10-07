import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { fillRouter } from "../src/routes/fill.js";

dotenv.config();

const app = express();

app.use(helmet());
app.use(express.json({ limit: "200kb" }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      if (origin.startsWith("chrome-extension://")) {
        return callback(null, true);
      }
      return callback(new Error("Blocked by CORS"));
    },
  }),
);

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please try again after a few minutes.",
  },
});

app.use("/api/", limiter);

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    engine: "Groq Cloud",
    app: "Smart Filler",
    model: process.env.MODEL || "llama-3.3-70b-versatile",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/fill", fillRouter);

app.use((err, req, res, _next) => {
  console.error("[SERVER EXCEPTION]", err.stack || err.message);
  res.status(500).json({ error: "Internal server error occurred." });
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`Smart Filler Server is listening on http://localhost:${PORT}`);
  });
}

export default app;
