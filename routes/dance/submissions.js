// Family award submissions — the WEB surface (development plan M1).
//
// The mobile app is milestones away, but every capability it needs is also
// useful here first: this is the same domain service the M5 API will call, on
// a surface we already know how to ship. It proves the riskiest part — data
// integrity of family-entered awards — with real users before a single mobile
// screen exists.
//
// What this router may and may not do:
//   * MAY write to the submissions staging file (submissions.sqlite).
//   * MAY NOT write anything canonical. No events row, no awards row, no
//     award_dancers link. Promotion is M3's job and runs behind a reviewer.
//   * Submissions are private to the household that made them. Nothing here
//     renders on a public page, and no public route reads the staging file.
//
// Behind the `family_submissions` feature flag: dark on deploy, released at
// /admin/features. Flag off = 404, the same shape the reactions endpoints use.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { openDb } = require('../../database');
const { requireAuth } = require('../../middleware/auth');
const { flagOn } = require('../../utils/featureFlags');
const {
  GROUP_SIZES, LIMITS, dancerStudios, validateSubmission, createSubmission,
  listForDancer, castForSubmissions, normalizeText,
} = require('../../utils/submissions');

// Ownership: the household that claimed this dancer, plus site admins. Same
// rule the rest of /manage/dancer/* uses — ownership is an owner_id column,
// never a role.
async function loadOwnedDancer(req, res) {
  const db = await openDb();
  const dancer = await db.get('SELECT * FROM dancers WHERE id = ?', [req.params.id]);
  if (!dancer) { res.status(404).send('Dancer not found'); return null; }
  const { id: userId, role } = req.session.user;
  if (dancer.claimed_by_user_id !== userId && role !== 'admin' && role !== 'superadmin') {
    res.status(403).send('Forbidden: Not the owner');
    return null;
  }
  return dancer;
}

// A feature that is dark must be indistinguishable from one that does not
// exist — 404, not 403.
async function requireFlag(req, res) {
  if (await flagOn('family_submissions', req)) return true;
  res.status(404).send('Not found');
  return false;
}

// Render the private submissions page. `form` carries back what the family
// typed when validation failed, so a rejected submit never empties the form.
async function renderPage(req, res, dancer, { errors = [], form = {}, notice = null, status = 200 } = {}) {
  const db = await openDb();
  const affiliations = await dancerStudios(db, dancer.id);
  const submissions = await listForDancer(dancer.id, req.session.user.id);
  const cast = await castForSubmissions(submissions.map(s => s.id));

  res.status(status).render('manage_dancer_submissions', {
    dancer,
    affiliations,
    submissions,
    cast,
    groupSizes: GROUP_SIZES,
    dailyLimit: LIMITS.submission,
    errors,
    notice,
    form,
    // One idempotency key per rendered form. A double-click, a refresh-resend,
    // or a back-then-resubmit all carry the SAME key and therefore return the
    // original row instead of a second award — the web analogue of the mobile
    // client's offline retry, and the same contract the M5 API will honour.
    clientSubmissionId: form.client_submission_id || crypto.randomUUID(),
    pageTitle: `Add an award — ${dancer.name}`,
  });
}

router.get('/manage/dancer/:id/submissions', requireAuth, async (req, res) => {
  if (!(await requireFlag(req, res))) return;
  const dancer = await loadOwnedDancer(req, res);
  if (!dancer) return;
  const notice = req.query.added
    ? 'Saved. It is pending review — you can see it below; nobody else can see it yet.'
    : (req.query.duplicate ? 'That submission was already saved — we kept the original.' : null);
  await renderPage(req, res, dancer, { notice });
});

router.post('/manage/dancer/:id/submissions', requireAuth, async (req, res) => {
  if (!(await requireFlag(req, res))) return;
  const dancer = await loadOwnedDancer(req, res);
  if (!dancer) return;
  const db = await openDb();

  const { ok, errors, value } = await validateSubmission(db, req.body || {}, {
    dancerId: dancer.id,
    userId: req.session.user.id,
  });
  if (!ok) return renderPage(req, res, dancer, { errors, form: req.body || {}, status: 400 });

  const { submission, idempotent, limit } = await createSubmission(value, value.cast);
  if (!submission) {
    return renderPage(req, res, dancer, {
      errors: [`That is ${limit.limit} submissions in 24 hours — the daily limit for one household. ` +
               'Everything already saved is safe; please continue tomorrow, or contact us if you have a big weekend to enter.'],
      form: req.body || {},
      status: 429,
    });
  }
  res.redirect(`/manage/dancer/${dancer.id}/submissions?${idempotent ? 'duplicate' : 'added'}=1`);
});

// Event picker, M1 edition: CANONICAL EVENTS ONLY. Families cannot create an
// event here — `event_candidates` and the geo/date picker are M2. The
// invariant that survives both: no canonical `events` row is ever written by
// a family action.
router.get('/api/dancer/:id/event-search', requireAuth, async (req, res) => {
  if (!(await flagOn('family_submissions', req))) return res.status(404).json({ error: 'Not found' });
  const dancer = await loadOwnedDancer(req, res);
  if (!dancer) return;

  const q = normalizeText(req.query.q);
  if (!q || q.length < 2) return res.json({ events: [] });
  const db = await openDb();
  const events = await db.all(`
    SELECT e.id, e.name, e.year, e.date_string, o.name AS org_name
    FROM events e
    LEFT JOIN organizations o ON o.id = e.org_id
    WHERE e.name LIKE ? OR o.name LIKE ?
    ORDER BY CAST(e.year AS INTEGER) DESC, e.name
    LIMIT 25
  `, [`%${q}%`, `%${q}%`]);
  res.json({ events });
});

module.exports = router;
