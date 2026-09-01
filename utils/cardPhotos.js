// Award card photo review, delegated to the people who were there
// (Q's decision, 2026-08-31; folded into development plan M3).
//
// THE BOTTLENECK THIS REMOVES. Every award card photo used to need a
// superadmin at /admin/card-content before it could go public. That is
// review scaling with AwardHome's headcount — the same ceiling the studio
// reviewer inbox exists to break for submissions. Photos have it worse,
// because a family uploads one per routine per season.
//
// THE LADDER, and who decides at each rung:
//
//   1. UPLOAD -> TEAM-VISIBLE. A pending photo is immediately visible to the
//      families of the dancers ON THAT AWARD, and to nobody else. This rung
//      is doing real work: a group photo shows other people's children, and
//      those families are the only ones who can say whether it should be
//      seen. Cross-studio collaborations make this necessary rather than
//      merely nice — a pseudo-studio routine's cast spans studios, so the
//      studio owner alone cannot speak for everyone pictured.
//
//   2. OBJECTION -> STOP. One objection from a cast family blocks studio
//      approval and sends the photo to AwardHome. Not a vote count: the pool
//      is a handful of families, and a single "that's my child and no"
//      deserves to win. Objections reuse `content_flags`, so an objection and
//      a public report are the same record with the same audit trail.
//
//   3. NO OBJECTION -> THE STUDIO PUBLISHES. Consent here is passive. A
//      unanimity rule would never fire: most dancers on a big group have no
//      claimed profile, so "everyone approved" would in practice mean "the
//      one family that claimed approved their own photo" — a safeguard that
//      evaporates exactly where the cast is thinnest.
//
//   4. PUBLIC -> COMMUNITY FLAGGING, unchanged. routes/flags.js already
//      darkens approved content on the first report and routes it back to
//      the superadmin queue, and a human reinstate blocks any repeat
//      auto-darkening. That guard is what makes a threshold of one safe
//      against griefing: an attacker gets exactly one dark per photo, ever.
//
// Superadmin becomes exception handling: objections and public reports, not
// volume.

// Is there an unresolved objection or report on this photo? Any open flag
// blocks studio approval — a studio owner must not be able to overrule a
// parent who said no.
async function hasOpenObjection(db, photoId) {
  try {
    const row = await db.get(
      "SELECT COUNT(*) AS n FROM content_flags WHERE content_type = 'award_photo' AND content_id = ? AND status = 'open'",
      [photoId]);
    return !!(row && row.n);
  } catch (e) {
    return false; // table missing until migrate — fail open, superadmin still gates
  }
}

// Photos waiting on THIS studio, with their objection state. Scoped through
// the award, so a studio only ever sees photos on its own routines.
async function pendingForStudio(db, studioId) {
  let rows = [];
  try {
    rows = await db.all(`
      SELECT p.id, p.award_id, p.dancer_id, p.photo_url, p.created_at,
             d.name AS dancer_name, d.unique_id AS dancer_uid,
             a.performance_name, a.award_type, a.category,
             e.name AS event_name, e.year AS event_year,
             u.email AS uploader_email,
             (SELECT COUNT(*) FROM award_dancers ad WHERE ad.award_id = a.id) AS cast_size
      FROM award_card_photos p
      JOIN awards a ON a.id = p.award_id
      JOIN dancers d ON d.id = p.dancer_id
      LEFT JOIN events e ON e.id = a.event_id
      LEFT JOIN users u ON u.id = p.uploaded_by
      WHERE p.status = 'pending' AND a.studio_id = ?
      ORDER BY p.created_at ASC
    `, [studioId]);
  } catch (e) {
    return [];
  }
  for (const r of rows) r.objected = await hasOpenObjection(db, r.id);
  return rows;
}

// Rung 1: pending photos on awards this dancer is IN, uploaded by someone
// else. This is what a family sees of their teammates' photos — the chance
// to object before anything is public.
//
// Deliberately excludes the viewer's own uploads: those already appear in
// their card editor, and a self-objection is not a thing.
async function pendingForCastmates(db, dancerId, userId) {
  try {
    return await db.all(`
      SELECT p.id, p.award_id, p.dancer_id, p.photo_url, p.created_at,
             d.name AS dancer_name,
             a.performance_name, e.name AS event_name, e.year AS event_year,
             EXISTS (SELECT 1 FROM content_flags cf
                     WHERE cf.content_type = 'award_photo' AND cf.content_id = p.id
                       AND cf.flagger_key = ? AND cf.status = 'open') AS i_objected
      FROM award_card_photos p
      JOIN awards a ON a.id = p.award_id
      JOIN dancers d ON d.id = p.dancer_id
      LEFT JOIN events e ON e.id = a.event_id
      WHERE p.status = 'pending'
        AND p.dancer_id != ?
        AND EXISTS (SELECT 1 FROM award_dancers ad
                    WHERE ad.award_id = p.award_id AND ad.dancer_id = ?)
      ORDER BY p.created_at DESC
      LIMIT 50
    `, ['u:' + userId, dancerId, dancerId]);
  } catch (e) {
    return [];
  }
}

// May this account object to this photo? Only a household with a claimed
// dancer in the same routine — the people actually pictured, or whose child
// is. Not the uploader.
//
// This is the gate that makes a threshold of one safe here: owning a claimed
// dancer means passing a human review (the studio director via the studio
// code, or an AwardHome admin), so objectors are reviewed households rather
// than free accounts.
async function canObject(db, userId, photoId) {
  const photo = await db.get('SELECT id, award_id, dancer_id, uploaded_by FROM award_card_photos WHERE id = ?', [photoId]);
  if (!photo) return { ok: false, reason: 'not_found' };
  if (photo.uploaded_by === userId) return { ok: false, reason: 'own_upload' };
  const standing = await db.get(`
    SELECT 1 AS x FROM award_dancers ad
    JOIN dancers d ON d.id = ad.dancer_id
    WHERE ad.award_id = ? AND d.claimed_by_user_id = ?
    LIMIT 1`, [photo.award_id, userId]);
  if (!standing) return { ok: false, reason: 'not_in_cast' };
  return { ok: true, photo };
}

// Rung 3. Approving propagates to identical copies of the same photo by the
// same dancer, matching the same-routine propagation convention the
// superadmin queue already uses: the reviewer judges the image once.
async function studioDecide(db, { photoId, studioId, reviewerId, approve }) {
  const photo = await db.get(`
    SELECT p.id, p.dancer_id, p.photo_url, p.status, a.studio_id
    FROM award_card_photos p JOIN awards a ON a.id = p.award_id
    WHERE p.id = ?`, [photoId]);
  if (!photo) return { ok: false, reason: 'not_found' };
  // Scope: the photo must hang off one of this studio's own awards.
  if (photo.studio_id !== studioId) return { ok: false, reason: 'not_found' };
  if (photo.status !== 'pending') return { ok: false, reason: 'already_decided' };

  if (approve && await hasOpenObjection(db, photoId)) {
    return { ok: false, reason: 'objected' };
  }

  await db.run(`
    UPDATE award_card_photos SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE dancer_id = ? AND photo_url = ? AND status = 'pending'`,
    [approve ? 'approved' : 'rejected', photo.dancer_id, photo.photo_url]);

  // A studio rejection resolves its own objections; it does NOT count as the
  // human reinstate that disarms the auto-dark guard — only a superadmin
  // decision does, because that guard governs public content.
  if (!approve) {
    try {
      await db.run(
        "UPDATE content_flags SET status = 'resolved_removed', resolved_at = CURRENT_TIMESTAMP WHERE content_type = 'award_photo' AND content_id = ? AND status = 'open'",
        [photoId]);
    } catch (e) { /* table missing until migrate */ }
  }
  return { ok: true };
}

const PHOTO_REASON_TEXT = {
  not_found: 'That photo is not on one of your routines.',
  already_decided: 'That photo was already decided.',
  objected: 'A family in this routine objected to this photo, so it has gone to AwardHome to decide. ' +
    'You cannot publish it from here.',
  own_upload: 'That is your own upload.',
  not_in_cast: 'Only families with a dancer in this routine can raise a concern about its photo.',
};

module.exports = {
  hasOpenObjection, pendingForStudio, pendingForCastmates, canObject, studioDecide,
  PHOTO_REASON_TEXT,
};
