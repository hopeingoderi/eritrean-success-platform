// backend/routes/exams.js
const express = require("express");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function getLang(req) {
  return req.query.lang === "ti" ? "ti" : "en";
}

function safeJsonParse(str, fallback = null) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// ✅ Configure retry policy here
const MAX_ATTEMPTS_PER_COURSE = 3; // change to 0 or null for unlimited

/**
 * GET /api/exams/status/:courseId
 * ✅ returns latest attempt + attemptCount (fast for dashboard)
 */
router.get("/status/:courseId", requireAuth, async (req, res) => {
  const userId = req.user?.id;
  const courseId = req.params.courseId;
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const countR = await query(
    `SELECT COUNT(*)::int AS c
     FROM exam_attempts
     WHERE user_id = $1 AND course_id = $2`,
    [userId, courseId]
  );

  const latestR = await query(
    `SELECT id, score, passed, created_at, updated_at
     FROM exam_attempts
     WHERE user_id = $1 AND course_id = $2
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [userId, courseId]
  );

  const row = latestR.rows[0] || null;

  return res.json({
    courseId,
    attemptCount: countR.rows[0]?.c ?? 0,
    attempted: !!row,
    passed: row?.passed ?? false,
    score: row?.score ?? null,
    created_at: row?.created_at ?? null,
    updated_at: row?.updated_at ?? null,
  });
});

/**
 * GET /api/exams/:courseId
 * returns exam definition + passScore
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

  if (!r.rows.length) return res.status(404).json({ error: "Exam not found", courseId });

  const def = r.rows[0];
  const jsonStr = lang === "ti" ? def.exam_json_ti : def.exam_json_en;
  const exam = safeJsonParse(jsonStr, null);

  if (!exam) {
    return res.status(500).json({ error: "Exam JSON invalid in DB", courseId, lang });
  }

  return res.json({ courseId, passScore: def.pass_score, exam });
});

// ✅ EXAM STATUS: last attempt + attempt count
router.get("/status/:courseId", requireAuth, async (req, res) => {
  const userId = req.user?.id;
  const courseId = req.params.courseId;

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  // Latest attempt
  const latestR = await query(
    `
    SELECT id, score, passed, created_at
    FROM exam_attempts
    WHERE user_id = $1 AND course_id = $2
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [userId, courseId]
  );

  // Attempt count
  const countR = await query(
    `
    SELECT COUNT(*)::int AS count
    FROM exam_attempts
    WHERE user_id = $1 AND course_id = $2
    `,
    [userId, courseId]
  );

  const latest = latestR.rows[0] || null;

  res.json({
    score: latest?.score ?? null,
    passed: latest?.passed ?? null,
    attemptCount: countR.rows[0].count,
    maxAttempts: null // unlimited (for now)
  });
});
/**
 * POST /api/exams/:courseId/submit
 * Body: { answers: number[] }
 * ✅ stores NEW attempt each time + returns results
 */
router.post("/:courseId/submit", requireAuth, async (req, res) => {
  const userId = req.user?.id;
  const courseId = req.params.courseId;
  const { answers } = req.body;

  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!Array.isArray(answers)) {
    return res.status(400).json({ error: "Answers array required" });
  }

  // Load exam definition
  const defR = await query(
    `SELECT pass_score, exam_json_en
     FROM exam_defs
     WHERE course_id = $1`,
    [courseId]
  );

  if (!defR.rows.length) {
    return res.status(404).json({ error: "Exam not found" });
  }

  const exam = JSON.parse(defR.rows[0].exam_json_en);
  const questions = exam.questions || [];

  // Compute results
  let correctCount = 0;
  const results = questions.map((q, i) => {
    const picked = answers[i];
    const correct = q.correctIndex;
    const isCorrect = picked === correct;
    if (isCorrect) correctCount++;
    return { index: i, picked, correct, isCorrect };
  });

  const score = Math.round((correctCount / questions.length) * 100);
  const passScore = defR.rows[0].pass_score;
  const passed = score >= passScore;

  // 🔑 INSERT NEW ATTEMPT (no ON CONFLICT)
  await query(
    `INSERT INTO exam_attempts
      (user_id, course_id, score, passed, answers, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
    [userId, courseId, score, passed, JSON.stringify(results)]
  );

  return res.json({
    passed,
    score,
    passScore,
    results
  });
});

module.exports = router;