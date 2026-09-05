const crypto = require('crypto');
const { openDb } = require('../database');
const { sendEmail } = require('./mailer');
const { BASE_URL, BETA_MODE, BETA_KEY } = require('../config');

// Studio invite machinery. Emails are personalized with real award counts
// and leaderboard rank; every send is recorded in studio_invites and the
// selection honors email_suppressions (one-click unsubscribe).

const SECRET = process.env.SESSION_SECRET || 'dev-only-secret';

// Brand architecture (decided 2026-09-05): AwardHome is the family
// award-and-milestone platform; the dance vertical is "AwardHome Dance" at
// dance.awardhome.com. Letters name the vertical; the signature keeps the
// parent ("Founder, AwardHome"). The displayed host is derived from
// BASE_URL so letters are correct before AND after the domain cutover —
// never hardcode a hostname in letter copy.
const SITE_HOST = String(BASE_URL).replace(/^https?:\/\//, '');

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

function buildStudioInvite({ studio, totalAwards, firstPlaces, rank, totals = {} }) {
  const name = escapeHtml(studio.name);
  // Platform totals computed live by the caller (sendStudioInvite) so the
  // letter never goes stale; fallbacks = last hand-verified numbers.
  const tAwards = totals.awards ? `over ${(totals.awards / 1e6).toFixed(1)} million` : 'over 1.5 million';
  const tStudios = totals.studios ? `${Math.floor(totals.studios / 1e3).toLocaleString()},000+` : '24,000+';
  const tOrgs = totals.orgs || 27;
  const profileUrl = `${BASE_URL}/dance/studio/${studio.unique_id}` +
    (BETA_MODE && BETA_KEY ? `?beta=${BETA_KEY}` : '');
  const upcomingUrl = `${BASE_URL}/dance/events` +
    (BETA_MODE && BETA_KEY ? `?beta=${BETA_KEY}` : '');
  const subject = `${studio.name}: ${totalAwards.toLocaleString()} awards, all in one place`;

  let rankHtml = '';
  if (rank && rank <= 100) {
    rankHtml = `<p>${name} currently ranks <strong>#${rank}</strong> on our all-time leaderboard — already featured on the AwardHome Dance homepage.</p>`;
  } else if (rank && rank <= 300) {
    rankHtml = `<p>${name} currently ranks <strong>#${rank}</strong> on our all-time leaderboard. The top 100 appear on our homepage — if some of your results are missing from our records, adding them after you claim could move you up the list.</p>`;
  }

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; color: #222; max-width: 560px; margin: 0 auto; line-height: 1.55;">
    <p>Hi ${name} team,</p>

    ${BETA_MODE ? '<p style="background: #faf6e8; border: 1px solid #d4af37; border-radius: 8px; padding: 10px 14px;"><strong>You\'re invited to our private beta.</strong> The link below is your early-access pass — AwardHome Dance opens to the public on September 15, and beta studios get a head start.</p>' : ''}
    <p>Congratulations on a great season. Your competition results are already live on
    <strong>AwardHome Dance</strong> — we aggregate results from ${tOrgs} competitions (YAGP, KAR, Starpower,
    NYCDA, Showstopper, Rainbow, and more) into a single digital trophy case: ${tAwards} awards
    from ${tStudios} studios, going back to 2011.</p>

    <p>${name}'s page — with <strong>${totalAwards.toLocaleString()} awards</strong>${firstPlaces ? ` and <strong>${firstPlaces.toLocaleString()} first-place finishes</strong>` : ''} — is here:</p>

    <p style="text-align: center; margin: 24px 0;">
      <a href="${profileUrl}" style="background: #d4af37; color: #000; padding: 12px 28px; border-radius: 24px; text-decoration: none; font-weight: bold;">View Your Studio's Trophy Case</a>
    </p>

    ${rankHtml}

    <p>Claiming your page takes about two minutes and costs nothing. It unlocks:</p>
    <ol>
      <li><strong>Make it complete and correct.</strong> Competitions spell studio names differently — duplicate profiles may be splitting your award count and leaderboard rank right now. Merge them, fix dancer-name typos, and add awards from events that never published results online.</li>
      <li><strong>Give every dancer their own trophy case.</strong> Invite your dance families to claim verified dancer profiles.</li>
      <li><strong>Put it on your own website.</strong> Claimed studios get an embeddable awards widget, in your colors — and you control which stats are public.</li>
    </ol>

    <p>Your login also makes next season easier: our <a href="${upcomingUrl}" style="color: #aa8529;"><strong>Upcoming Events</strong> directory</a> gathers
    every circuit's published tour dates in one place — tap <strong>"Near me"</strong> to sort by distance
    from your studio, star the events you're considering into a shortlist, and export it straight into
    your calendar. The season-planning spreadsheet, retired.</p>

    <p>And if a competition you attend isn't on AwardHome Dance yet, tell us — the <strong>Send
    Feedback</strong> button is right in the header once you're in. Name the event and we'll work on
    adding its results and tour dates, so your whole season lives in one place.</p>

    <p>Our homepage <strong>Featured Studios</strong> section is selected automatically from claimed
    studios with complete profiles — no payment, no favoritism. Claim early and you're eligible
    from day one.</p>

    <p>Click <strong>"Claim Studio"</strong> on your page above. If your email matches your studio's
    website domain, approval is instant.</p>

    <p>— Sam<br>Founder, AwardHome<br><a href="${BASE_URL}" style="color: #aa8529;">${SITE_HOST}</a></p>

    <p style="font-size: 12px; color: #888; border-top: 1px solid #ddd; padding-top: 12px; margin-top: 28px;">
      You're receiving this one-time note because your studio's public competition results appear on AwardHome Dance.
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

  const totals = {
    awards: (await db.get('SELECT COUNT(*) c FROM awards')).c,
    studios: (await db.get("SELECT COUNT(*) c FROM studios WHERE status = 'active'")).c,
    orgs: (await db.get('SELECT COUNT(*) c FROM organizations WHERE slug IS NOT NULL')).c,
  };
  const { subject, html } = buildStudioInvite({
    totals,
    studio,
    totalAwards: stats.totalAwards || 0,
    firstPlaces: stats.firstPlaces || 0,
    rank: rankRow ? rankRow.rank : null
  });

  const result = await sendEmail({
    to: overrideEmail || email, subject, html,
    headers: {
      'List-Unsubscribe': `<${unsubscribeLink(email)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  });
  if (!result.success) return { success: false, error: 'Send failed: ' + JSON.stringify(result.error).slice(0, 200) };

  if (!overrideEmail) {
    await db.run(
      'INSERT INTO studio_invites (studio_id, email, subject, message_id, sent_by) VALUES (?, ?, ?, ?, ?)',
      [studioId, email, subject, result.data && result.data.id, sentBy]
    );
  }
  return { success: true, subject, to: overrideEmail || email, messageId: result.data && result.data.id };
}

// ---- Organizer invites ----
// Unlike studio invites (fully templated, one click), organizer letters are
// composed by a superadmin on /admin/orgs: the template below is only the
// starting point, the edited plain text is what gets sent, and the exact
// letter is recorded in org_invites for future review. Content follows
// org_invite_draft.md.

function buildOrgInviteTemplate({ org, eventCount = 0, awardCount = 0, totals = {} }) {
  const n = org.name;
  // Platform totals are computed live by the caller so the letter can never
  // go stale; the fallbacks match the last hand-verified numbers.
  const tAwards = totals.awards ? `over ${(totals.awards / 1e6).toFixed(1)} million` : 'over 1.5 million';
  const tEvents = totals.events ? `${(Math.floor(totals.events / 100) * 100).toLocaleString()}+` : '4,200+';
  const tOrgs = totals.orgs || 27;
  const betaSuffix = BETA_MODE && BETA_KEY ? `?beta=${BETA_KEY}` : '';
  const orgPageUrl = `${BASE_URL}/dance/org/${org.slug}${betaSuffix}`;
  const upcomingUrl = `${BASE_URL}/dance/events${betaSuffix}`;
  // Sample page for orgs with no archived events yet: the Peacock Cup demo
  // page (render-only fictitious org in routes/dance/public.js) shows the
  // full organizer edition — branded coin included — without borrowing any
  // real org's data or implying their endorsement. The letter says openly
  // that it's a sample.
  const samplePageUrl = `${BASE_URL}/dance/org/peacock${betaSuffix}`;
  const alreadyLive = eventCount > 0
    ? `In fact, ${n} is already there: ${eventCount.toLocaleString()} of your events, with ${awardCount.toLocaleString()} awards, are live on AwardHome Dance today — see ${orgPageUrl}\nClaiming your organizer profile puts your branding on every one of those award cards.\n\n`
    : `Want to see what your page would look like? We keep a live sample up — the "Peacock Cup," a fictitious competition — with the brand coin, champions wall, tour dates, and an award card you can actually flip, all in place: ${samplePageUrl}\n\n`;

  const subject = `Featuring ${n} on AwardHome Dance`;
  const body = `Hi Competition Director,

I'm Sam, founder of AwardHome. AwardHome Dance is our award curation platform for competitive dance — we aggregate results from events nationwide into beautiful, shareable award pages for dancers and studios: today that's ${tAwards} awards from ${tEvents} events across ${tOrgs} competitions, including YAGP, Starpower, KAR, NYCDA, and Rainbow.

We'd love to feature ${n} alongside them when we launch on September 15.

${alreadyLive}The offer, plainly: send us your results in whatever format you have — CSV, Excel, PDFs, database exports, anything, one event or your entire history in a single zip or Drive link — and we handle 100% of the processing. Zero technical work on your end, free during our beta period.

What ${n} gets:

1. Your brand on every award card dancers share. Organizers get a free branding dashboard — your logo and custom trophy icons, hand-fitted onto our patent-pending award cards by our design team — so your brand stays visible on social media long after the event ends.

2. Permanent, searchable results. Dancers and parents constantly search for old placements. We host them forever, interactively — no more fielding "where can I find 2023 results?" emails, and your events sit beside the biggest names in the industry for every studio browsing the platform.

3. Your tour dates, where studios plan their season. Our Upcoming Events directory gathers every circuit's published dates in one place — studios and parents browse it when deciding which competitions to attend, sorted by distance, and they can shortlist your events and export them straight into their family calendars, with your registration one click away. You control your dates from your dashboard; complete, current listings are what turn browsing into bookings. See it live: ${upcomingUrl}

Curious how it all works? Our organizer FAQ covers the common questions — data formats, branding, what it costs — and includes a sample award card you can actually flip: ${BASE_URL}/faq/organizer

Claiming your free organizer account takes about two minutes with your private access link — and your dashboard walks you through the whole setup in three steps (upload results, add your profile, send us your logo):

{CLAIM_LINK}

Or if you have a recent results file or links handy, just reply with it attached — or with a Google Drive or Dropbox link — and we'll build a live demo page for ${n}, usually within a few days. And if you'd rather talk first, I'm happy to do a quick 15-minute call.

However this lands, one thing is true either way: we'd welcome ${n} as a partner, not just a name in our archive. And if anything on AwardHome Dance could serve you better — how your events are presented, a feature you wish existed, anything at all — just tell us. We're building this for the people who actually run competitions and for the dancers preserving those memories, so your thoughts and needs genuinely shape what we build next.

Thank you for everything you do for the dance community.

Best regards,

Sam
Founder, AwardHome
${BASE_URL}
hello@awardhome.com`;

  return { subject, body };
}

// Plain text → simple HTML email: escape, linkify bare URLs, preserve line
// breaks, and append the unsubscribe footer (never left to the composer).
function orgInviteHtml(body, email) {
  const linked = escapeHtml(body)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color: #aa8529;">$1</a>')
    .replace(/\n/g, '<br>\n');
  return `
  <div style="font-family: Arial, Helvetica, sans-serif; color: #222; max-width: 560px; margin: 0 auto; line-height: 1.55;">
    <p>${linked}</p>
    <p style="font-size: 12px; color: #888; border-top: 1px solid #ddd; padding-top: 12px; margin-top: 28px;">
      You're receiving this one-time note because your competition's public results appear on AwardHome Dance.
      <a href="${unsubscribeLink(email)}" style="color: #888;">Unsubscribe</a> and we won't email you again.
    </p>
  </div>`;
}

// How long a mailed claim link stays valid.
const ORG_CLAIM_TOKEN_DAYS = 30;

// Defensive twin of the initDb DDL (same pattern as /admin/settings): lets
// the invite + claim routes work even before `node database.js` re-runs.
async function ensureOrgInviteTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS org_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      message_id TEXT,
      sent_by INTEGER REFERENCES users(id),
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS org_claim_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES organizations(id),
      invite_id INTEGER REFERENCES org_invites(id),
      token TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      used_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// Validate + send + record. Resends are allowed (letters are hand-composed
// and relationships are 1:1 high-value); the compose UI warns instead.
// If the body contains {CLAIM_LINK}, a single-use claim token is minted and
// substituted before sending — the recorded body is the letter as sent,
// actual link included. Deleting the placeholder sends a link-free letter.
async function sendOrgInvite(orgId, { email, subject, body, sentBy = null }) {
  const db = await openDb();
  await ensureOrgInviteTables(db);
  const org = await db.get('SELECT * FROM organizations WHERE id = ?', [orgId]);
  if (!org) return { success: false, error: 'Organization not found' };
  if (org.owner_id) return { success: false, error: 'Organization already claimed' };

  email = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, error: 'Invalid email address' };
  if (!String(subject || '').trim()) return { success: false, error: 'Subject is required' };
  if (!String(body || '').trim()) return { success: false, error: 'Letter body is required' };

  const suppressed = await db.get('SELECT 1 FROM email_suppressions WHERE email = ?', [email.toLowerCase()]);
  if (suppressed) return { success: false, error: 'Recipient unsubscribed' };

  let finalBody = body;
  let tokenRowId = null;
  if (body.includes('{CLAIM_LINK}')) {
    const token = crypto.randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + ORG_CLAIM_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const ins = await db.run(
      'INSERT INTO org_claim_tokens (org_id, token, email, expires_at) VALUES (?, ?, ?, ?)',
      [orgId, token, email, expires]
    );
    tokenRowId = ins.lastID;
    finalBody = body.split('{CLAIM_LINK}').join(`${BASE_URL}/claim/org/${token}`);
  }

  const result = await sendEmail({
    to: email,
    subject: subject.trim(),
    html: orgInviteHtml(finalBody, email),
    headers: {
      'List-Unsubscribe': `<${unsubscribeLink(email)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  });
  if (!result.success) {
    if (tokenRowId) await db.run('DELETE FROM org_claim_tokens WHERE id = ?', [tokenRowId]);
    return { success: false, error: 'Send failed: ' + JSON.stringify(result.error).slice(0, 200) };
  }

  const inv = await db.run(
    'INSERT INTO org_invites (org_id, email, subject, body, message_id, sent_by) VALUES (?, ?, ?, ?, ?, ?)',
    [orgId, email, subject.trim(), finalBody, result.data && result.data.id, sentBy]
  );
  if (tokenRowId) await db.run('UPDATE org_claim_tokens SET invite_id = ? WHERE id = ?', [inv.lastID, tokenRowId]);
  return { success: true, to: email, messageId: result.data && result.data.id };
}

module.exports = { buildStudioInvite, sendStudioInvite, buildOrgInviteTemplate, sendOrgInvite, ensureOrgInviteTables, unsubscribeToken, unsubscribeLink };
