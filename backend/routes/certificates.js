// backend/routes/certificates.js
//
// Eritrean Success Journey - Certificates (WOW PDF, one page)
// ----------------------------------------------------------
// Endpoints:
//   GET  /api/certificates/:courseId/status     (auth)
//   POST /api/certificates/:courseId/claim      (auth, idempotent)
//   GET  /api/certificates/:courseId/pdf        (auth, one-page PDF)
//   GET  /api/certificates/verify/:id           (public HTML)
//   GET  /api/certificates/verify/:id.json      (public JSON)

const express = require("express");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/* ---------------------------
   CONFIG
---------------------------- */

const FOUNDER_NAME = "Michael Afewerki";
const FOUNDER_TITLE = "Founder, Eritrean Success Journey";
const PROGRAM_TEAM = "Program Team";

// Keep it short so it NEVER forces a 2nd page.
const INSPIRING_QUOTE =
  "Education is the passport to the future — success is built one lesson at a time.";

// Put your PNG here (transparent background recommended)
const SIGNATURE_PATH = path.join(__dirname, "..", "assets", "founder-signature.png");

/* ---------------------------
   HELPERS
---------------------------- */

function safeCourseId(courseId) {
  const allowed = new Set(["foundation", "growth", "excellence"]);
  return allowed.has(courseId) ? courseId : null;
}

function filenameSafe(s = "") {
  return String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function fmtDate(d) {
  try {
    const dt = new Date(d);
    if (!Number.isFinite(dt.getTime())) return "";
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

// Public base for verify links embedded in PDF / verify pages.
// Recommended: set PUBLIC_SITE_BASE_URL=https://api.riseeritrea.com
function publicBase(req) {
  const env = process.env.PUBLIC_SITE_BASE_URL;
  if (env) return env.replace(/\/+$/, "");

  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function courseLabel(courseId) {
  if (courseId === "foundation") return "Level 1: Foundation";
  if (courseId === "growth") return "Level 2: Growth";
  if (courseId === "excellence") return "Level 3: Excellence";
  return courseId;
}

/* ---------------------------
   ELIGIBILITY + CERT
---------------------------- */

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

  const examR = await query(
    `SELECT passed, score, updated_at, id
       FROM exam_attempts
      WHERE user_id=$1 AND course_id=$2
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1`,
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

async function getExistingCertificate({ userId, courseId }) {
  const r = await query(
    `SELECT id, issued_at
       FROM certificates
      WHERE user_id=$1 AND course_id=$2
      ORDER BY id ASC
      LIMIT 1`,
    [userId, courseId]
  );
A
  return r.rows[0] || null;
}

async function ensureCertificate({ userId, courseId }) {
  const existing = await getExistingCertificate({ userId, courseId });
  if (existing) return existing;

  const elig = await checkEligibility({ userId, courseId });
  if (!elig.eligible) {
    const err = new Error("Not eligible yet");
    err.status = 403;
    err.details = elig;
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
  const userR = await query("SELECT name FROM users WHERE id=$1", [userId]);
  const courseR = await query(
    "SELECT title_en FROM courses WHERE id=$1",
    [courseId]
  );

  return {
    userName: userR.rows[0]?.name || "Student",
    courseTitle: courseR.rows[0]?.title_en || courseLabel(courseId)
  };
}

/* ---------------------------
   STATUS (auth)
---------------------------- */

router.get("/:courseId/status", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id || req.session?.user?.id;

    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const elig = await checkEligibility({ userId, courseId });
    const cert = await getExistingCertificate({ userId, courseId });

    return res.json({
      ok: true,
      courseId,
      eligible: elig.eligible,
      totalLessons: elig.totalLessons,
      completedLessons: elig.completedLessons,
      examPassed: elig.examPassed,
      examScore: elig.examScore,
      issued: !!cert,
      certificateId: cert?.id || null,
      issuedAt: cert?.issued_at || null,
      pdfUrl: cert ? `${publicBase(req)}/api/certificates/${courseId}/pdf` : null,
      verifyUrl: cert ? `${publicBase(req)}/api/certificates/verify/${cert.id}` : null
    });
  } catch (e) {
    console.error("CERT STATUS ERROR:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ---------------------------
   CLAIM (auth, idempotent)
---------------------------- */

router.post("/:courseId/claim", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id || req.session?.user?.id;

    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const cert = await ensureCertificate({ userId, courseId });

    return res.json({
      ok: true,
      certificateId: cert.id,
      issuedAt: cert.issued_at,
      pdfUrl: `${publicBase(req)}/api/certificates/${courseId}/pdf`,
      verifyUrl: `${publicBase(req)}/api/certificates/verify/${cert.id}`
    });
  } catch (e) {
    if (e?.status === 403) {
      return res.status(403).json({ error: "Not eligible yet", details: e.details });
    }
    console.error("CERT CLAIM ERROR:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ---------------------------
   PUBLIC VERIFY JSON
---------------------------- */

router.get("/verify/:id.json", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const r = await query(
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

    if (!r.rows.length) return res.status(404).json({ error: "Not found" });

    const row = r.rows[0];
    return res.json({
      ok: true,
      certificateId: row.id,
      student: row.user_name || "Student",
      courseId: row.course_id,
      courseTitle: row.course_title || courseLabel(row.course_id),
      issuedAt: row.issued_at,
      verifyUrl: `${publicBase(req)}/api/certificates/verify/${row.id}`
    });
  } catch (e) {
    console.error("CERT VERIFY JSON ERROR:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ---------------------------
   PUBLIC VERIFY HTML
---------------------------- */

router.get("/verify/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).send("Invalid certificate id.");

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
      return res.status(404).send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Certificate Verification</title></head>
<body style="font-family:system-ui;background:#0b1220;color:#eaf0ff;padding:30px">
  <h2>❌ Certificate not found</h2>
  <p>This certificate ID does not exist.</p>
</body></html>`);
    }

    const row = certRes.rows[0];
    const student = row.user_name || "Student";
    const courseTitle = row.course_title || courseLabel(row.course_id);
    const issued = fmtDate(row.issued_at);
    const pdfUrl = `${publicBase(req)}/api/certificates/${row.course_id}/pdf`;

    return res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Certificate Verification</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;background:#0b1220;margin:0;color:#eaf0ff}
    .wrap{max-width:860px;margin:0 auto;padding:28px 16px}
    .card{background:#0f1a33;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:22px}
    .badge{display:inline-block;padding:6px 10px;border-radius:999px;background:rgba(20,184,166,.15);border:1px solid rgba(20,184,166,.35);color:#a7f3d0;font-weight:700;font-size:12px}
    .title{font-size:26px;margin:12px 0 6px 0}
    .muted{color:rgba(234,240,255,.72)}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:18px}
    .box{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:14px}
    .k{font-size:12px;color:rgba(234,240,255,.72)}
    .v{font-size:18px;font-weight:800;margin-top:6px}
    a.btn{display:inline-flex;gap:8px;align-items:center;background:#2563eb;color:white;text-decoration:none;padding:10px 14px;border-radius:12px;font-weight:800}
    @media (max-width:720px){.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <span class="badge">VERIFIED ✅</span>
      <div class="title">Certificate Verification</div>
      <div class="muted">Eritrean Success Journey</div>

      <div class="grid">
        <div class="box">
          <div class="k">Student</div>
          <div class="v">${escapeHtml(student)}</div>
        </div>
        <div class="box">
          <div class="k">Course</div>
          <div class="v">${escapeHtml(courseTitle)}</div>
        </div>
        <div class="box">
          <div class="k">Issued</div>
          <div class="v">${escapeHtml(issued)}</div>
        </div>
        <div class="box">
          <div class="k">Certificate ID</div>
          <div class="v">${row.id}</div>
        </div>
      </div>

      <div style="height:16px"></div>
      <a class="btn" href="${escapeHtml(pdfUrl)}" target="_blank" rel="noreferrer">⬇️ Download PDF</a>
    </div>
  </div>
</body>
</html>`);
  } catch (e) {
    console.error("CERT VERIFY HTML ERROR:", e);
    return res.status(500).send("Server error");
  }
});

/* ---------------------------
   PDF (auth) — ONE PAGE (safe coordinates)
---------------------------- */

router.get("/:courseId/pdf", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id || req.session?.user?.id;

    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Ensure certificate exists (and enforces eligibility)
    const cert = await ensureCertificate({ userId, courseId });
    const { userName, courseTitle } = await getUserAndCourse({ userId, courseId });

    const verifyUrl = `${publicBase(req)}/api/certificates/verify/${cert.id}`;
    const issuedOnStr = fmtDate(cert.issued_at);
    const certIdStr = String(cert.id);

    // Always generate QR from verifyUrl
    const qrBuf = await QRCode.toBuffer(verifyUrl, { margin: 1, scale: 6 });

    // PDF headers
    const fileName = `certificate-${filenameSafe(courseId)}-${filenameSafe(userName)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    doc.pipe(res);

    // ====================== GOLD PREMIUM TEMPLATE (PDFKit) =====================

    const pageW = doc.page.width;
    const pageH = doc.page.height;

    // Colors
    const GOLD = "#C8A84E";
    const GOLD_DARK = "#8A6A1F";
    const INK = "#1f2937";
    const SOFT = "#6b7280";

    function centerText(text, y, size, options = {}) {
      doc
        .fillColor(options.color || INK)
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
      doc.rect(24, 24, pageW - 48, pageH - 48).stroke();
      doc.strokeColor(GOLD_DARK).lineWidth(1);
      doc.rect(36, 36, pageW - 72, pageH - 72).stroke();
      doc.restore();
    }

    function drawWatermark(text) {
      doc.save();
      doc.rotate(-22, { origin: [pageW / 2, pageH / 2] });
      doc.fillColor("#000000").opacity(0.06);
      doc.font("Helvetica-Bold").fontSize(74);
      doc.text(text, 0, pageH / 2 - 60, { width: pageW, align: "center" });
      doc.opacity(1).restore();
    }

    function drawSeal() {
      const cx = pageW / 2;
      const cy = 190;

      doc.save();
      doc.strokeColor(GOLD).lineWidth(3);
      doc.circle(cx, cy, 34).stroke();

      doc.strokeColor(GOLD_DARK).lineWidth(1);
      doc.circle(cx, cy, 26).stroke();

      doc.strokeColor(GOLD).lineWidth(2);
      doc.moveTo(cx - 16, cy + 38).lineTo(cx - 6, cy + 56).stroke();
      doc.moveTo(cx + 16, cy + 38).lineTo(cx + 6, cy + 56).stroke();

      doc.fillColor(GOLD_DARK).font("Helvetica-Bold").fontSize(9);
      doc.text("OFFICIAL", cx - 26, cy - 6, { width: 52, align: "center" });
      doc.fillColor(SOFT).font("Helvetica-Bold").fontSize(8);
      doc.text("CERTIFIED", cx - 26, cy + 6, { width: 52, align: "center" });
      doc.restore();
    }

    function signatureLine(x, y, w) {
      doc.save();
      doc.strokeColor("#9ca3af").lineWidth(1);
      doc.moveTo(x, y).lineTo(x + w, y).stroke();
      doc.restore();
    }

    // Background + border + watermark
    drawBorder();
    drawWatermark("CERTIFIED");

    // Header
    centerText("Certificate of Completion", 78, 30, { font: "Helvetica-Bold", color: INK });
    centerText("Eritrean Success Journey", 118, 12, { color: SOFT });
    hr(142);

    // Seal
    drawSeal();

    // Main block
    centerText("This certificate is proudly presented to", 230, 12, { color: SOFT });

    doc.fillColor(INK).font("Helvetica-Bold").fontSize(34);
    doc.text(userName, 0, 252, { width: pageW, align: "center" });

    // Optional official certified after name (small, not huge)
    doc.fillColor(GOLD_DARK).font("Helvetica-Bold").fontSize(10);
    doc.text("OFFICIALLY CERTIFIED", 0, 292, { width: pageW, align: "center" });

    centerText("for successfully completing the course:", 318, 12, { color: SOFT });

    doc.fillColor(INK).font("Helvetica-Bold").fontSize(20);
    doc.text(courseTitle, 0, 340, { width: pageW, align: "center" });

    hr(380, "#E5D7A8", 1);

    // Quote (kept short to avoid overflow)
    doc.fillColor(SOFT).font("Helvetica-Oblique").fontSize(11);
    doc.text(`“${INSPIRING_QUOTE}”`, 90, 398, { width: pageW - 180, align: "center" });

    // Footer info box (bottom, guaranteed to fit)
    const boxX = 70;
    const boxY = 610;
    const boxW = pageW - 140;
    const boxH = 110;

    doc.save();
    doc.roundedRect(boxX, boxY, boxW, boxH, 10)
      .fillOpacity(0.06)
      .fillAndStroke("#111827", "#d1d5db");
    doc.fillOpacity(1);
    doc.restore();

    // Left text in box
    doc.fillColor("#374151").font("Helvetica").fontSize(10);
    doc.text(`Issued on: ${issuedOnStr}`, boxX + 14, boxY + 16);
    doc.text(`Certificate ID: ${certIdStr}`, boxX + 14, boxY + 34);
    doc.text(`Verify: ${verifyUrl}`, boxX + 14, boxY + 52, { width: boxW - 120 });

    // QR right inside the same box
    doc.image(qrBuf, boxX + boxW - 92, boxY + 16, { width: 76 });

    doc.fillColor(SOFT).font("Helvetica").fontSize(8);
    doc.text("Scan to verify", boxX + boxW - 96, boxY + 94, { width: 86, align: "center" });

    // Signatures (above the footer box)
    // Left: Program Team
    signatureLine(90, 560, 200);
    doc.fillColor(SOFT).font("Helvetica").fontSize(9).text("Authorized", 90, 566, { width: 200, align: "center" });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(PROGRAM_TEAM, 90, 580, { width: 200, align: "center" });

    // Right: Founder + signature image
    signatureLine(pageW - 290, 560, 200);

    // Signature image (optional)
    try {
      if (fs.existsSync(SIGNATURE_PATH)) {
        // A subtle opacity looks premium
        doc.save();
        doc.opacity(0.95);
        doc.image(SIGNATURE_PATH, pageW - 285, 525, { width: 190 });
        doc.opacity(1);
        doc.restore();
      }
    } catch (e) {
      console.warn("Signature image load failed:", e?.message);
    }

    doc.fillColor(SOFT).font("Helvetica").fontSize(9).text("Founder", pageW - 290, 566, { width: 200, align: "center" });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(FOUNDER_NAME, pageW - 290, 580, { width: 200, align: "center" });
    doc.fillColor(SOFT).font("Helvetica").fontSize(9).text(FOUNDER_TITLE, pageW - 290, 595, { width: 200, align: "center" });

    // IMPORTANT: do not add anything below boxY+boxH (~720). A4 ends ~842.
    // This guarantees one page.

    // ==================== END GOLD PREMIUM TEMPLATE ====================

    doc.end();
  } catch (err) {
    console.error("CERT PDF ERROR:", err);
    // Return JSON for fetch-based clients, but Chrome PDF viewer expects PDF.
    // If headers already sent, just end.
    if (res.headersSent) {
      try { res.end(); } catch {}
      return;
    }
    return res.status(err?.status || 500).json({
      error: "Server error generating certificate PDF",
      details: process.env.NODE_ENV === "production" ? undefined : String(err?.message || err)
    });
  }
});

module.exports = router;