// backend/routes/certificates.js
const express = require("express");
const PDFDocument = require("pdfkit");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/** Only allow known courses (safer) */
function safeCourseId(courseId) {
  const allowed = new Set(["foundation", "growth", "excellence"]);
  return allowed.has(courseId) ? courseId : null;
}

function courseLabel(courseId) {
  if (courseId === "foundation") return "Level 1: Foundation";
  if (courseId === "growth") return "Level 2: Growth";
  if (courseId === "excellence") return "Level 3: Excellence";
  return courseId;
}

/** Eligibility: all lessons completed + exam passed */
async function getEligibility(userId, courseId) {
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
  const examPassed = !!attemptR.rows[0]?.passed;
  const examScore =
    typeof attemptR.rows[0]?.score === "number" ? attemptR.rows[0].score : null;

  const eligible =
    totalLessons > 0 &&
    completedLessons >= totalLessons &&
    examPassed === true;

  return { eligible, totalLessons, completedLessons, examPassed, examScore };
}

/** Returns certificate row if exists */
async function getCertificate(userId, courseId) {
  const r = await query(
    "SELECT id, issued_at FROM certificates WHERE user_id=$1 AND course_id=$2",
    [userId, courseId]
  );
  return r.rows[0] || null;
}

/** Ensure certificate exists if eligible (idempotent) */
async function ensureCertificate(userId, courseId) {
  // If already exists -> return it
  const existing = await getCertificate(userId, courseId);
  if (existing) return existing;

  // Must be eligible to create
  const eligibility = await getEligibility(userId, courseId);
  if (!eligibility.eligible) {
    const err = new Error("Not eligible yet");
    err.code = 403;
    err.details = eligibility;
    throw err;
  }

  await query(
    `INSERT INTO certificates (user_id, course_id)
     VALUES ($1,$2)
     ON CONFLICT (user_id, course_id) DO NOTHING`,
    [userId, courseId]
  );

  return getCertificate(userId, courseId);
}

/**
 * GET /api/certificates/status/:courseId
 * Used by frontend to show eligibility/issued status.
 */
router.get("/status/:courseId", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const courseId = safeCourseId(req.params.courseId);
    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });

    const eligibility = await getEligibility(userId, courseId);
    const cert = await getCertificate(userId, courseId);

    res.json({
      courseId,
      eligible: eligibility.eligible,
      totalLessons: eligibility.totalLessons,
      completedLessons: eligibility.completedLessons,
      examPassed: eligibility.examPassed,
      examScore: eligibility.examScore,
      issued: !!cert,
      certificateId: cert ? cert.id : null,
      issuedAt: cert ? cert.issued_at : null,
      pdfUrl: cert ? `/api/certificates/${courseId}/pdf` : null,
      viewUrl: cert ? `/api/certificates/${courseId}/view` : null
    });
  } catch (err) {
    console.error("CERT STATUS ERROR:", err);
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

    const cert = await ensureCertificate(userId, courseId);
    const eligibility = await getEligibility(userId, courseId);

    res.json({
      ok: true,
      certificate: { id: cert.id, issuedAt: cert.issued_at },
      details: eligibility,
      pdfUrl: `/api/certificates/${courseId}/pdf`,
      viewUrl: `/api/certificates/${courseId}/view`
    });
  } catch (err) {
    if (err.code === 403) {
      return res.status(403).json({ error: err.message, details: err.details });
    }
    console.error("CERT CLAIM ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/certificates/:courseId/view
 * 🔥 Branded HTML certificate (print/save as PDF from browser)
 * Works if certificate exists OR if eligible -> auto-create.
 */
router.get("/:courseId/view", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const courseId = safeCourseId(req.params.courseId);
    if (!courseId) return res.status(400).send("Invalid courseId");

    // ensure exists if eligible
    const cert = await ensureCertificate(userId, courseId);

    // user name
    const userR = await query("SELECT name, email FROM users WHERE id=$1", [userId]);
    if (!userR.rows.length) return res.status(404).send("User not found");
    const studentName = userR.rows[0].name || userR.rows[0].email || "Student";

    const level = courseLabel(courseId);
    const date = new Date(cert.issued_at).toLocaleDateString();

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Certificate of Completion</title>
  <style>
    body {
      font-family: "Georgia", "Times New Roman", serif;
      background: #f3f6ff;
      padding: 30px;
    }

    .card {
      position: relative;
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border: 4px double #1c2b3a;
      border-radius: 22px;
      padding: 50px;
      overflow: hidden;
    }

    .watermark {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 120px;
      font-weight: bold;
      color: rgba(28, 43, 58, 0.06);
      transform: rotate(-20deg);
      pointer-events: none;
      user-select: none;
    }

    h1 {
      margin: 0;
      text-align: center;
      font-size: 36px;
      letter-spacing: 1px;
    }

    .sub {
      text-align: center;
      color: #333;
      margin-top: 6px;
      font-size: 15px;
    }

    .line {
      height: 1px;
      background: #ddd;
      margin: 28px 0;
    }

    .name {
      font-size: 34px;
      text-align: center;
      margin: 24px 0;
      font-weight: 700;
    }

    .course {
      font-size: 22px;
      text-align: center;
      font-weight: 600;
    }

    .meta {
      display: flex;
      justify-content: space-between;
      font-size: 14px;
      color: #333;
      margin-top: 30px;
    }

    .btn {
      display: inline-block;
      margin-top: 20px;
      padding: 10px 16px;
      border-radius: 12px;
      border: 1px solid #1c2b3a;
      text-decoration: none;
      color: #1c2b3a;
    }

    @media print {
      .noPrint { display: none; }
      body { background: white; padding: 0; }
      .card { border: 3px solid #000; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="watermark">ESJ</div>

    <h1>Certificate of Completion</h1>
    <div class="sub">Eritrean Success Journey</div>

    <div class="line"></div>

    <div class="sub">This certificate is proudly presented to</div>
    <div class="name">${escapeHtml(studentName)}</div>
    <div class="sub">for successfully completing the course:</div>
    <div class="course">${escapeHtml(level)}</div>

    <div class="line"></div>

    <div class="meta">
      <div><b>Issued on:</b> ${escapeHtml(date)}</div>
      <div><b>Certificate ID:</b> ${cert.id}</div>
    </div>

    <div class="noPrint" style="text-align:center;">
      <a class="btn" href="#" onclick="window.print();return false;">Print / Save as PDF</a>
      &nbsp;&nbsp;
      <a class="btn" href="/api/certificates/${courseId}/pdf">Download PDF</a>
    </div>
  </div>
</body>
</html>`);
  } catch (err) {
    if (err.code === 403) {
      return res.status(403).send("Not eligible yet. Complete all lessons + pass the exam.");
    }
    console.error("CERT VIEW ERROR:", err);
    res.status(500).send("Server error");
  }
});

/**
 * GET /api/certificates/:courseId/pdf
 * Branded PDF certificate (download)
 * Works if certificate exists OR if eligible -> auto-create.
 */
router.get("/:courseId/pdf", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const courseId = safeCourseId(req.params.courseId);
    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });

    // ensure exists if eligible
    const cert = await ensureCertificate(userId, courseId);

    // Get user name
    const userR = await query("SELECT name, email FROM users WHERE id=$1", [userId]);
    if (!userR.rows.length) return res.status(404).json({ error: "User not found" });
    const userName = userR.rows[0].name || userR.rows[0].email || "Student";

    const level = courseLabel(courseId);
    const issuedAt = cert.issued_at;

    // ---- PDF output ----
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="certificate-${courseId}.pdf"`
    );

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    // --- branded frame ---
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    // outer border
    doc
      .lineWidth(2)
      .rect(28, 28, pageWidth - 56, pageHeight - 56)
      .strokeColor("#1c2b3a")
      .stroke();

    // inner border (double)
    doc
      .lineWidth(1)
      .rect(38, 38, pageWidth - 76, pageHeight - 76)
      .strokeColor("#1c2b3a")
      .opacity(0.7)
      .stroke()
      .opacity(1);

    // watermark
    doc
      .fillColor("#1c2b3a")
      .opacity(0.06)
      .fontSize(120)
      .font("Helvetica-Bold")
      .text("ESJ", 0, pageHeight / 2 - 80, { align: "center" })
      .opacity(1);

    // content
    doc.fillColor("#111").font("Helvetica-Bold").fontSize(28)
      .text("Certificate of Completion", 0, 120, { align: "center" });

    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(12)
      .text("Eritrean Success Journey", { align: "center" });

    doc.moveDown(2);
    doc.fontSize(14).text("This certificate is proudly presented to", { align: "center" });

    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(30).text(userName, { align: "center" });

    doc.moveDown(1);
    doc.font("Helvetica").fontSize(14).text("for successfully completing the course:", { align: "center" });

    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(20).text(level, { align: "center" });

    doc.moveDown(2);
    doc.font("Helvetica").fontSize(12)
      .text(`Issued on: ${new Date(issuedAt).toDateString()}`, { align: "center" });

    doc.moveDown(2);
    doc.fontSize(11).fillColor("#333")
      .text(`Certificate ID: ${cert.id}`, 0, doc.y, { align: "center" });

    doc.end();
  } catch (err) {
    if (err.code === 403) {
      return res.status(403).json({ error: "Not eligible yet", details: err.details });
    }
    console.error("CERT PDF ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Small helper for HTML escaping
function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

module.exports = router;
