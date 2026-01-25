// backend/routes/lessons.js
const express = require("express");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ✅ Safe JSON parser (prevents crashes when DB contains "undefined", "null", empty string, etc.)
function safeParseJson(value) {
  if (value === null || value === undefined) return null;

  // If DB value is a string, validate + parse safely
  if (typeof value === "string") {
    const trimmed = value.trim();

    // 🔥 IMPORTANT: block invalid JSON strings that crash JSON.parse
    if (trimmed === "" || trimmed.toLowerCase() === "undefined" || trimmed.toLowerCase() === "null") {
      return null;
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  // If it's already an object/array (json/jsonb), return as-is
  if (typeof value === "object") return value;

  return null;
}

/**
 * GET /api/lessons/:courseId?lang=en|ti
 * Returns lesson content for student SPA
 */
router.get("/:courseId", requireAuth, async (req, res) => {
  try {
    const { courseId } = req.params;
    const lang = req.query.lang === "ti" ? "ti" : "en";

    const r = await query(
      `SELECT lesson_index, title_en, title_ti, learn_en, learn_ti, task_en, task_ti, quiz_json
       FROM lessons
       WHERE course_id=$1
       ORDER BY lesson_index`,
      [courseId]
    );

    const lessons = r.rows.map((x) => {
      const quiz = safeParseJson(x.quiz_json);

      return {
        lessonIndex: x.lesson_index,
        title: lang === "ti" ? (x.title_ti || x.title_en || "") : (x.title_en || x.title_ti || ""),
        learnText: lang === "ti" ? (x.learn_ti || x.learn_en || "") : (x.learn_en || x.learn_ti || ""),
        task: lang === "ti" ? (x.task_ti || x.task_en || "") : (x.task_en || x.task_ti || ""),
        quiz
      };
    });

    res.json({ courseId, lessons });
  } catch (err) {
    console.error("LESSONS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;