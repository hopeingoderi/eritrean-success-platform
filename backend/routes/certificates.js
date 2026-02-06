// backend/routes/certificates.js
// =======================================================
// Eritrean Success Journey – Certificates System
// PART 1: imports, helpers, eligibility, status, claim
// =======================================================

const express = require("express");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/* =======================================================
   CONFIG
======================================================= */

const FOUNDER_NAME = "Michael Afewerki";
const FOUNDER_TITLE = "Founder & Program Director";

const INSPIRING_QUOTE =
  "“Education is the most powerful journey — when belief leads, success follows.”";

const FOUNDER_SIGNATURE_PATH = path.join(
  __dirname,
  "..",
  "assets",
  "founder-signature.png"
);

/* =======================================================
   HELPERS
======================================================= */

function safeCourseId(courseId) {
  const allowed = new Set(["foundation", "growth", "excellence"]);
  return allowed.has(courseId) ? courseId : null;
}

function fmtDate(d) {
  try {
    return new Date(d).toDateString();
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
    "'": "&#39;",
  }[m]));
}

function publicBase(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  }
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  return `${proto}://${req.get("host")}`;
}

/* =======================================================
   ELIGIBILITY + CERTIFICATE
======================================================= */

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
    `SELECT passed, score
     FROM exam_attempts
     WHERE user_id=$1 AND course_id=$2
     ORDER BY updated_at DESC
     LIMIT 1`,
    [userId, courseId]
  );

  const examPassed = !!examR.rows[0]?.passed;

  return {
    eligible:
      totalLessons > 0 &&
      completedLessons >= totalLessons &&
      examPassed === true,
    totalLessons,
    completedLessons,
    examPassed,
  };
}

async function getExistingCertificate({ userId, courseId }) {
  const r = await query(
    `SELECT id, issued_at
     FROM certificates
     WHERE user_id=$1 AND course_id=$2
     LIMIT 1`,
    [userId, courseId]
  );
  return r.rows[0] || null;
}

async function ensureCertificate({ userId, courseId }) {
  const existing = await getExistingCertificate({ userId, courseId });
  if (existing) return existing;

  await query(
    `INSERT INTO certificates (user_id, course_id)
     VALUES ($1,$2)
     ON CONFLICT (user_id, course_id) DO NOTHING`,
    [userId, courseId]
  );

  return getExistingCertificate({ userId, courseId });
}

async function getUserAndCourse({ userId, courseId }) {
  const r = await query(
    `SELECT u.name AS user_name, co.title_en AS course_title
     FROM users u
     LEFT JOIN courses co ON co.id=$2
     WHERE u.id=$1
     LIMIT 1`,
    [userId, courseId]
  );

  return {
    userName: r.rows[0]?.user_name || "Student",
    courseTitle: r.rows[0]?.course_title || courseId,
  };
}

/* =======================================================
   STATUS
   GET /api/certificates/:courseId/status
======================================================= */

router.get("/:courseId/status", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id;

    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const eligibility = await checkEligibility({ userId, courseId });
    const cert = await getExistingCertificate({ userId, courseId });

    res.json({
      ok: true,
      courseId,
      ...eligibility,
      hasCertificate: !!cert,
      certificateId: cert?.id || null,
      issuedAt: cert?.issued_at || null,
      pdfUrl: cert
        ? `${publicBase(req)}/api/certificates/${courseId}/pdf`
        : null,
    });
  } catch (e) {
    console.error("STATUS ERROR:", e);
    res.status(500).json({ error: "Server error" });
  }
});

/* =======================================================
   CLAIM
   POST /api/certificates/:courseId/claim
======================================================= */

router.post("/:courseId/claim", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id;

    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const eligibility = await checkEligibility({ userId, courseId });
    if (!eligibility.eligible) {
      return res.status(403).json({ error: "Not eligible yet" });
    }

    const cert = await ensureCertificate({ userId, courseId });

    res.json({
      ok: true,
      certificateId: cert.id,
      issuedAt: cert.issued_at,
      pdfUrl: `${publicBase(req)}/api/certificates/${courseId}/pdf`,
      verifyUrl: `${publicBase(req)}/api/certificates/verify/${cert.id}`,
    });
  } catch (e) {
    console.error("CLAIM ERROR:", e);
    res.status(500).json({ error: "Server error" });
  }
});

/* =======================================================
   PUBLIC VERIFY JSON
   GET /api/certificates/verify/:id.json
======================================================= */
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

    if (!certRes.rows.length) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    const row = certRes.rows[0];
    return res.json({
      ok: true,
      certificateId: row.id,
      student: row.user_name || "Student",
      courseId: row.course_id,
      courseTitle: row.course_title || row.course_id,
      issuedAt: row.issued_at,
      verifyHtml: `${publicBase(req)}/api/certificates/verify/${row.id}`,
    });
  } catch (e) {
    console.error("VERIFY JSON ERROR:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/* =======================================================
   PUBLIC VERIFY HTML (QR opens this)
   GET /api/certificates/verify/:id
======================================================= */
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

    const home = process.env.PUBLIC_SITE_URL
      ? process.env.PUBLIC_SITE_URL.replace(/\/+$/, "")
      : publicBase(req);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Certificate Verification</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;background:#0b1220;margin:0;padding:0;color:#eaf0ff}
    .wrap{max-width:860px;margin:0 auto;padding:34px 16px}
    .card{background:#0f1a33;border:1px solid rgba(255,255,255,.10);border-radius:16px;padding:26px}
    .badge{display:inline-block;padding:7px 12px;border-radius:999px;background:rgba(16,185,129,.12);
           border:1px solid rgba(16,185,129,.35);color:#a7f3d0;font-weight:800;font-size:12px}
    .muted{color:rgba(234,240,255,.75)}
    .row{display:flex;gap:16px;flex-wrap:wrap;margin-top:18px}
    .box{flex:1;min-width:240px;border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:14px;background:rgba(255,255,255,.03)}
    .title{font-size:26px;margin:12px 0 6px 0}
    a{color:#93c5fd;text-decoration:none}
    a:hover{text-decoration:underline}
    .footer{margin-top:18px;font-size:12px;color:rgba(234,240,255,.7)}
    code{background:rgba(255,255,255,.06);padding:2px 6px;border-radius:8px}
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
          <div style="font-size:20px;font-weight:800;margin-top:6px">${escapeHtml(student)}</div>
        </div>
        <div class="box">
          <div class="muted">Course</div>
          <div style="font-size:18px;font-weight:800;margin-top:6px">${escapeHtml(courseTitle)}</div>
          <div class="muted" style="margin-top:6px">Course ID: <code>${escapeHtml(row.course_id)}</code></div>
        </div>
      </div>

      <div class="row">
        <div class="box">
          <div class="muted">Issued on</div>
          <div style="font-weight:800;margin-top:6px">${escapeHtml(issued)}</div>
        </div>
        <div class="box">
          <div class="muted">Certificate ID</div>
          <div style="font-weight:800;margin-top:6px">${row.id}</div>
        </div>
      </div>

      <div class="footer">
        <div>JSON: <a href="${publicBase(req)}/api/certificates/verify/${row.id}.json">${publicBase(req)}/api/certificates/verify/${row.id}.json</a></div>
        <div style="margin-top:6px"><a href="${home}">Back to website</a></div>
      </div>
    </div>
  </div>
</body>
</html>`);
  } catch (e) {
    console.error("VERIFY HTML ERROR:", e);
    return res.status(500).send("Server error");
  }
});

/* =======================================================
   STATUS (frontend calls this)
   GET /api/certificates/:courseId/status
======================================================= */
router.get("/:courseId/status", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id;

    if (!courseId) return res.status(400).json({ error: "Missing courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const eligibility = await checkEligibility({ userId, courseId });
    const cert = await getExistingCertificate({ userId, courseId });

    return res.json({
      ok: true,
      courseId,
      eligible: !!eligibility.eligible,
      totalLessons: eligibility.totalLessons,
      completedLessons: eligibility.completedLessons,
      examPassed: eligibility.examPassed,
      examScore: eligibility.examScore,
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

/* =======================================================
   CLAIM (idempotent)
   POST /api/certificates/:courseId/claim
======================================================= */
router.post("/:courseId/claim", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id;

    if (!courseId) return res.status(400).json({ error: "Missing courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const eligibility = await checkEligibility({ userId, courseId });
    if (!eligibility.eligible) return res.status(403).json({ error: "Not eligible yet", details: eligibility });

    const cert = await ensureCertificate({ userId, courseId });

    return res.json({
      ok: true,
      certificateId: cert.id,
      issuedAt: cert.issued_at,
      pdfUrl: `${publicBase(req)}/api/certificates/${courseId}/pdf`,
      verifyUrl: `${publicBase(req)}/api/certificates/verify/${cert.id}`,
    });
  } catch (e) {
    console.error("CERT CLAIM ERROR:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/* =======================================================
   PDF (ONE PAGE, WOW)
   GET /api/certificates/:courseId/pdf
======================================================= */
router.get("/:courseId/pdf", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id;

    if (!courseId) return res.status(400).json({ error: "Missing courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // must be eligible, and must have certificate
    const eligibility = await checkEligibility({ userId, courseId });
    if (!eligibility.eligible) return res.status(403).json({ error: "Not eligible yet", details: eligibility });

    const cert = await ensureCertificate({ userId, courseId });
    const { userName, courseTitle } = await getUserAndCourse({ userId, courseId });

    const verifyUrl = `${publicBase(req)}/api/certificates/verify/${cert.id}`;
    const qrPng = await QRCode.toBuffer(verifyUrl, { type: "png", margin: 1, scale: 6 });

    // IMPORTANT: inline so mobile opens it nicely
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="certificate-${filenameSafe(courseId)}.pdf"`);

    // PDF
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.pipe(res);

    const pageW = doc.page.width;
    const pageH = doc.page.height;

    // --- Theme ---
    const GOLD = "#C8A84E";
    const GOLD_DARK = "#8A6A1F";
    const INK = "#111827";
    const SOFT = "#6B7280";
    const LIGHT = "#F8FAFC";

    // Background
    doc.rect(0, 0, pageW, pageH).fill(LIGHT);

    // Border
    doc.save();
    doc.lineWidth(2).strokeColor(GOLD).rect(24, 24, pageW - 48, pageH - 48).stroke();
    doc.lineWidth(1).strokeColor("#D1D5DB").rect(32, 32, pageW - 64, pageH - 64).stroke();
    doc.restore();

    // Watermark (subtle)
    doc.save();
    doc.rotate(-18, { origin: [pageW / 2, pageH / 2] });
    doc.fillColor("#111827").opacity(0.06).font("Helvetica-Bold").fontSize(58);
    doc.text("ERITREAN SUCCESS JOURNEY", 0, pageH / 2 - 50, { width: pageW, align: "center" });
    doc.opacity(1).restore();

    // Header
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(32);
    doc.text("Certificate of Completion", 0, 86, { width: pageW, align: "center" });

    doc.fillColor(SOFT).font("Helvetica").fontSize(12);
    doc.text("Eritrean Success Journey", 0, 130, { width: pageW, align: "center" });

    // Divider
    doc.moveTo(120, 160).lineTo(pageW - 120, 160).lineWidth(1).strokeColor("#E5E7EB").stroke();

    // Body copy
    doc.fillColor(SOFT).font("Helvetica").fontSize(13);
    doc.text("This certificate is proudly presented to", 0, 190, { width: pageW, align: "center" });

    // Student name
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(38);
    doc.text(userName || "Student", 0, 220, { width: pageW, align: "center" });

    // Optional “Official Certified” next to name? (subtle, better)
    doc.fillColor(GOLD_DARK).font("Helvetica-Bold").fontSize(11);
    doc.text("OFFICIALLY CERTIFIED", 0, 266, { width: pageW, align: "center" });

    doc.fillColor(SOFT).font("Helvetica").fontSize(13);
    doc.text("for successfully completing the course:", 0, 292, { width: pageW, align: "center" });

    doc.fillColor(INK).font("Helvetica-Bold").fontSize(22);
    doc.text(courseTitle || courseId, 0, 318, { width: pageW, align: "center" });

    // Seal (moved down so it won't overlap)
    const sealX = pageW / 2;
    const sealY = 390;
    doc.save();
    doc.circle(sealX, sealY, 44).fill("#FFF7ED");
    doc.circle(sealX, sealY, 44).lineWidth(2).strokeColor(GOLD).stroke();
    doc.circle(sealX, sealY, 36).lineWidth(1).strokeColor("#F59E0B").dash(2, { space: 2 }).stroke().undash();
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10);
    doc.text("OFFICIAL", sealX - 28, sealY - 9, { width: 56, align: "center" });
    doc.fillColor(GOLD_DARK).font("Helvetica-Bold").fontSize(10);
    doc.text("CERTIFIED", sealX - 34, sealY + 5, { width: 68, align: "center" });
    doc.restore();

    // Quote (kept short to stay on one page)
    const quote = "“Education is the bridge between dreams and destiny.”";
    doc.fillColor(SOFT).font("Helvetica-Oblique").fontSize(12);
    doc.text(quote, 90, 445, { width: pageW - 180, align: "center" });

    // Signature area (ONE PAGE safe)
    const sigY = 500;

    // Founder signature image (optional)
    // Put your file at: backend/assets/founder-signature.png
    const path = require("path");
    const fs = require("fs");
    const sigPath = path.join(__dirname, "..", "assets", "founder-signature.png");

    // Left signature box (Founder)
    doc.save();
    doc.strokeColor("#E5E7EB").lineWidth(1).roundedRect(78, sigY, (pageW - 156) / 2 - 10, 78, 10).stroke();
    doc.restore();

    // Right signature box (Program Team)
    doc.save();
    doc.strokeColor("#E5E7EB").lineWidth(1).roundedRect(pageW / 2 + 10, sigY, (pageW - 156) / 2 - 10, 78, 10).stroke();
    doc.restore();

    // Founder signature image inside left box (safe fallback)
    if (fs.existsSync(sigPath)) {
      try {
        doc.image(sigPath, 92, sigY + 10, { width: 160, height: 40 });
      } catch (e) {
        console.error("SIGNATURE IMAGE ERROR:", e);
      }
    } else {
      // fallback: just draw a cursive-like name
      doc.fillColor(INK).font("Helvetica-Oblique").fontSize(18);
      doc.text("Michael Afewerki", 92, sigY + 20, { width: 200, align: "left" });
    }

    // Founder label
    doc.fillColor(SOFT).font("Helvetica").fontSize(9);
    doc.text("Michael Afewerki", 92, sigY + 54, { width: 200, align: "left" });
    doc.text("Founder • Eritrean Success Journey", 92, sigY + 66, { width: 240, align: "left" });

    // Right label (Program Team)
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10);
    doc.text("Program Team", pageW / 2 + 24, sigY + 28, { width: 220, align: "left" });
    doc.fillColor(SOFT).font("Helvetica").fontSize(9);
    doc.text("Eritrean Success Journey", pageW / 2 + 24, sigY + 46, { width: 220, align: "left" });

    // Footer info box + QR (BOTTOM — safe, no overflow)
    const boxY = pageH - 150; // safe one-page bottom position
    doc.save();
    doc.roundedRect(70, boxY, pageW - 140, 92, 10).fill("#FFFFFF");
    doc.roundedRect(70, boxY, pageW - 140, 92, 10).lineWidth(1).strokeColor("#E5E7EB").stroke();
    doc.restore();

    doc.fillColor(SOFT).font("Helvetica").fontSize(11);
    doc.text(`Issued on: ${fmtDate(cert.issued_at)}`, 90, boxY + 16, { width: pageW - 220, align: "left" });
    doc.text(`Certificate ID: ${cert.id}`, 90, boxY + 34, { width: pageW - 220, align: "left" });

    doc.fillColor(SOFT).font("Helvetica").fontSize(10);
    doc.text("Verify:", 90, boxY + 56, { width: 40, align: "left" });
    doc.fillColor(INK).font("Helvetica").fontSize(10);
    doc.text(verifyUrl, 132, boxY + 56, { width: pageW - 260, align: "left" });

    // QR (right side)
    const qrSize = 78;
    doc.image(qrPng, pageW - 70 - qrSize, boxY + 10, { width: qrSize, height: qrSize });
    doc.fillColor(SOFT).font("Helvetica").fontSize(8);
    doc.text("Scan to verify", pageW - 70 - qrSize, boxY + 90, { width: qrSize, align: "center" });

    // Bottom footer (INSIDE PAGE, not pushing new page)
    doc.fillColor("#9CA3AF").font("Helvetica").fontSize(9);
    doc.text("© Eritrean Success Journey", 0, pageH - 38, { width: pageW, align: "center" });

    doc.end();
  } catch (e) {
    console.error("CERT PDF ERROR:", e);
    return res.status(500).json({ error: "Server error generating certificate PDF" });
  }
});

module.exports = router;