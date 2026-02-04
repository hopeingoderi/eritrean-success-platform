// backend/middleware/auth.js
// Session-based auth middleware

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Not logged in" });
  }
  req.user = req.session.user;
    next();
}

function requireAdmin(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  // Your session stores: { id, name, email, isAdmin }
  if (!req.session.user.isAdmin) {
    return res.status(403).json({ error: "Admin only" });
  }

  next();
}

module.exports = { requireAuth, requireAdmin };
