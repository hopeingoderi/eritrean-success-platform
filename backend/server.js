// backend/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const session = require("express-session");

const authRoutes = require("./routes/auth");
const coursesRoutes = require("./routes/courses");
const lessonsRoutes = require("./routes/lessons");
const progressRoutes = require("./routes/progress");
const examsRoutes = require("./routes/exams");
const certificatesRoutes = require("./routes/certificates");

const app = express();

const PORT = process.env.PORT || 4000;

// ---------- MIDDLEWARE ----------
app.use(express.json());

app.use(
  cors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",")
      : true,
    credentials: true
  })
);

app.use(
  session({
    name: "esj.sid",
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax"
    }
  })
);

// ---------- ROUTES ----------
app.use("/api/auth", authRoutes);
app.use("/api/courses", coursesRoutes);
app.use("/api/lessons", lessonsRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/exams", examsRoutes);
app.use("/api/certificates", certificatesRoutes);

// ---------- HEALTH ----------
app.get("/", (req, res) => {
  res.send("Eritrean Success Journey API running");
});

// ---------- ERROR ----------
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).json({ error: "Server error" });
});

// ---------- START ----------
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});