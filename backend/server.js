// backend/server.js
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const coursesRoutes = require("./routes/courses");
const lessonsRoutes = require("./routes/lessons");
const progressRoutes = require("./routes/progress");
const examsRoutes = require("./routes/exams");
const certificatesRoutes = require("./routes/certificates");
const adminRoutes = require("./routes/admin");

// optional dev routes (only if file exists / you use it)
let devRoutes = null;
try {
  devRoutes = require("./routes/dev");
} catch {}

const app = express();

/* -------------------- CONFIG -------------------- */
const PORT = process.env.PORT || 4000;

// Render env shows: CORS_ORIGIN = "https://riseeritrea.com,https://www.riseeritrea.com"
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "http://localhost:5500,http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const isProd = process.env.NODE_ENV === "production";

/* ------------------ MIDDLEWARE ------------------ */
app.use(
  cors({
    origin: function (origin, cb) {
      // allow requests with no origin (like curl, Postman)
      if (!origin) return cb(null, true);

      if (CORS_ORIGIN.includes(origin)) return cb(null, true);

      return cb(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

/* ------------------- SESSION -------------------- */
app.set("trust proxy", 1); // needed on Render for secure cookies

app.use(
  session({
    name: "esj.sid",
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: isProd ? "none" : "lax",
      secure: isProd, // must be true on https (Render + custom domain)
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

/* -------------------- LOGS ---------------------- */
console.log("Booting API. NODE_ENV =", process.env.NODE_ENV || "(not set)");
console.log("Has DATABASE_URL =", !!process.env.DATABASE_URL);
console.log("PORT from env =", PORT);
console.log("CORS_ORIGIN =", CORS_ORIGIN);

/* -------------------- ROUTES -------------------- */
app.get("/", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/courses", coursesRoutes);
app.use("/api/lessons", lessonsRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/exams", examsRoutes);
app.use("/api/certificates", certificatesRoutes);
app.use("/api/admin", adminRoutes);

// dev routes only in non-prod
if (!isProd && devRoutes) {
  console.log("DEV routes enabled");
  app.use("/api/dev", devRoutes);
}

/* ------------------ 404 HANDLER ----------------- */
app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.originalUrl });
});

/* ---------------- ERROR HANDLER ----------------- */
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).json({ error: "Server error" });
});

/* -------------------- START --------------------- */
app.listen(PORT, () => {
  console.log(`✅ API running on port ${PORT}`);
});