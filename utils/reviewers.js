// Reviewer notification list — the people who get emailed about weekly-import
// holds and organizer results uploads. Managed by superadmins at
// /admin/reviewers. While the table is empty (or missing, e.g. a staging
// snapshot taken before the migration ran), falls back to REVIEW_EMAIL
// (comma-separated) and then SUPERADMIN_EMAIL so notifications never silently
// stop working.
const { openDb } = require('../database');

async function getReviewerEmails() {
  try {
    const db = await openDb();
    const rows = await db.all('SELECT email FROM reviewers ORDER BY email');
    if (rows.length) return rows.map(r => r.email);
  } catch (e) {
    console.error('[reviewers] lookup failed, using env fallback:', e.message);
  }
  const env = process.env.REVIEW_EMAIL || process.env.SUPERADMIN_EMAIL || '';
  return env.split(',').map(s => s.trim()).filter(Boolean);
}

module.exports = { getReviewerEmails };
