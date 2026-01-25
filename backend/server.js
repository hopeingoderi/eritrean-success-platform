// backend/server.js
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

import authRoutes from "./routes/auth.js";
import coursesRoutes from "./routes/courses.js";
import lessonsRoutes from "./routes/lessons.js";
import progressRoutes from "./routes/progress.js";
import examsRoutes from "./routes/exams.js";
import certificatesRoutes from "./routes/certificates.js";
import adminRoutes from "./routes/admin.js";
import devRoutes from "./routes/dev.js";

dotenv.config();

const app = express();

/* ------------------- CONFIG ------------------- */

const PORT = process.env.PORT || 4000;
const CLIENT_URL =
  process.env.CLIENT_URL ||
  "https://riseeritrea.com";

/* ------------------- MIDDLEWARE ------------------- */

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* ------------------- HEALTH CHECK ------------------- */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Eritrean Success Journey API",
    time: new Date().toISOString(),
  });
});

/* ------------------- API ROUTES ------------------- */

app.use("/api/auth", authRoutes);
app.use("/api/courses", coursesRoutes);
app.use("/api/lessons", lessonsRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/exams", examsRoutes);
app.use("/api/certificates", certificatesRoutes);
app.use("/api/admin", adminRoutes);

// ⚠️ dev routes only if enabled
if (process.env.NODE_ENV !== "production") {
  app.use("/api/dev", devRoutes);
}

/* ------------------- 404 HANDLER ------------------- */

app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    path: req.originalUrl,
  });
});

/* ------------------- ERROR HANDLER ------------------- */

app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);

  res.status(500).json({
    error: "Server error",
  });
});

/* ------------------- START SERVER ------------------- */

app.listen(PORT, () => {
  console.log(`✅ API running on port ${PORT}`);
});