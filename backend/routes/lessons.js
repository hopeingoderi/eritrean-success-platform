// backend/routes/lessons.js
//
// Uses ONLY: lessons.quiz (jsonb)
// Admin endpoints:
//   GET    /api/admin/lessons/:courseId
//   POST   /api/admin/lesson/save
//   DELETE /api/admin/lesson/:id
//
// Public/student endpoints (optional but useful):
//   GET    /api/lessons/:courseId

const express = require("express");
const { query } = require("../db_pg");

const router = express.Router();

/** Never crash on quiz parsing */
function quizSafe(v) {
  if (!v) return { questions: [] };
  if (typeof v === "object") return v; // json/jsonb often comes as object
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

/** Admin guard (supports both role and isAdmin) */
function requireAdmin(req, res, next) {
  const u = req.session?.user;
  const role = String(u?.role || "").toLowerCase();
  const isAdmin = u?.isAdmin === true || role === "admin";
  if (!u) return res.status(401).json({ error: "Not logged in" });
  if (!isAdmin) return res.status(403).json({ error: "Admin only" });
  next();
}

/** Normalize lesson payload from admin panel */
function normalizeLessonPayload(body) {
  const courseId = String(body?.courseId || body?.course_id || "").trim();
  const lessonIndex = Number(body?.lessonIndex ?? body?.lesson_index);

  return {
    id: body?.id ? Number(body.id) : null,
    courseId,
    lessonIndex: Number.isFinite(lessonIndex) ? lessonIndex : 0,

    title_en: String(body?.title_en || "").trim(),
    title_ti: String(body?.title_ti || "").trim(),
    learn_en: String(body?.learn_en || "").trim(),
    learn_ti: String(body?.learn_ti || "").trim(),
    task_en: String(body?.task_en || "").trim(),
    task_ti: String(body?.task_ti || "").trim(),

    quiz: quizSafe(body?.quiz)
  };
}

/**
 * PUBLIC/STUDENT: GET /api/lessons/:courseId
 * Returns lessons for the app. (Keeps quiz safe)
 */
router.get("/lessons/:courseId", async (req, res) => {
  try {
    const courseId = String(req.params.courseId || "").trim();
    if (!courseId) return res.status(400).json({ error: "Missing courseId" });

    const r = await query(
      `SELECT id, course_id, lesson_index, title_en, title_ti, learn_en, learn_ti, task_en, task_ti, quiz
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
      quiz: quizSafe(row.quiz)
    }));

    return res.json({ lessons });
  } catch (e) {
    console.error("GET /lessons/:courseId error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * ADMIN: GET /api/admin/lessons/:courseId
 */
router.get("/admin/lessons/:courseId", requireAdmin, async (req, res) => {
  try {
    const courseId = String(req.params.courseId || "").trim();
    if (!courseId) return res.status(400).json({ error: "Missing courseId" });

    const r = await query(
      `SELECT id, course_id, lesson_index, title_en, title_ti, learn_en, learn_ti, task_en, task_ti, quiz
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
      quiz: quizSafe(row.quiz)
    }));

    return res.json({ lessons });
  } catch (e) {
    console.error("GET /admin/lessons/:courseId error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * ADMIN: POST /api/admin/lesson/save
 * Upsert by (course_id, lesson_index) and also supports updating by id if provided.
 */
router.post("/admin/lesson/save", requireAdmin, async (req, res) => {
  try {
    const L = normalizeLessonPayload(req.body);

    if (!L.courseId) return res.status(400).json({ error: "courseId is required" });
    if (!Number.isFinite(L.lessonIndex) || L.lessonIndex < 0 || L.lessonIndex > 9) {
      return res.status(400).json({ error: "lessonIndex must be 0..9" });
    }
    if (!L.title_en) return res.status(400).json({ error: "title_en is required" });
    if (!L.title_ti) return res.status(400).json({ error: "title_ti is required" });

    // Store quiz as jsonb safely
    const quizJson = JSON.stringify(quizSafe(L.quiz));

    const r = await query(
      `INSERT INTO lessons (course_id, lesson_index, title_en, title_ti, learn_en, learn_ti, task_en, task_ti, quiz)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT (course_id, lesson_index) DO UPDATE SET
         title_en=EXCLUDED.title_en,
         title_ti=EXCLUDED.title_ti,
         learn_en=EXCLUDED.learn_en,
         learn_ti=EXCLUDED.learn_ti,
         task_en=EXCLUDED.task_en,
         task_ti=EXCLUDED.task_ti,
         quiz=EXCLUDED.quiz
       RETURNING id, course_id, lesson_index`,
      [
        L.courseId,
        L.lessonIndex,
        L.title_en,
        L.title_ti,
        L.learn_en,
        L.learn_ti,
        L.task_en,
        L.task_ti,
        quizJson
      ]
    );

    return res.json({ ok: true, lesson: r.rows[0] });
  } catch (e) {
    console.error("POST /admin/lesson/save error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * ADMIN: DELETE /api/admin/lesson/:id
 */
router.delete("/admin/lesson/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    await query("DELETE FROM lessons WHERE id=$1", [id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /admin/lesson/:id error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;