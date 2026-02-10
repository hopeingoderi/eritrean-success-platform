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
 * Helper: extract "correct" index/value from many possible shapes
 * Supports: correctIndex, correct, answer, correctAnswer
 */
function getCorrectValue(q) {
  if (!q || typeof q !== "object") return null;

  if (Number.isInteger(q.correctIndex)) return q.correctIndex;

  // common: correct: 0 / 1 / 2 ...
  if (Number.isInteger(q.correct)) return q.correct;

  // common: answer: 0 / 1 / 2 ...
  if (Number.isInteger(q.answer)) return q.answer;

  // sometimes boolean true/false
  if (typeof q.correct === "boolean") return q.correct ? 1 : 0;
  if (typeof q.answer === "boolean") return q.answer ? 1 : 0;

  // sometimes stored as string "0"/"1"/"2"
  if (typeof q.correct === "string" && q.correct.trim() !== "" && !Number.isNaN(Number(q.correct))) {
    return Number(q.correct);
  }
  if (typeof q.answer === "string" && q.answer.trim() !== "" && !Number.isNaN(Number(q.answer))) {
    return Number(q.answer);
  }

  // sometimes: correctAnswer
  if (Number.isInteger(q.correctAnswer)) return q.correctAnswer;
  if (typeof q.correctAnswer === "string" && q.correctAnswer.trim() !== "" && !Number.isNaN(Number(q.correctAnswer))) {
    return Number(q.correctAnswer);
  }

  return null;
}

/**
 * ✅ FIX: add route that frontend calls:
 * GET /api/exams/:courseId/status
 * (Keep old /status/:courseId too, for compatibility)
 */
async function handleStatus(req, res) {
  const userId = req.user?.id;
  const courseId = req.params.courseId;

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

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
}

router.get("/:courseId/status", requireAuth, handleStatus);
router.get("/status/:courseId", requireAuth, handleStatus);

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
  const userId = req.user?.id;
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
 * ✅ FIX: POST /api/exams/:courseId/submit
 * Accepts { answers: number[] } (preferred) OR { score: number } (fallback)
 * Stores attempt and returns pass/fail
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

  // Score
  const score = Math.round((correctCount / questions.length) * 100);
  const passScore = defR.rows[0].pass_score;
  const passed = score >= passScore;

  // Store attempt
  await query(
    `INSERT INTO exam_attempts
      (user_id, course_id, score, passed, answers, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id, course_id)
     DO UPDATE SET
       score = EXCLUDED.score,
       passed = EXCLUDED.passed,
       answers = EXCLUDED.answers,
       updated_at = NOW()`,
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