// backend/routes/admin.js
const express = require("express");
const { query } = require("../db_pg");

const router = express.Router();

/**
 * Safely return a quiz object
 * - DB jsonb often comes back as an object already
 * - but some drivers / older rows might be string
 */
function quizSafe(v) {
  if (!v) return { questions: [] };
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return { questions: [] };
    }
  }
  return { questions: [] };
}

/**
 * Safely parse JSON for exam payloads
 */
function safeJsonParse(val, fallback) {
  try {
    if (!val) return fallback;
    if (typeof val === "object") return val; // json/jsonb from pg
    return JSON.parse(val);                  // string
  } catch {
    return fallback;
  }
}

/**
 * Admin guard:
 * - works with either {isAdmin:true} OR {role:"admin"}
 */
function requireAdmin(req, res, next) {
  const u = req.session?.user;

  if (!u) return res.status(401).json({ error: "Not logged in" });

  const isAdmin =
    u.isAdmin === true || String(u.role || "").toLowerCase() === "admin";

  if (!isAdmin) return res.status(403).json({ error: "Admin only" });

  next();
}

/* =========================================================
   LESSONS
   ========================================================= */

// GET /api/admin/lessons/:courseId
router.get("/lessons/:courseId", requireAdmin, async (req, res) => {
  const courseId = String(req.params.courseId || "").trim();

  try {
    const r = await query(
      `SELECT id, course_id, lesson_index, title_en, title_ti,
              learn_en, learn_ti, task_en, task_ti, quiz
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
    console.error("ADMIN lessons load error:", e);
    return res.status(500).json({ error: "Failed to load lessons" });
  }
});

// POST /api/admin/lesson/save
router.post("/lesson/save", requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const id = b.id ? Number(b.id) : null;

    const courseId = String(b.courseId || "").trim();
    const lessonIndex = Number(b.lessonIndex);

    const title_en = String(b.title_en || "").trim();
    const title_ti = String(b.title_ti || "").trim();
    const learn_en = String(b.learn_en || "").trim();
    const learn_ti = String(b.learn_ti || "").trim();
    const task_en = String(b.task_en || "").trim();
    const task_ti = String(b.task_ti || "").trim();

    const quiz = quizSafe(b.quiz);

    if (!courseId) return res.status(400).json({ error: "courseId required" });
    if (!Number.isInteger(lessonIndex))
      return res.status(400).json({ error: "lessonIndex invalid" });

    if (!title_en || !title_ti || !learn_en || !learn_ti || !task_en || !task_ti) {
      return res.status(400).json({ error: "All text fields are required" });
    }

    if (id) {
      await query(
        `UPDATE lessons
         SET course_id=$1, lesson_index=$2, title_en=$3, title_ti=$4,
             learn_en=$5, learn_ti=$6, task_en=$7, task_ti=$8,
             quiz=$9::jsonb
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
          JSON.stringify(quiz),
          id,
        ]
      );
    } else {
      await query(
        `INSERT INTO lessons
           (course_id, lesson_index, title_en, title_ti, learn_en, learn_ti, task_en, task_ti, quiz)
         VALUES
           ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          courseId,
          lessonIndex,
          title_en,
          title_ti,
          learn_en,
          learn_ti,
          task_en,
          task_ti,
          JSON.stringify(quiz),
        ]
      );
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("ADMIN lesson save error:", e);
    return res.status(500).json({ error: "Failed to save lesson" });
  }
});

// DELETE /api/admin/lesson/:id
router.delete("/lesson/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });

    await query("DELETE FROM lessons WHERE id=$1", [id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error("ADMIN lesson delete error:", e);
    return res.status(500).json({ error: "Failed to delete lesson" });
  }
});

/* =========================================================
   EXAMS
   ========================================================= */

// GET /api/admin/exam/:courseId
router.get("/exam/:courseId", requireAdmin, async (req, res) => {
  const courseId = String(req.params.courseId || "").trim();

  try {
    const r = await query(
      `SELECT course_id, pass_score, exam_json_en, exam_json_ti
       FROM exam_defs
       WHERE course_id=$1`,
      [courseId]
    );

    // If not found, return defaults (so UI doesn't crash)
    if (!r.rows.length) {
      const exam_en = { questions: [] };
      const exam_ti = { questions: [] };
      return res.json({
        courseId,
        passScore: 70,
        exam_en,
        exam_ti,
        // extra fields: useful if UI expects strings
        exam_en_text: JSON.stringify(exam_en, null, 2),
        exam_ti_text: JSON.stringify(exam_ti, null, 2),
      });
    }

    const row = r.rows[0];
    const exam_en = safeJsonParse(row.exam_json_en, { questions: [] });
    const exam_ti = safeJsonParse(row.exam_json_ti, { questions: [] });

    return res.json({
      courseId: row.course_id,
      passScore: Number(row.pass_score ?? 70),
      exam_en,
      exam_ti,
      // extra fields: useful if UI expects strings
      exam_en_text: JSON.stringify(exam_en, null, 2),
      exam_ti_text: JSON.stringify(exam_ti, null, 2),
    });
  } catch (e) {
    console.error("ADMIN exam load error:", e);
    return res.status(500).json({ error: "Failed to load exam" });
  }
});

// POST /api/admin/exam/save
// body: { courseId, passScore, exam_en, exam_ti }
router.post("/exam/save", requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const courseId = String(b.courseId || "").trim();
    const passScore = Number(b.passScore);

    if (!courseId) return res.status(400).json({ error: "courseId required" });
    if (!Number.isFinite(passScore)) return res.status(400).json({ error: "passScore invalid" });

    const exam_en = safeJsonParse(b.exam_en, { questions: [] });
    const exam_ti = safeJsonParse(b.exam_ti, { questions: [] });

    await query(
      `INSERT INTO exam_defs (course_id, pass_score, exam_json_en, exam_json_ti)
       VALUES ($1,$2,$3::jsonb,$4::jsonb)
       ON CONFLICT (course_id) DO UPDATE SET
         pass_score=EXCLUDED.pass_score,
         exam_json_en=EXCLUDED.exam_json_en,
         exam_json_ti=EXCLUDED.exam_json_ti`,
      [courseId, passScore, JSON.stringify(exam_en), JSON.stringify(exam_ti)]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("ADMIN exam save error:", e);
    return res.status(500).json({ error: "Failed to save exam" });
  }
});

module.exports = router;