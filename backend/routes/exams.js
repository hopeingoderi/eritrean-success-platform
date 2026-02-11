// backend/routes/exams.js
const express = require("express");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function getLang(req) {
  return req.query.lang === "ti" ? "ti" : "en";
}

function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// ✅ Retry policy (0 = unlimited)
const MAX_ATTEMPTS_PER_COURSE = 3;

/**
 * GET /api/exams/status/:courseId
 * returns: attemptCount + latest attempt fields (for UI meta)
 */
router.get("/status/:courseId", requireAuth, async (req, res) => {
  const userId = req.user?.id;
  const courseId = req.params.courseId;

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const countR = await query(
    `
      SELECT COUNT(*)::int AS attempt_count
      FROM exam_attempts
      WHERE user_id = $1 AND course_id = $2
    `,
    [userId, courseId]
  );

  const latestR = await query(
    `
      SELECT id, score, passed, created_at, updated_at
      FROM exam_attempts
      WHERE user_id = $1 AND course_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [userId, courseId]
  );

  const attemptCount = countR.rows[0]?.attempt_count ?? 0;
  const latest = latestR.rows[0] || null;

  res.json({
    courseId,
    attemptCount,
    maxAttempts: MAX_ATTEMPTS_PER_COURSE || null,
    attempted: !!latest,
    passed: latest?.passed ?? false,
    score: latest?.score ?? null,
    created_at: latest?.created_at ?? null,
    updated_at: latest?.updated_at ?? null,
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
    `
      SELECT pass_score, exam_json_en, exam_json_ti
      FROM exam_defs
      WHERE course_id = $1
    `,
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
      error: "Exam JSON invalid in DB",
      courseId,
      lang,
    });
  }

  res.json({ courseId, passScore: def.pass_score, exam });
});

/**
 * POST /api/exams/:courseId/submit
 * Body: { answers: number[] }
 * stores NEW attempt each submission + returns per-question results
 */
router.post("/:courseId/submit", requireAuth, async (req, res) => {
  const userId = req.user?.id;
  const courseId = req.params.courseId;
  const { answers } = req.body;

  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!Array.isArray(answers)) {
    return res.status(400).json({ error: "Answers array required" });
  }

  // Enforce attempt limit (if enabled)
  if (MAX_ATTEMPTS_PER_COURSE && MAX_ATTEMPTS_PER_COURSE > 0) {
    const cnt = await query(
      `
        SELECT COUNT(*)::int AS c
        FROM exam_attempts
        WHERE user_id = $1 AND course_id = $2
      `,
      [userId, courseId]
    );
    const attemptCount = cnt.rows[0]?.c ?? 0;

    if (attemptCount >= MAX_ATTEMPTS_PER_COURSE) {
      return res.status(403).json({
        error: "Max attempts reached",
        attemptCount,
        maxAttempts: MAX_ATTEMPTS_PER_COURSE,
      });
    }
  }

  // Load exam definition (use EN for grading; correctIndex should match)
  const defR = await query(
    `
      SELECT pass_score, exam_json_en
      FROM exam_defs
      WHERE course_id = $1
    `,
    [courseId]
  );

  if (!defR.rows.length) {
    return res.status(404).json({ error: "Exam not found" });
  }

  const exam = safeJsonParse(defR.rows[0].exam_json_en, null);
  if (!exam || !Array.isArray(exam.questions)) {
    return res.status(500).json({ error: "Exam JSON invalid" });
  }

  const questions = exam.questions;
  const total = questions.length;

  let correctCount = 0;

  const results = questions.map((q, i) => {
    const picked = answers[i];
    const correct = q.correctIndex;
    const isCorrect = picked === correct;
    if (isCorrect) correctCount++;
    return { index: i, picked, correct, isCorrect };
  });

  const score = total ? Math.round((correctCount / total) * 100) : 0;
  const passScore = defR.rows[0].pass_score;
  const passed = score >= passScore;

  // Insert new attempt row each time
  await query(
    `
      INSERT INTO exam_attempts
        (user_id, course_id, score, passed, answers, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, NOW(), NOW())
    `,
    [userId, courseId, score, passed, results] // answers is JSONB
  );

  res.json({
    passed,
    score,
    passScore,
    results,
  });
});

module.exports = router;