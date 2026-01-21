// backend/routes/exams.js
const express = require("express");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Helper: safely JSON.parse
function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// GET /api/exams/status/:courseId
// Returns { courseId, passed, score, updatedAt } (or passed:false if no attempt)
router.get("/status/:courseId", requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const courseId = req.params.courseId;

  const r = await query(
    "SELECT score, passed, updated_at FROM exam_attempts WHERE user_id=$1 AND course_id=$2",
    [userId, courseId]
  );

  const a = r.rows[0] || null;
  res.json({
    courseId,
    passed: !!a?.passed,
    score: typeof a?.score === "number" ? a.score : null,
    updatedAt: a?.updated_at || null
  });
});

// GET /api/exams/:courseId
// Returns exam definition + last attempt
router.get("/:courseId", requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const courseId = req.params.courseId;
  const lang = (req.query.lang === "ti") ? "ti" : "en";

  const defR = await query(
    "SELECT pass_score, exam_json_en, exam_json_ti FROM exam_defs WHERE course_id=$1",
    [courseId]
  );
  if (!defR.rows.length) return res.status(404).json({ error: "Exam not found" });

  const def = defR.rows[0];
  const exam = safeJsonParse(lang === "ti" ? def.exam_json_ti : def.exam_json_en, { questions: [] });

  const attR = await query(
    "SELECT score, passed, updated_at FROM exam_attempts WHERE user_id=$1 AND course_id=$2",
    [userId, courseId]
  );

  res.json({
    courseId,
    passScore: def.pass_score,
    exam,
    latestAttempt: attR.rows[0] || null
  });
});

// GET /api/exams/:courseId/attempt
router.get("/:courseId/attempt", requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const courseId = req.params.courseId;

  const r = await query(
    "SELECT score, passed, updated_at FROM exam_attempts WHERE user_id=$1 AND course_id=$2",
    [userId, courseId]
  );
  res.json({ attempt: r.rows[0] || null });
});

// POST /api/exams/:courseId/submit
// Body: { answers: number[] }  (index of chosen option for each question)
router.post("/:courseId/submit", requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const courseId = req.params.courseId;
  const lang = (req.query.lang === "ti") ? "ti" : "en";

  const answers = req.body?.answers;
  if (!Array.isArray(answers)) {
    return res.status(400).json({ error: "Invalid answers" });
  }

  const defR = await query(
    "SELECT pass_score, exam_json_en, exam_json_ti FROM exam_defs WHERE course_id=$1",
    [courseId]
  );
  if (!defR.rows.length) return res.status(404).json({ error: "Exam not found" });

  const passScore = defR.rows[0].pass_score;
  const exam = safeJsonParse(lang === "ti" ? defR.rows[0].exam_json_ti : defR.rows[0].exam_json_en, { questions: [] });

  const questions = Array.isArray(exam.questions) ? exam.questions : [];
  if (!questions.length) return res.status(400).json({ error: "Exam has no questions" });

  // Score: compare answers[i] to questions[i].correctIndex
  let correct = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const correctIndex = q.correctIndex;
    if (typeof correctIndex === "number" && answers[i] === correctIndex) correct++;
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

  res.json({ ok: true, score, passed, passScore });
});

module.exports = router;
