process.on("uncaughtException", (err) => console.error("UNCAUGHT EXCEPTION:", err));
process.on("unhandledRejection", (err) => console.error("UNHANDLED REJECTION:", err));

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");

const { pool } = require("./db_pg");

const requireLogin = require("./middleware/requireLogin");
const requireAdmin = require("./middleware/requireAdmin");

const app = express();
app.set("trust proxy", 1);

app.use(helmet());
app.use(rateLimit({ windowMs: 60_000, max: 300 }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// ✅ CORS (ONLY ONCE)
app.use(cors({
  origin: ["https://riseeritrea.com", "https://www.riseeritrea.com"],
  credentials: true
}));

// ✅ SESSION (cross-subdomain cookie)
app.use(session({
  name: "esj.sid",
  store: new pgSession({ pool, tableName: "session" }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: true,                 // REQUIRED (https)
    sameSite: "none",             // REQUIRED for cross-site cookies
    domain: ".riseeritrea.com",   // share cookie across subdomains
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
}));

app.get("/api/health", (req, res) => res.json({ ok: true }));

// PUBLIC
app.use("/api/auth", require("./routes/auth"));
app.use("/api/courses", require("./routes/courses"));
app.use("/api/lessons", require("./routes/lessons"));

// STUDENT (logged-in)
app.use("/api/progress", requireLogin, require("./routes/progress"));
app.use("/api/exams", requireLogin, require("./routes/exams"));
app.use("/api/certificates", requireLogin, require("./routes/certificates"));

// ADMIN
app.use("/api/admin", requireAdmin, require("./routes/admin"));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log("API running on port", PORT));
