const express = require("express");
const { z } = require("zod");
const { query } = require("../db_pg");

const router = express.Router();

/**
 * GET exam for a course
 * /api/admin/exam/:courseId
 */
router.get("/exam/:courseId", async (req, res) => {
  const { courseId } = req.params;

  const r = await query(
    `SELECT pass_score, exam_en, exam_ti
     FROM exams
     WHERE course_id=$1
     LIMIT 1`,
    [courseId]
  );

  if (!r.rows.length) {
    return res.json({
      passScore: 70,
      exam_en: { questions: [] },
      exam_ti: { questions: [] }
    });
  }

  const row = r.rows[0];
  res.json({
    passScore: row.pass_score,
    exam_en: row.exam_en || { questions: [] },
    exam_ti: row.exam_ti || { questions: [] }
  });
});

/**
 * SAVE exam
 * POST /api/admin/exam/save
 */
router.post("/exam/save", async (req, res) => {
  const schema = z.object({
    courseId: z.string(),
    passScore: z.number().int().min(0).max(100),
    exam_en: z.any(),
    exam_ti: z.any()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input" });
  }

  const { courseId, passScore, exam_en, exam_ti } = parsed.data;

  await query(
    `INSERT INTO exams (course_id, pass_score, exam_en, exam_ti)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (course_id)
     DO UPDATE SET
       pass_score=EXCLUDED.pass_score,
       exam_en=EXCLUDED.exam_en,
       exam_ti=EXCLUDED.exam_ti,
       updated_at=NOW()`,
    [courseId, passScore, exam_en || { questions: [] }, exam_ti || { questions: [] }]
  );

  res.json({ ok: true });
});

module.exports = router;
