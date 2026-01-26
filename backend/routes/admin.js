// backend/routes/admin.js
const express = require("express");
const { query } = require("../db_pg");

const router = express.Router();

/** Safely normalize quiz JSON */
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

/** Admin-only middleware */
function requireAdmin(req, res, next) {
  const u = req.session?.user;
  if (!u) return res.status(401).json({ error: "Not logged in" });
  if (!u.isAdmin) return res.status(403).json({ error: "Admin only" });
  next();
}

/**
 * GET /api/admin/lessons/:courseId
 */
router.get("/lessons/:courseId", requireAdmin, async (req, res) => {
  const courseId = String(req.params.courseId || "").trim();

  try {
    const r = await query(
      `SELECT id, course_id, lesson_index,
              title_en, title_ti,
              learn_en, learn_ti,
              task_en, task_ti,
              quiz
       FROM lessons
       WHERE course_id=$1
       ORDER BY lesson_index ASC`,
      [courseId]
    );

    const lessons = r.rows.map(row => ({
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

    res.json({ lessons });
  } catch (err) {
    console.error("ADMIN lessons load error:", err);
    res.status(500).json({ error: "Failed to load lessons" });
  }
});

/**
 * POST /api/admin/lesson/save
 */
router.post("/lesson/save", requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const id = b.id ? Number(b.id) : null;

    const courseId = String(b.courseId || "").trim();
    const lessonIndex = Number(b.lessonIndex);

    if (!courseId) return res.status(400).json({ error: "courseId required" });
    if (!Number.isInteger(lessonIndex)) {
      return res.status(400).json({ error: "lessonIndex invalid" });
    }

    const title_en = String(b.title_en || "").trim();
    const title_ti = String(b.title_ti || "").trim();
    const learn_en = String(b.learn_en || "").trim();
    const learn_ti = String(b.learn_ti || "").trim();
    const task_en = String(b.task_en || "").trim();
    const task_ti = String(b.task_ti || "").trim();
    const quiz = quizSafe(b.quiz);

    if (!title_en || !title_ti || !learn_en || !learn_ti || !task_en || !task_ti) {
      return res.status(400).json({ error: "All text fields are required" });
    }

    if (id) {
      await query(
        `UPDATE lessons
         SET course_id=$1, lesson_index=$2,
             title_en=$3, title_ti=$4,
             learn_en=$5, learn_ti=$6,
             task_en=$7, task_ti=$8,
             quiz=$9::jsonb
         WHERE id=$10`,
        [
          courseId, lessonIndex,
          title_en, title_ti,
          learn_en, learn_ti,
          task_en, task_ti,
          JSON.stringify(quiz),
          id
        ]
      );
    } else {
      await query(
        `INSERT INTO lessons
         (course_id, lesson_index, title_en, title_ti,
          learn_en, learn_ti, task_en, task_ti, quiz)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          courseId, lessonIndex,
          title_en, title_ti,
          learn_en, learn_ti,
          task_en, task_ti,
          JSON.stringify(quiz)
        ]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("ADMIN lesson save error:", err);
    res.status(500).json({ error: "Failed to save lesson" });
  }
});

/**
 * DELETE /api/admin/lesson/:id
 */
router.delete("/lesson/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });

    await query("DELETE FROM lessons WHERE id=$1", [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("ADMIN lesson delete error:", err);
    res.status(500).json({ error: "Failed to delete lesson" });
  }
});

module.exports = router;