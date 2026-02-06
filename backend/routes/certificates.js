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

// Short inspiring line (best practice: short, strong, timeless)
const INSPIRING_QUOTE =
  "Education builds the future — success is earned one lesson at a time.";

// Put your transparent signature PNG here:
const SIGNATURE_PATH = path.join(__dirname, "..", "assets", "founder-signature-transparent.png");

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
    // Nice readable, stable formatting
    return dt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
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

// Read userId safely from your middleware style (req.user OR req.session.user)
function getUserId(req) {
  return req.user?.id || req.session?.user?.id || null;
}

// public base for links embedded in PDF / verify pages
function publicBase(req) {
  // Recommended: set this in Render env
  // PUBLIC_SITE_BASE_URL=https://api.riseeritrea.com
  const env = process.env.PUBLIC_SITE_BASE_URL;
  if (env) return env.replace(/\/+$/, "");

  // fallback: infer from request
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`.replace(/\/+$/, "");
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

  // latest attempt determines status
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

  const eligible = totalLessons > 0 && completedLessons >= totalLessons && examPassed;

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
  const courseR = await query("SELECT title_en FROM courses WHERE id=$1", [courseId]);

  return {
    userName: userR.rows[0]?.name || "Student",
    courseTitle: courseR.rows[0]?.title_en || courseId
  };
}

/* =========================
   STATUS (frontend calls)
========================= */

router.get("/:courseId/status", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = getUserId(req); // supports req.user OR req.session.user

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

/* =========================
   CLAIM (IDEMPOTENT)
========================= */

router.post("/:courseId/claim", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = getUserId(req);

    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // optional: return details if not eligible
    const elig = await checkEligibility({ userId, courseId });
    if (!elig.eligible) {
      return res.status(403).json({ error: "Not eligible yet", details: elig });
    }

    // idempotent: returns existing if already created
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

/* =========================
   PDF (WOW, ONE PAGE)
========================= */

router.get("/:courseId/pdf", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = getUserId(req);

    if (!courseId) return res.status(400).json({ error: "Invalid courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Ensure eligible + cert exists (idempotent)
    const cert = await ensureCertificate({ userId, courseId });
    const { userName, courseTitle } = await getUserAndCourse({ userId, courseId });

    const verifyUrl = `${publicBase(req)}/api/certificates/verify/${cert.id}`;

    // ✅ 1) HEADERS FIRST
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="certificate-${filenameSafe(courseId)}.pdf"`
    );

    // ✅ 2) CREATE DOC AFTER HEADERS
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.pipe(res);

    const pageW = doc.page.width;
    const pageH = doc.page.height;

    // Colors
    const GOLD = "#C8A84E";
    const GOLD_DARK = "#8A6A1F";
    const INK = "#111827";
    const SOFT = "#6B7280";
    const PAPER = "#F8FAFC";

    // Helpers
    const center = (text, y, size, opts = {}) => {
      doc
        .fillColor(opts.color || INK)
        .font(opts.font || "Helvetica")
        .fontSize(size)
        .text(text, 0, y, { width: pageW, align: "center" });
    };

    const hr = (y, color = "#E5E7EB") => {
      doc.save();
      doc.strokeColor(color).lineWidth(1);
      doc.moveTo(90, y).lineTo(pageW - 90, y).stroke();
      doc.restore();
    };

    const clamp = (s, max = 70) => {
      const t = String(s || "");
      return t.length > max ? t.slice(0, max - 1) + "…" : t;
    };

    // Background
    doc.rect(0, 0, pageW, pageH).fill(PAPER);

    // Premium double border
    doc.save();
    doc.lineWidth(3).strokeColor(GOLD).rect(24, 24, pageW - 48, pageH - 48).stroke();
    doc.lineWidth(1).strokeColor("#D1D5DB").rect(34, 34, pageW - 68, pageH - 68).stroke();
    doc.restore();

    // Watermark (light, doesn’t block content)
    doc.save();
    doc.rotate(-18, { origin: [pageW / 2, pageH / 2] });
    doc.fillColor("#111827").opacity(0.05).font("Helvetica-Bold").fontSize(58);
    doc.text("ERITREAN SUCCESS JOURNEY", 0, pageH / 2 - 50, { width: pageW, align: "center" });
    doc.opacity(1).restore();

    // Header
    center("Certificate of Completion", 86, 32, { font: "Helvetica-Bold", color: INK });
    center("Eritrean Success Journey", 128, 12, { color: SOFT });
    hr(156);

    // Quote (short + elegant)
    doc.fillColor(SOFT).font("Helvetica-Oblique").fontSize(11);
    doc.text(`“${INSPIRING_QUOTE}”`, 110, 174, {
      width: pageW - 220,
      align: "center"
    });

    // Body
    center("This certificate is proudly presented to", 230, 13, { color: SOFT });

    // Student name + optional suffix
    const nameLine = OFFICIAL_SUFFIX_ENABLED
      ? `${clamp(userName, 44)} — Officially Certified`
      : clamp(userName, 52);

    doc.fillColor(INK).font("Helvetica-Bold").fontSize(34);
    doc.text(nameLine, 0, 258, { width: pageW, align: "center" });

    center("for successfully completing the course:", 320, 12, { color: SOFT });

    doc.fillColor(INK).font("Helvetica-Bold").fontSize(20);
    doc.text(clamp(courseTitle, 62), 0, 345, { width: pageW, align: "center" });

    hr(390, "#E5D7A8");

    // Seal (kept below text so it doesn't block)
    const sealX = pageW / 2;
    const sealY = 440;
    doc.save();
    doc.circle(sealX, sealY, 40).fill("#FFF7ED");
    doc.circle(sealX, sealY, 40).lineWidth(2).strokeColor(GOLD).stroke();
    doc.circle(sealX, sealY, 32).lineWidth(1).strokeColor("#F59E0B").dash(2, { space: 2 }).stroke().undash();
    doc.fillColor(GOLD_DARK).font("Helvetica-Bold").fontSize(10);
    doc.text("CERTIFIED", sealX - 34, sealY - 5, { width: 68, align: "center" });
    doc.restore();

    // Info lines
    const issuedStr = fmtDate(cert.issued_at);
    doc.fillColor(SOFT).font("Helvetica").fontSize(10);
    doc.text(`Issued on: ${issuedStr}`, 0, 492, { width: pageW, align: "center" });
    doc.text(`Certificate ID: ${cert.id}`, 0, 508, { width: pageW, align: "center" });

    // Signatures area
    const sigY = 560;

    // Founder signature image (transparent PNG)
    const sigExists = fs.existsSync(SIGNATURE_PATH);
    if (sigExists) {
      try {
        const sigBuf = fs.readFileSync(SIGNATURE_PATH);
        // left signature image
        doc.image(sigBuf, 105, sigY - 22, { width: 180 });
      } catch (e) {
        console.warn("Signature image load failed:", e.message);
      }
    }

    // Signature lines + labels
    doc.save();
    doc.strokeColor("#9CA3AF").lineWidth(1);

    // left block
    doc.moveTo(95, sigY + 20).lineTo(305, sigY + 20).stroke();
    doc.fillColor(SOFT).font("Helvetica").fontSize(9);
    doc.text(FOUNDER_TITLE, 95, sigY + 26, { width: 210, align: "center" });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10);
    doc.text(FOUNDER_NAME, 95, sigY + 40, { width: 210, align: "center" });

    // right block
    doc.moveTo(pageW - 305, sigY + 20).lineTo(pageW - 95, sigY + 20).stroke();
    doc.fillColor(SOFT).font("Helvetica").fontSize(9);
    doc.text("Authorized by", pageW - 305, sigY + 26, { width: 210, align: "center" });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10);
    doc.text(PROGRAM_TEAM, pageW - 305, sigY + 40, { width: 210, align: "center" });

    doc.restore();

    // QR + verify link (kept high enough so NO 2nd page)
    const qrPng = await QRCode.toBuffer(verifyUrl, { type: "png", margin: 1, scale: 6 });

    const qrSize = 84;
    const qrX = pageW / 2 - qrSize / 2;
    const qrY = 645; // ✅ safe on one page

    doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });

    doc.fillColor(SOFT).font("Helvetica").fontSize(8);
    doc.text("Scan to verify", 0, qrY + qrSize + 6, { width: pageW, align: "center" });

    // IMPORTANT: keep this above ~800 to avoid page 2
    doc.fillColor("#2563EB").font("Helvetica").fontSize(8);
    doc.text(verifyUrl, 0, qrY + qrSize + 18, {
      width: pageW,
      align: "center",
      link: verifyUrl,
      underline: true
    });

    // Footer
    doc.fillColor("#9CA3AF").font("Helvetica").fontSize(9);
    doc.text("© Eritrean Success Journey", 0, 790, { width: pageW, align: "center" });

    // ✅ END (must be last)
    doc.end();
  } catch (e) {
    console.error("CERT PDF ERROR:", e);
    // If headers were already sent, just end the response safely
    if (res.headersSent) return res.end();
    return res.status(500).json({ error: "Server error generating certificate PDF" });
  }
});

/* =========================
   PUBLIC VERIFY JSON
========================= */

router.get("/verify/:id.json", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: "Invalid id" });

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

    if (!r.rows.length) return res.status(404).json({ ok: false, error: "Not found" });

    const row = r.rows[0];
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

/* =========================
   PUBLIC VERIFY HTML
========================= */

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
<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Certificate Verification</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:40px;color:#111827">
  <h2>Certificate not found</h2>
  <p>This certificate ID does not exist.</p>
</body></html>`);
    }

    const row = certRes.rows[0];
    const student = row.user_name || "Student";
    const courseTitle = row.course_title || row.course_id;
    const issued = fmtDate(row.issued_at);

    const base = publicBase(req);

    return res.send(`<!doctype html>
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
    .footer{margin-top:18px;font-size:12px;color:#6b7280}
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
</html>`);
  } catch (e) {
    console.error("CERT VERIFY HTML ERROR:", e);
    return res.status(500).send("Server error");
  }
});

module.exports = router;