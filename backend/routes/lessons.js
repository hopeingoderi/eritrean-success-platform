// backend/routes/lessons.js
const express = require("express");
const { query } = require("../db_pg");

const router = express.Router();

/** Never crash on quiz parsing */
function quizSafe(v) {
  if (!v) return { questions: [] };
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" ? parsed : { questions: [] };
    } catch {
      return { questions: [] };
    }
  }
  return { questions: [] };
}

/**
 * PUBLIC/STUDENT: GET /api/lessons/:courseId
 * Because server.js mounts this router at /api/lessons,
 * this must be router.get("/:courseId")
 */
router.get("/:courseId", async (req, res) => {
  try {
    const courseId = String(req.params.courseId || "").trim();
    if (!courseId) return res.status(400).json({ error: "Missing courseId" });

    const r = await query(
      `SELECT id, course_id, lesson_index, title_en, title_ti, learn_en, learn_ti, task_en, task_ti, quiz
       FROM lessons
       WHERE course_id=$1
       ORDER BY lesson_index ASC`,
      [courseId]
    );

    const lessons = r.rows.map((row) => ({
      id: row.id,
      course_id: row.course_id,
      lesson_index: row.lesson_index,
      title_en: row.title_en,
      title_ti: row.title_ti,
      learn_en: row.learn_en,
      learn_ti: row.learn_ti,
      task_en: row.task_en,
      task_ti: row.task_ti,
      quiz: quizSafe(row.quiz),
    }));

    return res.json({ lessons });
  } catch (e) {
    console.error("GET /api/lessons/:courseId error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;