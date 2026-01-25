// backend/server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const session = require("express-session");

// Routes
const authRoutes = require("./routes/auth");
const coursesRoutes = require("./routes/courses");
const lessonsRoutes = require("./routes/lessons");
const progressRoutes = require("./routes/progress");
const examsRoutes = require("./routes/exams");
const certificatesRoutes = require("./routes/certificates");

const app = express();

// ---------------- ENV ----------------
const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

const PORT = Number(process.env.PORT || 4000);

// IMPORTANT: comma-separated list in Render env:
// CORS_ORIGIN="https://riseeritrea.com,https://www.riseeritrea.com,http://localhost:5500,http://127.0.0.1:5500"
const allowedOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

console.log("Booting API. NODE_ENV =", NODE_ENV);
console.log("Allowed origins =", allowedOrigins);

// Render / proxies (IMPORTANT)
app.set("trust proxy", 1);

// ---------------- MIDDLEWARE ----------------
app.use(express.json({ limit: "1mb" }));

// CORS (must be BEFORE session routes for correct headers)
app.use(
  cors({
    origin: (origin, cb) => {
      // allow same-origin / server-to-server / curl (no Origin header)
      if (!origin) return cb(null, true);

      // allow if origin is in allowlist
      if (allowedOrigins.includes(origin)) return cb(null, true);

      // block otherwise
      return cb(new Error("CORS blocked origin: " + origin), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Session cookie settings
app.use(
  session({
    name: "esj.sid",
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // ✅ THIS is the big one:
      // For cross-site cookies (riseeritrea.com -> api.riseeritrea.com) you need SameSite=None + Secure=true
      sameSite: isProd ? "none" : "lax",
      secure: isProd, // must be true in production (https)
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

// Health check
app.get("/", (req, res) => res.send("OK"));
app.get("/health", (req, res) => res.json({ ok: true, env: NODE_ENV }));

// ---------------- ROUTES ----------------
app.use("/api/auth", authRoutes);
app.use("/api/courses", coursesRoutes);
app.use("/api/lessons", lessonsRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/exams", examsRoutes);
app.use("/api/certificates", certificatesRoutes);

// Global error handler (helps you see the real problem)
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).json({ error: "Server error" });
});

// ---------------- START ----------------
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});