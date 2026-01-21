// backend/routes/certificates.js
const express = require("express");
const PDFDocument = require("pdfkit");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/** Only allow known courses (optional but safer) */
function safeCourseId(courseId) {
  const allowed = new Set(["foundation", "growth", "excellence"]);
  return allowed.has(courseId) ? courseId : null;
}

/** Eligibility: all lessons completed + exam passed */
async function checkEligibility(userId, courseId) {
  const totalR = await query(
    "SELECT COUNT(*)::int AS c FROM lessons WHERE course_id=$1",
    [courseId]
  );
  const totalLessons = totalR.rows[0]?.c ?? 0;

  const doneR = await query(
    "SELECT COUNT(*)::int AS c FROM progress WHERE user_id=$1 AND course_id=$2 AND completed=true",
    [userId, courseId]
  );
  const completedLessons = doneR.rows[0]?.c ?? 0;

  const attemptR = await query(
    "SELECT passed, score FROM exam_attempts WHERE user_id=$1 AND course_id=$2",
    [userId, courseId]
  );
  const passedExam = !!attemptR.rows[0]?.passed;
  const examScore =
    typeof attemptR.rows[0]?.score === "number" ? attemptR.rows[0].score : null;

  const eligible =
    totalLessons > 0 &&
    completedLessons >= totalLessons &&
    passedExam === true;

  return { eligible, totalLessons, completedLessons, passedExam, examScore };
}

/**
 * GET /api/certificates
 * List user's certificates
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const r = await query(
      `SELECT c.course_id, c.issued_at,
              co.title_en, co.title_ti
       FROM certificates c
       JOIN courses co ON co.id = c.course_id
       WHERE c.user_id=$1
       ORDER BY c.issued_at DESC`,
      [userId]
    );

    res.json({ certificates: r.rows });
  } catch (err) {
    console.error("CERT LIST ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/certificates/claim
 * Body: { courseId }
 * Creates certificate if eligible (idempotent).
 */
router.post("/claim", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const courseId = safeCourseId(req.body?.courseId);

    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });

    const eligibility = await checkEligibility(userId, courseId);

    if (!eligibility.eligible) {
      return res.status(403).json({
        error: "Not eligible yet",
        details: eligibility
      });
    }

    await query(
      `INSERT INTO certificates (user_id, course_id)
       VALUES ($1,$2)
       ON CONFLICT (user_id, course_id) DO NOTHING`,
      [userId, courseId]
    );

    const certR = await query(
      `SELECT course_id, issued_at
       FROM certificates
       WHERE user_id=$1 AND course_id=$2`,
      [userId, courseId]
    );

    res.json({ ok: true, certificate: certR.rows[0], details: eligibility });
  } catch (err) {
    console.error("CERT CLAIM ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/certificates/:courseId/pdf
 * Downloads a PDF certificate if exists (or if eligible -> auto-create).
 */
router.get("/:courseId/pdf", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const courseId = safeCourseId(req.params.courseId);

    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });

    // Get user name
    const userR = await query("SELECT name FROM users WHERE id=$1", [userId]);
    if (!userR.rows.length) return res.status(404).json({ error: "User not found" });
    const userName = userR.rows[0].name || "Student";

    // Get course title
    const courseR = await query(
      "SELECT id, title_en, title_ti FROM courses WHERE id=$1",
      [courseId]
    );
    if (!courseR.rows.length) return res.status(404).json({ error: "Course not found" });

    // Ensure certificate exists (if eligible, auto-create)
    let certR = await query(
      "SELECT issued_at FROM certificates WHERE user_id=$1 AND course_id=$2",
      [userId, courseId]
    );

    if (!certR.rows.length) {
      const eligibility = await checkEligibility(userId, courseId);
      if (!eligibility.eligible) {
        return res.status(403).json({ error: "Not eligible yet", details: eligibility });
      }

      await query(
        `INSERT INTO certificates (user_id, course_id)
         VALUES ($1,$2)
         ON CONFLICT (user_id, course_id) DO NOTHING`,
        [userId, courseId]
      );

      certR = await query(
        "SELECT issued_at FROM certificates WHERE user_id=$1 AND course_id=$2",
        [userId, courseId]
      );
    }

    const issuedAt = certR.rows[0].issued_at;

    // ---- PDF output ----
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="certificate-${courseId}.pdf"`
    );

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    const courseTitle = courseR.rows[0].title_en || courseId;

    doc.fontSize(26).text("Certificate of Completion", { align: "center" });
    doc.moveDown(0.4);
    doc.fontSize(12).text("Eritrean Success Journey", { align: "center" });

    doc.moveDown(2);
    doc.fontSize(14).text("This certificate is proudly presented to", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(28).text(userName, { align: "center" });

    doc.moveDown(1);
    doc.fontSize(14).text("for successfully completing the course:", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(20).text(courseTitle, { align: "center" });

    doc.moveDown(1.5);
    doc.fontSize(12).text(`Issued on: ${new Date(issuedAt).toDateString()}`, { align: "center" });

    doc.moveDown(2.2);
    doc.fontSize(12).text("Signature: ____________________", { align: "left" });
    doc.fontSize(12).text("Stamp: _______________________", { align: "left" });

    doc.end();
  } catch (err) {
    console.error("CERT PDF ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
