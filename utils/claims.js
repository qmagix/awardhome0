const { logStudioActivity } = require('./activity');
const { sendEmail } = require('./mailer');
const { BASE_URL } = require('../config');

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

// ---- Dancer profile claims: studio-code routing + decision notifications ----

// Match an optional studio claim code (studios.join_code) against studios
// the dancer is actually affiliated with (roster link or award history).
// The code is distributed to every family in the studio, so a match proves
// community membership, not identity — it ROUTES the claim to the studio
// director for approval (who knows which parent belongs to which dancer),
// it never auto-approves. A code from an unrelated studio proves nothing
// and is treated as no match.
async function matchDancerClaimCode(db, dancerId, code) {
  const trimmed = String(code || '').trim();
  if (!trimmed) return { provided: false, valid: false, studio: null };
  const studios = await db.all(`
    SELECT DISTINCT s.id, s.name, s.join_code, s.owner_id
    FROM studios s
    WHERE s.join_code IS NOT NULL AND TRIM(s.join_code) != '' AND (
      s.id IN (SELECT studio_id FROM dancer_studios WHERE dancer_id = ?)
      OR s.id IN (
        SELECT a.studio_id FROM awards a
        JOIN award_dancers ad ON ad.award_id = a.id
        WHERE ad.dancer_id = ? AND a.studio_id IS NOT NULL
      )
    )
  `, [dancerId, dancerId]);
  const hit = studios.find(s => s.join_code.trim().toLowerCase() === trimmed.toLowerCase());
  return { provided: true, valid: !!hit, studio: hit || null };
}

// Email the claimant about a decision, whether it came from the system
// admin or the studio director. Fire-and-forget: sendEmail never throws,
// and a lost email must never roll back a decision.
async function notifyDancerClaimDecision(db, claimId, approved) {
  try {
    const claim = await db.get(`
      SELECT dc.id, u.email, d.id as dancer_id, d.name as dancer_name, d.unique_id
      FROM dancer_claims dc
      JOIN users u ON dc.user_id = u.id
      JOIN dancers d ON dc.dancer_id = d.id
      WHERE dc.id = ?
    `, [claimId]);
    if (!claim || !claim.email) return;

    const subject = approved
      ? `You're in! ${claim.dancer_name}'s AwardHome profile is yours`
      : `Update on your claim for ${claim.dancer_name}'s AwardHome profile`;
    const html = approved
      ? `<p>Great news — your claim for <strong>${escapeHtml(claim.dancer_name)}</strong>'s profile was approved!</p>
         <p>You can now manage the profile, and make the award cards truly yours:</p>
         <ul>
           <li><a href="${BASE_URL}/manage/dancer/${claim.dancer_id}/card">Add a photo &amp; thank-you notes to award cards</a></li>
           <li><a href="${BASE_URL}/manage/dancer/${claim.dancer_id}">Manage the profile</a></li>
           <li><a href="${BASE_URL}/dancer/${claim.unique_id}">View the public trophy case</a></li>
         </ul>`
      : `<p>Thanks for your claim for <strong>${escapeHtml(claim.dancer_name)}</strong>'s profile on AwardHome.</p>
         <p>We couldn't verify this request, so it was not approved. If you believe this is a mistake,
         reply to this email or ask your studio director for the studio claim code and submit again —
         claims with a valid code are confirmed directly by your studio.</p>`;

    if (!process.env.EMAIL_PROVIDER) {
      console.log(`[DEV MODE] Claim ${approved ? 'approval' : 'rejection'} email for ${claim.email} (dancer ${claim.dancer_name})`);
      return;
    }
    const result = await sendEmail({ to: claim.email, subject, html });
    if (!result.success) console.error('Failed to send claim decision email:', result.error);
  } catch (err) {
    console.error('notifyDancerClaimDecision failed:', err);
  }
}

// Email the studio director when a code-routed profile claim lands in
// their Verifications queue. Fire-and-forget.
async function notifyStudioOfProfileClaim(db, { studio, dancer, claimantEmail, relationship }) {
  try {
    if (!studio || !studio.owner_id) return;
    const owner = await db.get('SELECT email FROM users WHERE id = ?', [studio.owner_id]);
    if (!owner || !owner.email) return;

    const subject = `Profile claim to review: ${dancer.name} (${studio.name})`;
    const html = `<p>Someone used your studio claim code to request ownership of a dancer profile:</p>
      <p><strong>${escapeHtml(dancer.name)}</strong> — claimed by ${escapeHtml(claimantEmail)}
      (${escapeHtml(relationship || 'relationship not stated')})</p>
      <p>Because they have your studio code, we're asking you to confirm they belong to this dancer's family.</p>
      <p><a href="${BASE_URL}/manage/studio/${studio.id}/verifications">Review it in your Verifications dashboard</a></p>`;

    if (!process.env.EMAIL_PROVIDER) {
      console.log(`[DEV MODE] Studio claim-review email for ${owner.email} (dancer ${dancer.name})`);
      return;
    }
    const result = await sendEmail({ to: owner.email, subject, html });
    if (!result.success) console.error('Failed to send studio claim-review email:', result.error);
  } catch (err) {
    console.error('notifyStudioOfProfileClaim failed:', err);
  }
}

// Approve a dancer claim: assign ownership, upgrade the role, and settle
// the queue — any competing pending claims for the same dancer are
// auto-rejected (otherwise a later approval would silently reassign the
// profile). Sends the decision emails for the winner and the losers.
// Used by both the admin route and the studio-director route.
async function approveDancerClaim(db, claim) {
  await db.run('UPDATE dancers SET is_claimed = 1, claimed_by_user_id = ? WHERE id = ?', [claim.user_id, claim.dancer_id]);
  await db.run('UPDATE dancer_claims SET status = "approved" WHERE id = ?', [claim.id]);
  await db.run('UPDATE users SET role = "dancer_owner" WHERE id = ? AND role = "user"', [claim.user_id]);

  const competing = await db.all(
    "SELECT id FROM dancer_claims WHERE dancer_id = ? AND status = 'pending' AND id != ?",
    [claim.dancer_id, claim.id]);
  for (const c of competing) {
    await db.run('UPDATE dancer_claims SET status = "rejected" WHERE id = ?', [c.id]);
    notifyDancerClaimDecision(db, c.id, false);
  }
  notifyDancerClaimDecision(db, claim.id, true);
}

async function rejectDancerClaim(db, claimId) {
  await db.run('UPDATE dancer_claims SET status = "rejected" WHERE id = ?', [claimId]);
  notifyDancerClaimDecision(db, claimId, false);
}

// Layer-3 rogue-studio deterrent: when a studio owner attaches a CLAIMED
// dancer to their roster, the family hears about it — every would-be victim
// becomes a detector. Fire-and-forget; unclaimed dancers no-op.
async function notifyRosterAttach(db, dancerId, studioId) {
  try {
    const dancer = await db.get(
      'SELECT d.name, d.id, u.email FROM dancers d JOIN users u ON u.id = d.claimed_by_user_id WHERE d.id = ?',
      [dancerId]);
    if (!dancer || !dancer.email) return;
    const studio = await db.get('SELECT name FROM studios WHERE id = ?', [studioId]);
    if (!studio) return;
    await sendEmail({
      to: dancer.email,
      subject: `${studio.name} added ${dancer.name} to its roster on AwardHome`,
      html: `<div style="font-family: Arial, sans-serif; max-width: 540px; line-height: 1.55; color: #222;">
        <p><strong>${studio.name}</strong> just added <strong>${dancer.name}</strong> to its studio roster on AwardHome.</p>
        <p>If that's your studio — wonderful, nothing to do.</p>
        <p>If it's <strong>not</strong>, reply to this email (or use the Send Feedback button on any AwardHome page) and we'll remove the link right away.</p>
        <p><a href="${BASE_URL}/manage/dancer/${dancer.id}" style="color: #aa8529;">Manage ${dancer.name}'s profile</a></p>
      </div>`,
    });
  } catch (e) {
    console.error('[notifyRosterAttach] failed:', e.message);
  }
}

module.exports = {
  domainsMatch, approveStudioClaim,
  matchDancerClaimCode, approveDancerClaim, rejectDancerClaim,
  notifyDancerClaimDecision, notifyStudioOfProfileClaim, notifyRosterAttach,
};
