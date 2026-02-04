// backend/routes/exams.js
const express = require("express");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/**
 * Helper: normalize language
 */
function getLang(req) {
  return req.query.lang === "ti" ? "ti" : "en";
}

/**
 * Helper: safe JSON parse
 */
function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

/**
 * ✅ FIX for dashboard 404 + slow loading
 * GET /api/exams/status/:courseId?lang=en|ti
 * Returns whether user completed exam + score/pass
 */
router.get("/status/:courseId", requireAuth, async (req, res) => {
  const userId = req.user?.id;
  const courseId = req.params.courseId;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const r = await query(
    `
    SELECT score, passed, updated_at
    FROM exam_attempts
    WHERE user_id = $1 AND course_id = $2
    `,
    [userId, courseId]
  );

  const row = r.rows[0];

  return res.json({
    courseId,
    attempted: !!row,
    passed: row?.passed ?? false,
    score: row?.score ?? null,
    updated_at: row?.updated_at ?? null,
  });
});
/**
 * GET /api/exams/:courseId?lang=en|ti
 * Returns exam definition + passScore
 */
router.get("/:courseId", requireAuth, async (req, res) => {
  const courseId = req.params.courseId;
  const lang = getLang(req);

  const r = await query(
    `SELECT pass_score, exam_json_en, exam_json_ti
     FROM exam_defs
     WHERE course_id = $1`,
    [courseId]
  );

  if (!r.rows.length) {
    return res.status(404).json({ error: "Exam not found", courseId });
  }

  const def = r.rows[0];
  const jsonStr = lang === "ti" ? def.exam_json_ti : def.exam_json_en;
  const exam = safeJsonParse(jsonStr, null);

  if (!exam) {
    return res.status(500).json({
      error: "Exam JSON is invalid in database",
      courseId,
      lang,
    });
  }

  return res.json({
    courseId,
    passScore: def.pass_score,
    exam,
  });
});

/**
 * GET /api/exams/:courseId/attempt
 * Returns the user's attempt for this exam (if exists)
 */
router.get("/:courseId/attempt", requireAuth, async (req, res) => {
  const userId = req.user?.id;          // ✅ changed
  const courseId = req.params.courseId;

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const r = await query(
    `SELECT score, passed, updated_at
     FROM exam_attempts
     WHERE user_id = $1 AND course_id = $2`,
    [userId, courseId]
  );

  return res.json({ attempt: r.rows[0] || null });
});

/**
 * POST /api/exams/:courseId/submit
 * Body: { score: number } 0..100
 * Stores attempt and returns pass/fail
 */
router.post("/:courseId/submit", requireAuth, async (req, res) => {
  const userId = req.user?.id;          // ✅ changed
  const courseId = req.params.courseId;

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const score = req.body?.score;

  // Validate score
  if (typeof score !== "number" || Number.isNaN(score) || score < 0 || score > 100) {
    return res.status(400).json({ error: "Invalid score (0..100 required)" });
  }

  // Get pass score
  const defR = await query(
    `SELECT pass_score
     FROM exam_defs
     WHERE course_id = $1`,
    [courseId]
  );

  if (!defR.rows.length) {
    return res.status(404).json({ error: "Exam not found", courseId });
  }

  const passScore = defR.rows[0].pass_score;
  const passed = score >= passScore;

  // Upsert attempt
  await query(
    `INSERT INTO exam_attempts (user_id, course_id, score, passed, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, course_id) DO UPDATE SET
       score = EXCLUDED.score,
       passed = EXCLUDED.passed,
       updated_at = NOW()`,
    [userId, courseId, score, passed]
  );

  return res.json({
    ok: true,
    courseId,
    score,
    passed,
    passScore,
  });
});

module.exports = router;