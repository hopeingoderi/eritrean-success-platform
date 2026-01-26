// backend/routes/lessons.js

const express = require("express");
const { query } = require("../db_pg");

const router = express.Router();

/**
 * Safely parse quiz JSON
 */
function quizSafe(v) {
  if (!v) return { questions: [] };
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return { questions: [] };
  }
}

/**
 * -----------------------------
 * STUDENT / PUBLIC
 * GET /api/lessons/:courseId
 * -----------------------------
 */
router.get("/:courseId", async (req, res) => {
  try {
    const courseId = String(req.params.courseId || "").trim();
    if (!courseId) {
      return res.status(400).json({ error: "Missing courseId" });
    }

    const r = await query(
      `
      SELECT
        id,
        lesson_index,
        title_en,
        title_ti,
        learn_en,
        learn_ti,
        task_en,
        task_ti,
        quiz
      FROM lessons
      WHERE course_id = $1
      ORDER BY lesson_index ASC
      `,
      [courseId]
    );

    const lessons = r.rows.map(row => ({
      id: row.id,
      lessonIndex: row.lesson_index,
      title: row.title_en,          // 👈 frontend uses "title"
      title_en: row.title_en,
      title_ti: row.title_ti,
      learn: row.learn_en,           // 👈 frontend uses "learn"
      learn_en: row.learn_en,
      learn_ti: row.learn_ti,
      task_en: row.task_en,
      task_ti: row.task_ti,
      quiz: quizSafe(row.quiz)
    }));

    return res.json({ lessons });
  } catch (err) {
    console.error("GET /api/lessons/:courseId failed:", err);
    return res.status(500).json({ error: "Failed to load lessons" });
  }
});

/**
 * -----------------------------
 * ADMIN GUARD
 * -----------------------------
 */
function requireAdmin(req, res, next) {
  const u = req.session?.user;
  if (!u) return res.status(401).json({ error: "Not logged in" });

  const isAdmin =
    u.isAdmin === true ||
    String(u.role || "").toLowerCase() === "admin";

  if (!isAdmin) {
    return res.status(403).json({ error: "Admin only" });
  }

  next();
}

/**
 * -----------------------------
 * ADMIN
 * GET /api/admin/lessons/:courseId
 * -----------------------------
 */
router.get("/admin/:courseId", requireAdmin, async (req, res) => {
  try {
    const courseId = String(req.params.courseId || "").trim();

    const r = await query(
      `
      SELECT
        id,
        course_id,
        lesson_index,
        title_en,
        title_ti,
        learn_en,
        learn_ti,
        task_en,
        task_ti,
        quiz
      FROM lessons
      WHERE course_id = $1
      ORDER BY lesson_index ASC
      `,
      [courseId]
    );

    return res.json({
      lessons: r.rows.map(row => ({
        id: row.id,
        course_id: row.course_id,
        lesson_index: row.lesson_index,
        title_en: row.title_en,
        title_ti: row.title_ti,
        learn_en: row.learn_en,
        learn_ti: row.learn_ti,
        task_en: row.task_en,
        task_ti: row.task_ti,
        quiz: quizSafe(row.quiz)
      }))
    });
  } catch (err) {
    console.error("ADMIN lessons load error:", err);
    return res.status(500).json({ error: "Failed to load lessons" });
  }
});

module.exports = router;