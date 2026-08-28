// Partners page: inbound mini media-kit + inquiry form for sponsors, press,
// and organizers arriving through the front door (outbound org outreach stays
// the primary organizer channel — see org_invite_draft.md).
//
// Deliberate decisions (2026-08-27, see docs/organizer_dashboard_plan.md +
// TODOS): NO public investor page (industry norm — investor inbound via a
// public form is ~100% spam; a quiet "other inquiries" mailto line covers it),
// NO AI-assisted intake (simple form + email routing wins at this volume).
// This route is intentionally OUTSIDE the beta gate: it must work for
// outsiders during the pre-launch invite window.
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { openDb } = require('../database');
const { cached } = require('../utils/cache');

const CATEGORIES = ['sponsor', 'press', 'organizer', 'other'];

const inquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many messages — please try again later.',
});

async function ensureTable(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS partner_inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT,
    email TEXT NOT NULL,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

async function platformStats() {
  return cached('partner-stats', 10 * 60 * 1000, async () => {
    const db = await openDb();
    const one = async (sql) => (await db.get(sql)).c;
    return {
      awards: await one('SELECT COUNT(*) c FROM awards'),
      events: await one('SELECT COUNT(*) c FROM events'),
      orgs: await one('SELECT COUNT(*) c FROM organizations WHERE slug IS NOT NULL'),
      dancers: await one('SELECT COUNT(*) c FROM dancers'),
    };
  });
}

router.get('/partners', async (req, res) => {
  try {
    const stats = await platformStats();
    res.render('partners', { stats, sent: req.query.sent === '1', user: req.session.user || null });
  } catch (err) {
    console.error('Partners page failed:', err);
    res.status(500).send('Server error');
  }
});

router.post('/partners', inquiryLimiter, async (req, res) => {
  const { name, company, email, category, message, website } = req.body || {};
  // Honeypot: real users never fill the hidden "website" field.
  if (website) return res.redirect('/partners?sent=1');
  if (!name || !email || !message || !CATEGORIES.includes(category)) {
    return res.status(400).send('Please fill in your name, email, category, and message.');
  }
  if (String(message).length > 4000 || String(name).length > 200 ||
      String(company || '').length > 200 || String(email).length > 200) {
    return res.status(400).send('Message too long.');
  }
  try {
    const db = await openDb();
    await ensureTable(db);
    await db.run(
      'INSERT INTO partner_inquiries (name, company, email, category, message) VALUES (?, ?, ?, ?, ?)',
      [String(name).trim(), String(company || '').trim(), String(email).trim(), category, String(message).trim()]
    );
    // Notify reviewers; inquiry is stored regardless of email success.
    try {
      const { getReviewerEmails } = require('../utils/reviewers');
      const { sendEmail } = require('../utils/mailer');
      const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = `<p><strong>${esc(category)}</strong> inquiry from the partners page:</p>
<p><strong>${esc(name)}</strong>${company ? ' — ' + esc(company) : ''}<br>${esc(email)}</p>
<blockquote>${esc(message).replace(/\n/g, '<br>')}</blockquote>`;
      for (const to of await getReviewerEmails()) {
        await sendEmail({ to, subject: `[AwardHome] Partner inquiry — ${category}${company ? ' — ' + company : ''}`, html });
      }
    } catch (e) {
      console.error('Partner inquiry email failed (inquiry stored):', e.message);
    }
    res.redirect('/partners?sent=1');
  } catch (err) {
    console.error('Partner inquiry insert failed:', err);
    res.status(500).send('Server error — please email hello@awardhome.com instead.');
  }
});

module.exports = router;
