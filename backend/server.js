const requireLogin = require("./middleware/requireLogin");
const requireAdmin = require("./middleware/requireAdmin");
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

console.log("Booting API. NODE_ENV =", process.env.NODE_ENV);
console.log("Has DATABASE_URL =", !!process.env.DATABASE_URL);
console.log("PORT from env =", process.env.PORT);

require("dotenv").config();
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const { pool } = require("./db_pg");

const app = express();

app.set("trust proxy", 1);

app.use(helmet());
app.use(rateLimit({ windowMs: 60_000, max: 200 }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use(cors({
  origin: [
    "https://riseeritrea.com",                    // allow any origin (ONLY for local dev)
    "https://www.riseeritrea.com"
  ],
  credentials: true
}));


const isProd = process.env.NODE_ENV === "production";

app.use(cors({
  origin: [
    "https://riseeritrea.com",
    "https://www.riseeritrea.com"
  ],
  credentials: true
}));

app.use(session({
  store: new pgSession({ pool, tableName: "session" }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
}));


app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", require("./routes/auth"));
app.use("/api/courses", require("./routes/courses"));
app.use("/api/lessons", require("./routes/lessons"));
app.use("/api/progress", require("./routes/progress"));
app.use("/api/exams", require("./routes/exams"));
app.use("/api/certificates", require("./routes/certificates"));

// admin routers share same prefix
app.use("/api/admin", require("./routes/admin_lessons"));
app.use("/api/admin", require("./routes/admin_exams"));

// more natural
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});


