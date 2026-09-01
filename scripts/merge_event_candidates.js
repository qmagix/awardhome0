// Auto-merge event candidates into the organizer's own data once it lands
// (mobile design v2 §6.4, development plan M2).
//
// A family creates a candidate because AwardHome had never heard of their
// competition. Weeks later the organizer's results import creates the real
// event. At that moment the candidate stops being provisional — it IS that
// event — and no human should have to notice.
//
// This is the second of the two promotion paths, and the cheaper one: the
// organizer's published data is higher authority by definition, so merging
// into it needs no reviewer. The other path is a human at
// /admin/event-candidates.
//
// THE SAFETY RULE: auto-merge only on an UNAMBIGUOUS match. Exactly one
// canonical event of the same organization and year whose name is a strong
// match. Two plausible events is a tour with two nearby stops, and picking one
// would attach a family's award to the wrong weekend — so ambiguity is left
// for the queue, never guessed. This is the same principle as
// resolveOrCreateDancer refusing to guess between same-name dancers.
//
// Idempotent: merged candidates are never revisited. Safe to run repeatedly,
// which is why the weekly pipeline can call it unconditionally.
//
// Usage (repo root):
//   node scripts/merge_event_candidates.js            # dry run
//   node scripts/merge_event_candidates.js --apply
const { openDb } = require('../database');
const { openSubmissionsDb } = require('../utils/submissionsDb');
const { findCanonicalMatches, mergeCandidateIntoEvent } = require('../utils/eventCandidates');

// Above the reviewer-suggestion threshold: a suggestion only has to be worth
// a human's glance, an automatic merge has to be right.
const AUTO_MERGE_SCORE = parseFloat(process.env.CANDIDATE_AUTOMERGE_SCORE) || 0.75;

async function run({ apply = false } = {}) {
  const db = await openDb();
  const sdb = await openSubmissionsDb();

  const open = await sdb.all("SELECT * FROM event_candidates WHERE status = 'open' ORDER BY id");
  const result = { scanned: open.length, merged: [], ambiguous: [], unmatched: 0 };

  for (const cand of open) {
    const matches = await findCanonicalMatches(db, cand);
    const strong = matches.filter(m => m.score >= AUTO_MERGE_SCORE);

    if (strong.length === 1) {
      const submissions = (await sdb.get(
        'SELECT COUNT(*) AS n FROM award_submissions WHERE event_candidate_id = ?', [cand.id])).n;
      if (apply) {
        await mergeCandidateIntoEvent(db, sdb, {
          candidateId: cand.id, eventId: strong[0].id, auto: true,
        });
      }
      result.merged.push({
        candidate_id: cand.id, candidate: cand.name,
        event_id: strong[0].id, event: strong[0].name,
        score: Number(strong[0].score.toFixed(2)), submissions,
      });
    } else if (strong.length > 1) {
      // Deliberately untouched. Left for /admin/event-candidates, where the
      // suggestions this same matcher produced are shown to a human.
      result.ambiguous.push({
        candidate_id: cand.id, candidate: cand.name,
        options: strong.map(m => ({ id: m.id, name: m.name, score: Number(m.score.toFixed(2)) })),
      });
    } else {
      result.unmatched++;
    }
  }
  return result;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const r = await run({ apply });

  console.log(`scanned ${r.scanned} open candidate(s)`);
  for (const m of r.merged) {
    console.log(`  MERGE  #${m.candidate_id} "${m.candidate}" -> event ${m.event_id} "${m.event}" ` +
      `(score ${m.score}, ${m.submissions} submission(s))`);
  }
  for (const a of r.ambiguous) {
    console.log(`  QUEUE  #${a.candidate_id} "${a.candidate}" — ${a.options.length} plausible events, ` +
      'left for a human: ' + a.options.map(o => `${o.id}(${o.score})`).join(', '));
  }
  console.log(`\n  auto-merged : ${r.merged.length}`);
  console.log(`  ambiguous   : ${r.ambiguous.length} (review at /admin/event-candidates)`);
  console.log(`  no match yet: ${r.unmatched}`);
  console.log(apply ? 'APPLIED.' : 'Dry run — re-run with --apply to write.');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { run, AUTO_MERGE_SCORE };
