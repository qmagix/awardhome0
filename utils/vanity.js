// Vanity tag: a dancer-chosen decoration displayed as "#Tag" next to the
// canonical unique_id. It is NEVER part of the ID itself — the ID stays
// immutable and is the only thing synced across apps. Tags are not
// required to be unique (pure display, nothing joins on them).

// Kid-facing platform: tight charset, short length, and a blocklist so
// tags can't impersonate the platform or slip in obvious profanity.
const BLOCKED_SUBSTRINGS = [
  'admin', 'awardhome', 'official', 'moderator', 'staff', 'support',
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'whore',
  'slut', 'nigger', 'nigga', 'faggot', 'retard', 'rape', 'nazi',
  'hitler', 'porn', 'sex', 'anal', 'penis', 'vagina', 'boob',
];

// 3-16 chars, starts and ends alphanumeric, middle may add _ . -
const TAG_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_.\-]{1,14})?[A-Za-z0-9]$/;

// Returns { ok: true, tag } (tag null = clear) or { ok: false, error }.
function validateVanityTag(raw) {
  if (raw === undefined || raw === null) return { ok: true, tag: null };
  let tag = String(raw).trim().replace(/^#+/, '');
  if (tag === '') return { ok: true, tag: null };
  if (tag.length < 3 || tag.length > 16) {
    return { ok: false, error: 'Tag must be 3-16 characters.' };
  }
  if (!TAG_RE.test(tag)) {
    return { ok: false, error: 'Tag can use letters, numbers, dots, dashes and underscores, and must start and end with a letter or number.' };
  }
  const lower = tag.toLowerCase().replace(/[_.\-]/g, '');
  for (const bad of BLOCKED_SUBSTRINGS) {
    if (lower.includes(bad)) {
      return { ok: false, error: 'That tag is not available.' };
    }
  }
  return { ok: true, tag };
}

module.exports = { validateVanityTag };
