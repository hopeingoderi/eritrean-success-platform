// backend/middleware/auth.js
// Session-based auth middleware
function requireAuth(req, res, next) {
  const user = req.session?.user;
  if (!user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  // ✅ unify: many routes expect req.user
  req.user = user;

  next();
}

function requireAdmin(req, res, next) {
  const user = req.session?.user;
  if (!user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  // ✅ keep it consistent with your stored user shape
  // If you store role:
  if (user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  req.user = user;
  next();
}

module.exports = { requireAuth, requireAdmin };