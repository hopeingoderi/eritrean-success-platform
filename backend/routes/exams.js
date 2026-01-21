// backend/routes/exams.js
const express = require("express");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// GET exam definition
router.get("/:courseId", requireAuth, async (req, res) => {
  const courseId = req.params.courseId;
  const lang = (req.query.lang === "ti") ? "ti" : "en";

  const r = await query(
    "SELECT pass_score, exam_json_en, exam_json_ti FROM exam_defs WHERE course_id=$1",
    [courseId]
  );
  if (!r.rows.length) return res.status(404).json({ error: "Exam not found" });

  const def = r.rows[0];
  const examJson = JSON.parse(lang === "ti" ? def.exam_json_ti : def.exam_json_en);

  // Return latest attempt too (nice UX)
  const userId = req.session.user.id;
  const a = await query(
    "SELECT score, passed, updated_at FROM exam_attempts WHERE user_id=$1 AND course_id=$2",
    [userId, courseId]
  );

  res.json({
    courseId,
    passScore: def.pass_score,
    exam: examJson,
    latestAttempt: a.rows[0] || null
  });
});

// GET attempt/status (used by dashboard/cert)
router.get("/status/:courseId", requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const courseId = req.params.courseId;

  const r = await query(
    "SELECT score, passed, updated_at FROM exam_attempts WHERE user_id=$1 AND course_id=$2",
    [userId, courseId]
  );

  const attempt = r.rows[0] || null;
  res.json({
    courseId,
    passed: attempt ? !!attempt.passed : false,
    score: attempt ? attempt.score : null,
    updatedAt: attempt ? attempt.updated_at : null
  });
});

// POST submit answers -> server calculates score
router.post("/:courseId/submit", requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const courseId = req.params.courseId;

  const answers = req.body?.answers;
  const lang = (req.body?.lang === "ti") ? "ti" : "en";

  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: "Invalid answers" });
  }
  if (answers.some(a => !Number.isInteger(a) || a < 0)) {
    return res.status(400).json({ error: "Invalid answers" });
  }

  // load exam def
  const defR = await query(
    "SELECT pass_score, exam_json_en, exam_json_ti FROM exam_defs WHERE course_id=$1",
    [courseId]
  );
  if (!defR.rows.length) return res.status(404).json({ error: "Exam not found" });

  const passScore = defR.rows[0].pass_score;
  const exam = JSON.parse(lang === "ti" ? defR.rows[0].exam_json_ti : defR.rows[0].exam_json_en);
  const questions = exam?.questions || [];

  if (answers.length !== questions.length) {
    return res.status(400).json({ error: "Invalid answers" });
  }

  // compute score
  let correct = 0;
  for (let i = 0; i < questions.length; i++) {
    const correctIndex = questions[i]?.correctIndex;
    if (Number.isInteger(correctIndex) && answers[i] === correctIndex) correct++;
  }

  const score = Math.round((correct / questions.length) * 100);
  const passed = score >= passScore;

  // upsert attempt
  await query(
    `INSERT INTO exam_attempts (user_id, course_id, score, passed, updated_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (user_id, course_id) DO UPDATE SET
       score=EXCLUDED.score,
       passed=EXCLUDED.passed,
       updated_at=NOW()`,
    [userId, courseId, score, passed]
  );

  res.json({ ok: true, score, passed, passScore });
});

module.exports = router;
