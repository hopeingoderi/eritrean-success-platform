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
/**
 * PUBLIC / STUDENT
 * Mounted at: /api/lessons
 * GET /api/lessons/:courseId?lang=en|ti
 */
router.get("/:courseId", async (req, res) => {
  try {
    const courseId = String(req.params.courseId || "").trim();
    if (!courseId) return res.status(400).json({ error: "Missing courseId" });

    const lang = req.lang || "en"; // from server.js middleware

    const r = await query(
      `SELECT id, course_id, lesson_index,
              title_en, title_ti,
              learn_en, learn_ti,
              task_en, task_ti,
              quiz
       FROM lessons
       WHERE course_id=$1
       ORDER BY lesson_index ASC`,
      [courseId]
    );

    const lessons = r.rows.map((row) => ({
      id: row.id,
      courseId: row.course_id,
      lessonIndex: row.lesson_index,

      // Student-friendly fields (language resolved)
      title: lang === "ti" ? (row.title_ti || row.title_en || "") : (row.title_en || ""),
      learn: lang === "ti" ? (row.learn_ti || row.learn_en || "") : (row.learn_en || ""),
      task:  lang === "ti" ? (row.task_ti  || row.task_en  || "") : (row.task_en  || ""),

      // keep quiz safe (student needs it for lesson quiz)
      quiz: quizSafe(row.quiz),
    }));

    return res.json({ lessons });
  } catch (e) {
    console.error("GET /api/lessons/:courseId error:", e);
    return res.status(500).json({ error: "Server error" });
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