// backend/routes/certificates.js

const express = require("express");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { query } = require("../db_pg");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /api/certificates/:courseId/pdf
 * Generates & downloads certificate PDF
 */
router.get("/:courseId/pdf", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { courseId } = req.params;

    // --------------------------------------------------
    // 1. Validate user & course
    // --------------------------------------------------
    const userRes = await query(
      "SELECT name FROM users WHERE id = $1",
      [userId]
    );

    if (userRes.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const courseRes = await query(
      "SELECT title_en FROM courses WHERE id = $1",
      [courseId]
    );

    if (courseRes.rowCount === 0) {
      return res.status(404).json({ error: "Course not found" });
    }

    const userName = userRes.rows[0].name;
    const courseTitle = courseRes.rows[0].title_en;

    // --------------------------------------------------
    // 2. Ensure certificate exists (idempotent)
    // --------------------------------------------------
    const certRes = await query(
      `INSERT INTO certificates (user_id, course_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, course_id)
       DO UPDATE SET issued_at = NOW()
       RETURNING id, issued_at`,
      [userId, courseId]
    );

    const certId = certRes.rows[0].id;
    const issuedAt = certRes.rows[0].issued_at;

    // --------------------------------------------------
    // 3. Headers (IMPORTANT)
    // --------------------------------------------------
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=certificate-${courseId}.pdf`
    );

    // --------------------------------------------------
    // 4. Create PDF
    // --------------------------------------------------
    const doc = new PDFDocument({
      size: "A4",
      margin: 50
    });

    doc.pipe(res);

    const pageW = doc.page.width;
    const pageH = doc.page.height;

    // --------------------------------------------------
    // 5. Helpers
    // --------------------------------------------------
    const center = (text, y, size = 20) => {
      doc.fontSize(size).text(text, 0, y, {
        width: pageW,
        align: "center"
      });
    };

    // --------------------------------------------------
    // 6. Border (Premium but safe)
    // --------------------------------------------------
    doc
      .rect(20, 20, pageW - 40, pageH - 40)
      .lineWidth(2)
      .stroke("#C9A24D");

    // --------------------------------------------------
    // 7. Content
    // --------------------------------------------------
    center("Certificate of Completion", 120, 32);

    doc.moveDown(1);
    center("Eritrean Success Journey", doc.y, 14);

    doc.moveDown(2);
    center("This certificate is proudly presented to", doc.y, 14);

    doc.moveDown(1);
    center(userName, doc.y, 28);

    doc.moveDown(2);
    center("for successfully completing the course:", doc.y, 14);

    doc.moveDown(1);
    center(courseTitle, doc.y, 22);

    doc.moveDown(3);
    center(
      `Issued on: ${new Date(issuedAt).toDateString()}`,
      doc.y,
      11
    );

    center(`Certificate ID: ${certId}`, doc.y + 15, 10);

    // --------------------------------------------------
    // 8. QR Code (SAFE async handling)
    // --------------------------------------------------
    const verifyUrl = `${process.env.PUBLIC_API_BASE}/certificates/verify/${certId}`;

    const qrBuffer = await QRCode.toBuffer(verifyUrl);

    doc.image(qrBuffer, pageW / 2 - 40, pageH - 200, {
      width: 80
    });

    doc.fontSize(9).text(
      "Scan to verify certificate",
      pageW / 2 - 60,
      pageH - 110,
      { width: 120, align: "center" }
    );

    // --------------------------------------------------
    // 9. Finish
    // --------------------------------------------------
    doc.end();
  } catch (err) {
    console.error("CERTIFICATE PDF ERROR:", err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Server error generating certificate PDF"
      });
    }
  }
});

module.exports = router;