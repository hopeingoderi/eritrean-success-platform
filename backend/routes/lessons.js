// backend/routes/lessons.js
//
// STUDENT/PUBLIC endpoints only (admin stays in backend/routes/admin.js)
//
// Mounted in server.js as:
//   app.use("/api/lessons", require("./routes/lessons"));
//
// So routes here become:
//   GET /api/lessons/:courseId?lang=en|ti
//
// Response shape for student UI:
//   { lessons: [ { id, lessonIndex, title, learn } ] }

const express = require("express");
const { query } = require("../db_pg");

const router = express.Router();

/**
 * GET /api/lessons/:courseId?lang=en|ti
 * Student-facing: returns minimal fields the student UI expects:
 *   id, lessonIndex, title, learn
 */
router.get("/:courseId", async (req, res) => {
  try {
    const courseId = String(req.params.courseId || "").trim();
    if (!courseId) return res.status(400).json({ error: "Missing courseId" });

    // default to English unless explicitly "ti"
    const lang = String(req.query.lang || "en").toLowerCase() === "ti" ? "ti" : "en";

    const r = await query(
      `SELECT id, lesson_index, title_en, title_ti, learn_en, learn_ti
       FROM lessons
       WHERE course_id=$1
       ORDER BY lesson_index ASC`,
      [courseId]
    );

    const lessons = r.rows.map((row) => ({
      id: row.id,
      lessonIndex: Number(row.lesson_index),
      title: lang === "ti" ? (row.title_ti || "") : (row.title_en || ""),
      learn: lang === "ti" ? (row.learn_ti || "") : (row.learn_en || ""),
    }));

    return res.json({ lessons });
  } catch (e) {
    console.error("GET /api/lessons/:courseId error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;