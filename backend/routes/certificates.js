// backend/routes/certificates.js
//
// Certificates system for Eritrean Success Journey
// ------------------------------------------------
// Features:
//  - PUBLIC certificate verification page (QR target)
//  - Eligibility check: ALL lessons completed + Final Exam passed
//  - Claim certificate (idempotent)
//  - Status endpoint for frontend UI
//  - PDF certificate with:
//      • Gold seal
//      • Watermark
//      • Signature name + title
//      • QR code (verify link)
//      • Professional layout
//

const express = require("express");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/* ============================================================
   Helpers
   ============================================================ */

/** Allow only known course IDs (safer) */
function safeCourseId(courseId) {
  const allowed = new Set(["foundation", "growth", "excellence"]);
  return allowed.has(courseId) ? courseId : null;
}

/** Human-friendly course labels */
function courseLabel(courseId) {
  if (courseId === "foundation") return "Level 1: Foundation";
  if (courseId === "growth") return "Level 2: Growth";
  if (courseId === "excellence") return "Level 3: Excellence";
  return courseId;
}

/** Brand config (easy to polish later) */
function brand() {
  return {
    org: "Eritrean Success Journey",
    title: "Certificate of Completion"
  };
}

/** Escape HTML for public verify page */
function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

/** Public API base URL (PROD vs DEV safe) */
function publicApiBaseUrl() {
  const base = process.env.PUBLIC_API_BASE_URL || "http://localhost:4000";
  return base.replace(/\/+$/, ""); // remove trailing slash
}

/* ============================================================
   Eligibility logic
   ============================================================ */

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

  const examR = await query(
    "SELECT passed, score FROM exam_attempts WHERE user_id=$1 AND course_id=$2",
    [userId, courseId]
  );

  const examPassed = !!examR.rows[0]?.passed;
  const examScore =
    typeof examR.rows[0]?.score === "number" ? examR.rows[0].score : null;

  const eligible =
    totalLessons > 0 &&
    completedLessons >= totalLessons &&
    examPassed === true;

  return { eligible, totalLessons, completedLessons, examPassed, examScore };
}

async function getExistingCertificate(userId, courseId) {
  const r = await query(
    "SELECT id, issued_at FROM certificates WHERE user_id=$1 AND course_id=$2",
    [userId, courseId]
  );
  return r.rows[0] || null;
}

async function ensureCertificate(userId, courseId) {
  const existing = await getExistingCertificate(userId, courseId);
  if (existing) return existing;

  const eligibility = await checkEligibility(userId, courseId);
  if (!eligibility.eligible) {
    const err = new Error("Not eligible yet");
    err.status = 403;
    err.details = eligibility;
    throw err;
  }

  await query(
    `INSERT INTO certificates (user_id, course_id)
     VALUES ($1,$2)
     ON CONFLICT (user_id, course_id) DO NOTHING`,
    [userId, courseId]
  );

  const created = await getExistingCertificate(userId, courseId);
  if (!created) {
    const err = new Error("Failed to create certificate");
    err.status = 500;
    throw err;
  }
  return created;
}

/* ============================================================
   ✅ PUBLIC VERIFY PAGE (NO LOGIN)
   GET /api/certificates/verify/:certId
   ============================================================ */
router.get("/verify/:certId", async (req, res) => {
  try {
    const certId = Number(req.params.certId);
    if (!Number.isFinite(certId)) {
      return res.status(400).send("Bad certificate id");
    }

    const r = await query(
      `SELECT c.id, c.course_id, c.issued_at, u.name AS student_name
       FROM certificates c
       JOIN users u ON u.id = c.user_id
       WHERE c.id=$1`,
      [certId]
    );

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    if (!r.rows.length) {
      return res.status(404).send(`<!doctype html>
<html>
<head><meta charset="utf-8"/><title>Certificate Verification</title></head>
<body style="font-family:system-ui;background:#0b1220;color:#eaf0ff;padding:30px">
<h2>❌ Certificate not found</h2>
<p>This certificate ID does not exist.</p>
</body></html>`);
    }

    const cert = r.rows[0];

    return res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Certificate Verification</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>
body{font-family:system-ui;background:#0b1220;color:#eaf0ff;padding:24px}
.card{max-width:720px;margin:auto;background:#0f1a33;padding:20px;border-radius:14px}
.ok{display:inline-block;padding:6px 10px;border-radius:999px;
background:rgba(20,184,166,.15);border:1px solid rgba(20,184,166,.35)}
</style>
</head>
<body>
<div class="card">
<h2>Certificate Verification</h2>
<div class="ok">✅ VALID</div>
<p><b>Student:</b> ${escapeHtml(cert.student_name)}</p>
<p><b>Course:</b> ${escapeHtml(courseLabel(cert.course_id))}</p>
<p><b>Issued:</b> ${escapeHtml(new Date(cert.issued_at).toDateString())}</p>
<p><b>Certificate ID:</b> ${cert.id}</p>
</div>
</body>
</html>`);
  } catch (err) {
    console.error("VERIFY ERROR:", err);
    res.status(500).send("Server error");
  }
});

/* ============================================================
   STATUS (logged in)
   ============================================================ */
router.get("/status/:courseId", requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const courseId = safeCourseId(req.params.courseId);
  if (!courseId) return res.status(400).json({ error: "Invalid courseId" });

  const eligibility = await checkEligibility(userId, courseId);
  const cert = await getExistingCertificate(userId, courseId);

  res.json({
    courseId,
    eligible: eligibility.eligible,
    ...eligibility,
    issued: !!cert,
    certificateId: cert?.id || null,
    verifyUrl: cert ? `/api/certificates/verify/${cert.id}` : null,
    pdfUrl: cert ? `/api/certificates/${courseId}/pdf` : null
  });
});

/* ============================================================
   CLAIM
   ============================================================ */
router.post("/claim", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const courseId = safeCourseId(req.body.courseId);
    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });

    const cert = await ensureCertificate(userId, courseId);

    res.json({
      ok: true,
      certificateId: cert.id,
      verifyUrl: `/api/certificates/verify/${cert.id}`,
      pdfUrl: `/api/certificates/${courseId}/pdf`
    });
  } catch (err) {
    if (err.status === 403) {
      return res.status(403).json({ error: "Not eligible yet", details: err.details });
    }
    console.error("CLAIM ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ============================================================
   PDF DOWNLOAD — WOW DESIGN + QR + SEAL
   ============================================================ */
router.get("/:courseId/pdf", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const courseId = safeCourseId(req.params.courseId);
    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });

    const cert = await ensureCertificate(userId, courseId);

    const userR = await query("SELECT name FROM users WHERE id=$1", [userId]);
    const courseR = await query("SELECT title_en FROM courses WHERE id=$1", [courseId]);

    const userName = userR.rows[0]?.name || "Student";
    const courseTitle = courseR.rows[0]?.title_en || courseLabel(courseId);

    const verifyUrl = `${publicApiBaseUrl()}/api/certificates/verify/${cert.id}`;
    const qrData = await QRCode.toBuffer(verifyUrl);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="certificate-${courseId}.pdf"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    // ====================== GOLD PREMIUM TEMPLATE (PDFKit) ======================
// Make sure doc was created with: new PDFDocument({ size: "A4", margin: 0 })

// ---- helpers ----
const pageW = doc.page.width;   // A4 width
const pageH = doc.page.height;  // A4 height

function centerText(text, y, size, options = {}) {
  doc.fontSize(size).text(text, 0, y, {
    width: pageW,
    align: "center",
    ...options,
  });
}

// A clean safe font setup (PDFKit built-ins). If you later add custom fonts,
// replace these with doc.registerFont(...) and doc.font("YourFont").
const FONT_SERIF = "Times-Roman";
const FONT_SERIF_BOLD = "Times-Bold";
const FONT_SANS = "Helvetica";
const FONT_SANS_BOLD = "Helvetica-Bold";

// ---- Background (very light) ----
doc.save();
doc.rect(0, 0, pageW, pageH).fill("#ffffff");
doc.restore();

// ---- Premium double border ----
const outer = 28;
const inner = 40;

doc.save();
// Outer border (dark gray)
doc
  .lineWidth(2)
  .strokeColor("#2b2b2b")
  .rect(outer, outer, pageW - outer * 2, pageH - outer * 2)
  .stroke();

// Inner border (gold)
doc
  .lineWidth(1.5)
  .strokeColor("#b08d57") // elegant gold
  .rect(inner, inner, pageW - inner * 2, pageH - inner * 2)
  .stroke();
doc.restore();

// ---- Header line ornament ----
doc.save();
doc.strokeColor("#b08d57").lineWidth(1);
doc
  .moveTo(inner + 35, 130)
  .lineTo(pageW - (inner + 35), 130)
  .stroke();
doc.restore();

// ---- Title ----
doc.font(FONT_SERIF_BOLD);
centerText("Certificate of Completion", 75, 36, { characterSpacing: 0.5 });

// ---- Brand/Sub-title ----
doc.font(FONT_SANS);
centerText("Eritrean Success Journey", 140, 13, { fill: true });
doc.save();
doc.fillColor("#555555");
centerText("Learn • Grow • Believe • Succeed", 160, 10);
doc.restore();

// ---- Presented to ----
doc.save();
doc.fillColor("#2b2b2b");
doc.font(FONT_SANS);
centerText("This certificate is proudly presented to", 220, 14);
doc.restore();

// Student name (big)
doc.save();
doc.fillColor("#111111");
doc.font(FONT_SERIF_BOLD);
centerText(studentName || "Student", 255, 42);
doc.restore();

// ---- Course line ----
doc.save();
doc.fillColor("#2b2b2b");
doc.font(FONT_SANS);
centerText("for successfully completing the course:", 315, 14);
doc.restore();

doc.save();
doc.fillColor("#111111");
doc.font(FONT_SERIF_BOLD);
centerText(courseTitle || "Course Title", 345, 26);
doc.restore();

// ---- Gold seal (vector) ----
// (No external image needed — draws a premium seal)
const sealX = pageW / 2;
const sealY = 470;
const sealR = 46;

doc.save();
// Outer ring
doc
  .lineWidth(2)
  .strokeColor("#b08d57")
  .fillColor("#fff7e6")
  .circle(sealX, sealY, sealR)
  .fillAndStroke();

// Inner ring
doc
  .lineWidth(1)
  .strokeColor("#b08d57")
  .fillColor("#ffffff")
  .circle(sealX, sealY, sealR - 10)
  .fillAndStroke();

// Seal text
doc.fillColor("#8a6a3b").font(FONT_SANS_BOLD).fontSize(10);
doc.text("OFFICIAL", sealX - 30, sealY - 10, { width: 60, align: "center" });
doc.fontSize(9).text("CERTIFIED", sealX - 30, sealY + 3, { width: 60, align: "center" });
doc.restore();

// ---- Footer info (Issued, ID) ----
doc.save();
doc.fillColor("#333333");
doc.font(FONT_SANS);
centerText(`Issued on: ${issuedOnText || new Date().toDateString()}`, 545, 11);
centerText(`Certificate ID: ${certificateId ?? "—"}`, 563, 11);
doc.restore();

// ---- QR Code + Verify link (bottom corners) ----
const qrSize = 95;
const qrPad = 14;
const qrX = inner + 25;
const qrY = pageH - inner - qrSize - 25;

if (qrPngBuffer && Buffer.isBuffer(qrPngBuffer)) {
  try {
    doc.image(qrPngBuffer, qrX, qrY, { width: qrSize, height: qrSize });
    doc.save();
    doc.fillColor("#555555").font(FONT_SANS).fontSize(9);
    doc.text("Scan to verify", qrX, qrY + qrSize + 6, { width: qrSize, align: "center" });
    doc.restore();
  } catch (e) {
    // If QR fails, continue without breaking PDF
  }
}

// Right side verify URL (short display)
doc.save();
doc.fillColor("#555555");
doc.font(FONT_SANS).fontSize(9);

const verifyLabel = "Verify:";
const verifyText = (verifyUrl || "").length > 64 ? (verifyUrl || "").slice(0, 64) + "…" : (verifyUrl || "");

doc.text(verifyLabel, pageW - inner - 260, qrY + 8, { width: 250, align: "right" });
doc.fillColor("#1f4e79"); // link-ish blue
doc.text(verifyText || "—", pageW - inner - 260, qrY + 24, { width: 250, align: "right", underline: true });

doc.restore();

// ---- Signature placeholders (optional) ----
doc.save();
doc.strokeColor("#999999").lineWidth(1);

const sigY = 620;
const leftSigX1 = inner + 70;
const leftSigX2 = inner + 260;

const rightSigX1 = pageW - inner - 260;
const rightSigX2 = pageW - inner - 70;

doc.moveTo(leftSigX1, sigY).lineTo(leftSigX2, sigY).stroke();
doc.moveTo(rightSigX1, sigY).lineTo(rightSigX2, sigY).stroke();

doc.fillColor("#666666").font(FONT_SANS).fontSize(10);
doc.text("Instructor", leftSigX1, sigY + 6, { width: leftSigX2 - leftSigX1, align: "center" });
doc.text("Program Director", rightSigX1, sigY + 6, { width: rightSigX2 - rightSigX1, align: "center" });

doc.restore();

// ==================== END GOLD PREMIUM TEMPLATE ====================

    doc.end();
  } catch (err) {
    console.error("PDF ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;