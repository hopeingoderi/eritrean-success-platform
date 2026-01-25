// backend/routes/lessons.js
const express = require("express");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function safeQuiz(value) {
  // DB column is jsonb => usually object or null
  if (value == null) return { questions: [] };

  // If somehow a string got stored/returned, guard it
  if (typeof value === "string") {
    const s = value.trim();
    if (!s || s.toLowerCase() === "undefined" || s.toLowerCase() === "null") {
      return { questions: [] };
    }
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === "object" ? parsed : { questions: [] };
    } catch {
      return { questions: [] };
    }
  }

  if (typeof value === "object") return value;
  return { questions: [] };
}

/**
 * GET /api/lessons/:courseId?lang=en|ti
 */
router.get("/:courseId", requireAuth, async (req, res) => {
  try {
    const { courseId } = req.params;
    const lang = req.query.lang === "ti" ? "ti" : "en";

    // IMPORTANT: your DB column is quiz (jsonb)
    const r = await query(
      `SELECT
         lesson_index,
         title_en, title_ti,
         learn_en, learn_ti,
         task_en, task_ti,
         quiz
       FROM lessons
       WHERE course_id = $1
       ORDER BY lesson_index`,
      [courseId]
    );

    const lessons = r.rows.map((x) => ({
      lessonIndex: x.lesson_index,
      title: lang === "ti" ? (x.title_ti || x.title_en || "") : (x.title_en || x.title_ti || ""),
      learnText: lang === "ti" ? (x.learn_ti || x.learn_en || "") : (x.learn_en || x.learn_ti || ""),
      task: lang === "ti" ? (x.task_ti || x.task_en || "") : (x.task_en || x.task_ti || ""),
      quiz: safeQuiz(x.quiz),
    }));

    res.json({ courseId, lessons });
  } catch (err) {
    console.error("LESSONS ERROR:", err);
    res.status(500).json({ error: "Failed to load lessons" });
  }
});

module.exports = router;