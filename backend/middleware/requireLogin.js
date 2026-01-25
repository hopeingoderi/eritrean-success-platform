// backend/middleware/requireLogin.js
// Alias middleware (same as requireAuth) — useful if some routes use a different name

function requireLogin(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Not logged in" });
  }
  next();
}

module.exports = { requireLogin };
