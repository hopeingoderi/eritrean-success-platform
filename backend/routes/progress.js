// backend/routes/progress.js
const express = require("express");
const { z } = require("zod");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /api/progress/status
 * Returns overall progress per course for logged-in user
 */
router.get("/status", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;

    const courses = await query("SELECT id FROM courses ORDER BY id");
    const out = [];

    for (const c of courses.rows) {
      const total = await query(
        "SELECT COUNT(*)::int AS c FROM lessons WHERE course_id=$1",
        [c.id]
      );

      const done = await query(
        "SELECT COUNT(*)::int AS c FROM progress WHERE user_id=$1 AND course_id=$2 AND completed=true",
        [userId, c.id]
      );

      const cert = await query(
        "SELECT 1 FROM certificates WHERE user_id=$1 AND course_id=$2 LIMIT 1",
        [userId, c.id]
      );

      out.push({
        courseId: c.id,
        totalLessons: total.rows[0]?.c ?? 0,
        completedLessons: done.rows[0]?.c ?? 0,
        hasCertificate: cert.rows.length > 0
      });
    }

    return res.json({ status: out });
  } catch (err) {
    console.error("PROGRESS STATUS ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/progress/course/:courseId
 * Returns per-lesson progress for a course
 */
router.get("/course/:courseId", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const courseId = String(req.params.courseId || "").trim();

    // lessons progress
    const r = await query(
      `SELECT lesson_index, completed, quiz_score, reflection, reflection_updated_at, updated_at
       FROM progress
       WHERE user_id=$1 AND course_id=$2
       ORDER BY lesson_index`,
      [userId, courseId]
    );

    const byLessonIndex = {};
    for (const row of r.rows) {
      byLessonIndex[row.lesson_index] = {
        completed: !!row.completed,
        quizScore: row.quiz_score ?? null
      };
    }

    // 🔽 ADD THESE TWO QUERIES
    const totalQ = await query(
      "SELECT COUNT(*)::int AS c FROM lessons WHERE course_id=$1",
      [courseId]
    );

    const doneQ = await query(
      "SELECT COUNT(*)::int AS c FROM progress WHERE user_id=$1 AND course_id=$2 AND completed=true",
      [userId, courseId]
    );

    // 🔽 ADD THESE VARIABLES
    const totalLessons = totalQ.rows[0]?.c ?? 0;
    const completedLessons = doneQ.rows[0]?.c ?? 0;

    // 🔽 THIS IS THE IMPORTANT PART
    return res.json({
      courseId,

      // canonical names
      totalLessons,
      completedLessons,

      // aliases (frontend safety)
      total: totalLessons,
      done: completedLessons,
      lessonsTotal: totalLessons,
      lessonsCompleted: completedLessons,

      byLessonIndex
    });
  } catch (err) {
    console.error("PROGRESS COURSE ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/update", requireAuth, async (req, res) => {
  const schema = z.object({
    courseId: z.string().min(1),
    lessonIndex: z.number().int().min(0),
    completed: z.boolean().optional(),
    quizScore: z.number().int().min(0).max(100).optional(),
    reflection: z.string().max(2000).optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
  }

  const userId = req.user?.id;
  const { courseId, lessonIndex, completed, quizScore, reflection } = parsed.data;

  // Convert missing optional fields to null for SQL params.
  // IMPORTANT: We cast $6::text inside SQL so NULL is safe (fixes 42P08).
  const completedParam = typeof completed === "boolean" ? completed : null;
  const quizScoreParam = typeof quizScore === "number" ? quizScore : null;
  const reflectionParam = typeof reflection === "string" ? reflection : null;

  try {
    await query(
      `INSERT INTO progress (
        user_id, course_id, lesson_index,
        completed, quiz_score, reflection,
        reflection_updated_at,
        updated_at
      )
      VALUES (
        $1::int,
        $2::text,
        $3::int,
        COALESCE($4::boolean, false),
        $5::int,
        $6::text,
        CASE WHEN $6 IS NOT NULL THEN NOW() ELSE NULL END,
        NOW()
      )
      ON CONFLICT (user_id, course_id, lesson_index) DO UPDATE SET
        completed = COALESCE($4::boolean, progress.completed),
        quiz_score = COALESCE($5::int, progress.quiz_score),
        reflection = COALESCE($6::text, progress.reflection),
        reflection_updated_at = CASE
          WHEN $6 IS NOT NULL THEN NOW()
          ELSE progress.reflection_updated_at
        END,
        updated_at = NOW()`,
      [
        userId,
        courseId,
        lessonIndex,
        completedParam,
        quizScoreParam,
        reflectionParam
      ]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("PROGRESS UPDATE ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
