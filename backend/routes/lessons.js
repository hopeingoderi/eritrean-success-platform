// backend/routes/lessons.js
const express = require("express");
const { query } = require("../db_pg");

const router = express.Router();

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
 * STUDENT ONLY
 * GET /api/lessons/:courseId?lang=en|ti
 */
router.get("/:courseId", async (req, res) => {
  try {
    const courseId = String(req.params.courseId || "").trim();
    if (!courseId) {
      return res.status(400).json({ error: "Missing courseId" });
    }

    const lang = String(req.query.lang || "en").toLowerCase();
    const useTi = lang === "ti" || lang === "tg";

    const r = await query(
      `SELECT id, course_id, lesson_index,
              title_en, title_ti,
              learn_en, learn_ti,
              task_en, task_ti,
              quiz
       FROM lessons
       WHERE course_id=$1
       ORDER BY lesson_index ASC, id ASC`,
      [courseId]
    );

    const lessons = r.rows.map((row) => ({
      id: row.id,
      courseId: row.course_id,

      // ✅ THIS FIXES NaN
      lessonIndex: Number(row.lesson_index),

      // ✅ language-aware fields
      title: useTi ? row.title_ti : row.title_en,
      learn: useTi ? row.learn_ti : row.learn_en,
      task: useTi ? row.task_ti : row.task_en,

      quiz: quizSafe(row.quiz),
    }));

    return res.json({ lessons });
  } catch (err) {
    console.error("STUDENT lessons error:", err);
    return res.status(500).json({ error: "Failed to load lessons" });
  }
});

module.exports = router;