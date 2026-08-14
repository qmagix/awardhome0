// Machine moderation for thank-you notes (photos stay human-reviewed —
// higher stakes, lower volume). Three tiers, cheapest first:
//   1. Rules: contact info / links (spam vectors AND child-safety PII —
//      a note must never publish a minor's phone or handle) + profanity.
//   2. Trusted authors: an account with several already-approved notes
//      and a rules-clean text skips the API call.
//   3. OpenAI Moderation API (omni-moderation — free) for content the
//      rules can't judge. API failure NEVER auto-approves: the note just
//      stays in the human queue, exactly like before this pipeline.
// The moderation_mode system setting decides what a clean verdict does:
//   'manual'   — pipeline off, everything queues (launch default)
//   'assisted' — verdicts shown as hints in the queue, humans still click
//   'auto'     — clean notes go live immediately; flagged ones queue
const { openDb } = require('../database');

const URL_RE = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|io|co|app|me|link|xyz)\b/i;
const EMAIL_RE = /\b[^\s@]+@[^\s@]+\.[^\s@]{2,}\b/;
// 7+ digits allowing separators — catches phone numbers without flagging years
const PHONE_RE = /(?:\d[\s\-.()]*){7,}/;
const HANDLE_RE = /(^|\s)@[a-z0-9_.]{3,}/i;
// Deliberately small profanity list: the LLM tier catches the long tail;
// this exists so the obvious cases never even cost an API call.
const PROFANITY = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'whore', 'slut', 'nigger', 'faggot', 'retard'];

function ruleCheck(text) {
  const reasons = [];
  const lower = ` ${text.toLowerCase()} `;
  if (URL_RE.test(text)) reasons.push('link');
  if (EMAIL_RE.test(text)) reasons.push('email address');
  if (PHONE_RE.test(text)) reasons.push('phone number');
  if (HANDLE_RE.test(text)) reasons.push('social handle');
  if (PROFANITY.some(w => lower.includes(` ${w}`) || lower.includes(`${w} `))) reasons.push('language');
  return reasons;
}

async function isTrustedAuthor(db, userId) {
  if (!userId) return false;
  const row = await db.get(
    "SELECT COUNT(*) as n FROM award_acknowledgements WHERE created_by = ? AND status = 'approved'", [userId]);
  return row && row.n >= 3;
}

async function llmCheck(text) {
  if (!process.env.OPENAI_API_KEY) return { available: false };
  try {
    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const result = await openai.moderations.create({
      model: 'omni-moderation-latest',
      input: text,
    });
    const r = result.results && result.results[0];
    if (!r) return { available: false };
    const flagged = Object.entries(r.categories || {}).filter(([, v]) => v).map(([k]) => k);
    return { available: true, flagged };
  } catch (err) {
    console.error('[moderation] OpenAI moderation call failed:', err.message);
    return { available: false };
  }
}

// Returns { verdict: 'approve' | 'review', note: string } — `note` lands
// in award_acknowledgements.moderation_note for the admin queue.
async function moderateNote(text, authorUserId) {
  const db = await openDb();
  const reasons = ruleCheck(text);
  if (reasons.length) {
    return { verdict: 'review', note: 'flagged: ' + reasons.join(', ') };
  }
  if (await isTrustedAuthor(db, authorUserId)) {
    return { verdict: 'approve', note: 'machine-clean (trusted author)' };
  }
  const llm = await llmCheck(text);
  if (!llm.available) {
    return { verdict: 'review', note: 'machine check unavailable' };
  }
  if (llm.flagged.length) {
    return { verdict: 'review', note: 'flagged: ' + llm.flagged.join(', ') };
  }
  return { verdict: 'approve', note: 'machine-clean' };
}

async function getModerationMode(db) {
  try {
    const row = await db.get("SELECT value FROM system_settings WHERE key = 'moderation_mode'");
    return ['manual', 'assisted', 'auto'].includes(row && row.value) ? row.value : 'manual';
  } catch (e) {
    return 'manual';
  }
}

module.exports = { moderateNote, getModerationMode, ruleCheck };
