// backend/routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const { query } = require("../db_pg");

const router = express.Router();

/** Normalize email */
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/** Better email check (still lightweight) */
function isValidEmail(email) {
  const e = normalizeEmail(email);
  // very basic: something@something.something
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/** Build full display name safely */
function buildFullName(firstName, lastName) {
  return [String(firstName || "").trim(), String(lastName || "").trim()]
    .filter(Boolean)
    .join(" ");
}

/**
 * Convert DB row -> session user object
 * IMPORTANT: include `role` (frontend uses role === "admin")
 */
function safeUserRowToSessionUser(row) {
  const role = String(row?.role || "student").toLowerCase();
  const isAdmin = role === "admin";

  return {
    id: row.id,
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    name: row.name || buildFullName(row.first_name, row.last_name) || "",
    email: row.email || "",
    role,
    isAdmin,
  };
}

/** Promisified session helpers */
function sessionRegenerate(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function sessionSave(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * POST /api/auth/register
 * Creates a user and logs them in immediately
 */
router.post("/register", async (req, res) => {
  try {
    const first_name = String(req.body?.first_name || "").trim();
    const last_name = String(req.body?.last_name || "").trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!first_name || !last_name) {
      return res.status(400).json({ error: "First and last name are required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const existing = await query("SELECT id FROM users WHERE email=$1", [email]);
    if (existing.rows.length) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const name = `${first_name} ${last_name}`.trim();

    const ins = await query(
      `INSERT INTO users (name, first_name, last_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, first_name, last_name, email, role`,
      [name, first_name, last_name, email, passwordHash, "student"]
    );

    const userRow = ins.rows[0];

    await sessionRegenerate(req);
    req.session.user = safeUserRowToSessionUser(userRow);
    await sessionSave(req);

    return res.json({ user: req.session.user });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/auth/login
 */
router.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!isValidEmail(email)) return res.status(400).json({ error: "Valid email is required" });
    if (!password) return res.status(400).json({ error: "Password is required" });

    const r = await query(
      `SELECT id, name, first_name, last_name, email, password_hash, role
       FROM users
       WHERE email=$1`,
      [email]
    );

    if (!r.rows.length) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const userRow = r.rows[0];
    const ok = await bcrypt.compare(password, userRow.password_hash || "");
    if (!ok) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    await sessionRegenerate(req);
    req.session.user = safeUserRowToSessionUser(userRow);
    await sessionSave(req);

    return res.json({ user: req.session.user });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/auth/logout
 */
router.post("/logout", (req, res) => {
  try {
    req.session.destroy(() => {
      // Most express-session setups use "connect.sid" by default.
      // If you configured a custom name, replace this with that name.
      res.clearCookie("connect.sid");
      return res.json({ ok: true });
    });
  } catch (err) {
    console.error("LOGOUT ERROR:", err);
    return res.json({ ok: true });
  }
});

/**
 * GET /api/auth/me
 */
router.get("/me", (req, res) => {
  const user = req.session?.user;
  return res.json({ user: user || null });
});

module.exports = router;