// backend/routes/certificates.js
//
// Production-safe Certificates endpoints (works on Render)
// - Claim certificate (idempotent)
// - Status endpoint for UI
// - Generate premium-looking PDF (no external fonts/images required)
// - Public verify endpoint (QR target)
//
// Mount in server.js:
//   app.use("/api/certificates", require("./routes/certificates"));

const express = require("express");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/* ----------------------------- helpers ----------------------------- */

function safeCourseId(raw) {
  return String(raw || "").trim().toLowerCase();
}

function formatIssuedDate(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  // Example: Wed Jan 21 2026
  return d.toDateString();
}

async function getUserDisplayName(userId) {
  // Try to be resilient across different schemas
  const r = await query(
    `
    SELECT
      COALESCE(
        NULLIF(name, ''),
        NULLIF(full_name, ''),
        NULLIF(username, ''),
        NULLIF(email, ''),
        'Student'
      ) AS display_name
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [userId]
  );

  return r.rows?.[0]?.display_name || "Student";
}

async function getCourseTitle(courseId) {
  const r = await query(
    `
    SELECT
      COALESCE(
        NULLIF(title_en, ''),
        NULLIF(title, ''),
        NULLIF(name, ''),
        $1
      ) AS title
    FROM courses
    WHERE id = $1
    LIMIT 1
    `,
    [courseId]
  );

  return r.rows?.[0]?.title || courseId;
}

async function getOrCreateCertificate(userId, courseId) {
  // 1) check existing
  const existing = await query(
    `SELECT id, user_id, course_id, issued_at
     FROM certificates
     WHERE user_id = $1 AND course_id = $2
     LIMIT 1`,
    [userId, courseId]
  );

  if (existing.rows.length) return existing.rows[0];

  // 2) create new
  const inserted = await query(
    `INSERT INTO certificates (user_id, course_id, issued_at)
     VALUES ($1, $2, NOW())
     RETURNING id, user_id, course_id, issued_at`,
    [userId, courseId]
  );

  return inserted.rows[0];
}

async function buildVerifyUrl(certId) {
  // Set this in Render env if you want:
  // PUBLIC_BASE_URL=https://api.riseeritrea.com
  const base = (process.env.PUBLIC_BASE_URL || "https://api.riseeritrea.com").replace(/\/+$/, "");
  return `${base}/api/certificates/verify/${certId}`;
}

/* ----------------------------- routes ----------------------------- */

// UI helper: check if certificate exists / can be claimed
router.get("/:courseId/status", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id;

    const cert = await query(
      `SELECT id, issued_at
       FROM certificates
       WHERE user_id = $1 AND course_id = $2
       LIMIT 1`,
      [userId, courseId]
    );

    res.json({
      ok: true,
      course_id: courseId,
      claimed: cert.rows.length > 0,
      certificate_id: cert.rows[0]?.id ?? null,
      issued_at: cert.rows[0]?.issued_at ?? null,
    });
  } catch (err) {
    console.error("CERT STATUS ERROR:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Idempotent claim (creates certificate row if missing)
router.post("/:courseId/claim", requireAuth, async (req, res) => {
  try {
    const courseId = safeCourseId(req.params.courseId);
    const userId = req.user?.id;

    const cert = await getOrCreateCertificate(userId, courseId);

    res.json({
      ok: true,
      claimed: true,
      certificate_id: cert.id,
      issued_at: cert.issued_at,
      course_id: cert.course_id,
    });
  } catch (err) {
    console.error("CERT CLAIM ERROR:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// Premium PDF (no external assets, so it’s stable on Render)
router.get("/:courseId/pdf", requireAuth, async (req, res) => {
  const courseId = safeCourseId(req.params.courseId);
  const userId = req.user?.id;

  try {
    // Make sure certificate exists
    const cert = await getOrCreateCertificate(userId, courseId);

    // Data
    const userName = await getUserDisplayName(userId);
    const courseTitle = await getCourseTitle(courseId);
    const issuedAt = cert.issued_at ? new Date(cert.issued_at) : new Date();
    const issuedText = formatIssuedDate(issuedAt);

    // Verify URL + QR (QR optional; if it fails we still generate PDF)
    const verifyUrl = await buildVerifyUrl(cert.id);

    let qrDataUrl = null;
    try {
      qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, scale: 6 });
    } catch (qrErr) {
      console.warn("QR generation failed (continuing):", qrErr.message);
    }

    // Headers BEFORE streaming
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="certificate-${courseId}.pdf"`
    );

    // PDF
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    doc.pipe(res);

    const pageW = doc.page.width;
    const pageH = doc.page.height;

    // --- Colors (use rgb to avoid any edge issues)
    const gold = "#B88A2B";
    const dark = "#1A1A1A";
    const soft = "#666666";
    const paper = "#FBFAF7";

    // Background
    doc.save();
    doc.rect(0, 0, pageW, pageH).fill(paper);
    doc.restore();

    // Double border (premium look)
    doc.save();
    doc.lineWidth(3).strokeColor(gold).rect(22, 22, pageW - 44, pageH - 44).stroke();
    doc.lineWidth(1).strokeColor("#222").rect(32, 32, pageW - 64, pageH - 64).stroke();
    doc.restore();

    // Header ornaments
    doc.save();
    doc.lineWidth(1).strokeColor(gold);
    doc.moveTo(70, 110).lineTo(pageW - 70, 110).stroke();
    doc.moveTo(70, 118).lineTo(pageW - 70, 118).stroke();
    doc.restore();

    // Title
    doc
      .font("Helvetica-Bold")
      .fillColor(dark)
      .fontSize(36)
      .text("Certificate of Completion", 0, 150, { align: "center" });

    // Org
    doc
      .font("Helvetica")
      .fillColor(soft)
      .fontSize(13)
      .text("Eritrean Success Journey", 0, 205, { align: "center" });

    // Body text
    doc
      .font("Helvetica")
      .fillColor(dark)
      .fontSize(14)
      .text("This certificate is proudly presented to", 0, 265, { align: "center" });

    // Name (big)
    doc
      .font("Helvetica-Bold")
      .fillColor(dark)
      .fontSize(44)
      .text(userName, 0, 300, { align: "center" });

    // Course line
    doc
      .font("Helvetica")
      .fillColor(dark)
      .fontSize(14)
      .text("for successfully completing the course:", 0, 380, { align: "center" });

    doc
      .font("Helvetica-Bold")
      .fillColor(dark)
      .fontSize(26)
      .text(courseTitle, 0, 410, { align: "center" });

    // Footer details
    doc
      .font("Helvetica")
      .fillColor(soft)
      .fontSize(11)
      .text(`Issued on: ${issuedText}`, 0, 520, { align: "center" });

    doc
      .font("Helvetica")
      .fillColor(soft)
      .fontSize(11)
      .text(`Certificate ID: ${cert.id}`, 0, 540, { align: "center" });

    // Signature lines (simple + clean)
    const sigY = 610;
    doc.save();
    doc.strokeColor("#333").lineWidth(1);
    doc.moveTo(110, sigY).lineTo(280, sigY).stroke();
    doc.moveTo(pageW - 280, sigY).lineTo(pageW - 110, sigY).stroke();
    doc.restore();

    doc
      .font("Helvetica")
      .fillColor(soft)
      .fontSize(10)
      .text("Program Director", 110, sigY + 8, { width: 170, align: "center" });

    doc
      .font("Helvetica")
      .fillColor(soft)
      .fontSize(10)
      .text("Instructor", pageW - 280, sigY + 8, { width: 170, align: "center" });

    // QR block (bottom-right)
    if (qrDataUrl) {
      try {
        const qrX = pageW - 160;
        const qrY = pageH - 190;

        // subtle frame
        doc.save();
        doc.lineWidth(1).strokeColor(gold).rect(qrX - 8, qrY - 8, 120 + 16, 120 + 16).stroke();
        doc.restore();

        const base64 = qrDataUrl.split(",")[1];
        const qrBuf = Buffer.from(base64, "base64");
        doc.image(qrBuf, qrX, qrY, { width: 120, height: 120 });

        doc
          .font("Helvetica")
          .fillColor(soft)
          .fontSize(8)
          .text("Verify", qrX, qrY + 125, { width: 120, align: "center" });
      } catch (imgErr) {
        console.warn("QR image embedding failed (continuing):", imgErr.message);
      }
    }

    // Verify URL small at bottom
    doc
      .font("Helvetica")
      .fillColor("#777")
      .fontSize(8)
      .text(verifyUrl, 0, pageH - 60, { align: "center" });

    doc.end();
  } catch (err) {
    console.error("CERT PDF ERROR:", err);
    // IMPORTANT: if headers already sent, just end.
    if (!res.headersSent) {
      res.status(500).json({ error: "Server error generating certificate PDF", details: err.message });
    } else {
      try {
        res.end();
      } catch (_) {}
    }
  }
});

// Public verify endpoint (QR target)
router.get("/verify/:certificateId", async (req, res) => {
  try {
    const certId = Number(req.params.certificateId);
    if (!Number.isFinite(certId)) return res.status(400).send("Invalid certificate id");

    const r = await query(
      `
      SELECT c.id, c.issued_at, c.course_id,
             COALESCE(u.name, u.full_name, u.username, u.email, 'Student') AS user_name,
             COALESCE(co.title_en, co.title, co.name, c.course_id) AS course_title
      FROM certificates c
      JOIN users u ON u.id = c.user_id
      LEFT JOIN courses co ON co.id = c.course_id
      WHERE c.id = $1
      LIMIT 1
      `,
      [certId]
    );

    if (!r.rows.length) {
      return res.status(404).send("Certificate not found");
    }

    const row = r.rows[0];

    // Simple verification page (no frontend dependency)
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Certificate Verification</title>
        <style>
          body{font-family:system-ui,Segoe UI,Arial; background:#0f172a; color:#e2e8f0; margin:0; padding:40px;}
          .card{max-width:720px; margin:0 auto; background:#111827; border:1px solid rgba(255,255,255,.08);
                border-radius:14px; padding:24px;}
          h1{margin:0 0 12px; font-size:22px;}
          .ok{display:inline-block; padding:6px 10px; border-radius:999px; background:rgba(34,197,94,.15); color:#22c55e;
              border:1px solid rgba(34,197,94,.35); font-weight:600; font-size:12px;}
          .row{margin-top:16px; display:grid; grid-template-columns:140px 1fr; gap:10px;}
          .k{color:#94a3b8;}
          .v{color:#e2e8f0; font-weight:600;}
          .small{color:#94a3b8; font-size:12px; margin-top:14px;}
        </style>
      </head>
      <body>
        <div class="card">
          <div class="ok">Verified ✓</div>
          <h1>Certificate Verification</h1>
          <div class="row"><div class="k">Certificate ID</div><div class="v">${row.id}</div></div>
          <div class="row"><div class="k">Name</div><div class="v">${escapeHtml(row.user_name)}</div></div>
          <div class="row"><div class="k">Course</div><div class="v">${escapeHtml(row.course_title)}</div></div>
          <div class="row"><div class="k">Issued</div><div class="v">${escapeHtml(formatIssuedDate(row.issued_at))}</div></div>
          <div class="small">This page confirms the certificate exists in our system.</div>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("CERT VERIFY ERROR:", err);
    res.status(500).send("Server error");
  }
});

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

module.exports = router;