// backend/server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const session = require("express-session");

let PgSession = null;
try {
  PgSession = require("connect-pg-simple")(session);
} catch {
  PgSession = null;
}

const app = express();

// Render / reverse proxy (required for secure cookies + correct protocol)
app.set("trust proxy", 1);

// ---------- ENV ----------
const isProd = process.env.NODE_ENV === "production";

// Comma-separated list in Render env var:
// CORS_ORIGIN=https://riseeritrea.com,https://www.riseeritrea.com
const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// ---------- CORS (must be before routes) ----------
const corsOptions = {
  origin: function (origin, cb) {
    // Allow non-browser tools (curl/postman) with no origin
    if (!origin) return cb(null, true);

    // If no list provided, block-by-default in production (safer),
    // allow all in dev (optional behavior)
    if (corsOrigins.length === 0) {
      if (!isProd) return cb(null, true);
      return cb(new Error("CORS blocked (no CORS_ORIGIN set): " + origin));
    }

    if (corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked: " + origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// IMPORTANT: handle preflight for ALL routes
app.options("*", cors(corsOptions));
app.use(cors(corsOptions));

app.use(express.json({ limit: "2mb" }));

// ---------- SESSION ----------
const cookieDomain = process.env.SESSION_DOMAIN || undefined;
// recommended for subdomain cookies: .riseeritrea.com
// SESSION_DOMAIN=.riseeritrea.com

const sessionOptions = {
  name: "sid",
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: isProd,                     // true on https
    sameSite: isProd ? "none" : "lax",  // needed for cross-subdomain + fetch credentials
    domain: cookieDomain,               // optional
    maxAge: 1000 * 60 * 60 * 24 * 7,    // 7 days
  },
};

if (PgSession && process.env.DATABASE_URL) {
  sessionOptions.store = new PgSession({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
  });
}

app.use(session(sessionOptions));

// ---- Language middleware ----
app.use((req, res, next) => {
  const q = String(req.query.lang || "").toLowerCase();
  req.lang = q === "ti" || q === "en" ? q : "en";
  next();
});

// Simple API home (prevents "Cannot GET /")
app.get("/", (req, res) => {
  res.status(200).send("Eritrean Success Journey API is running ✅ Use /health");
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

// ---------- ROUTES ----------
app.use("/api/auth", require("./routes/auth"));
app.use("/api/courses", require("./routes/courses"));
app.use("/api/lessons", require("./routes/lessons"));
app.use("/api/progress", require("./routes/progress"));
app.use("/api/exams", require("./routes/exams"));
app.use("/api/certificates", require("./routes/certificates"));
app.use("/api/admin", require("./routes/admin"));

// ---------- ERROR HANDLER (keep CORS headers) ----------
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);

  // Ensure CORS headers even on errors
  const origin = req.headers.origin;
  if (origin && corsOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.status(500).json({ error: err.message || "Server error" });
});

// ---------- START ----------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("API running on port", PORT);
  console.log("NODE_ENV =", process.env.NODE_ENV);
  console.log("CORS_ORIGIN =", process.env.CORS_ORIGIN);
  console.log("SESSION_DOMAIN =", process.env.SESSION_DOMAIN);
});