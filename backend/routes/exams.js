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

// ✅ Configure retry policy here
const MAX_ATTEMPTS_PER_COURSE = 3; // set to null for unlimited

/**
 * GET /api/exams/status/:courseId
 * returns latest attempt + attemptCount
 */
router.get("/status/:courseId", requireAuth, async (req, res) => {
  try {
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
    const attemptCount = countR.rows[0]?.c ?? 0;

    return res.json({
      courseId,
      attemptCount,
      maxAttempts: MAX_ATTEMPTS_PER_COURSE ?? null,
      remainingAttempts:
        MAX_ATTEMPTS_PER_COURSE == null
          ? null
          : Math.max(0, MAX_ATTEMPTS_PER_COURSE - attemptCount),

      attempted: !!row,
      passed: row?.passed ?? false,
      score: row?.score ?? null,
      created_at: row?.created_at ?? null,
      updated_at: row?.updated_at ?? null,
    });
  } catch (e) {
    console.error("EXAMS STATUS ERROR:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
});

/**
 * GET /api/exams/:courseId
 * returns exam definition + passScore
 */
router.get("/:courseId", requireAuth, async (req, res) => {
  try {
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
      return res.status(500).json({ error: "Exam JSON invalid in DB", courseId, lang });
    }

    return res.json({ courseId, passScore: def.pass_score, exam });
  } catch (e) {
    console.error("GET EXAM ERROR:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
});

/**
 * POST /api/exams/:courseId/submit
 * Body: { answers: number[] }
 * stores NEW attempt each time + returns results
 */
router.post("/:courseId/submit", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const courseId = req.params.courseId;
    const { answers } = req.body;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!Array.isArray(answers)) {
      return res.status(400).json({ error: "Answers array required" });
    }

    // Optional: enforce retry limit
    if (MAX_ATTEMPTS_PER_COURSE != null) {
      const countR = await query(
        `SELECT COUNT(*)::int AS c
         FROM exam_attempts
         WHERE user_id = $1 AND course_id = $2`,
        [userId, courseId]
      );
      const attemptCount = countR.rows[0]?.c ?? 0;

      if (attemptCount >= MAX_ATTEMPTS_PER_COURSE) {
        return res.status(403).json({
          error: "Max attempts reached",
          attemptCount,
          maxAttempts: MAX_ATTEMPTS_PER_COURSE,
        });
      }
    }

    // Load exam definition (by lang)
    const lang = getLang(req);

    const defR = await query(
      `SELECT pass_score, exam_json_en, exam_json_ti
       FROM exam_defs
       WHERE course_id = $1`,
      [courseId]
    );

    if (!defR.rows.length) {
      return res.status(404).json({ error: "Exam not found" });
    }

    const def = defR.rows[0];
    const jsonStr = lang === "ti" ? def.exam_json_ti : def.exam_json_en;
    const exam = safeJsonParse(jsonStr, null);

    if (!exam) {
      return res.status(500).json({ error: "Exam JSON invalid in DB", courseId, lang });
    }

    const questions = exam.questions || [];
    const total = questions.length;

    // Compute results
    let correctCount = 0;

    const results = questions.map((q, i) => {
      const picked = answers[i];
      const correct = q.correctIndex;
      const isCorrect = picked === correct;
      if (isCorrect) correctCount++;
      return { index: i, picked, correct, isCorrect };
    });

    const score = total === 0 ? 0 : Math.round((correctCount / total) * 100);
    const passScore = def.pass_score;
    const passed = score >= passScore;

    // ✅ Insert NEW attempt each time
    // answers column is JSONB -> store results directly
    await query(
      `INSERT INTO exam_attempts
        (user_id, course_id, score, passed, answers, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())`,
      [userId, courseId, score, passed, JSON.stringify(results)]
    );

    return res.json({
      passed,
      score,
      passScore,
      results,
    });
  } catch (e) {
    console.error("SUBMIT EXAM ERROR:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
});

module.exports = router;