// server.js (or index.js) — cleaned + mobile-safe for sessions on api.riseeritrea.com
// ✅ Fixes:
// - dotenv loaded first
// - trust proxy enabled for Render
// - ONLY ONE CORS middleware (no duplicates)
// - session cookie works across subdomains (.riseeritrea.com) + SameSite=None in production
// - keeps your existing routes + middleware

require("dotenv").config();

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

console.log("Booting API. NODE_ENV =", process.env.NODE_ENV);
console.log("Has DATABASE_URL =", !!process.env.DATABASE_URL);
console.log("PORT from env =", process.env.PORT);

const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");

const requireLogin = require("./middleware/requireLogin");
const requireAdmin = require("./middleware/requireAdmin");
const { pool } = require("./db_pg");

const app = express();

// Render / reverse proxy support (required for secure cookies)
app.set("trust proxy", 1);

const isProd = process.env.NODE_ENV === "production";

// Security + parsing
app.use(helmet());
app.use(rateLimit({ windowMs: 60_000, max: 200 }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// ✅ SINGLE CORS MIDDLEWARE (keep only this one)
app.use(
  cors({
    origin: isProd
      ? ["https://riseeritrea.com", "https://www.riseeritrea.com"]
      : ["http://localhost:3000", "http://localhost:5173", "http://localhost:5500"],
    credentials: true
  })
);

// Session (Postgres store)
app.use(
  session({
    store: new pgSession({ pool, tableName: "session" }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd, // must be true on https
      sameSite: isProd ? "none" : "lax",
      domain: isProd ? ".riseeritrea.com" : undefined, // share cookie across subdomains
      maxAge: 1000 * 60 * 60 * 24 * 14 // 14 days
    }
  })
);

// Health check
app.get("/api/health", (req, res) => res.json({ ok: true }));

// PUBLIC
app.use("/api/auth", require("./routes/auth"));
app.use("/api/courses", require("./routes/courses"));
app.use("/api/lessons", require("./routes/lessons"));

// STUDENT (logged-in)
app.use("/api/progress", requireLogin, require("./routes/progress"));
app.use("/api/exams", requireLogin, require("./routes/exams"));
app.use("/api/certificates", requireLogin, require("./routes/certificates"));

// ADMIN ONLY
app.use("/api/admin", requireAdmin, require("./routes/admin_lessons"));
app.use("/api/admin", requireAdmin, require("./routes/admin_exams"));

// Listen
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
