// QA test tenant: seed and remove fake entities for manual walkthroughs
// on prod (or locally) without ever touching real studios/dancers.
//
// Design decision (2026-08-21): NO is_test filtering on discovery
// surfaces — the cost of every future query remembering a filter isn't
// worth it. Instead the fixtures are (a) named so nobody mistakes them
// ("… QA … (please ignore)"), and (b) TRANSIENT: seed before a test
// session, remove right after. A 5-award studio ranks near the bottom of
// 17,000 anyway. Two rules keep this safe:
//   1. Don't leave fixtures seeded overnight — the featured-studio
//      recompute (3:30am) could pick up a fully-configured claimed QA
//      studio.
//   2. Any account you register DURING a walkthrough must use a
//      qa-*@awardhome.com email — that's how `remove` finds it.
//
// Usage:
//   node scripts/qa_fixtures.js seed     # create tenant, print test URLs
//   node scripts/qa_fixtures.js remove   # delete tenant + everything it touched
//   node scripts/qa_fixtures.js status   # what QA rows exist right now
//
// Both commands are idempotent. `remove` is surgical: it only deletes
// rows reachable from the fixture keys below and qa-*@awardhome.com users.
const { openDb } = require('../database');

const ORG_SLUG = 'awardhome-qa';
const ORG_NAME = 'AwardHome QA Competition (please ignore)';
const EVENT_NAME = 'AwardHome QA Classic - Test City';
const STUDIO_UID = 'qa-fixture-studio';
const STUDIO_NAME = 'AwardHome QA Studio (please ignore)';
const DANCER_UID = 'DNC-qa-fixture-dancer';
const DANCER_NAME = 'QA Dancer (please ignore)';
const DANCER2_UID = 'DNC-qa-fixture-dancer-2';
const DANCER2_NAME = 'QA Partner (please ignore)';
const QA_EMAIL_PATTERN = 'qa-%@awardhome.com';

async function seed(db) {
  const year = new Date().getFullYear();

  let org = await db.get('SELECT id FROM organizations WHERE slug = ?', [ORG_SLUG]);
  if (!org) {
    const r = await db.run('INSERT INTO organizations (name, slug) VALUES (?, ?)', [ORG_NAME, ORG_SLUG]);
    org = { id: r.lastID };
  }

  let event = await db.get('SELECT id FROM events WHERE org_id = ? AND name = ?', [org.id, EVENT_NAME]);
  if (!event) {
    const r = await db.run('INSERT INTO events (org_id, name, year) VALUES (?, ?, ?)', [org.id, EVENT_NAME, year]);
    event = { id: r.lastID };
  }

  let studio = await db.get('SELECT id FROM studios WHERE unique_id = ?', [STUDIO_UID]);
  if (!studio) {
    const r = await db.run(
      "INSERT INTO studios (unique_id, name, email, status, is_claimed) VALUES (?, ?, 'qa-studio@awardhome.com', 'active', 0)",
      [STUDIO_UID, STUDIO_NAME]);
    studio = { id: r.lastID };
  }

  const dancers = {};
  for (const [uid, name] of [[DANCER_UID, DANCER_NAME], [DANCER2_UID, DANCER2_NAME]]) {
    let d = await db.get('SELECT id FROM dancers WHERE unique_id = ?', [uid]);
    if (!d) {
      const r = await db.run('INSERT INTO dancers (unique_id, name) VALUES (?, ?)', [uid, name]);
      d = { id: r.lastID };
    }
    dancers[uid] = d.id;
    await db.run('INSERT OR IGNORE INTO dancer_studios (dancer_id, studio_id) VALUES (?, ?)', [d.id, studio.id]);
  }

  // A representative award spread: placed solo, group with two dancers,
  // and a blank-name studio award (exercises the "Studio Awards" group).
  const AWARDS = [
    { name: 'QA Solo Routine', type: 'Top QA Solo 12 - 14', place: '1st', cls: 'adjudication', first: 1, dancers: [DANCER_UID] },
    { name: 'QA Group Routine', type: 'Top QA Small Group', place: '2nd', cls: 'adjudication', first: 0, dancers: [DANCER_UID, DANCER2_UID] },
    { name: '', type: 'Top QA Studio (please ignore)', place: '', cls: 'studio', first: 0, dancers: [] },
  ];
  for (const a of AWARDS) {
    let row = await db.get(
      'SELECT id FROM awards WHERE event_id = ? AND studio_id = ? AND award_type = ? AND performance_name = ?',
      [event.id, studio.id, a.type, a.name]);
    if (!row) {
      const r = await db.run(
        'INSERT INTO awards (event_id, studio_id, performance_name, award_type, category, place, award_class, is_first_place) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [event.id, studio.id, a.name, a.type, '', a.place, a.cls, a.first]);
      row = { id: r.lastID };
    }
    for (const uid of a.dancers) {
      await db.run('INSERT OR IGNORE INTO award_dancers (award_id, dancer_id) VALUES (?, ?)', [row.id, dancers[uid]]);
    }
  }

  console.log('QA tenant seeded. Test surfaces:');
  console.log(`  org:     /dance/org/${ORG_SLUG}`);
  console.log(`  studio:  /dance/studio/${studio.id}   (claim: /claim/studio/${studio.id})`);
  console.log(`  dancer:  /dancer/${DANCER_UID}   (claim: /claim/dancer/${dancers[DANCER_UID]})`);
  console.log(`  event:   /dance/event/${event.id} (admin-only)`);
  console.log('Register test accounts as qa-<anything>@awardhome.com so `remove` can find them.');
  console.log('REMEMBER: run `node scripts/qa_fixtures.js remove` when done — do not leave seeded overnight.');
}

async function collectIds(db) {
  const org = await db.get('SELECT id FROM organizations WHERE slug = ?', [ORG_SLUG]);
  const events = org ? await db.all('SELECT id FROM events WHERE org_id = ?', [org.id]) : [];
  const studio = await db.get('SELECT id FROM studios WHERE unique_id = ?', [STUDIO_UID]);
  const dancers = await db.all('SELECT id FROM dancers WHERE unique_id IN (?, ?)', [DANCER_UID, DANCER2_UID]);
  const users = await db.all('SELECT id, email FROM users WHERE email LIKE ?', [QA_EMAIL_PATTERN]);
  const awardRows = [];
  if (studio) awardRows.push(...await db.all('SELECT id FROM awards WHERE studio_id = ?', [studio.id]));
  for (const e of events) awardRows.push(...await db.all('SELECT id FROM awards WHERE event_id = ?', [e.id]));
  const awardIds = [...new Set(awardRows.map(a => a.id))];
  return { org, events, studio, dancers, users, awardIds };
}

async function remove(db) {
  const { org, events, studio, dancers, users, awardIds } = await collectIds(db);
  const counts = {};
  const run = async (label, sql, params) => {
    const r = await db.run(sql, params).catch(() => ({ changes: 0 }));
    counts[label] = (counts[label] || 0) + (r.changes || 0);
  };
  const inList = (ids) => ids.map(() => '?').join(',');

  if (awardIds.length) {
    await run('removal_tombstones', `DELETE FROM award_dancer_removals WHERE award_id IN (${inList(awardIds)})`, awardIds);
    await run('award_dancers', `DELETE FROM award_dancers WHERE award_id IN (${inList(awardIds)})`, awardIds);
    await run('acknowledgements', `DELETE FROM award_acknowledgements WHERE award_id IN (${inList(awardIds)})`, awardIds);
    await run('card_photos', `DELETE FROM award_card_photos WHERE award_id IN (${inList(awardIds)})`, awardIds);
    await run('awards', `DELETE FROM awards WHERE id IN (${inList(awardIds)})`, awardIds);
    try {
      const { openReactionsDb } = require('../utils/reactions');
      const rdb = await openReactionsDb();
      const r = await rdb.run(`DELETE FROM reactions WHERE award_id IN (${inList(awardIds)})`, awardIds);
      counts['reactions'] = r.changes || 0;
    } catch (e) { /* reactions db unavailable */ }
  }

  const dancerIds = dancers.map(d => d.id);
  if (dancerIds.length) {
    await run('dancer_claims', `DELETE FROM dancer_claims WHERE dancer_id IN (${inList(dancerIds)})`, dancerIds);
    await run('dancer_studios', `DELETE FROM dancer_studios WHERE dancer_id IN (${inList(dancerIds)})`, dancerIds);
    await run('dancers', `DELETE FROM dancers WHERE id IN (${inList(dancerIds)})`, dancerIds);
  }

  if (studio) {
    await run('studio_claims', 'DELETE FROM studio_claims WHERE studio_id = ?', [studio.id]);
    await run('studio_activity', 'DELETE FROM studio_activity WHERE studio_id = ?', [studio.id]);
    await run('studio_invites', 'DELETE FROM studio_invites WHERE studio_id = ?', [studio.id]);
    await run('studios', 'DELETE FROM studios WHERE id = ?', [studio.id]);
  }

  for (const e of events) await run('events', 'DELETE FROM events WHERE id = ?', [e.id]);
  if (org) {
    await run('org_invites', 'DELETE FROM org_invites WHERE org_id = ?', [org.id]);
    await run('organizations', 'DELETE FROM organizations WHERE id = ?', [org.id]);
  }

  const userIds = users.map(u => u.id);
  if (userIds.length) {
    // Claims/dancers created by QA accounts during a walkthrough
    await run('dancer_claims(u)', `DELETE FROM dancer_claims WHERE user_id IN (${inList(userIds)})`, userIds);
    await run('studio_claims(u)', `DELETE FROM studio_claims WHERE user_id IN (${inList(userIds)})`, userIds);
    await run('unclaim dancers', `UPDATE dancers SET claimed_by_user_id = NULL, is_claimed = 0 WHERE claimed_by_user_id IN (${inList(userIds)})`, userIds);
    await run('unclaim studios', `UPDATE studios SET owner_id = NULL, is_claimed = 0 WHERE owner_id IN (${inList(userIds)})`, userIds);
    await run('unclaim orgs', `UPDATE organizations SET owner_id = NULL WHERE owner_id IN (${inList(userIds)})`, userIds);
    await run('feedback', `DELETE FROM feedback WHERE user_id IN (${inList(userIds)})`, userIds);
    await run('users', `DELETE FROM users WHERE id IN (${inList(userIds)})`, userIds);
  }

  console.log('QA tenant removed:', JSON.stringify(counts));
  const left = await collectIds(db);
  const leftovers = (left.org ? 1 : 0) + (left.studio ? 1 : 0) + left.dancers.length + left.users.length + left.awardIds.length;
  console.log(leftovers === 0 ? 'Verified clean — no QA rows remain.' : `WARNING: ${leftovers} QA rows still present!`);
  console.log('Note: cached aggregates (homepage counts) refresh on their own within the cache TTL.');
}

async function status(db) {
  const { org, events, studio, dancers, users, awardIds } = await collectIds(db);
  console.log(JSON.stringify({
    org: !!org, events: events.length, studio: !!studio,
    dancers: dancers.length, awards: awardIds.length,
    qaUsers: users.map(u => u.email),
  }, null, 2));
}

async function main() {
  const cmd = process.argv[2];
  const db = await openDb();
  if (cmd === 'seed') await seed(db);
  else if (cmd === 'remove') await remove(db);
  else if (cmd === 'status') await status(db);
  else {
    console.log('Usage: node scripts/qa_fixtures.js seed|remove|status');
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
