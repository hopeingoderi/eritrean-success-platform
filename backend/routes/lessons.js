// backend/routes/lessons.js
const express = require("express");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();

/**
 * Always return a safe quiz object.
 */
function quizSafe(q) {
  if (q && typeof q === "object" && !Array.isArray(q)) {
    return { questions: Array.isArray(q.questions) ? q.questions : [] };
  }
  return { questions: [] };
}

/**
 * Safely parse JSON from TEXT columns.
 */
function safeJsonParse(str) {
  if (!str || typeof str !== "string") return { questions: [] };
  try {
    const parsed = JSON.parse(str);
    return quizSafe(parsed);
  } catch {
    return { questions: [] };
  }
}

/**
 * Detect whether lessons table uses `quiz` (jsonb) or `quiz_json` (text).
 * Cached after first call.
 */
let quizColumnPromise = null;

async function getQuizColumnInfo() {
  if (!quizColumnPromise) {
    quizColumnPromise = query(
      `
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name='lessons'
        AND column_name IN ('quiz', 'quiz_json')
      `
    );
  }
  const r = await quizColumnPromise;
  const cols = r.rows.map((x) => x.column_name);

  return {
    hasQuizJsonb: cols.includes("quiz"),
    hasQuizText: cols.includes("quiz_json"),
  };
}

/* ================= STUDENT LESSONS =================
   GET /api/lessons/:courseId?lang=en|ti
*/
router.get("/:courseId", requireAuth, async (req, res) => {
  try {
    const { courseId } = req.params;
    const lang = req.query.lang === "ti" ? "ti" : "en";

    const { hasQuizJsonb, hasQuizText } = await getQuizColumnInfo();

    // Build SELECT depending on DB schema
    let sql;
    if (hasQuizJsonb) {
      sql = `
        SELECT
          lesson_index,
          title_${lang} AS title,
          learn_${lang} AS "learnText",
          task_${lang} AS task,
          COALESCE(quiz, '{"questions":[]}'::jsonb) AS quiz
        FROM lessons
        WHERE course_id = $1
        ORDER BY lesson_index
      `;
    } else if (hasQuizText) {
      sql = `
        SELECT
          lesson_index,
          title_${lang} AS title,
          learn_${lang} AS "learnText",
          task_${lang} AS task,
          quiz_json
        FROM lessons
        WHERE course_id = $1
        ORDER BY lesson_index
      `;
    } else {
      // No quiz column found at all
      sql = `
        SELECT
          lesson_index,
          title_${lang} AS title,
          learn_${lang} AS "learnText",
          task_${lang} AS task
        FROM lessons
        WHERE course_id = $1
        ORDER BY lesson_index
      `;
    }

    const r = await query(sql, [courseId]);

    const lessons = r.rows.map((row) => {
      const quiz =
        hasQuizJsonb ? quizSafe(row.quiz)
        : hasQuizText ? safeJsonParse(row.quiz_json)
        : { questions: [] };

      return {
        lessonIndex: row.lesson_index,
        title: row.title,
        learnText: row.learnText,
        task: row.task,
        quiz,
      };
    });

    return res.json({ courseId, lessons });
  } catch (err) {
    console.error("LESSONS ERROR:", err);
    return res.status(500).json({ error: "Failed to load lessons" });
  }
});

/* ================= ADMIN SAVE LESSON =================
   POST /api/lessons/lesson/save
   (If you still use this route. Otherwise your admin routes may be /api/admin/lesson/save)
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

    if (!courseId || lessonIndex === undefined || lessonIndex === null) {
      return res.status(400).json({ error: "Missing courseId or lessonIndex" });
    }

    const q = quizSafe(quiz);
    const { hasQuizJsonb, hasQuizText } = await getQuizColumnInfo();

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
          [courseId, lessonIndex, title_en, title_ti, learn_en, learn_ti, task_en, task_ti, q, id]
        );
      } else if (hasQuizText) {
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
          [courseId, lessonIndex, title_en, title_ti, learn_en, learn_ti, task_en, task_ti, JSON.stringify(q), id]
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
            task_ti=$8
          WHERE id=$9
          `,
          [courseId, lessonIndex, title_en, title_ti, learn_en, learn_ti, task_en, task_ti, id]
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
          [courseId, lessonIndex, title_en, title_ti, learn_en, learn_ti, task_en, task_ti, q]
        );
      } else if (hasQuizText) {
        await query(
          `
          INSERT INTO lessons
            (course_id, lesson_index, title_en, title_ti, learn_en, learn_ti, task_en, task_ti, quiz_json)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `,
          [courseId, lessonIndex, title_en, title_ti, learn_en, learn_ti, task_en, task_ti, JSON.stringify(q)]
        );
      } else {
        await query(
          `
          INSERT INTO lessons
            (course_id, lesson_index, title_en, title_ti, learn_en, learn_ti, task_en, task_ti)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          `,
          [courseId, lessonIndex, title_en, title_ti, learn_en, learn_ti, task_en, task_ti]
        );
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("SAVE LESSON ERROR:", err);
    return res.status(500).json({ error: "Failed to save lesson" });
  }
});

module.exports = router;