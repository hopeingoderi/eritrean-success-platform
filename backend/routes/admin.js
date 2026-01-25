// backend/routes/admin.js

"use strict";

const express = require("express");
const { z } = require("zod");
const { query } = require("../db_pg");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

const COURSE_IDS = ["foundation", "growth", "excellence"];

const courseIdSchema = z.enum(COURSE_IDS);

function safeJsonParse(val, fallback) {
  try {
    if (!val) return fallback;
    if (typeof val === "object") return val; // in case pg returns json already
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

/**
 * GET /api/admin/exam/:courseId
 * Returns the stored exam (EN + TI) for a course.
 */
router.get("/exam/:courseId", requireAdmin, async (req, res) => {
  try {
    const courseId = courseIdSchema.parse(req.params.courseId);

    const r = await query(
      "SELECT course_id, pass_score, exam_json_en, exam_json_ti FROM exam_defs WHERE course_id=$1",
      [courseId]
    );

    if (!r.rows.length) {
      return res.json({
        courseId,
        passScore: 70,
        exam_en: { questions: [] },
        exam_ti: { questions: [] }
      });
    }

    const row = r.rows[0];

    return res.json({
      courseId: row.course_id,
      passScore: Number(row.pass_score ?? 70),
      exam_en: safeJsonParse(row.exam_json_en, { questions: [] }),
      exam_ti: safeJsonParse(row.exam_json_ti, { questions: [] })
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return res.status(400).json({ error: "Invalid courseId" });
    }
    console.error("ADMIN GET EXAM ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/admin/exam/save
 * Body: { courseId, passScore, exam_en, exam_ti }
 */
router.post("/exam/save", requireAdmin, async (req, res) => {
  const schema = z.object({
    courseId: courseIdSchema,
    passScore: z.number().int().min(0).max(100),
    exam_en: z.object({
      questions: z
        .array(
          z.object({
            text: z.string().min(1),
            options: z.array(z.string().min(1)).min(2),
            correctIndex: z.number().int().min(0)
          })
        )
        .min(1)
    }),
    exam_ti: z.object({
      questions: z
        .array(
          z.object({
            text: z.string().min(1),
            options: z.array(z.string().min(1)).min(2),
            correctIndex: z.number().int().min(0)
          })
        )
        .min(1)
    })
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  const { courseId, passScore, exam_en, exam_ti } = parsed.data;

  const validate = (ex) => {
    ex.questions.forEach((q, i) => {
      if (q.correctIndex < 0 || q.correctIndex >= q.options.length) {
        throw new Error(`Question ${i + 1}: correctIndex out of range`);
      }
    });
  };

  try {
    validate(exam_en);
    validate(exam_ti);

    await query(
      `INSERT INTO exam_defs (course_id, pass_score, exam_json_en, exam_json_ti)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (course_id) DO UPDATE SET
         pass_score=EXCLUDED.pass_score,
         exam_json_en=EXCLUDED.exam_json_en,
         exam_json_ti=EXCLUDED.exam_json_ti`,
      [courseId, passScore, JSON.stringify(exam_en), JSON.stringify(exam_ti)]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("ADMIN SAVE EXAM ERROR:", err);
    return res.status(400).json({ error: err.message || "Invalid exam payload" });
  }
});

module.exports = router;
