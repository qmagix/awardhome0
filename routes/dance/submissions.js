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
  listForDancer, castForSubmissions, normalizeText, consumeHouseholdAction,
} = require('../../utils/submissions');
const { openSubmissionsDb } = require('../../utils/submissionsDb');
const { findEventOptions } = require('../../utils/eventPicker');
const {
  LIFECYCLE, cleanCandidateInput, findDuplicateCandidates, createCandidate,
} = require('../../utils/eventCandidates');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

  // A pre-selected event (the family just created one, or the form is coming
  // back with errors) is resolved to a label so the page can say what is
  // chosen instead of silently holding an id.
  let chosenEvent = null;
  const sdb = await openSubmissionsDb();
  if (form.event_candidate_id) {
    const c = await sdb.get('SELECT * FROM event_candidates WHERE id = ?', [parseInt(form.event_candidate_id, 10)]);
    if (c) chosenEvent = { kind: 'candidate', id: c.id, name: c.name, when: c.start_date, note: 'Added by a family' };
  } else if (form.event_id) {
    const e = await db.get('SELECT id, name, year FROM events WHERE id = ?', [parseInt(form.event_id, 10)]);
    if (e) chosenEvent = { kind: 'event', id: e.id, name: e.name, when: e.year ? String(e.year) : null, note: null };
  } else if (form.upcoming_event_id) {
    const u = await db.get('SELECT id, name, start_date FROM org_upcoming_events WHERE id = ?', [parseInt(form.upcoming_event_id, 10)]);
    if (u) chosenEvent = { kind: 'upcoming', id: u.id, name: u.name, when: u.start_date, note: null };
  }

  const orgs = await db.all('SELECT id, name FROM organizations ORDER BY name');

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
    orgs,
    chosenEvent,
    candidateWindow: LIFECYCLE,
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

// ---- The event picker (M2) -------------------------------------------------
//
// One endpoint, three sources: the organizer's own geocoded tour stops, other
// families' candidates, and canonical historical events (see
// utils/eventPicker.js for why only the first two can answer "am I here?").
// Reads only — picking never writes; the candidate for an organizer stop is
// seeded at submit time.
//
// Backwards-compatible with the M1 `/event-search` path, which the form used
// before the picker existed.
router.get(['/api/dancer/:id/event-picker', '/api/dancer/:id/event-search'], requireAuth, async (req, res) => {
  if (!(await flagOn('family_submissions', req))) return res.status(404).json({ error: 'Not found' });
  const dancer = await loadOwnedDancer(req, res);
  if (!dancer) return;

  const db = await openDb();
  const sdb = await openSubmissionsDb();
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  let lat = num(req.query.lat), lng = num(req.query.lng);
  if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) { lat = null; lng = null; }
  const date = ISO_DATE.test(req.query.date || '') ? req.query.date : null;
  const state = /^[A-Za-z]{2}$/.test(req.query.state || '') ? req.query.state.toUpperCase() : null;

  const options = await findEventOptions(db, sdb, { lat, lng, date, q: normalizeText(req.query.q), state });
  // `events` is kept as an alias so an older cached page keeps working through
  // a deploy rather than silently losing its picker.
  res.json({ options, events: options });
});

// Dedup at creation. The family fills in what they know, and BEFORE the create
// is accepted we show anything that already looks like the same event:
// "Someone here added 'Starquest Spring Classic' 20 minutes ago — is that
// yours?" This is the race that otherwise produces two candidates for one
// competition within minutes, so the check runs on the server, not the client.
router.post('/api/dancer/:id/event-candidates/check', requireAuth, async (req, res) => {
  if (!(await flagOn('family_submissions', req))) return res.status(404).json({ error: 'Not found' });
  const dancer = await loadOwnedDancer(req, res);
  if (!dancer) return;

  const { ok, errors, values } = cleanCandidateInput(req.body || {});
  if (!ok) return res.status(400).json({ errors });
  const sdb = await openSubmissionsDb();
  const duplicates = await findDuplicateCandidates(sdb, values);
  res.json({
    duplicates: duplicates.map(c => ({
      id: c.id, name: c.name, start_date: c.start_date, end_date: c.end_date,
      city: c.city, state: c.state, venue: c.venue, status: c.status,
      created_at: c.created_at,
    })),
  });
});

// Create a candidate. NEVER writes a canonical `events` row — that is the
// invariant the whole candidate model exists to hold. `confirm_new` is the
// family saying "I saw those, mine is different"; without it, a likely twin
// comes back as an offer instead of a second row.
//
// JSON rather than a form post so the half-filled award form beside it keeps
// its state — a family who has typed a routine name should not lose it to add
// the event it belongs to.
router.post('/api/dancer/:id/event-candidates', requireAuth, async (req, res) => {
  if (!(await flagOn('family_submissions', req))) return res.status(404).json({ error: 'Not found' });
  const dancer = await loadOwnedDancer(req, res);
  if (!dancer) return;

  const { ok, errors, values } = cleanCandidateInput(req.body || {});
  if (!ok) return res.status(400).json({ errors });

  // Creating an event is a household action like a submission is: unverifiable
  // self-service needs a ceiling, or it becomes the route around review.
  const quota = await consumeHouseholdAction(req.session.user.id, 'submission', null);
  if (!quota.ok) {
    return res.status(429).json({
      errors: [`That is ${quota.limit} entries in 24 hours — the daily limit for one household. ` +
               'Everything already saved is safe; please continue tomorrow.'],
    });
  }

  const sdb = await openSubmissionsDb();
  const { candidate, duplicates, offered } = await createCandidate(sdb, values, {
    userId: req.session.user.id,
    confirmNew: !!(req.body && (req.body.confirm_new === true || req.body.confirm_new === '1')),
  });

  if (offered) {
    return res.json({
      offered: true,
      duplicates: duplicates.map(c => ({
        id: c.id, name: c.name, start_date: c.start_date, end_date: c.end_date,
        city: c.city, state: c.state, venue: c.venue, created_at: c.created_at,
      })),
    });
  }

  res.json({
    offered: false,
    candidate: {
      id: candidate.id, name: candidate.name, start_date: candidate.start_date,
      end_date: candidate.end_date, city: candidate.city, state: candidate.state,
    },
  });
});

module.exports = router;
