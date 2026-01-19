const express = require("express");
const { z } = require("zod");
const { query } = require("../db_pg");

const router = express.Router();

/**
 * GET lessons for a course (ADMIN)
 * /api/admin/lessons/:courseId
 */
router.get("/lessons/:courseId", async (req, res) => {
  const { courseId } = req.params;

  const r = await query(
    `SELECT id, course_id, lesson_index, title_en, title_ti
     FROM lessons
     WHERE course_id = $1
     ORDER BY lesson_index`,
    [courseId]
  );

  res.json({ lessons: r.rows });
});

/**
 * CREATE or UPDATE lesson
 * POST /api/admin/lesson/save
 */
router.post("/lesson/save", async (req, res) => {
  const schema = z.object({
    id: z.number().optional(),
    courseId: z.string(),
    lessonIndex: z.number().int().min(0),
    title_en: z.string().optional(),
    title_ti: z.string().optional(),
    learn_en: z.string().optional(),
    learn_ti: z.string().optional(),
    task_en: z.string().optional(),
    task_ti: z.string().optional(),
    quiz: z.any().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input" });
  }

  const {
    id,
    courseId,
    lessonIndex,
    title_en,
    title_ti,
    learn_en,
    learn_ti,
    task_en,
    task_ti,
    quiz
  } = parsed.data;

  if (id) {
    // UPDATE
    await query(
      `UPDATE lessons SET
        course_id=$1,
        lesson_index=$2,
        title_en=$3,
        title_ti=$4,
        learn_en=$5,
        learn_ti=$6,
        task_en=$7,
        task_ti=$8,
        quiz=$9,
        updated_at=NOW()
       WHERE id=$10`,
      [
        courseId,
        lessonIndex,
        title_en,
        title_ti,
        learn_en,
        learn_ti,
        task_en,
        task_ti,
        quiz || { questions: [] },
        id
      ]
    );
  } else {
    // INSERT
    await query(
      `INSERT INTO lessons
       (course_id, lesson_index, title_en, title_ti, learn_en, learn_ti, task_en, task_ti, quiz)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        courseId,
        lessonIndex,
        title_en,
        title_ti,
        learn_en,
        learn_ti,
        task_en,
        task_ti,
        quiz || { questions: [] }
      ]
    );
  }

  res.json({ ok: true });
});

/**
 * DELETE lesson
 * DELETE /api/admin/lesson/:id
 */
router.delete("/lesson/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid ID" });

  await query("DELETE FROM lessons WHERE id=$1", [id]);
  res.json({ ok: true });
});

module.exports = router;
