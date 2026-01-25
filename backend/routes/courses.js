// backend/routes/courses.js
"use strict";

const express = require("express");
const { query } = require("../db_pg");

const router = express.Router();

/**
 * GET /api/courses?lang=en|ti
 * Public: returns list of courses (localized)
 */
router.get("/", async (req, res) => {
  try {
    const lang = req.query.lang === "ti" ? "ti" : "en";

    const r = await query(
      `SELECT id, title_en, title_ti, intro_en, intro_ti
       FROM courses
       ORDER BY id`
    );

    // Optional caching for public content (adjust as you like)
    // res.set("Cache-Control", "public, max-age=60");

    return res.json({
      courses: r.rows.map((x) => ({
        id: x.id,
        title: lang === "ti" ? x.title_ti : x.title_en,
        intro: lang === "ti" ? x.intro_ti : x.intro_en
      }))
    });
  } catch (err) {
    console.error("COURSES LIST ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
