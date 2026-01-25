// backend/routes/lessons.js
const express = require("express");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();

function quizSafe(value) {
  // jsonb from Postgres should already be an object
  if (value && typeof value === "object") return value;
  return { questions: [] };
}

/* ================= STUDENT LESSONS =================
   GET /api/lessons/:courseId?lang=en|ti
*/
router.get("/:courseId", requireAuth, async (req, res) => {
  try {
    const { courseId } = req.params;
    const lang = req.query.lang === "ti" ? "ti" : "en";

    const r = await query(
      `SELECT
          lesson_index,
          title_en, title_ti,
          learn_en, learn_ti,
          task_en, task_ti,
          COALESCE(quiz, '{"questions":[]}'::jsonb) AS quiz
       FROM lessons
       WHERE course_id=$1
       ORDER BY lesson_index`,
      [courseId]
    );

    const lessons = r.rows.map((row) => {
      const title =
        lang === "ti"
          ? (row.title_ti || row.title_en || "")
          : (row.title_en || row.title_ti || "");

      const learnText =
        lang === "ti"
          ? (row.learn_ti || row.learn_en || "")
          : (row.learn_en || row.learn_ti || "");

      const task =
        lang === "ti"
          ? (row.task_ti || row.task_en || "")
          : (row.task_en || row.task_ti || "");

      return {
        lessonIndex: row.lesson_index,
        title,
        learnText,
        task,
        quiz: quizSafe(row.quiz),
      };
    });

    res.json({ courseId, lessons });
  } catch (err) {
    console.error("STUDENT LESSONS ERROR:", err);
    res.status(500).json({ error: "Failed to load lessons" });
  }
});

/* ================= ADMIN SAVE LESSON =================
   POST /api/lessons/lesson/save
*/
router.post("/lesson/save", requireAdmin, async (req, res) => {
  try {
    let {
      id,
      courseId,
      lessonIndex,
      title_en,
      title_ti,
      learn_en,
      learn_ti,
      task_en,
      task_ti,
      quiz,
    } = req.body;

    if (!courseId || lessonIndex === undefined) {
      return res.status(400).json({ error: "Missing courseId or lessonIndex" });
    }

    const q = quizSafe(quiz);

    if (id) {
      await query(
        `UPDATE lessons SET
          course_id=$1,
          lesson_index=$2,
          title_en=$3,
          title_ti=$4,
          learn_en=$5,
          learn_ti=$6,
          task_en=$7,
          task_ti=$8,
          quiz=$9
         WHERE id=$10`,
        [
          courseId,
          lessonIndex,
          title_en,
          title_ti,
          learn_en,
          learn_ti,
          task_en,
          task_ti,
          q,
          id,
        ]
      );
    } else {
      await query(
        `INSERT INTO lessons
          (course_id, lesson_index, title_en, title_ti,
           learn_en, learn_ti, task_en, task_ti, quiz)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          courseId,
          lessonIndex,
          title_en,
          title_ti,
          learn_en,
          learn_ti,
          task_en,
          task_ti,
          q,
        ]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("SAVE LESSON ERROR:", err);
    res.status(500).json({ error: "Failed to save lesson" });
  }
});

module.exports = router;