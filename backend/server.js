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
const PORT = process.env.PORT || 4000;

// ----------------------------------------------------
// MIDDLEWARE
// ----------------------------------------------------
app.use(express.json());

// CORS (Render + local + cookies)
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
  : true;

app.use(
  cors({
    origin: corsOrigins,
    credentials: true
  })
);

// Session (required for login persistence)
app.use(
  session({
    name: "esj.sid",
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax"
    }
  })
);

// ----------------------------------------------------
// ROUTES
// ----------------------------------------------------
app.use("/api/auth", authRoutes);
app.use("/api/courses", coursesRoutes);
app.use("/api/lessons", lessonsRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/exams", examsRoutes);
app.use("/api/certificates", certificatesRoutes);

// ----------------------------------------------------
// HEALTH CHECK
// ----------------------------------------------------
app.get("/", (req, res) => {
  res.send("✅ Eritrean Success Journey API is running");
});

// ----------------------------------------------------
// GLOBAL ERROR HANDLER
// ----------------------------------------------------
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).json({ error: "Server error" });
});

// ----------------------------------------------------
// START SERVER
// ----------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
  console.log("NODE_ENV =", process.env.NODE_ENV);
  console.log("Has DATABASE_URL =", !!process.env.DATABASE_URL);
});