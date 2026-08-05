const { openDb } = require('../database');

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || (req.session.user.role !== 'admin' && req.session.user.role !== 'superadmin')) return res.status(403).send('Forbidden');
  next();
}

function requireSuperadmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'superadmin') return res.status(403).send('Forbidden: Superadmin only');
  next();
}

// Loads studio :id and verifies the logged-in user owns it (site admins pass).
// Attaches the row as req.studio. Must run after requireAuth.
async function requireStudioOwner(req, res, next) {
  try {
    const db = await openDb();
    const studio = await db.get('SELECT * FROM studios WHERE id = ?', [req.params.id]);
    if (!studio) return res.status(404).send('Studio not found');
    const { id: userId, role } = req.session.user;
    if (studio.owner_id !== userId && role !== 'admin' && role !== 'superadmin') {
      return res.status(403).send('Forbidden: Not the owner');
    }
    req.studio = studio;
    next();
  } catch (err) {
    next(err);
  }
}

// Same for organizations. Superadmins always pass; allowAdmin: false keeps
// regular admins out (branding/marketing are owner + superadmin only).
// Attaches the row as req.org. Must run after requireAuth.
function requireOrgOwner({ allowAdmin = true } = {}) {
  return async (req, res, next) => {
    try {
      const db = await openDb();
      const org = await db.get('SELECT * FROM organizations WHERE id = ?', [req.params.id]);
      if (!org) return res.status(404).send('Organization not found');
      const { id: userId, role } = req.session.user;
      const hasAdminAccess = role === 'superadmin' || (allowAdmin && role === 'admin');
      if (org.owner_id !== userId && !hasAdminAccess) {
        return res.status(403).send('Forbidden: Not the owner');
      }
      req.org = org;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireAuth, requireAdmin, requireSuperadmin, requireStudioOwner, requireOrgOwner };
