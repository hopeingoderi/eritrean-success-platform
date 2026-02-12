// backend/routes/exams.js
// FINAL VERSION ✅

const express = require("express");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// 🔒 Attempt policy (null = unlimited)
const MAX_ATTEMPTS_PER_COURSE = 3;

function getLang(req) {
  return req.query.lang === "ti" ? "ti" : "en";
}

function safeJsonParse(str, fallback = null) {
  try { return JSON.parse(str); } catch { return fallback; }
}

/* ============================================
   STATUS
   GET /api/exams/status/:courseId
============================================ */
router.get("/status/:courseId", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const courseId = req.params.courseId;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const countR = await query(
      `SELECT COUNT(*)::int AS c
       FROM exam_attempts
       WHERE user_id=$1 AND course_id=$2`,
      [userId, courseId]
    );

    const latestR = await query(
      `SELECT score, passed, created_at
       FROM exam_attempts
       WHERE user_id=$1 AND course_id=$2
       ORDER BY created_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [userId, courseId]
    );

    const attemptCount = countR.rows[0]?.c ?? 0;
    const latest = latestR.rows[0] || null;

    res.json({
      attemptCount,
      maxAttempts: MAX_ATTEMPTS_PER_COURSE,
      score: latest?.score ?? null,
      passed: latest?.passed ?? false,
      created_at: latest?.created_at ?? null
    });

  } catch (err) {
    console.error("STATUS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================================
   GET EXAM DEFINITION
   GET /api/exams/:courseId
============================================ */
router.get("/:courseId", requireAuth, async (req, res) => {
  try {
    const courseId = req.params.courseId;
    const lang = getLang(req);

    const r = await query(
      `SELECT pass_score, exam_json_en, exam_json_ti
       FROM exam_defs
       WHERE course_id=$1`,
      [courseId]
    );

    if (!r.rows.length) {
      return res.status(404).json({ error: "Exam not found" });
    }

    const def = r.rows[0];
    const jsonStr = lang === "ti" ? def.exam_json_ti : def.exam_json_en;
    const exam = safeJsonParse(jsonStr);

    if (!exam?.questions) {
      return res.status(500).json({ error: "Invalid exam JSON" });
    }

    res.json({
      passScore: def.pass_score,
      exam
    });

  } catch (err) {
    console.error("GET EXAM ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================================
   SUBMIT EXAM
   POST /api/exams/:courseId/submit
============================================ */
router.post("/:courseId/submit", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const courseId = req.params.courseId;
    const { answers } = req.body;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!Array.isArray(answers)) return res.status(400).json({ error: "Answers required" });

    // Check attempts
    if (Number.isFinite(MAX_ATTEMPTS_PER_COURSE)) {
      const countR = await query(
        `SELECT COUNT(*)::int AS c
         FROM exam_attempts
         WHERE user_id=$1 AND course_id=$2`,
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

    // Load exam
    const defR = await query(
      `SELECT pass_score, exam_json_en
       FROM exam_defs
       WHERE course_id=$1`,
      [courseId]
    );

    if (!defR.rows.length) {
      return res.status(404).json({ error: "Exam not found" });
    }

    const def = defR.rows[0];
    const exam = safeJsonParse(def.exam_json_en);
    const questions = exam?.questions || [];

    let correctCount = 0;

    const results = questions.map((q, i) => {
      const picked = answers[i];
      const correct = q.correctIndex;
      const isCorrect = picked === correct;
      if (isCorrect) correctCount++;
      return { index: i, picked, correct, isCorrect };
    });

    const score = Math.round((correctCount / questions.length) * 100);
    const passed = score >= def.pass_score;

    await query(
      `INSERT INTO exam_attempts
       (user_id, course_id, score, passed, answers, created_at)
       VALUES ($1,$2,$3,$4,$5,NOW())`,
      [userId, courseId, score, passed, JSON.stringify(results)]
    );

    res.json({
      score,
      passScore: def.pass_score,
      passed,
      results
    });

  } catch (err) {
    console.error("SUBMIT ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;