// backend/routes/certificates.js
//
// Certificates system for Eritrean Success Journey
// ------------------------------------------------
// Routes:
//   GET  /api/certificates/:courseId/status    (logged-in)
//   POST /api/certificates/:courseId/claim     (logged-in, idempotent)
//   GET  /api/certificates/:courseId/pdf       (logged-in)
//   GET  /api/certificates/verify/:id          (public HTML)
//   GET  /api/certificates/verify/:id.json     (public JSON)

const express = require("express");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/* ============================================================
   Helpers
============================================================ */

// Only allow known course IDs
function safeCourseId(courseId) {
  const id = String(courseId || "").trim().toLowerCase();
  const allowed = new Set(["foundation", "growth", "excellence"]);
  return allowed.has(id) ? id : null;
}

function courseLabel(courseId) {
  if (courseId === "foundation") return "Level 1: Foundation";
  if (courseId === "growth") return "Level 2: Growth";
  if (courseId === "excellence") return "Level 3: Excellence";
  return courseId;
}

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}

// Robust base URL builder (works on Render behind proxy)
function publicBase(req) {
  // You can force it via env if you want:
  // PUBLIC_BASE_URL=https://api.riseeritrea.com
  const forced = process.env.PUBLIC_BASE_URL;
  if (forced) return String(forced).replace(/\/+$/, "");

  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").toString();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function filenameSafe(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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

// Truncate long text to fit width (prevents accidental 2nd page)
function truncateToWidth(doc, text, maxWidth) {
  const s = String(text || "");
  if (!s) return "";
  if (doc.widthOfString(s) <= maxWidth) return s;

  const ell = "…";
  let left = s;
  while (left.length > 4 && doc.widthOfString(left + ell) > maxWidth) {
    left = left.slice(0, -1);
  }
  return left + ell;
}

/* ============================================================
   Eligibility + certificate DB functions
============================================================ */

async function checkEligibility({ userId, courseId }) {
  // Total lessons
  const totalR = await query(
    "SELECT COUNT(*)::int AS c FROM lessons WHERE course_id=$1",
    [courseId]
  );
  const totalLessons = totalR.rows[0]?.c ?? 0;

  // Completed lessons
  const doneR = await query(
    `SELECT COUNT(*)::int AS c
       FROM progress
      WHERE user_id=$1 AND course_id=$2 AND completed=true`,
    [userId, courseId]
  );
  const completedLessons = doneR.rows[0]?.c ?? 0;

  // Latest exam attempt (IMPORTANT: latest, not random)
  const examR = await query(
    `SELECT passed, score, updated_at
       FROM exam_attempts
      WHERE user_id=$1 AND course_id=$2
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1`,
    [userId, courseId]
  );

  const examPassed = !!examR.rows[0]?.passed;
  const examScore = (typeof examR.rows[0]?.score === "number") ? examR.rows[0].score : null;

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

async function getUserAndCourse({ userId, courseId }) {
  const userR = await query("SELECT name, first_name, last_name FROM users WHERE id=$1", [userId]);
  const courseR = await query("SELECT title_en FROM courses WHERE id=$1", [courseId]);

  const userRow = userR.rows[0] || {};
  const userName =
    userRow.name ||
    [userRow.first_name, userRow.last_name].filter(Boolean).join(" ") ||
    "Student";

  const courseTitle = courseR.rows[0]?.title_en || courseLabel(courseId);

  return { userName, courseTitle };
}

/* ============================================================
   PUBLIC VERIFY
============================================================ */

router.get("/verify/:id.json", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: "Invalid id" });

    const certRes = await query(
      `SELECT c.id, c.course_id, c.issued_at, u.name AS user_name, co.title_en AS course_title
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
      issuedAt: row.issued_at,
    });
  } catch (e) {
    console.error("CERT VERIFY JSON ERROR:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.get("/verify/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).send("Invalid certificate id.");

    const certRes = await query(
      `SELECT c.id, c.course_id, c.issued_at, u.name AS user_name, co.title_en AS course_title
         FROM certificates c
         LEFT JOIN users u ON u.id = c.user_id
         LEFT JOIN courses co ON co.id = c.course_id
        WHERE c.id = $1
        LIMIT 1`,
      [id]
    );

    if (!certRes.rows.length) {
      return res.status(404).send(`
        <html><body style="font-family:Arial;padding:40px">
          <h2>Certificate not found</h2>
          <p>This certificate ID does not exist.</p>
        </body></html>
      `);
    }

    const row = certRes.rows[0];
    const student = escapeHtml(row.user_name || "Student");
    const courseTitle = escapeHtml(row.course_title || row.course_id);
    const issued = escapeHtml(fmtDate(row.issued_at));

    const home = process.env.PUBLIC_WEBSITE_URL || "https://riseeritrea.com";

    res.setHeader("Content-Type", "text/html; charset=utf-8");
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
      <div class="muted">Eritrean Success Journey</div>

      <div class="row">
        <div class="box">
          <div class="muted">Student</div>
          <div style="font-size:20px;font-weight:700;margin-top:6px">${student}</div>
        </div>
        <div class="box">
          <div class="muted">Course</div>
          <div style="font-size:18px;font-weight:700;margin-top:6px">${courseTitle}</div>
          <div class="muted" style="margin-top:6px">Course ID: ${escapeHtml(row.course_id)}</div>
        </div>
      </div>

      <div class="row">
        <div class="box">
          <div class="muted">Issued on</div>
          <div style="font-weight:700;margin-top:6px">${issued}</div>
        </div>
        <div class="box">
          <div class="muted">Certificate ID</div>
          <div style="font-weight:700;margin-top:6px">${row.id}</div>
        </div>
      </div>

      <div class="footer">
        <div>JSON: <a href="${publicBase(req)}/api/certificates/verify/${row.id}.json">${publicBase(req)}/api/certificates/verify/${row.id}.json</a></div>
        <div style="margin-top:6px"><a href="${home}">Back to website</a></div>
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

/* ============================================================
   STATUS (frontend)
   GET /api/certificates/:courseId/status
============================================================ */

router.get("/:courseId/status", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id;

    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const eligibility = await checkEligibility({ userId, courseId });
    const cert = await getExistingCertificate({ userId, courseId });

    return res.json({
      ok: true,
      courseId,
      ...eligibility,              // ✅ totalLessons, completedLessons, examPassed, examScore, eligible
      issued: !!cert,
      certificateId: cert?.id || null,
      issuedAt: cert?.issued_at || null,
      verifyUrl: cert ? `${publicBase(req)}/api/certificates/verify/${cert.id}` : null,
      pdfUrl: cert ? `${publicBase(req)}/api/certificates/${courseId}/pdf` : null,
    });
  } catch (e) {
    console.error("CERT STATUS ERROR:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ============================================================
   CLAIM (idempotent)
   POST /api/certificates/:courseId/claim
============================================================ */

router.post("/:courseId/claim", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id;

    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const cert = await ensureCertificate({ userId, courseId }); // ✅ creates if eligible

    return res.json({
      ok: true,
      certificateId: cert.id,
      issuedAt: cert.issued_at,
      pdfUrl: `${publicBase(req)}/api/certificates/${courseId}/pdf`,
      verifyUrl: `${publicBase(req)}/api/certificates/verify/${cert.id}`,
    });
  } catch (e) {
    if (e.status === 403) {
      return res.status(403).json({ error: "Not eligible yet", details: e.details });
    }
    console.error("CERT CLAIM ERROR:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ============================================================
   PDF
   GET /api/certificates/:courseId/pdf
============================================================ */

router.get("/:courseId/pdf", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id;

    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const cert = await ensureCertificate({ userId, courseId });
    const { userName, courseTitle } = await getUserAndCourse({ userId, courseId });

    const verifyUrl = `${publicBase(req)}/api/certificates/verify/${cert.id}`;
    const qrPng = await QRCode.toBuffer(verifyUrl, { type: "png", margin: 1, scale: 6 });

    // Headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="certificate-${filenameSafe(courseId)}.pdf"`
    );

    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.pipe(res);

// ======================= GOLD PREMIUM TEMPLATE (PDFKit) =====================

// Page constants
const pageW = doc.page.width;
const pageH = doc.page.height;

// Colors
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
  doc.strokeColor(GOLD).lineWidth(4);
  doc.rect(28, 28, pageW - 56, pageH - 56).stroke();

  doc.strokeColor(GOLD_DARK).lineWidth(1);
  doc.rect(40, 40, pageW - 80, pageH - 80).stroke();
  doc.restore();
}

function drawWatermark(text) {
  doc.save();
  doc.rotate(-22, { origin: [pageW / 2, pageH / 2] });
  doc.fillColor("#000000").opacity(0.05);
  doc.font("Helvetica-Bold").fontSize(76);
  doc.text(text, 0, pageH / 2 - 60, { width: pageW, align: "center" });
  doc.opacity(1).restore();
}

function drawSeal(cx, cy, r = 32) {
  doc.save();
  doc.strokeColor(GOLD).lineWidth(3);
  doc.circle(cx, cy, r).stroke();

  doc.strokeColor(GOLD_DARK).lineWidth(1);
  doc.circle(cx, cy, r - 7).stroke();

  doc.strokeColor(GOLD).lineWidth(2);
  doc.moveTo(cx - 14, cy + r + 6).lineTo(cx - 5, cy + r + 24).stroke();
  doc.moveTo(cx + 14, cy + r + 6).lineTo(cx + 5, cy + r + 24).stroke();

  doc.fillColor(GOLD_DARK).font("Helvetica-Bold").fontSize(10);
  doc.text("OFFICIAL", cx - 28, cy - 7, { width: 56, align: "center" });
  doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(10);
  doc.text("CERTIFIED", cx - 34, cy + 6, { width: 68, align: "center" });
  doc.restore();
}

function drawSignatureBlock(leftX, y, label, name) {
  doc.save();
  doc.strokeColor("#999999").lineWidth(1);
  doc.moveTo(leftX, y).lineTo(leftX + 200, y).stroke();
  doc.fillColor(SOFT).font("Helvetica").fontSize(9)
    .text(label, leftX, y + 6, { width: 200, align: "center" });
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10)
    .text(name, leftX, y + 22, { width: 200, align: "center" });
  doc.restore();
}

function truncateToWidth(text, maxWidth) {
  const s = String(text || "");
  if (!s) return "";
  if (doc.widthOfString(s) <= maxWidth) return s;

  const ell = "…";
  let out = s;
  while (out.length > 6 && doc.widthOfString(out + ell) > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + ell;
}

// --- Background + borders ---
drawBorder();
drawWatermark("CERTIFIED");

// --- Header ---
centerText("Certificate of Completion", 86, 32, { font: "Helvetica-Bold", color: INK });
centerText("Eritrean Success Journey", 130, 12, { color: SOFT });
hr(154);

// ✅ Seal moved DOWN so it doesn't block the top area
drawSeal(pageW / 2, 205, 30);

// --- Main copy ---
const safeUserName = (userName && String(userName).trim()) ? userName : "Student";
const safeCourseTitle = (courseTitle && String(courseTitle).trim()) ? courseTitle : "Course";
const safeIssued = (issuedOnStr && String(issuedOnStr).trim()) ? issuedOnStr : "";
const safeCertId = (certId != null) ? String(certId) : "";
const safeVerifyUrl = (verifyUrl && String(verifyUrl).trim()) ? verifyUrl : "";

// Body text
centerText("This certificate is proudly presented to", 250, 13, { color: SOFT });

doc.fillColor(INK).font("Helvetica-Bold").fontSize(34);
doc.text(safeUserName, 0, 276, { width: pageW, align: "center" });

centerText("for successfully completing the course:", 332, 12, { color: SOFT });

doc.fillColor(INK).font("Helvetica-Bold").fontSize(22);
doc.text(safeCourseTitle, 0, 356, { width: pageW, align: "center" });

hr(404, "#E5D7A8", 1);

// ✅ Signatures moved a bit UP to leave space for footer box
drawSignatureBlock(90, 470, "Authorized Signature", "Eritrean Success Journey");
drawSignatureBlock(pageW - 290, 470, "Instructor", "Program Team");

// ✅ Bottom info box (keeps everything inside page → NO PAGE 2)
const boxX = 80;
const boxW = pageW - 160;
const boxH = 88;
const boxY = pageH - 120; // safely above bottom edge on A4

doc.save();
doc.roundedRect(boxX, boxY, boxW, boxH, 10).fill("#FFFFFF");
doc.roundedRect(boxX, boxY, boxW, boxH, 10).lineWidth(1).strokeColor("#E5E7EB").stroke();
doc.restore();

doc.fillColor(SOFT).font("Helvetica").fontSize(10);
doc.text(`Issued on: ${safeIssued}`, boxX + 14, boxY + 16);
doc.text(`Certificate ID: ${safeCertId}`, boxX + 14, boxY + 34);

// Verify URL line (truncate so it never wraps to a new page)
doc.text("Verify:", boxX + 14, boxY + 52);
doc.fillColor("#0A58CA").font("Helvetica").fontSize(10);

const qrSize = 70;
const urlMaxWidth = boxW - 14 - 14 - 46 - qrSize - 18; // leave room for QR on right
const urlText = truncateToWidth(safeVerifyUrl, urlMaxWidth);

doc.text(urlText, boxX + 60, boxY + 52, {
  width: urlMaxWidth,
  link: safeVerifyUrl || undefined,
  underline: true
});

// QR on the right inside the box (never touches bottom)
if (safeVerifyUrl) {
  const qrBuf = await QRCode.toBuffer(safeVerifyUrl, { margin: 1, scale: 5 });
  doc.image(qrBuf, boxX + boxW - 14 - qrSize, boxY + 10, { width: qrSize, height: qrSize });
  doc.fillColor(SOFT).font("Helvetica").fontSize(8);
  doc.text("Scan to verify", boxX + boxW - 14 - qrSize, boxY + 82, { width: qrSize, align: "center" });
}

// Optional tiny footer (still page 1)
doc.fillColor("#9CA3AF").font("Helvetica").fontSize(9);
doc.text("© Eritrean Success Journey", 0, pageH - 42, { width: pageW, align: "center" });

// ==================== END GOLD PREMIUM TEMPLATE ====================

    doc.end();
  } catch (e) {
    if (e.status === 403) {
      return res.status(403).json({ error: "Not eligible yet", details: e.details });
    }
    console.error("CERT PDF ERROR:", e);
    return res.status(500).json({ error: "Server error generating certificate PDF" });
  }
});

module.exports = router;