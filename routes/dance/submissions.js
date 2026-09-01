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
const { requireAuth, requireStudioOwner } = require('../../middleware/auth');
const { flagOn } = require('../../utils/featureFlags');
const { logStudioActivity } = require('../../utils/activity');
const {
  GROUP_SIZES, LIMITS, dancerStudios, validateSubmission, createSubmission,
  listForDancer, listForStudio, castForSubmissions, normalizeText, consumeHouseholdAction,
} = require('../../utils/submissions');
const {
  CORRECTABLE, REASON_TEXT, confirmSubmission, rejectSubmission, requestInfo, runAutoPromotion,
} = require('../../utils/promotion');
const { openSubmissionsDb } = require('../../utils/submissionsDb');
const { findEventOptions } = require('../../utils/eventPicker');
const {
  LIFECYCLE, cleanCandidateInput, findDuplicateCandidates, createCandidate,
} = require('../../utils/eventCandidates');

const { householdStanding } = require('../../utils/claims');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Who may enter an award for this dancer: the household that claimed her,
// a household whose claim is still PENDING (M8), plus site admins. Ownership
// is an owner_id column, never a role — the same rule the rest of
// /manage/dancer/* uses; this surface additionally admits the pending case
// because staging is not publication.
//
// Every caller of this helper is part of the award-entry flow (the form, the
// submit, the event picker, candidate check and create). Surfaces that
// actually change the dancer's public profile still use the owner-only rule.
async function loadDancerForSubmission(req, res) {
  const db = await openDb();
  const dancer = await db.get('SELECT * FROM dancers WHERE id = ?', [req.params.id]);
  if (!dancer) { res.status(404).send('Dancer not found'); return null; }
  const { id: userId, role } = req.session.user;
  const standing = await householdStanding(db, dancer.id, userId);
  if (!standing && role !== 'admin' && role !== 'superadmin') {
    res.status(403).send('Forbidden: Not the owner');
    return null;
  }
  dancer.standing = standing;
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
    // An independent with no publish grant is keeping a private record, and
    // the page has to say so — otherwise "pending review" names a reviewer
    // who does not exist (M9).
    independentPublish: affiliations.some(a => a.is_independent)
      ? (dancer.independent_publish_status || 'none') : null,
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
  const dancer = await loadDancerForSubmission(req, res);
  if (!dancer) return;
  const NOTICES = {
    added: 'Saved. It is pending review — you can see it below; nobody else can see it yet.',
    duplicate: 'That submission was already saved — we kept the original.',
    independent: 'Saved and published. Because this dancer has no studio, there is no director to ' +
      'confirm it, so it goes live right away — labelled as added by your family until a competition\'s ' +
      'own results confirm it.',
    corroborated: 'Saved and published. Another family recorded the same result independently, which is ' +
      'the strongest confirmation we can get without waiting for anyone.',
    // A different promise from "pending review", and worth keeping distinct:
    // nothing has been sent to anyone yet, and what unblocks it is the claim,
    // not a queue.
    // Named for what it is: kept, not queued. There is no reviewer waiting.
    independent_curating: 'Saved to this dancer\'s private record. There is no studio director to ' +
      'confirm it, so it stays private until another family records the same result — or until ' +
      'AwardHome reviews the record and approves it. Keep adding: nothing is lost by entering the ' +
      'rest of the weekend now.',
    requested: 'Thanks — we\'ll take a look. Because this dancer has no studio director, AwardHome ' +
      'reviews the record once and then everything you have added goes public together, with new ' +
      'entries publishing as you add them.',
    queued: 'Saved to your own list. It will be submitted automatically as soon as your claim on ' +
      'this dancer is approved — nobody else can see it before then, so nothing is lost by ' +
      'entering the rest of the weekend now while you remember it.',
  };
  const notice = req.query.added ? NOTICES.added
    : (req.query.requested ? NOTICES.requested
      : (req.query.queued ? NOTICES.queued
        : (req.query.duplicate ? NOTICES.duplicate : (NOTICES[req.query.auto] || null))));
  await renderPage(req, res, dancer, { notice });
});

// An independent dancer's family asking AwardHome to publish their record.
//
// Only meaningful for an independent: everyone else has a studio director who
// can confirm awards one at a time. This is the ask that exists because there
// is nobody else to ask.
router.post('/manage/dancer/:id/publish-request', requireAuth, async (req, res) => {
  if (!(await requireFlag(req, res))) return;
  const dancer = await loadDancerForSubmission(req, res);
  if (!dancer) return;
  if (dancer.standing !== 'owner') {
    return res.redirect(`/manage/dancer/${dancer.id}/submissions?error=claim_pending`);
  }
  const db = await openDb();
  const indep = await db.get(
    'SELECT 1 AS x FROM dancer_studios ds JOIN studios s ON s.id = ds.studio_id ' +
    'WHERE ds.dancer_id = ? AND COALESCE(s.is_independent, 0) = 1', [dancer.id]);
  if (!indep) return res.redirect(`/manage/dancer/${dancer.id}/submissions`);
  // Only ever moves 'none' -> 'requested'. Asking twice is not an escalation,
  // and asking must never undo a grant already given.
  await db.run(
    "UPDATE dancers SET independent_publish_status = 'requested', " +
    "independent_publish_at = CURRENT_TIMESTAMP " +
    "WHERE id = ? AND IFNULL(independent_publish_status, 'none') = 'none'", [dancer.id]);
  res.redirect(`/manage/dancer/${dancer.id}/submissions?requested=1`);
});

router.post('/manage/dancer/:id/submissions', requireAuth, async (req, res) => {
  if (!(await requireFlag(req, res))) return;
  const dancer = await loadDancerForSubmission(req, res);
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
  // Two paths reach the archive without a reviewer: an independent dancer
  // (no studio owner exists to review them) and corroboration by an unrelated
  // household. Both label honestly rather than claiming a human confirmed it.
  // Never blocks the response — a family's submission is saved either way.
  let auto = { promoted: [], reason: null };
  if (!idempotent) {
    try {
      auto = await runAutoPromotion({ submissionId: submission.id });
    } catch (e) {
      console.error('[submissions] auto-promotion failed:', e.message);
    }
  }
  const flag = idempotent ? 'duplicate=1'
    : (auto.reason === 'independent' ? 'auto=independent'
      : (auto.reason === 'corroborated' ? 'auto=corroborated'
        : (auto.reason === 'independent_curating' ? 'auto=independent_curating'
          : (auto.reason === 'claim_pending' ? 'queued=1' : 'added=1'))));
  res.redirect(`/manage/dancer/${dancer.id}/submissions?${flag}`);
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
  const dancer = await loadDancerForSubmission(req, res);
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
  const dancer = await loadDancerForSubmission(req, res);
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
  const dancer = await loadDancerForSubmission(req, res);
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

// ---- Studio reviewer inbox (M3) --------------------------------------------
//
// THE REVIEWER-ECONOMICS MILESTONE. AwardHome staff review does not scale;
// studio owners already know their dancers, their routines and their results,
// already have a dashboard, and are already motivated — the studio's page is
// the showcase. This is the difference between review scaling with our
// headcount and review scaling with the network.
//
// Scope is enforced twice on every action: requireStudioOwner proves the
// caller owns THIS studio, and each handler then proves the submission
// belongs to it. One check would be enough if ids were never guessable; two
// is what makes "an owner cannot act on another studio's submissions" a
// property rather than a hope.
async function loadStudioSubmission(req, res) {
  const sdb = await openSubmissionsDb();
  const sub = await sdb.get('SELECT * FROM award_submissions WHERE id = ?', [req.params.sid]);
  if (!sub) { res.status(404).send('Submission not found'); return null; }
  if (sub.studio_id !== req.studio.id) {
    // Deliberately 404, not 403: a reviewer poking at ids learns nothing
    // about which submissions exist for other studios.
    res.status(404).send('Submission not found');
    return null;
  }
  return sub;
}

router.get('/manage/studio/:id/submissions', requireAuth, requireStudioOwner, async (req, res) => {
  if (!(await requireFlag(req, res))) return;
  const submissions = await listForStudio(req.studio.id);
  const cast = await castForSubmissions(submissions.map(s => s.id));
  const decided = await listForStudio(req.studio.id, { statuses: ['accepted', 'rejected'] });

  res.render('manage_studio_submissions', {
    studio: req.studio,
    submissions,
    cast,
    decided: decided.slice(0, 25),
    correctable: CORRECTABLE,
    notice: req.query.ok ? 'Confirmed — the award is live on the dancer and studio pages.' : null,
    error: req.query.error || null,
    pageTitle: `Family submissions — ${req.studio.name}`,
  });
});

router.post('/manage/studio/:id/submissions/:sid/confirm', requireAuth, requireStudioOwner, async (req, res) => {
  if (!(await requireFlag(req, res))) return;
  const sub = await loadStudioSubmission(req, res);
  if (!sub) return;

  // Only fields the reviewer actually changed are sent through as
  // corrections, so an untouched form never rewrites the family's words.
  const corrections = {};
  for (const field of CORRECTABLE) {
    if (!(field in req.body)) continue;
    const sent = normalizeText(req.body[field]);
    if (sent !== (sub[field] || null)) corrections[field] = req.body[field];
  }

  const result = await confirmSubmission({
    submissionId: sub.id,
    reviewerId: req.session.user.id,
    corrections,
    note: normalizeText(req.body.note),
  });
  const base = `/manage/studio/${req.studio.id}/submissions`;
  if (!result.ok) {
    return res.redirect(`${base}?error=${encodeURIComponent(REASON_TEXT[result.reason] || 'Could not confirm that submission.')}`);
  }
  logStudioActivity(req.studio.id, 'submission_confirmed');
  res.redirect(`${base}?ok=1`);
});

router.post('/manage/studio/:id/submissions/:sid/reject', requireAuth, requireStudioOwner, async (req, res) => {
  if (!(await requireFlag(req, res))) return;
  const sub = await loadStudioSubmission(req, res);
  if (!sub) return;
  const result = await rejectSubmission({
    submissionId: sub.id, reviewerId: req.session.user.id, note: normalizeText(req.body.note),
  });
  const base = `/manage/studio/${req.studio.id}/submissions`;
  res.redirect(result.ok ? base : `${base}?error=${encodeURIComponent(REASON_TEXT[result.reason] || 'Could not reject that submission.')}`);
});

router.post('/manage/studio/:id/submissions/:sid/ask', requireAuth, requireStudioOwner, async (req, res) => {
  if (!(await requireFlag(req, res))) return;
  const sub = await loadStudioSubmission(req, res);
  if (!sub) return;
  const result = await requestInfo({
    submissionId: sub.id, reviewerId: req.session.user.id, note: normalizeText(req.body.note),
  });
  const base = `/manage/studio/${req.studio.id}/submissions`;
  res.redirect(result.ok ? base : `${base}?error=${encodeURIComponent(REASON_TEXT[result.reason] || 'Could not update that submission.')}`);
});

module.exports = router;
