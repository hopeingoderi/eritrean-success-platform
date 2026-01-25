// middleware/requireAdmin.js
module.exports = function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
};
