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

// Two households claiming the same dancer is a real scenario, not an edge
// case (design §6.9): same-name dancers, separated parents, a studio and a
// parent both claiming. Neither claimant may silently win, and the decision
// is AwardHome's — NEVER a studio's, even when both claimants hold a valid
// studio code, because a director asked to choose between two families is
// being asked to arbitrate a private dispute.
//
// Marking both sides `contested` is what takes them out of the studio queue,
// which filters on `pending`, and puts them in front of an AwardHome
// reviewer. Called after a claim is filed.
async function markContestedClaims(db, dancerId) {
  const open = await db.all(
    "SELECT id FROM dancer_claims WHERE dancer_id = ? AND status IN ('pending', 'contested')",
    [dancerId]);
  if (open.length < 2) return { contested: false, count: open.length };
  await db.run(
    "UPDATE dancer_claims SET status = 'contested' WHERE dancer_id = ? AND status = 'pending'",
    [dancerId]);
  return { contested: true, count: open.length };
}

async function isDancerContested(db, dancerId) {
  try {
    const row = await db.get(
      "SELECT 1 AS x FROM dancer_claims WHERE dancer_id = ? AND status = 'contested' LIMIT 1", [dancerId]);
    return !!row;
  } catch (e) {
    return false;
  }
}

// WHO SHOULD DECIDE A DANCER CLAIM (revised 2026-09-01).
//
// The question a dancer claim asks is "is this person really this child's
// parent?" — and an AwardHome reviewer has no way to answer it. They have no
// relationship to the family and nothing to check against. Sending them the
// decision does not produce review; it produces rubber-stamping, on a
// child-safety surface, with the appearance of oversight.
//
// The studio director CAN answer it. They know which parent belongs to which
// dancer. So the routing follows competence, not paperwork:
//
//   contested            -> AwardHome. A director must never be asked to
//                           choose between two families (design §6.9).
//   independent dancer   -> AwardHome. There is no director, by definition
//                           (design §6.2.3).
//   studio has an owner  -> THAT STUDIO, whether or not a code was supplied.
//   studio unclaimed     -> nobody competent exists yet. It waits, and the
//                           family is told why and offered the invite path.
//
// This demotes the studio claim code from a routing gate to what it always
// really was: a shortcut that proves community membership and lets a family
// skip the queue. Its ABSENCE never made AwardHome more able to judge.
async function routeDancerClaim(db, dancerId, codeMatch) {
  if (codeMatch && codeMatch.valid && codeMatch.studio) {
    return { studioId: codeMatch.studio.id, studio: codeMatch.studio, routedTo: 'studio', withCode: true };
  }
  const owned = await db.get(`
    SELECT s.id, s.name, s.owner_id
    FROM dancer_studios ds JOIN studios s ON s.id = ds.studio_id
    WHERE ds.dancer_id = ? AND s.owner_id IS NOT NULL
      AND COALESCE(s.is_independent, 0) = 0 AND COALESCE(s.status, 'active') != 'merged'
    LIMIT 1`, [dancerId]);
  if (owned) return { studioId: owned.id, studio: owned, routedTo: 'studio', withCode: false };

  const unclaimed = await db.get(`
    SELECT s.id, s.unique_id, s.name
    FROM dancer_studios ds JOIN studios s ON s.id = ds.studio_id
    WHERE ds.dancer_id = ? AND s.owner_id IS NULL
      AND COALESCE(s.is_independent, 0) = 0 AND COALESCE(s.status, 'active') != 'merged'
    LIMIT 1`, [dancerId]);
  return {
    studioId: null, studio: null, withCode: false,
    routedTo: unclaimed ? 'waiting_for_studio' : 'awardhome',
    unclaimedStudio: unclaimed || null,
  };
}

/**
 * What standing does this household have over this dancer?
 *
 *   'owner'         — the claim was approved; she manages the profile.
 *   'pending_claim' — she has asked, and nobody has decided yet.
 *   null            — a stranger.
 *
 * The distinction exists because the two questions are different. "May she
 * PUT SOMETHING IN STAGING?" and "may that thing become a canonical award?"
 * were the same question only as long as staging was unreachable to anyone
 * but an owner. A pending claimant on an unclaimed studio can be waiting
 * indefinitely — 21,693 of 21,695 real studios have no owner to decide — and
 * a weekend's results are gone from memory long before that resolves. Letting
 * her queue costs nothing: staging is a separate file, nothing there is
 * public, and promotion remains the only door.
 *
 * A contested claim still counts as pending here. Both households may queue;
 * neither promotes, because promotion refuses a contested dancer outright.
 */
async function householdStanding(db, dancerId, userId) {
  if (!userId) return null;
  const dancer = await db.get('SELECT claimed_by_user_id FROM dancers WHERE id = ?', [dancerId]);
  if (!dancer) return null;
  if (dancer.claimed_by_user_id === userId) return 'owner';
  try {
    const claim = await db.get(
      "SELECT 1 AS x FROM dancer_claims WHERE dancer_id = ? AND user_id = ? " +
      "AND status IN ('pending', 'contested') LIMIT 1", [dancerId, userId]);
    if (claim) return 'pending_claim';
  } catch (e) { /* pre-migration */ }
  return null;
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
    "SELECT id, user_id FROM dancer_claims WHERE dancer_id = ? AND status IN ('pending', 'contested') AND id != ?",
    [claim.dancer_id, claim.id]);
  for (const c of competing) {
    await db.run('UPDATE dancer_claims SET status = "rejected" WHERE id = ?', [c.id]);
    notifyDancerClaimDecision(db, c.id, false);
    // The losing household's queue goes with the claim. Left alone it would
    // sit in staging forever, attached to a dancer they were just told is not
    // theirs — and would still be matchable as somebody's corroboration.
    await withdrawQueuedSubmissions(c.user_id, claim.dancer_id);
  }
  notifyDancerClaimDecision(db, claim.id, true);

  // The relationship is now established, so the queue she built while waiting
  // stops being unverified — and gets the auto-promotion pass it was held out
  // of. This is the payoff of letting her queue at all: one decision by one
  // director releases a season's worth of entries at once.
  await releaseQueuedSubmissions(claim.user_id, claim.dancer_id, db);
}

/**
 * Clear the unverified marker on a newly-confirmed household's staged
 * submissions and run each through auto-promotion.
 *
 * Required lazily: promotion.js reaches into staging and canonical both, and
 * claims.js is required by routes that have no business loading that. Failure
 * is logged and swallowed — a claim approval must not fail because a
 * submission could not be promoted; the reviewer queue is the backstop.
 */
async function releaseQueuedSubmissions(userId, dancerId, dbIn) {
  try {
    const { openSubmissionsDb } = require('./submissionsDb');
    const { runAutoPromotion } = require('./promotion');
    const sdb = await openSubmissionsDb();
    const rows = await sdb.all(
      "SELECT id FROM award_submissions WHERE user_id = ? AND dancer_id = ? " +
      "AND unverified_household = 1 AND status = 'submitted'", [userId, dancerId]);
    if (!rows.length) return;
    await sdb.run(
      "UPDATE award_submissions SET unverified_household = 0, updated_at = CURRENT_TIMESTAMP " +
      'WHERE user_id = ? AND dancer_id = ? AND unverified_household = 1', [userId, dancerId]);
    for (const r of rows) {
      try { await runAutoPromotion({ submissionId: r.id, db: dbIn }); }
      catch (e) { console.error('[claims] release auto-promotion failed:', e.message); }
    }
  } catch (e) {
    console.error('[claims] releasing queued submissions failed:', e.message);
  }
}

/**
 * A rejected claimant's queue is withdrawn, not left to rot.
 *
 * Withdrawn rather than deleted: the row is the audit trail of what was
 * entered and by whom, and the household ledger that counted it is
 * append-only. Nothing was ever public, so nothing is unpublished.
 */
async function withdrawQueuedSubmissions(userId, dancerId) {
  try {
    const { openSubmissionsDb } = require('./submissionsDb');
    const sdb = await openSubmissionsDb();
    await sdb.run(
      "UPDATE award_submissions SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP " +
      "WHERE user_id = ? AND dancer_id = ? AND unverified_household = 1 AND status = 'submitted'",
      [userId, dancerId]);
  } catch (e) {
    console.error('[claims] withdrawing queued submissions failed:', e.message);
  }
}

async function rejectDancerClaim(db, claimId) {
  const claim = await db.get('SELECT user_id, dancer_id FROM dancer_claims WHERE id = ?', [claimId]);
  await db.run('UPDATE dancer_claims SET status = "rejected" WHERE id = ?', [claimId]);
  notifyDancerClaimDecision(db, claimId, false);
  if (claim) await withdrawQueuedSubmissions(claim.user_id, claim.dancer_id);
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
  matchDancerClaimCode, markContestedClaims, isDancerContested, routeDancerClaim,
  householdStanding, releaseQueuedSubmissions, withdrawQueuedSubmissions,
  approveDancerClaim, rejectDancerClaim,
  notifyDancerClaimDecision, notifyStudioOfProfileClaim, notifyRosterAttach,
};
