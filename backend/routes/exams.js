// backend/routes/exams.js
// REPLACE WHOLE FILE ✅
//
// Endpoints:
// - GET  /api/exams/status/:courseId
// - GET  /api/exams/:courseId?lang=en|ti
// - POST /api/exams/:courseId/submit
//
// Behavior:
// - Stores a NEW attempt row on each submit
// - Enforces MAX_ATTEMPTS_PER_COURSE (set to null for unlimited)
// - Returns per-question results for frontend marking

const express = require("express");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ✅ change this (null = unlimited)
const MAX_ATTEMPTS_PER_COURSE = 3;

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

/**
 * GET /api/exams/status/:courseId
 * returns latest attempt + attemptCount (+ maxAttempts)
 */
router.get("/status/:courseId", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const courseId = String(req.params.courseId || "").trim();

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!courseId) return res.status(400).json({ error: "Missing courseId" });

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
       ORDER BY created_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [userId, courseId]
    );

    const attemptCount = countR.rows[0]?.c ?? 0;
    const latest = latestR.rows[0] || null;

    res.json({
      courseId,
      attemptCount,
      maxAttempts: MAX_ATTEMPTS_PER_COURSE,
      attempted: !!latest,
      score: latest?.score ?? null,
      passed: latest?.passed ?? false,
      created_at: latest?.created_at ?? null,
      updated_at: latest?.updated_at ?? null
    });
  } catch (err) {
    console.error("EXAMS STATUS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/exams/:courseId?lang=en|ti
 * returns exam definition + passScore
 */
router.get("/:courseId", requireAuth, async (req, res) => {
  try {
    const courseId = String(req.params.courseId || "").trim();
    const lang = getLang(req);

    if (!courseId) return res.status(400).json({ error: "Missing courseId" });

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

    if (!exam || !Array.isArray(exam.questions) || exam.questions.length === 0) {
      return res.status(500).json({
        error: "Exam JSON invalid in DB",
        courseId,
        lang
      });
    }

    res.json({
      courseId,
      passScore: def.pass_score,
      exam
    });
  } catch (err) {
    console.error("EXAMS GET ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/exams/:courseId/submit
 * Body: { answers: number[] }
 */
router.post("/:courseId/submit", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const courseId = String(req.params.courseId || "").trim();
    const { answers } = req.body || {};

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!courseId) return res.status(400).json({ error: "Missing courseId" });
    if (!Array.isArray(answers)) return res.status(400).json({ error: "Answers array required" });

    // ✅ attempt limit (if enabled)
    if (Number.isFinite(MAX_ATTEMPTS_PER_COURSE)) {
      const countR = await query(
        `SELECT COUNT(*)::int AS c
         FROM exam_attempts
         WHERE user_id = $1 AND course_id = $2`,
        [userId, courseId]
      );
      const attemptCount = countR.rows[0]?.c ?? 0;

      if (attemptCount >= MAX_ATTEMPTS_PER_COURSE) {
        return res.status(403).json({
          error: "Maximum attempts reached",
          attemptCount,
          maxAttempts: MAX_ATTEMPTS_PER_COURSE
        });
      }
    }

    // Load exam definition (use EN as grading source of truth)
    const defR = await query(
      `SELECT pass_score, exam_json_en
       FROM exam_defs
       WHERE course_id = $1`,
      [courseId]
    );
    if (!defR.rows.length) return res.status(404).json({ error: "Exam not found", courseId });

    const def = defR.rows[0];
    const exam = safeJsonParse(def.exam_json_en, null);
    const questions = exam?.questions || [];

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(500).json({ error: "Exam questions missing/invalid", courseId });
    }

    // Compute results
    let correctCount = 0;
    const results = questions.map((q, i) => {
      const picked = Number.isFinite(answers[i]) ? answers[i] : -1;
      const correct = q.correctIndex;
      const isCorrect = picked === correct;
      if (isCorrect) correctCount++;
      return { index: i, picked, correct, isCorrect };
    });

    const score = Math.round((correctCount / questions.length) * 100);
    const passScore = def.pass_score;
    const passed = score >= passScore;

    // Insert NEW attempt row
    await query(
      `INSERT INTO exam_attempts
        (user_id, course_id, score, passed, answers, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [userId, courseId, score, passed, JSON.stringify(results)]
    );

    // return updated attempt count too (nice for UI)
    const countAfter = await query(
      `SELECT COUNT(*)::int AS c
       FROM exam_attempts
       WHERE user_id = $1 AND course_id = $2`,
      [userId, courseId]
    );

    return res.json({
      passed,
      score,
      passScore,
      results,
      attemptCount: countAfter.rows[0]?.c ?? null,
      maxAttempts: MAX_ATTEMPTS_PER_COURSE
    });
  } catch (err) {
    console.error("EXAMS SUBMIT ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;