const express = require("express");
const { query } = require("../db_pg");

const r = await query(`
  SELECT id, title_en, title_ti, description_en, description_ti
  FROM courses
  ORDER BY CASE id
    WHEN 'foundation' THEN 1
    WHEN 'growth' THEN 2
    WHEN 'excellence' THEN 3
    ELSE 99
  END
`);

router.get("/", async (req, res) => {
  const lang = (req.query.lang === "ti") ? "ti" : "en";
  const r = await query("SELECT * FROM courses ORDER BY id");
  const rows = r.rows;

  res.json({
    courses: rows.map(x => ({
      id: x.id,
      title: lang === "ti" ? x.title_ti : x.title_en,
      intro: lang === "ti" ? x.intro_ti : x.intro_en
    }))
  });
});

module.exports = router;

