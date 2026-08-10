// Repairs PDF-extraction whitespace damage in award category / award_type
// names ("Adult S ol o Award", "Mini/ Petite Odyssey Award", tab-separated
// header fragments). The pdf2json extractor emits text in fragments; joining
// them with ' ' scattered spaces mid-word and left tabs between columns.
//
// The true spacing is reconstructible from content: a real word break is
// followed by an Uppercase word (or a legit lowercase word like "of"); a
// lowercase-starting fragment is the tail of a split word and belongs glued
// to the previous token, as does anything at a '/' boundary. All whitespace
// runs (tabs included) collapse to single spaces.
const LOWER_OK = new Set(['of', 'the', 'and', 'in', 'on', 'at', 'to', 'for', 'with', 'by']);

function normalizeName(raw) {
  if (!raw) return raw;
  const tokens = String(raw).trim().split(/\s+/);
  const out = [];
  for (const t of tokens) {
    const prev = out.length ? out[out.length - 1] : null;
    const glue = prev !== null && (
      t.startsWith('/') ||
      prev.endsWith('/') ||
      (/^[a-z]/.test(t) && !LOWER_OK.has(t.toLowerCase()))
    );
    if (glue) out[out.length - 1] = prev + t;
    else out.push(t);
  }
  return out.join(' ');
}

// Grouping key: same name modulo ALL whitespace (survives damage the token
// heuristic can't fix alone, e.g. "o f" → "Studioof").
function nameKey(raw) {
  return String(raw || '').toLowerCase().replace(/\s+/g, '');
}

module.exports = { normalizeName, nameKey };
