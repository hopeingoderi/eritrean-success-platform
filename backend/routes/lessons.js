// backend/routes/lessons.js
const express = require("express");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/**
 * Safely parse JSON that may be:
 * - null
 * - empty string
 * - "undefined"
 * - invalid JSON
 * - already an object (json/jsonb)
 */
function safeParseJson(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === "object") {
    return value; // already parsed (json/jsonb)
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      trimmed === "" ||
      trimmed.toLowerCase() === "undefined" ||
      trimmed.toLowerCase() === "null"
    ) {
      return null;
    }

    try {
      return JSON.parse(trimmed);
    } catch (err) {
      console.warn("⚠️ Invalid quiz_json skipped:", trimmed);
      return null;
    }
  }

  return null;
}

/**
 * GET /api/lessons/:courseId?lang=en|ti
 * Returns lessons for the student app
 */
router.get("/:courseId", requireAuth, async (req, res) => {
  try {
    const { courseId } = req.params;
    const lang = req.query.lang === "ti" ? "ti" : "en";

    const r = await query(
      `
      SELECT
        lesson_index,
        title_en,
        title_ti,
        learn_en,
        learn_ti,
        task_en,
        task_ti,
        quiz_json
      FROM lessons
      WHERE course_id = $1
      ORDER BY lesson_index
      `,
      [courseId]
    );

    const lessons = r.rows.map((row) => ({
      lessonIndex: Number(row.lesson_index),
      title:
        lang === "ti"
          ? row.title_ti || row.title_en || ""
          : row.title_en || row.title_ti || "",
      learnText:
        lang === "ti"
          ? row.learn_ti || row.learn_en || ""
          : row.learn_en || row.learn_ti || "",
      task:
        lang === "ti"
          ? row.task_ti || row.task_en || ""
          : row.task_en || row.task_ti || "",
      quiz: safeParseJson(row.quiz_json)
    }));

    res.json({ courseId, lessons });
  } catch (err) {
    console.error("LESSONS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;