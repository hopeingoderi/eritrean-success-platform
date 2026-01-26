// backend/routes/lessons.js
const express = require("express");
const { query } = require("../db_pg");

const router = express.Router();

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
 * STUDENT: GET /api/lessons/:courseId?lang=en|ti
 * IMPORTANT: server.js mounts this router at /api/lessons
 */
router.get("/:courseId", async (req, res) => {
  try {
    const courseId = String(req.params.courseId || "").trim();
    if (!courseId) return res.status(400).json({ error: "Missing courseId" });

    const lang = String(req.query.lang || "en").toLowerCase(); // "en" or "ti"
    const useTi = lang === "ti" || lang === "tg" || lang === "tigrinya";

    const r = await query(
      `SELECT id, course_id, lesson_index,
              title_en, title_ti, learn_en, learn_ti, task_en, task_ti, quiz
       FROM lessons
       WHERE course_id=$1
       ORDER BY lesson_index ASC, id ASC`,
      [courseId]
    );

    const lessons = r.rows.map((row) => {
      const lessonIndex = Number(row.lesson_index);

      // Provide BOTH:
      // - "student friendly" fields: lessonIndex/title/learn/task
      // - keep old fields too for safety: lesson_index/title_en/... etc
      return {
        id: row.id,

        // student expected keys
        courseId: row.course_id,
        lessonIndex,
        title: useTi ? row.title_ti : row.title_en,
        learn: useTi ? row.learn_ti : row.learn_en,
        task: useTi ? row.task_ti : row.task_en,
        quiz: quizSafe(row.quiz),

        // legacy keys (won't hurt)
        course_id: row.course_id,
        lesson_index: row.lesson_index,
        title_en: row.title_en,
        title_ti: row.title_ti,
        learn_en: row.learn_en,
        learn_ti: row.learn_ti,
        task_en: row.task_en,
        task_ti: row.task_ti,
      };
    });

    return res.json({ lessons });
  } catch (e) {
    console.error("GET /api/lessons/:courseId error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;