// backend/routes/certificates.js
//
// ✅ Eritrean Success Journey — Certificates System (Final WOW Version)
// - Status endpoint for frontend: GET /api/certificates/:courseId/status
// - Claim (idempotent):          POST /api/certificates/:courseId/claim
// - PDF (one page):              GET /api/certificates/:courseId/pdf
// - Public verify HTML:          GET /api/certificates/verify/:id
// - Public verify JSON:          GET /api/certificates/verify/:id.json
//
// Notes:
// - Uses req.user?.id (your requireAuth sets req.user from session)
// - PDFKit auto-adds pages if you draw too low -> we keep a strict bottom safe area
//

const express = require("express");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/* =========================
   CONFIG (edit here or use ENV)
========================= */

// Founder / Brand
const ORG_NAME = process.env.ORG_NAME || "Eritrean Success Journey";
const CERT_TITLE = process.env.CERT_TITLE || "Certificate of Completion";

// Founder block text
const FOUNDER_NAME = process.env.FOUNDER_NAME || "Your Name";
const FOUNDER_TITLE = process.env.FOUNDER_TITLE || "Founder, Eritrean Success Journey";

// Inspiring quote
const CERT_QUOTE =
  process.env.CERT_QUOTE ||
  "“Education is the bridge between belief and becoming.”";

// Optional signature images (PNG recommended, transparent background)
// Put files e.g. in: backend/assets/signature-founder.png, backend/assets/signature-team.png
const SIGNATURE_FOUNDER_PATH =
  process.env.SIGNATURE_FOUNDER_PATH ||
  path.join(__dirname, "../assets/signature-founder.png");

const SIGNATURE_TEAM_PATH =
  process.env.SIGNATURE_TEAM_PATH ||
  path.join(__dirname, "../assets/signature-team.png");

/* =========================
   HELPERS
========================= */

function safeCourseId(courseId) {
  const allowed = new Set(["foundation", "growth", "excellence"]);
  return allowed.has(courseId) ? courseId : null;
}

function filenameSafe(str = "") {
  return String(str).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function fmtDate(d) {
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toDateString();
  } catch {
    return "";
  }
}

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

// Base URL for verify links (important for QR to work in PROD)
function publicBase(req) {
  // Prefer explicit env (recommended)
  // Example: https://api.riseeritrea.com  OR https://riseeritrea.com
  const envBase =
    process.env.PUBLIC_BASE_URL ||
    process.env.PUBLIC_API_BASE_URL || "";

  if (envBase) return envBase.replace(/\/+$/, "");

  // fallback: derive from request
  const proto = (req.headers["x-forwarded-proto"] || "http").toString().split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`.replace(/\/+$/, "");
}

async function getUserAndCourse({ userId, courseId }) {
  const userR = await query("SELECT name FROM users WHERE id=$1 LIMIT 1", [userId]);
  const courseR = await query("SELECT title_en FROM courses WHERE id=$1 LIMIT 1", [courseId]);

  return {
    userName: userR.rows[0]?.name || "Student",
    courseTitle: courseR.rows[0]?.title_en || courseId
  };
}

// Eligibility check: ALL lessons completed + exam passed
async function checkEligibility({ userId, courseId }) {
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

  // Most recent exam attempt (or any passed attempt)
  const examR = await query(
    `SELECT passed, score, updated_at
       FROM exam_attempts
      WHERE user_id=$1 AND course_id=$2
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1`,
    [userId, courseId]
  );

  const examPassed = !!examR.rows[0]?.passed;
  const examScore = typeof examR.rows[0]?.score === "number" ? examR.rows[0].score : null;

  const eligible =
    totalLessons > 0 &&
    completedLessons >= totalLessons &&
    examPassed === true;

  return { eligible, totalLessons, completedLessons, examPassed, examScore };
}

async function getExistingCertificate({ userId, courseId }) {
  const r = await query(
    `SELECT id, issued_at
       FROM certificates
      WHERE user_id=$1 AND course_id=$2
      ORDER BY id ASC
      LIMIT 1`,
    [userId, courseId]
  );
  return r.rows[0] || null;
}

async function ensureCertificate({ userId, courseId }) {
  const existing = await getExistingCertificate({ userId, courseId });
  if (existing) return existing;

  const eligibility = await checkEligibility({ userId, courseId });
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

  const created = await getExistingCertificate({ userId, courseId });
  if (!created) {
    const err = new Error("Failed to create certificate");
    err.status = 500;
    throw err;
  }
  return created;
}

/* =========================
   STATUS HANDLER
========================= */

async function statusHandler(req, res) {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id;

    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const eligibility = await checkEligibility({ userId, courseId });
    const cert = await getExistingCertificate({ userId, courseId });

    const issued = !!cert;
    const certificateId = cert?.id ?? null;

    return res.json({
      ok: true,
      courseId,
      eligible: eligibility.eligible,
      totalLessons: eligibility.totalLessons,
      completedLessons: eligibility.completedLessons,
      examPassed: eligibility.examPassed,
      examScore: eligibility.examScore,
      issued,
      certificateId,
      issuedAt: cert?.issued_at ?? null,
      pdfUrl: issued ? `${publicBase(req)}/api/certificates/${courseId}/pdf` : null,
      verifyUrl: issued ? `${publicBase(req)}/api/certificates/verify/${certificateId}` : null
    });
  } catch (e) {
    console.error("CERT STATUS ERROR:", e);
    return res.status(500).json({ error: "Server error" });
  }
}

/* =========================
   ROUTES
========================= */

// ✅ STATUS (frontend calls this)
router.get("/:courseId/status", requireAuth, statusHandler);

/**
 * ✅ CLAIM (idempotent)
 * POST /api/certificates/:courseId/claim
 */
router.post("/:courseId/claim", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id;

    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const eligibility = await checkEligibility({ userId, courseId });
    if (!eligibility.eligible) return res.status(403).json({ error: "Not eligible yet", details: eligibility });

    const cert = await ensureCertificate({ userId, courseId });

    return res.json({
      ok: true,
      certificateId: cert.id,
      issuedAt: cert.issued_at,
      pdfUrl: `${publicBase(req)}/api/certificates/${courseId}/pdf`,
      verifyUrl: `${publicBase(req)}/api/certificates/verify/${cert.id}`
    });
  } catch (e) {
    console.error("CERT CLAIM ERROR:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * ✅ PDF (ONE PAGE WOW)
 * GET /api/certificates/:courseId/pdf
 */
router.get("/:courseId/pdf", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id;

    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const eligibility = await checkEligibility({ userId, courseId });
    if (!eligibility.eligible) return res.status(403).json({ error: "Not eligible yet", details: eligibility });

    const cert = await ensureCertificate({ userId, courseId });
    const { userName, courseTitle } = await getUserAndCourse({ userId, courseId });

    const verifyUrl = `${publicBase(req)}/api/certificates/verify/${cert.id}`;
    const qrPng = await QRCode.toBuffer(verifyUrl, { type: "png", margin: 1, scale: 5 });

    // Headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="certificate-${filenameSafe(courseId)}.pdf"`
    );

    // PDF
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.pipe(res);

    const pageW = doc.page.width;   // ~595
    const pageH = doc.page.height;  // ~842

    // Hard rule: never draw below this (prevents page 2)
    const BOTTOM_SAFE_Y = pageH - 120;

    // Colors
    const GOLD = "#C8A84E";
    const GOLD_DARK = "#8A6A1F";
    const INK = "#111827";
    const SOFT = "#6B7280";
    const LIGHT = "#F8FAFC";

    // Background
    doc.rect(0, 0, pageW, pageH).fill(LIGHT);

    // Premium double border
    doc.save();
    doc.lineWidth(2).strokeColor(GOLD).rect(24, 24, pageW - 48, pageH - 48).stroke();
    doc.lineWidth(1).strokeColor("#D1D5DB").rect(32, 32, pageW - 64, pageH - 64).stroke();
    doc.restore();

    // Watermark
    doc.save();
    doc.rotate(-18, { origin: [pageW / 2, pageH / 2] });
    doc.fillColor("#111827").opacity(0.06).font("Helvetica-Bold").fontSize(56);
    doc.text(ORG_NAME.toUpperCase(), 0, pageH / 2 - 40, { width: pageW, align: "center" });
    doc.opacity(1).restore();

    // Header
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(32);
    doc.text(CERT_TITLE, 0, 86, { width: pageW, align: "center" });

    doc.fillColor(SOFT).font("Helvetica").fontSize(12);
    doc.text(ORG_NAME, 0, 128, { width: pageW, align: "center" });

    // Divider
    doc.moveTo(120, 154).lineTo(pageW - 120, 154).lineWidth(1).strokeColor("#E5E7EB").stroke();

    // Body
    doc.fillColor(SOFT).font("Helvetica").fontSize(13);
    doc.text("This certificate is proudly presented to", 0, 190, { width: pageW, align: "center" });

    // Student name
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(40);
    doc.text(userName, 0, 222, { width: pageW, align: "center" });

    // ✅ OFFICIALLY CERTIFIED under name (clean + premium)
    doc.fillColor(GOLD_DARK).font("Helvetica-Bold").fontSize(11);
    doc.text("OFFICIALLY CERTIFIED", 0, 270, { width: pageW, align: "center" });

    doc.fillColor(SOFT).font("Helvetica").fontSize(13);
    doc.text("for successfully completing the course:", 0, 302, { width: pageW, align: "center" });

    doc.fillColor(INK).font("Helvetica-Bold").fontSize(24);
    doc.text(courseTitle, 0, 330, { width: pageW, align: "center" });

    // Small gold divider
    doc.moveTo(170, 372).lineTo(pageW - 170, 372).lineWidth(1).strokeColor("#E5D7A8").stroke();

    // Quote (inspiring)
    doc.fillColor(SOFT).font("Helvetica-Oblique").fontSize(11);
    doc.text(CERT_QUOTE, 0, 394, { width: pageW, align: "center" });

    // Info box + QR (kept safely above bottom)
    const boxY = BOTTOM_SAFE_Y - 86; // ensures box never triggers page 2
    const boxH = 86;
    const boxX = 70;
    const boxW = pageW - 140;

    doc.save();
    doc.roundedRect(boxX, boxY, boxW, boxH, 10).fill("#FFFFFF");
    doc.roundedRect(boxX, boxY, boxW, boxH, 10).lineWidth(1).strokeColor("#E5E7EB").stroke();
    doc.restore();

    doc.fillColor(SOFT).font("Helvetica").fontSize(10);
    doc.text(`Issued on: ${fmtDate(cert.issued_at)}`, boxX + 18, boxY + 16, { width: boxW - 120 });
    doc.text(`Certificate ID: ${cert.id}`, boxX + 18, boxY + 34, { width: boxW - 120 });
    doc.text(`Verify: ${verifyUrl}`, boxX + 18, boxY + 52, { width: boxW - 120 });

    // QR on right inside box
    const qrSize = 62;
    doc.image(qrPng, boxX + boxW - qrSize - 18, boxY + 12, { width: qrSize, height: qrSize });
    doc.fillColor(SOFT).font("Helvetica").fontSize(8);
    doc.text("Scan to verify", boxX + boxW - qrSize - 18, boxY + 74, { width: qrSize, align: "center" });

    // Signature blocks (above info box, safely)
    const sigY = boxY - 88;

    function signatureLine(x, y, w = 190) {
      doc.save();
      doc.strokeColor("#9CA3AF").lineWidth(1);
      doc.moveTo(x, y).lineTo(x + w, y).stroke();
      doc.restore();
    }

    // Optional signature images
    function drawSignatureImage(imgPath, x, y, w) {
      try {
        if (imgPath && fs.existsSync(imgPath)) {
          doc.image(imgPath, x, y, { width: w });
          return true;
        }
      } catch {}
      return false;
    }

    // Left (Founder)
    const leftX = 90;
    const rightX = pageW - 90 - 190;

    // Founder signature image (above line)
    const drewFounderSig = drawSignatureImage(SIGNATURE_FOUNDER_PATH, leftX + 10, sigY - 42, 160);
    signatureLine(leftX, sigY, 190);

    doc.fillColor(SOFT).font("Helvetica").fontSize(9);
    doc.text(FOUNDER_TITLE, leftX, sigY + 6, { width: 190, align: "center" });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10);
    doc.text(FOUNDER_NAME, leftX, sigY + 20, { width: 190, align: "center" });

    // Right (Program Team / Instructor)
    const drewTeamSig = drawSignatureImage(SIGNATURE_TEAM_PATH, rightX + 10, sigY - 42, 160);
    signatureLine(rightX, sigY, 190);

    doc.fillColor(SOFT).font("Helvetica").fontSize(9);
    doc.text("Program Team", rightX, sigY + 6, { width: 190, align: "center" });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10);
    doc.text(ORG_NAME, rightX, sigY + 20, { width: 190, align: "center" });

    // Footer (must stay above bottom margin -> safe)
    doc.fillColor("#9CA3AF").font("Helvetica").fontSize(9);
    doc.text(`© ${new Date().getFullYear()} ${ORG_NAME}`, 0, pageH - 58, { width: pageW, align: "center" });

    doc.end();
  } catch (err) {
    console.error("CERT PDF ERROR:", err);
    // If PDF partially streamed, sending JSON might fail; but we still try safely.
    try {
      if (!res.headersSent) return res.status(500).json({ error: "Server error generating certificate PDF" });
      res.end();
    } catch {}
  }
});

/* =========================
   PUBLIC VERIFY (NO LOGIN)
========================= */

/**
 * Public JSON verify
 * GET /api/certificates/verify/:id.json
 */
router.get("/verify/:id.json", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: "Invalid id" });

    const certRes = await query(
      `SELECT c.id, c.course_id, c.issued_at,
              u.name AS user_name,
              co.title_en AS course_title
         FROM certificates c
         LEFT JOIN users u ON u.id = c.user_id
         LEFT JOIN courses co ON co.id = c.course_id
        WHERE c.id = $1
        LIMIT 1`,
      [id]
    );

    if (!certRes.rows.length) return res.status(404).json({ ok: false, error: "Not found" });

    const row = certRes.rows[0];
    return res.json({
      ok: true,
      certificateId: row.id,
      student: row.user_name || "Student",
      courseId: row.course_id,
      courseTitle: row.course_title || row.course_id,
      issuedAt: row.issued_at
    });
  } catch (e) {
    console.error("CERT VERIFY JSON ERROR:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * Public HTML verify page
 * GET /api/certificates/verify/:id
 */
router.get("/verify/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).send("Invalid certificate id.");

    const certRes = await query(
      `SELECT c.id, c.course_id, c.issued_at,
              u.name AS user_name,
              co.title_en AS course_title
         FROM certificates c
         LEFT JOIN users u ON u.id = c.user_id
         LEFT JOIN courses co ON co.id = c.course_id
        WHERE c.id = $1
        LIMIT 1`,
      [id]
    );

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    if (!certRes.rows.length) {
      return res.status(404).send(`
        <html><body style="font-family:Arial;padding:40px">
          <h2>Certificate not found</h2>
          <p>This certificate ID does not exist.</p>
        </body></html>
      `);
    }

    const row = certRes.rows[0];
    const student = row.user_name || "Student";
    const courseTitle = row.course_title || row.course_id;
    const issued = fmtDate(row.issued_at);
    const base = publicBase(req);

    return res.send(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Certificate Verification</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;background:#f8fafc;margin:0;padding:0;color:#111827}
    .wrap{max-width:820px;margin:0 auto;padding:40px 18px}
    .card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px}
    .badge{display:inline-block;padding:6px 10px;border-radius:999px;background:#ecfdf5;color:#065f46;font-weight:700;font-size:12px}
    .muted{color:#6b7280}
    .row{display:flex;gap:18px;flex-wrap:wrap;margin-top:18px}
    .box{flex:1;min-width:240px;border:1px solid #e5e7eb;border-radius:12px;padding:14px}
    .title{font-size:26px;margin:12px 0 6px 0}
    a{color:#2563eb;text-decoration:none}
    a:hover{text-decoration:underline}
    .footer{margin-top:16px;font-size:12px;color:#6b7280}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="badge">VERIFIED ✅</div>
      <div class="title">Certificate Verification</div>
      <div class="muted">${escapeHtml(ORG_NAME)}</div>

      <div class="row">
        <div class="box">
          <div class="muted">Student</div>
          <div style="font-size:20px;font-weight:700;margin-top:6px">${escapeHtml(student)}</div>
        </div>
        <div class="box">
          <div class="muted">Course</div>
          <div style="font-size:18px;font-weight:700;margin-top:6px">${escapeHtml(courseTitle)}</div>
          <div class="muted" style="margin-top:6px">Course ID: ${escapeHtml(row.course_id)}</div>
        </div>
      </div>

      <div class="row">
        <div class="box">
          <div class="muted">Issued on</div>
          <div style="font-weight:700;margin-top:6px">${escapeHtml(issued)}</div>
        </div>
        <div class="box">
          <div class="muted">Certificate ID</div>
          <div style="font-weight:700;margin-top:6px">${row.id}</div>
        </div>
      </div>

      <div class="footer">
        <div>JSON: <a href="${base}/api/certificates/verify/${row.id}.json">${base}/api/certificates/verify/${row.id}.json</a></div>
      </div>
    </div>
  </div>
</body>
</html>
    `);
  } catch (e) {
    console.error("CERT VERIFY HTML ERROR:", e);
    return res.status(500).send("Server error");
  }
});

module.exports = router;