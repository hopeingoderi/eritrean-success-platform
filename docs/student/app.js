// backend/server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const session = require("express-session");

// If you already use a PG session store, keep it.
// If connect-pg-simple is installed, this will persist sessions across restarts.
let PgSession = null;
try {
  PgSession = require("connect-pg-simple")(session);
} catch {
  PgSession = null;
}

const app = express();

// IMPORTANT for Render / proxies (so secure cookies work)
app.set("trust proxy", 1);

// ---------- CORS ----------
const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: function (origin, cb) {
    // allow tools / curl (no origin)
    if (!origin) return cb(null, true);

    // allow if in list
    if (corsOrigins.length === 0 || corsOrigins.includes(origin)) return cb(null, true);

    // IMPORTANT: do NOT throw (throwing can remove CORS headers and cause confusing browser errors)
    return cb(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
// IMPORTANT: allow preflight for ALL routes
app.options("*", cors(corsOptions));

// ---------- BODY ----------
app.use(express.json({ limit: "2mb" }));

// ---------- SESSION ----------
const isProd = process.env.NODE_ENV === "production";

// cookie domain is OPTIONAL; only use if you set it.
// Example: SESSION_DOMAIN=.riseeritrea.com
const cookieDomain = process.env.SESSION_DOMAIN || undefined;

const sessionOptions = {
  name: "sid",
  secret: process.env.SESSION_SECRET || "dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: isProd, // MUST be true on https (prod)
    sameSite: isProd ? "none" : "lax", // needed for cross-origin fetch+credentials
    domain: cookieDomain, // optional (set SESSION_DOMAIN=.riseeritrea.com)
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
};

// Use PG session store if available + DATABASE_URL exists
if (PgSession && process.env.DATABASE_URL) {
  sessionOptions.store = new PgSession({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
  });
}

app.use(session(sessionOptions));

// ---- Language middleware (EN/TI) ----
app.use((req, res, next) => {
  const q = String(req.query.lang || "").toLowerCase();
  req.lang = q === "ti" || q === "en" ? q : "en"; // default en
  next();
});

// ---------- ROUTES ----------
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", require("./routes/auth"));
app.use("/api/courses", require("./routes/courses"));
app.use("/api/lessons", require("./routes/lessons"));
app.use("/api/progress", require("./routes/progress"));
app.use("/api/exams", require("./routes/exams"));
app.use("/api/certificates", require("./routes/certificates"));
app.use("/api/admin", require("./routes/admin"));

// Optional dev routes (only in development)
if (!isProd) {
  try {
    app.use("/api/dev", require("./routes/dev"));
  } catch {}
}

// ---------- ERROR HANDLER ----------
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).json({ error: err.message || "Server error" });
});

// ---------- START ----------
const PORT = process.env.PORT || 4000;
console.log("Booting API. NODE_ENV =", process.env.NODE_ENV);
console.log("CORS_ORIGIN =", process.env.CORS_ORIGIN || "(not set)");
console.log("SESSION_DOMAIN =", process.env.SESSION_DOMAIN || "(not set)");
console.log("Has DATABASE_URL =", !!process.env.DATABASE_URL);
console.log("PORT from env =", PORT);

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});