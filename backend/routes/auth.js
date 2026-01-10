const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { query } = require("../db_pg");

const router = express.Router();

router.post("/register", async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  const { name, email, password } = parsed.data;

  const exists = await query("SELECT id FROM users WHERE email=$1", [email]);
  if (exists.rows.length) return res.status(409).json({ error: "Email already used" });

  const hash = bcrypt.hashSync(password, 10);
  const r = await query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role",
    [name, email, hash, "student"]
  );

  req.session.user = {
  id: r.rows[0].id,
  role: "admin"
};
  res.json({ user: req.session.user });
});

router.post("/login", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const { email, password } = parsed.data;
  const r = await query("SELECT id, name, email, password_hash, role FROM users WHERE email=$1", [email]);
  if (!r.rows.length) return res.status(401).json({ error: "Invalid email or password" });

  const u = r.rows[0];
  const ok = bcrypt.compareSync(password, u.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });

  req.session.user = { id: u.id, name: u.name, email: u.email, role: u.role };
  res.json({ user: req.session.user });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get("/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

module.exports = router;

