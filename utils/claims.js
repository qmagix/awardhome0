const { logStudioActivity } = require('./activity');

// Domain fast-track: a claimant whose (verified) email domain matches the
// studio's website domain is auto-approved. SECURITY: callers must only
// invoke approval AFTER the email is verified — matching an unverified
// email proves nothing.
function domainsMatch(studioWebsiteUrl, email) {
  if (!studioWebsiteUrl || !email || !email.includes('@')) return false;
  try {
    const url = studioWebsiteUrl.startsWith('http') ? studioWebsiteUrl : `https://${studioWebsiteUrl}`;
    const studioDomain = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    const userDomain = email.split('@')[1].toLowerCase();
    return studioDomain === userDomain;
  } catch (e) {
    return false;
  }
}

// Approve a studio claim: assign ownership, mark the claim, upgrade the
// user's role. Used by the logged-in fast-track, the post-verification
// hook, and admin approval all follow this same shape.
async function approveStudioClaim(db, { userId, studioId }) {
  await db.run('UPDATE studios SET is_claimed = 1, owner_id = ? WHERE id = ?', [userId, studioId]);
  await db.run(
    `UPDATE studio_claims SET status = 'approved' WHERE user_id = ? AND studio_id = ? AND status = 'pending'`,
    [userId, studioId]
  );
  await db.run(`UPDATE users SET role = 'studio_owner' WHERE id = ? AND role = 'user'`, [userId]);
  logStudioActivity(studioId, 'claim_approved');
}

module.exports = { domainsMatch, approveStudioClaim };
