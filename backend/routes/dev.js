// backend/routes/dev.js
const express = require("express");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/**
 * DEV ONLY — mark exam as passed
 * POST /api/dev/pass-exam
 * body: { courseId, score }
 */
router.post("/pass-exam", requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const courseId = String(req.body?.courseId || "");
  const score = Number(req.body?.score ?? 100);

  if (!courseId) {
    return res.status(400).json({ error: "courseId required" });
  }

  await query(
    `INSERT INTO exam_attempts (user_id, course_id, score, passed, updated_at)
     VALUES ($1,$2,$3,true,NOW())
     ON CONFLICT (user_id, course_id)
     DO UPDATE SET
       score = EXCLUDED.score,
       passed = true,
       updated_at = NOW()`,
    [userId, courseId, Math.max(0, Math.min(100, score))]
  );

  res.json({ ok: true });
});

module.exports = router;