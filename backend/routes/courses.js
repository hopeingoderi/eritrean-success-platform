// backend/routes/courses.js
const express = require("express");
const { query } = require("../db_pg");

const router = express.Router();

function sortRank(id) {
  if (id === "foundation") return 1;
  if (id === "growth") return 2;
  if (id === "excellence") return 3;
  return 99;
}

router.get("/", async (req, res) => {
  const lang = req.query.lang === "ti" ? "ti" : "en";

  try {
    // Try multilingual description columns first (description_en / description_ti)
    const r = await query(
      `
      SELECT
        id,
        title_${lang} AS title,
        description_${lang} AS description
      FROM courses
      `,
      []
    );

    const courses = (r.rows || []).sort((a, b) => sortRank(a.id) - sortRank(b.id));
    return res.json({ courses });
  } catch (err) {
    // If description_en does not exist, fall back to a single "description" column
    // (Postgres undefined_column error code is 42703)
    if (err && err.code === "42703") {
      try {
        const r2 = await query(
          `
          SELECT
            id,
            title_${lang} AS title,
            description AS description
          FROM courses
          `,
          []
        );
        const courses = (r2.rows || []).sort((a, b) => sortRank(a.id) - sortRank(b.id));
        return res.json({ courses });
      } catch (err2) {
        console.error("COURSES ERROR (fallback):", err2);
        return res.status(500).json({ error: "Server error" });
      }
    }

    console.error("COURSES ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
