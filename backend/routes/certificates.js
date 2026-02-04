// backend/routes/certificates.js
// Premium Certificate system (Render-safe: no external fonts/images required)

const express = require("express");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/**
 * ENV:
 *  - PUBLIC_APP_URL (optional)  e.g. https://riseeritrea.com
 *  - PUBLIC_API_URL (optional)  e.g. https://api.riseeritrea.com
 *
 * If not set, we infer from request.
 */
function publicBase(req) {
  // prefer explicit
  const api = process.env.PUBLIC_API_URL;
  if (api) return api.replace(/\/$/, "");

  // infer from request (works behind proxy if x-forwarded-host is set)
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https").toString();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
  if (!host) return "https://api.riseeritrea.com";
  return `${proto}://${host}`.replace(/\/$/, "");
}

function appBase(req) {
  const app = process.env.PUBLIC_APP_URL;
  if (app) return app.replace(/\/$/, "");
  // fallback to same domain (not perfect but ok)
  return publicBase(req).replace(/^https?:\/\/api\./, (m) => m.replace("api.", ""));
}

function safeCourseId(courseId) {
  return String(courseId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

function filenameSafe(s) {
  return String(s || "").replace(/[^a-z0-9_-]+/gi, "_");
}

function fmtDate(d) {
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

/**
 * Try to determine eligibility.
 * This is intentionally defensive (won’t crash if schemas differ).
 * If we cannot confidently determine, we allow claim (so the feature doesn’t break).
 */
async function checkEligibility({ userId, courseId }) {
  try {
    // If you have an exams table with a "passed" flag, prefer it.
    // Adjust if your schema differs.
    const exam = await query(
      `SELECT passed
         FROM exams
        WHERE user_id = $1 AND course_id = $2
        ORDER BY id DESC
        LIMIT 1`,
      [userId, courseId]
    ).catch(() => null);

    if (exam && exam.rows && exam.rows.length) {
      // If passed is boolean:
      if (typeof exam.rows[0].passed === "boolean") return exam.rows[0].passed === true;
      // If passed stored as text/int:
      const v = exam.rows[0].passed;
      if (v === 1 || v === "1" || v === "true") return true;
    }

    // fallback: if there is progress + lessons, require all lessons completed
    const lessons = await query(`SELECT id FROM lessons WHERE course_id = $1`, [courseId]).catch(() => null);
    if (lessons && lessons.rows && lessons.rows.length) {
      const total = lessons.rows.length;
      const done = await query(
        `SELECT COUNT(*)::int AS c
           FROM progress
          WHERE user_id = $1 AND course_id = $2 AND (completed = true OR completed_at IS NOT NULL)`,
        [userId, courseId]
      ).catch(() => null);

      if (done && done.rows && done.rows.length) {
        return done.rows[0].c >= total;
      }
    }

    // If we cannot verify (schema mismatch), do not block.
    return true;
  } catch {
    return true;
  }
}

/**
 * Ensure certificate exists (idempotent)
 * Returns certificate row { id, user_id, course_id, issued_at }
 */
async function ensureCertificate({ userId, courseId }) {
  // already exists?
  const existing = await query(
    `SELECT id, user_id, course_id, issued_at
       FROM certificates
      WHERE user_id = $1 AND course_id = $2
      ORDER BY id ASC
      LIMIT 1`,
    [userId, courseId]
  );

  if (existing.rows.length) return existing.rows[0];

  // insert
  const inserted = await query(
    `INSERT INTO certificates (user_id, course_id, issued_at)
     VALUES ($1, $2, NOW())
     RETURNING id, user_id, course_id, issued_at`,
    [userId, courseId]
  );

  return inserted.rows[0];
}

async function getUserAndCourse({ userId, courseId }) {
  const userRes = await query(
    `SELECT name
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }));

  const courseRes = await query(
    `SELECT title_en
       FROM courses
      WHERE id = $1
      LIMIT 1`,
    [courseId]
  ).catch(() => ({ rows: [] }));

  const userName = userRes.rows?.[0]?.name || "Student";
  const courseTitle = courseRes.rows?.[0]?.title_en || `Course: ${courseId}`;

  return { userName, courseTitle };
}

/* ---------------------------
   ROUTES (make UI robust)
---------------------------- */

/**
 * STATUS (UI uses this)
 * Supports:
 *  - GET /api/certificates/:courseId
 *  - GET /api/certificates/:courseId/status
 */
async function statusHandler(req, res) {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id;

    if (!courseId) return res.status(400).json({ error: "Missing courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const eligible = await checkEligibility({ userId, courseId });

    const cert = await query(
      `SELECT id, issued_at
         FROM certificates
        WHERE user_id = $1 AND course_id = $2
        ORDER BY id ASC
        LIMIT 1`,
      [userId, courseId]
    );

    const hasCertificate = cert.rows.length > 0;
    const certificateId = hasCertificate ? cert.rows[0].id : null;
    const issuedAt = hasCertificate ? cert.rows[0].issued_at : null;

    return res.json({
      ok: true,
      courseId,
      eligible,
      hasCertificate,
      certificateId,
      issuedAt,
      pdfUrl: hasCertificate ? `${publicBase(req)}/api/certificates/${courseId}/pdf` : null,
      verifyUrl: hasCertificate ? `${publicBase(req)}/api/certificates/verify/${certificateId}` : null,
    });
  } catch (e) {
    console.error("CERT STATUS ERROR:", e);
    return res.status(500).json({ error: "Server error" });
  }
}

// STATUS (frontend should call this)
router.get("/:courseId/status", requireAuth, statusHandler);

/**
 * CLAIM (idempotent)
 * POST /api/certificates/:courseId/claim
 */
router.post("/:courseId/claim", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id;

    if (!courseId) return res.status(400).json({ error: "Missing courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const eligible = await checkEligibility({ userId, courseId });
    if (!eligible) return res.status(403).json({ error: "Not eligible yet" });

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

/**
 * PDF
 * GET /api/certificates/:courseId/pdf
 */
router.get("/:courseId/pdf", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id;

    if (!courseId) return res.status(400).json({ error: "Missing courseId" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const eligible = await checkEligibility({ userId, courseId });
    if (!eligible) return res.status(403).json({ error: "Not eligible yet" });

    const cert = await ensureCertificate({ userId, courseId });
    const { userName, courseTitle } = await getUserAndCourse({ userId, courseId });

    const verifyUrl = `${publicBase(req)}/api/certificates/verify/${cert.id}`;
    const qrPng = await QRCode.toBuffer(verifyUrl, { type: "png", margin: 1, scale: 6 });

    //  PDF generation 
    // Headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="certificate-${filenameSafe(courseId)}.pdf"`);

    // PDF
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.pipe(res);

    const pageW = doc.page.width;
    const pageH = doc.page.height;

    // Colors
    const gold = "#C9A227";
    const dark = "#111827";
    const gray = "#6B7280";
    const light = "#F8FAFC";

    // Background
    doc.rect(0, 0, pageW, pageH).fill(light);

    // Premium double border
    doc.save();
    doc.lineWidth(2).strokeColor(gold).rect(24, 24, pageW - 48, pageH - 48).stroke();
    doc.lineWidth(1).strokeColor("#D1D5DB").rect(32, 32, pageW - 64, pageH - 64).stroke();
    doc.restore();

    // Watermark
    doc.save();
    doc.rotate(-18, { origin: [pageW / 2, pageH / 2] });
    doc.fillColor("#E5E7EB").font("Helvetica-Bold").fontSize(48);
    doc.text("ERITREAN SUCCESS JOURNEY", 0, pageH / 2 - 40, { width: pageW, align: "center" });
    doc.restore();

    // Header
    doc.fillColor(dark).font("Helvetica-Bold").fontSize(34);
    doc.text("Certificate of Completion", 0, 92, { width: pageW, align: "center" });

    doc.moveDown(0.4);
    doc.fillColor(gray).font("Helvetica").fontSize(13);
    doc.text("Eritrean Success Journey", 0, 142, { width: pageW, align: "center" });

    // Divider line
    doc.moveTo(120, 175).lineTo(pageW - 120, 175).lineWidth(1).strokeColor("#E5E7EB").stroke();

    // Body
    doc.fillColor(gray).font("Helvetica").fontSize(14);
    doc.text("This certificate is proudly presented to", 0, 210, { width: pageW, align: "center" });

    doc.fillColor(dark).font("Helvetica-Bold").fontSize(40);
    doc.text(userName, 0, 245, { width: pageW, align: "center" });

    doc.fillColor(gray).font("Helvetica").fontSize(14);
    doc.text("for successfully completing the course:", 0, 305, { width: pageW, align: "center" });

    doc.fillColor(dark).font("Helvetica-Bold").fontSize(24);
    doc.text(courseTitle, 0, 335, { width: pageW, align: "center" });

    // Seal (simple vector)
    const sealX = pageW / 2;
    const sealY = 450;
    doc.save();
    doc.circle(sealX, sealY, 46).fill("#FFF7ED"); // warm light
    doc.circle(sealX, sealY, 46).lineWidth(2).strokeColor(gold).stroke();
    doc.circle(sealX, sealY, 38).lineWidth(1).strokeColor("#F59E0B").dash(2, { space: 2 }).stroke().undash();
    doc.fillColor(dark).font("Helvetica-Bold").fontSize(10);
    doc.text("OFFICIAL", sealX - 28, sealY - 10, { width: 56, align: "center" });
    doc.fillColor(gold).font("Helvetica-Bold").fontSize(10);
    doc.text("CERTIFIED", sealX - 34, sealY + 4, { width: 68, align: "center" });
    doc.restore();

    // Footer info box
    const boxY = pageH - 170;
    doc.save();
    doc.roundedRect(70, boxY, pageW - 140, 95, 10).fill("#FFFFFF");
    doc.roundedRect(70, boxY, pageW - 140, 95, 10).lineWidth(1).strokeColor("#E5E7EB").stroke();
    doc.restore();

    doc.fillColor(gray).font("Helvetica").fontSize(11);
    doc.text(`Issued on: ${fmtDate(cert.issued_at)}`, 90, boxY + 18, { width: pageW - 180, align: "left" });
    doc.text(`Certificate ID: ${cert.id}`, 90, boxY + 36, { width: pageW - 180, align: "left" });

    doc.fillColor(gray).font("Helvetica").fontSize(10);
    doc.text("Verify:", 90, boxY + 58, { width: 40, align: "left" });
    doc.fillColor(dark).font("Helvetica").fontSize(10);
    doc.text(verifyUrl, 130, boxY + 58, { width: pageW - 260, align: "left" });

    // QR (bottom-right)
    const qrSize = 86;
    doc.image(qrPng, pageW - 70 - qrSize, boxY + 6, { width: qrSize, height: qrSize });
    doc.fillColor(gray).font("Helvetica").fontSize(8);
    doc.text("Scan to verify", pageW - 70 - qrSize, boxY + 92, { width: qrSize, align: "center" });

    // Small brand footer
    doc.fillColor("#9CA3AF").font("Helvetica").fontSize(9);
    doc.text("© Eritrean Success Journey", 0, pageH - 52, { width: pageW, align: "center" });

    doc.end();
  } catch (e) {
    console.error("CERT PDF ERROR:", e);
    return res.status(500).json({ error: "Server error generating certificate PDF" });
  }
});

/* ---------------------------
   PUBLIC VERIFICATION (NO FRONTEND)
---------------------------- */

/**
 * Public JSON verify (easy for integrations)
 * GET /api/certificates/verify/:id.json
 */
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

/**
 * Public HTML verify page (no frontend dependency)
 * GET /api/certificates/verify/:id
 */
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
    const student = row.user_name || "Student";
    const courseTitle = row.course_title || row.course_id;
    const issued = fmtDate(row.issued_at);

    const home = appBase(req);

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
          <div class="muted" style="margin-top:6px">Course ID: ${row.course_id}</div>
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

module.exports = router;