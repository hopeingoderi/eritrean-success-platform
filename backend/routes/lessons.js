// backend/routes/lessons.js
const express = require("express");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();

const EMPTY_QUIZ = { questions: [] };

function safeQuizObj(v) {
  if (!v) return EMPTY_QUIZ;
  if (typeof v === "object") return v;

  // If it's a string, try parse safely
  if (typeof v === "string") {
    const s = v.trim();
    if (!s || s === "undefined" || s === "null") return EMPTY_QUIZ;
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === "object" ? parsed : EMPTY_QUIZ;
    } catch {
      return EMPTY_QUIZ;
    }
  }

  return EMPTY_QUIZ;
}

async function hasColumn(table, column) {
  const r = await query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_name=$1 AND column_name=$2
    LIMIT 1
    `,
    [table, column]
  );
  return r.rows.length > 0;
}

/* ================= STUDENT LESSONS =================
   GET /api/lessons/:courseId?lang=en|ti
*/
router.get("/:courseId", requireAuth, async (req, res) => {
  try {
    const { courseId } = req.params;
    const lang = req.query.lang === "ti" ? "ti" : "en";

    // Detect which column exists in THIS database: quiz (jsonb) OR quiz_json (text)
    const hasQuizJsonb = await hasColumn("lessons", "quiz");
    const hasQuizText = await hasColumn("lessons", "quiz_json");

    let quizSelect = `'{"questions":[]}'::jsonb AS quiz`;

    if (hasQuizJsonb) {
      // quiz is jsonb already
      quizSelect = `COALESCE(quiz, '{"questions":[]}'::jsonb) AS quiz`;
    } else if (hasQuizText) {
      // quiz_json is TEXT, may contain invalid strings like "undefined"
      quizSelect = `
        CASE
          WHEN quiz_json IS NULL OR btrim(quiz_json) = '' OR btrim(quiz_json) IN ('undefined','null')
            THEN '{"questions":[]}'::jsonb
          ELSE quiz_json::jsonb
        END AS quiz
      `;
    }

    const r = await query(
      `
      SELECT
        lesson_index,
        title_${lang} AS title,
        learn_${lang} AS "learnText",
        task_${lang} AS task,
        ${quizSelect}
      FROM lessons
      WHERE course_id=$1
      ORDER BY lesson_index
      `,
      [courseId]
    );

    const lessons = r.rows.map((row) => ({
      lessonIndex: row.lesson_index,
      title: row.title || "",
      learnText: row.learnText || "",
      task: row.task || "",
      quiz: safeQuizObj(row.quiz),
    }));

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
    const {
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

    const q = safeQuizObj(quiz);

    const hasQuizJsonb = await hasColumn("lessons", "quiz");
    const hasQuizText = await hasColumn("lessons", "quiz_json");

    if (!hasQuizJsonb && !hasQuizText) {
      return res.status(500).json({
        error: "DB schema error: lessons table has no quiz or quiz_json column",
      });
    }

    if (id) {
      if (hasQuizJsonb) {
        await query(
          `
          UPDATE lessons SET
            course_id=$1,
            lesson_index=$2,
            title_en=$3,
            title_ti=$4,
            learn_en=$5,
            learn_ti=$6,
            task_en=$7,
            task_ti=$8,
            quiz=$9
          WHERE id=$10
          `,
          [
            courseId,
            lessonIndex,
            title_en || "",
            title_ti || "",
            learn_en || "",
            learn_ti || "",
            task_en || "",
            task_ti || "",
            q,
            id,
          ]
        );
      } else {
        await query(
          `
          UPDATE lessons SET
            course_id=$1,
            lesson_index=$2,
            title_en=$3,
            title_ti=$4,
            learn_en=$5,
            learn_ti=$6,
            task_en=$7,
            task_ti=$8,
            quiz_json=$9
          WHERE id=$10
          `,
          [
            courseId,
            lessonIndex,
            title_en || "",
            title_ti || "",
            learn_en || "",
            learn_ti || "",
            task_en || "",
            task_ti || "",
            JSON.stringify(q),
            id,
          ]
        );
      }
    } else {
      if (hasQuizJsonb) {
        await query(
          `
          INSERT INTO lessons
            (course_id, lesson_index, title_en, title_ti, learn_en, learn_ti, task_en, task_ti, quiz)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `,
          [
            courseId,
            lessonIndex,
            title_en || "",
            title_ti || "",
            learn_en || "",
            learn_ti || "",
            task_en || "",
            task_ti || "",
            q,
          ]
        );
      } else {
        await query(
          `
          INSERT INTO lessons
            (course_id, lesson_index, title_en, title_ti, learn_en, learn_ti, task_en, task_ti, quiz_json)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `,
          [
            courseId,
            lessonIndex,
            title_en || "",
            title_ti || "",
            learn_en || "",
            learn_ti || "",
            task_en || "",
            task_ti || "",
            JSON.stringify(q),
          ]
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("SAVE LESSON ERROR:", err);
    res.status(500).json({ error: "Failed to save lesson" });
  }
});

module.exports = router;