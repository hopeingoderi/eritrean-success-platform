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

    // ====================== GOLD PREMIUM TEMPLATE (PDFKit) =====================

// Page constants
const pageW = doc.page.width;
const pageH = doc.page.height;

// Colors (PDFKit supports hex)
const GOLD = "#C8A84E";
const GOLD_DARK = "#8A6A1F";
const INK = "#222222";
const SOFT = "#666666";

// Helpers
function centerText(text, y, size, options = {}) {
  doc.fillColor(options.color || INK)
    .font(options.font || "Helvetica")
    .fontSize(size)
    .text(text, 0, y, { width: pageW, align: "center" });
}

function hr(y, color = GOLD, thickness = 1) {
  doc.save();
  doc.strokeColor(color).lineWidth(thickness);
  doc.moveTo(70, y).lineTo(pageW - 70, y).stroke();
  doc.restore();
}

function drawBorder() {
  doc.save();
  // Outer gold border
  doc.strokeColor(GOLD).lineWidth(4);
  doc.rect(28, 28, pageW - 56, pageH - 56).stroke();

  // Inner thin border
  doc.strokeColor(GOLD_DARK).lineWidth(1);
  doc.rect(40, 40, pageW - 80, pageH - 80).stroke();
  doc.restore();
}

function drawWatermark(text) {
  doc.save();
  doc.rotate(-22, { origin: [pageW / 2, pageH / 2] });
  doc.fillColor("#000000").opacity(0.06);
  doc.font("Helvetica-Bold").fontSize(80);
  doc.text(text, 0, pageH / 2 - 60, { width: pageW, align: "center" });
  doc.opacity(1).restore();
}

function drawSeal() {
  // Simple “seal” circle (premium look)
  const cx = pageW / 2;
  const cy = 195;

  doc.save();
  // Outer circle
  doc.strokeColor(GOLD).lineWidth(3);
  doc.circle(cx, cy, 38).stroke();

  // Inner circle
  doc.strokeColor(GOLD_DARK).lineWidth(1);
  doc.circle(cx, cy, 30).stroke();

  // Tiny ribbon lines
  doc.strokeColor(GOLD).lineWidth(2);
  doc.moveTo(cx - 18, cy + 42).lineTo(cx - 6, cy + 64).stroke();
  doc.moveTo(cx + 18, cy + 42).lineTo(cx + 6, cy + 64).stroke();

  // Seal text
  doc.fillColor(GOLD_DARK).font("Helvetica-Bold").fontSize(10);
  doc.text("OFFICIAL", cx - 28, cy - 7, { width: 56, align: "center" });
  doc.restore();
}

function drawSignatureBlock(leftX, y, label, name) {
  doc.save();
  doc.strokeColor("#999999").lineWidth(1);
  doc.moveTo(leftX, y).lineTo(leftX + 200, y).stroke();
  doc.fillColor(SOFT).font("Helvetica").fontSize(9).text(label, leftX, y + 6, { width: 200, align: "center" });
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(name, leftX, y + 22, { width: 200, align: "center" });
  doc.restore();
}

// --- Background + borders ---
drawBorder();
drawWatermark("CERTIFIED");

// --- Header ---
centerText("Certificate of Completion", 88, 32, { font: "Helvetica-Bold", color: INK });
centerText("Eritrean Success Journey", 132, 12, { color: SOFT });
hr(155);

// Seal badge
drawSeal();

// --- Main copy ---
// You should already have these variables from your DB queries:
/// userName, courseTitle, issuedOnStr, certId, verifyUrl

// Fallbacks if missing (safe)
const safeUserName = (typeof userName !== "undefined" && userName) ? userName : "Student";
const safeCourseTitle = (typeof courseTitle !== "undefined" && courseTitle) ? courseTitle : "Course";
const safeIssued = (typeof issuedOnStr !== "undefined" && issuedOnStr) ? issuedOnStr : "";
const safeCertId = (typeof certId !== "undefined" && certId) ? String(certId) : "";
const safeVerifyUrl = (typeof verifyUrl !== "undefined" && verifyUrl) ? verifyUrl : "";

// Body text
centerText("This certificate is proudly presented to", 255, 13, { color: SOFT });

doc.fillColor(INK).font("Helvetica-Bold").fontSize(34);
doc.text(safeUserName, 0, 282, { width: pageW, align: "center" });

centerText("for successfully completing the course:", 335, 12, { color: SOFT });

doc.fillColor(INK).font("Helvetica-Bold").fontSize(20);
doc.text(safeCourseTitle, 0, 360, { width: pageW, align: "center" });

hr(410, "#E5D7A8", 1);

// --- Footer info ---
doc.fillColor(SOFT).font("Helvetica").fontSize(10);
doc.text(`Issued on: ${safeIssued}`, 0, 445, { width: pageW, align: "center" });
doc.text(`Certificate ID: ${safeCertId}`, 0, 462, { width: pageW, align: "center" });

// Signatures
drawSignatureBlock(90, 520, "Authorized Signature", "Eritrean Success Journey");
drawSignatureBlock(pageW - 290, 520, "Instructor", "Program Team");

// --- QR Code (optional but premium) ---
if (safeVerifyUrl) {
  const qrBuf = await QRCode.toBuffer(safeVerifyUrl, { margin: 1, scale: 5 });

  // QR bottom center
  doc.image(qrBuf, pageW / 2 - 45, 585, { width: 90 });

  doc.fillColor(SOFT).font("Helvetica").fontSize(8);
  doc.text("Verify this certificate", 0, 678, { width: pageW, align: "center" });
  doc.fillColor("#0A58CA").font("Helvetica").fontSize(8);
  doc.text(safeVerifyUrl, 0, 690, { width: pageW, align: "center", link: safeVerifyUrl, underline: true });
}

// ==================== END GOLD PREMIUM TEMPLATE ====================

    doc.end();
  } catch (err) {
    console.error("PDF ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;