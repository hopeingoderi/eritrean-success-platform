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

  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  // Load exam def (we need pass_score + exam_json for scoring)
  const lang = getLang(req);
  const defR = await query(
    `SELECT pass_score, exam_json_en, exam_json_ti
     FROM exam_defs
     WHERE course_id = $1`,
    [courseId]
  );

  if (!defR.rows.length) {
    return res.status(404).json({ error: "Exam not found", courseId });
  }

  const passScore = defR.rows[0].pass_score;

  // ---- Compute score ----
  let score = null;

  // 1) Preferred: answers-based scoring
  const answers = req.body?.answers;
  if (Array.isArray(answers)) {
    const jsonStr = lang === "ti" ? defR.rows[0].exam_json_ti : defR.rows[0].exam_json_en;
    const exam = safeJsonParse(jsonStr, null);

    const questions = Array.isArray(exam?.questions) ? exam.questions : null;
    if (!questions) {
      return res.status(500).json({ error: "Exam JSON missing questions[]", courseId, lang });
    }

    const n = Math.min(questions.length, answers.length);
    let correct = 0;
    let total = 0;

    for (let i = 0; i < n; i++) {
      const q = questions[i];
      const expected = getCorrectValue(q);
      const picked = answers[i];

      // skip if exam doesn't contain a valid correct answer for this question
      if (expected === null || expected === undefined) continue;

      total++;
      if (Number(picked) === Number(expected)) correct++;
    }

    // If we couldn't score anything, return clear error (prevents "Invalid score" confusion)
    if (total === 0) {
      return res.status(500).json({
        error: "Could not score exam (no correct answers found in exam_json)",
        courseId,
        lang,
      });
    }

    score = Math.round((correct / total) * 100);
  }

  // 2) Fallback: accept score directly (keeps old clients working)
  if (score === null || score === undefined) {
    const providedScore = req.body?.score;
    if (typeof providedScore === "number" && !Number.isNaN(providedScore)) {
      score = providedScore;
    }
  }

  // Validate score (final)
  if (typeof score !== "number" || Number.isNaN(score) || score < 0 || score > 100) {
    return res.status(400).json({
      error: "Invalid score (0..100 required)",
      hint: "Send { answers: [...] } or { score: number }",
    });
  }

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