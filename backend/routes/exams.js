// backend/routes/exams.js
const express = require("express");
const { query } = require("../db_pg");

const router = express.Router();

function getUserId(req) {
  return req.session?.user?.id;
}

function safeLang(lang) {
  return lang === "ti" ? "ti" : "en";
}

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * IMPORTANT: /status MUST come BEFORE /:courseId
 */

// GET /api/exams/status/:courseId
router.get("/status/:courseId", async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Not logged in" });

    const courseId = req.params.courseId;

    const r = await query(
      "SELECT score, passed, updated_at FROM exam_attempts WHERE user_id=$1 AND course_id=$2",
      [userId, courseId]
    );

    const row = r.rows[0] || null;
    res.json({
      courseId,
      passed: row ? !!row.passed : false,
      score: row ? row.score : null,
      updatedAt: row ? row.updated_at : null
    });
  } catch (err) {
    console.error("EXAMS STATUS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/exams/submit  (answers-based, backend calculates score)
router.post("/submit", async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Not logged in" });

    const courseId = req.body?.courseId;
    const answers = req.body?.answers;

    if (!courseId || !Array.isArray(answers)) {
      return res.status(400).json({ error: "Missing courseId or answers" });
    }

    const defR = await query(
      "SELECT pass_score, exam_json_en FROM exam_defs WHERE course_id=$1",
      [courseId]
    );
    if (!defR.rows.length) return res.status(404).json({ error: "Exam not found" });

    const passScore = defR.rows[0].pass_score ?? 70;
    const exam = safeJsonParse(defR.rows[0].exam_json_en, { questions: [] });

    const questions = Array.isArray(exam.questions) ? exam.questions : [];
    if (!questions.length) return res.status(400).json({ error: "Exam has no questions" });
    if (answers.length !== questions.length) return res.status(400).json({ error: "Answers length mismatch" });

    let correct = 0;
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const correctIndex = Number(q.correctIndex);
      const chosen = Number(answers[i]);
      if (Number.isFinite(correctIndex) && chosen === correctIndex) correct++;
    }

    const score = Math.round((correct / questions.length) * 100);
    const passed = score >= passScore;

    await query(
      `INSERT INTO exam_attempts (user_id, course_id, score, passed, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (user_id, course_id) DO UPDATE SET
         score=EXCLUDED.score,
         passed=EXCLUDED.passed,
         updated_at=NOW()`,
      [userId, courseId, score, passed]
    );

    res.json({ ok: true, courseId, score, passed, passScore });
  } catch (err) {
    console.error("EXAMS SUBMIT ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/exams/:courseId
router.get("/:courseId", async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Not logged in" });

    const courseId = req.params.courseId;
    const lang = safeLang(req.query.lang);

    const defR = await query(
      "SELECT pass_score, exam_json_en, exam_json_ti FROM exam_defs WHERE course_id=$1",
      [courseId]
    );
    if (!defR.rows.length) return res.status(404).json({ error: "Exam not found" });

    const def = defR.rows[0];
    const exam = safeJsonParse(lang === "ti" ? def.exam_json_ti : def.exam_json_en, { questions: [] });

    const attemptR = await query(
      "SELECT score, passed, updated_at FROM exam_attempts WHERE user_id=$1 AND course_id=$2",
      [userId, courseId]
    );

    res.json({
      courseId,
      passScore: def.pass_score,
      exam,
      latestAttempt: attemptR.rows[0] || null
    });
  } catch (err) {
    console.error("EXAMS GET ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// legacy: POST /api/exams/:courseId/submit  body { score }
router.post("/:courseId/submit", async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Not logged in" });

    const courseId = req.params.courseId;
    const score = req.body?.score;

    if (typeof score !== "number" || score < 0 || score > 100) {
      return res.status(400).json({ error: "Invalid score" });
    }

    const defR = await query("SELECT pass_score FROM exam_defs WHERE course_id=$1", [courseId]);
    if (!defR.rows.length) return res.status(404).json({ error: "Exam not found" });

    const passScore = defR.rows[0].pass_score ?? 70;
    const passed = score >= passScore;

    await query(
      `INSERT INTO exam_attempts (user_id, course_id, score, passed, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (user_id, course_id) DO UPDATE SET
         score=EXCLUDED.score,
         passed=EXCLUDED.passed,
         updated_at=NOW()`,
      [userId, courseId, score, passed]
    );

    res.json({ ok: true, passed, passScore, score });
  } catch (err) {
    console.error("EXAMS LEGACY SUBMIT ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
