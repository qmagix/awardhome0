const crypto = require('crypto');
const { openDb } = require('../database');
const { sendEmail } = require('./mailer');
const { BASE_URL } = require('../config');

// Studio invite machinery. Emails are personalized with real award counts
// and leaderboard rank; every send is recorded in studio_invites and the
// selection honors email_suppressions (one-click unsubscribe).

const SECRET = process.env.SESSION_SECRET || 'dev-only-secret';

function unsubscribeToken(email) {
  return crypto.createHmac('sha256', SECRET)
    .update(String(email).trim().toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

function unsubscribeLink(email) {
  const e = Buffer.from(String(email).trim().toLowerCase()).toString('base64url');
  return `${BASE_URL}/unsubscribe?e=${e}&t=${unsubscribeToken(email)}`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildStudioInvite({ studio, totalAwards, firstPlaces, rank }) {
  const name = escapeHtml(studio.name);
  const profileUrl = `${BASE_URL}/dance/studio/${studio.id}`;
  const subject = `${studio.name}: ${totalAwards.toLocaleString()} awards, all in one place`;

  let rankHtml = '';
  if (rank && rank <= 100) {
    rankHtml = `<p>${name} currently ranks <strong>#${rank}</strong> on our all-time leaderboard — already featured on the AwardHome homepage.</p>`;
  } else if (rank && rank <= 300) {
    rankHtml = `<p>${name} currently ranks <strong>#${rank}</strong> on our all-time leaderboard. The top 100 appear on our homepage — if some of your results are missing from our records, adding them after you claim could move you up the list.</p>`;
  }

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; color: #222; max-width: 560px; margin: 0 auto; line-height: 1.55;">
    <p>Hi ${name} team,</p>

    <p>Congratulations on a great season. Your competition results are already live on
    <strong>AwardHome</strong> — we aggregate results from 14 competitions (YAGP, KAR, Starpower,
    NYCDA, Showstopper, Rainbow, and more) into a single digital trophy case: over 900,000 awards
    from 17,000+ studios since 2022.</p>

    <p>${name}'s page — with <strong>${totalAwards.toLocaleString()} awards</strong>${firstPlaces ? ` and <strong>${firstPlaces.toLocaleString()} first-place finishes</strong>` : ''} — is here:</p>

    <p style="text-align: center; margin: 24px 0;">
      <a href="${profileUrl}" style="background: #d4af37; color: #000; padding: 12px 28px; border-radius: 24px; text-decoration: none; font-weight: bold;">View Your Studio's Trophy Case</a>
    </p>

    ${rankHtml}

    <p>Claiming your page takes about two minutes and costs nothing. It unlocks:</p>
    <ol>
      <li><strong>Make it complete and correct.</strong> Merge duplicate profiles, fix dancer-name typos, and add awards from events that never published results online.</li>
      <li><strong>Give every dancer their own trophy case.</strong> Invite your dance families to claim verified dancer profiles.</li>
      <li><strong>Put it on your own website.</strong> Claimed studios get an embeddable awards widget, in your colors — and you control which stats are public.</li>
    </ol>

    <p>Our homepage <strong>Featured Studios</strong> section is selected automatically from claimed
    studios with complete profiles — no payment, no favoritism. Claim early and you're eligible
    from day one.</p>

    <p>Click <strong>"Claim Studio"</strong> on your page above. If your email matches your studio's
    website domain, approval is instant.</p>

    <p>— ${'Q'}<br>Founder, AwardHome<br><a href="${BASE_URL}" style="color: #aa8529;">awardhome.com</a></p>

    <p style="font-size: 12px; color: #888; border-top: 1px solid #ddd; padding-top: 12px; margin-top: 28px;">
      You're receiving this one-time note because your studio's public competition results appear on AwardHome.
      <a href="${unsubscribeLink(studio.email)}" style="color: #888;">Unsubscribe</a> and we won't email you again.
    </p>
  </div>`;

  return { subject, html };
}

// Eligibility + stats + send + record. overrideEmail sends a sample to
// another address WITHOUT recording (for testing); record only on real sends.
async function sendStudioInvite(studioId, { sentBy = null, overrideEmail = null } = {}) {
  const db = await openDb();
  const studio = await db.get('SELECT * FROM studios WHERE id = ?', [studioId]);
  if (!studio) return { success: false, error: 'Studio not found' };
  if (studio.status !== 'active') return { success: false, error: 'Studio is not active' };
  if (studio.is_claimed) return { success: false, error: 'Studio already claimed' };
  if (!studio.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studio.email.trim())) {
    return { success: false, error: 'No valid email on file' };
  }
  const email = studio.email.trim();

  if (!overrideEmail) {
    const suppressed = await db.get('SELECT 1 FROM email_suppressions WHERE email = ?', [email.toLowerCase()]);
    if (suppressed) return { success: false, error: 'Recipient unsubscribed' };
    const already = await db.get('SELECT sent_at FROM studio_invites WHERE studio_id = ? OR email = ? LIMIT 1', [studioId, email]);
    if (already) return { success: false, error: `Already invited ${already.sent_at}` };
  }

  const stats = await db.get(`
    SELECT COUNT(*) AS totalAwards, SUM(CASE WHEN is_first_place = 1 THEN 1 ELSE 0 END) AS firstPlaces
    FROM awards WHERE studio_id = ?`, [studioId]);
  const rankRow = await db.get(`
    SELECT COUNT(*) + 1 AS rank FROM (
      SELECT a.studio_id, COUNT(*) AS c FROM awards a
      JOIN studios s ON s.id = a.studio_id AND s.status = 'active'
      GROUP BY a.studio_id HAVING c > ?
    )`, [stats.totalAwards]);

  const { subject, html } = buildStudioInvite({
    studio,
    totalAwards: stats.totalAwards || 0,
    firstPlaces: stats.firstPlaces || 0,
    rank: rankRow ? rankRow.rank : null
  });

  const result = await sendEmail({ to: overrideEmail || email, subject, html });
  if (!result.success) return { success: false, error: 'Send failed: ' + JSON.stringify(result.error).slice(0, 200) };

  if (!overrideEmail) {
    await db.run(
      'INSERT INTO studio_invites (studio_id, email, subject, message_id, sent_by) VALUES (?, ?, ?, ?, ?)',
      [studioId, email, subject, result.data && result.data.id, sentBy]
    );
  }
  return { success: true, subject, to: overrideEmail || email, messageId: result.data && result.data.id };
}

module.exports = { buildStudioInvite, sendStudioInvite, unsubscribeToken, unsubscribeLink };
