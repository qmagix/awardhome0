// UBC (Universal Ballet Competition) results → reviewable txt.
// Two-step convention: this script only writes tobeprocessed/ubc/txt/;
// scripts/import_ubc_txt.js imports after human review.
//
// Usage: node scripts/extract_ubc.js [--from=2022] [--to=2026] [--id=N]
//
// Source: the registration backend at
//   api.reg.universalballetcompetition.com/public/results.cfm?event_id=N
// (the marketing site is behind Cloudflare, the API is not; season_id in
// the site's links is ignored by the server — event_id alone selects the
// event). The results page carries NO date, and the public site lists only
// the current season, so event_id → city/date/season comes from the
// committed map scripts/seed/ubc_events.json, built once from the site
// plus Wayback snapshots of past-season index pages (their "?id=N" links
// gave the ids; each row's city was cross-checked against the API page's
// own "Results for X" header — 81/81 matched).
//
// Page shapes (one linear flow of section headers + numbered placements):
//   solo      : "N. DANCER NAME"  then  "ROUTINE - STUDIO"
//   duo/trio  : "N. ROUTINE"      then  "Dancer, Dancer - STUDIO"
//   ensemble  : "N. Routine - Studio"            (no dancer names)
//   plus a leading "Additional Awards" block: award label then recipient.
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const ROOT = path.join(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'raw', 'ubc');
const OUT_DIR = path.join(ROOT, 'tobeprocessed', 'ubc', 'txt');
const SEED = path.join(__dirname, 'seed', 'ubc_events.json');
const API = 'https://api.reg.universalballetcompetition.com/public/results.cfm?event_id=';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const arg = (k, d) => {
  const a = process.argv.find(x => x.startsWith(`--${k}=`));
  return a ? a.split('=')[1] : d;
};
const FROM = Number(arg('from', 2022));
const TO = Number(arg('to', 2026));
const ONLY_ID = arg('id', '');

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function pageToLines(html) {
  let t = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '\n');
  // the backend emits uppercase HTML entities
  t = t.replace(/&EACUTE;/gi, 'é').replace(/&AACUTE;/gi, 'á').replace(/&IACUTE;/gi, 'í')
    .replace(/&OACUTE;/gi, 'ó').replace(/&UACUTE;/gi, 'ú').replace(/&NTILDE;/gi, 'ñ')
    .replace(/&UUML;/gi, 'ü').replace(/&OUML;/gi, 'ö').replace(/&AUML;/gi, 'ä')
    .replace(/&AMP;/gi, '&').replace(/&QUOT;/gi, '"').replace(/&#0?39;|&APOS;/gi, "'")
    .replace(/&NBSP;/gi, ' ').replace(/&LT;/gi, '<').replace(/&GT;/gi, '>');
  return t.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const PLACE_RE = /^(\d{1,2})\.\s*(.*)$/;
// section headers are all-caps and not numbered placements
const isHeader = (l) => !PLACE_RE.test(l) && l === l.toUpperCase() && /[A-Z]/.test(l) && l.length < 70;

async function fetchEvent(id, year) {
  const cache = path.join(RAW_DIR, String(year), `${id}.html`);
  if (fs.existsSync(cache)) return fs.readFileSync(cache, 'utf8');
  const res = await axios.get(API + id, { headers: { 'User-Agent': UA }, timeout: 30000, maxRedirects: 5 });
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, res.data);
  await new Promise(r => setTimeout(r, 400));
  return res.data;
}

function extract(lines) {
  const rows = [];
  const flags = [];
  let section = '';
  let mode = 'solo';       // solo | duo | ensemble | additional
  let pending = null;      // first line of a two-line placement

  const flush = () => {
    if (!pending) return;
    // a placement whose second line never arrived
    rows.push({ ...pending, routine: pending.routine || '', dancers: pending.dancers || '', studio: '' });
    pending = null;
  };
  // "ROUTINE - STUDIO" → split on the LAST " - " (routine titles contain dashes)
  const splitTail = (s) => {
    const i = s.lastIndexOf(' - ');
    return i === -1 ? { left: s.trim(), right: '' } : { left: s.slice(0, i).trim(), right: s.slice(i + 3).trim() };
  };

  for (const line of lines) {
    if (/^Results for /i.test(line)) continue;
    if (/^Additional Awards$/i.test(line)) { flush(); section = 'ADDITIONAL AWARDS'; mode = 'additional'; continue; }

    // A pending placement always owns the very next line — routine/studio
    // lines are often ALL CAPS ("LA FILLE MAL GARDEE - INFINITY DANCE
    // STUDIO INC.") and would otherwise look like section headers.
    if (pending && mode !== 'additional') {
      const { left, right } = splitTail(line);
      if (mode === 'duo') { pending.dancers = left; pending.studio = right; }
      else { pending.routine = left; pending.studio = right; }
      rows.push(pending);
      pending = null;
      continue;
    }

    // Section headers are ALL CAPS; the Additional Awards labels are Title
    // Case, so an all-caps line always ends that block.
    if (isHeader(line)) {
      flush();
      section = line;
      mode = /ENSEMBLE/.test(line) ? 'ensemble' : (/DUO|TRIO|PAS DE DEUX/.test(line) ? 'duo' : 'solo');
      continue;
    }
    if (mode === 'additional') {
      // award label line followed by recipient line
      if (!pending) pending = { section, place: '', award: line, routine: '', dancers: '', studio: '' };
      else { rows.push({ section, place: '', award: pending.award, routine: '', dancers: line, studio: '' }); pending = null; }
      continue;
    }

    const pm = line.match(PLACE_RE);
    if (pm) {
      flush();
      const place = pm[1];
      const rest = pm[2].trim();
      if (mode === 'ensemble') {
        const { left, right } = splitTail(rest);
        rows.push({ section, place, award: '', routine: left, dancers: '', studio: right });
      } else if (mode === 'duo') {
        pending = { section, place, award: '', routine: rest, dancers: '', studio: '' };
      } else {
        pending = { section, place, award: '', routine: '', dancers: rest, studio: '' };
      }
      continue;
    }

    if (pending) {
      const { left, right } = splitTail(line);
      if (mode === 'duo') { pending.dancers = left; pending.studio = right; }
      else { pending.routine = left; pending.studio = right; }
      rows.push(pending);
      pending = null;
      continue;
    }
    if (line.length > 2) flags.push(`UNPARSED (section "${section}"): ${line}`);
  }
  flush();
  return { rows, flags };
}

async function main() {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let files = 0, totalRows = 0, totalFlags = 0;

  for (const [id, meta] of Object.entries(seed).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (ONLY_ID && id !== ONLY_ID) continue;
    if (!ONLY_ID && (meta.year < FROM || meta.year > TO)) continue;

    let html;
    try { html = await fetchEvent(id, meta.year); }
    catch (err) { console.log(`[${id}] FETCH FAILED (${meta.city}): ${err.message}`); continue; }

    const { rows, flags } = extract(pageToLines(html));
    if (!rows.length) { console.log(`[${id}] ${meta.date} ${meta.city} — no placements (cancelled/unpublished), skipped`); continue; }

    const isFinals = /grand prix finals/i.test(meta.city);
    const cityClean = meta.city.replace(/UBC Grand Prix Finals/i, '')
      .replace(/GRAND PRIX FINALS/i, '').replace(/^[\s–-]+|[\s,–-]+$/g, '').trim();
    const eventName = isFinals
      ? `UBC ${meta.year} Grand Prix Finals${cityClean ? ' - ' + cityClean : ''}`
      : `UBC ${meta.year} ${meta.city}`;

    const out = [
      `# UBC ${meta.season} season — extracted ${new Date().toISOString().slice(0, 10)} from ${API}${id}`,
      `# Date/city from scripts/seed/ubc_events.json (site + Wayback index pages; city cross-checked against the results page header)`,
      `Event: ${eventName}`,
      `Year: ${meta.year}`,
      `Date: ${meta.date}`,
      `City: ${meta.city}`,
      `SourceURL: ${API}${id}`,
      `# Format: Sec | Place | Award | Routine | Dancers | Studio`,
      '',
      ...rows.map(r => `Sec: ${r.section} | Place: ${r.place} | Award: ${r.award || '-'} | Routine: ${r.routine || '-'} | Dancers: ${r.dancers || '-'} | Studio: ${r.studio || '-'}`),
    ];
    if (flags.length) out.push('', `# ---- ${flags.length} FLAGGED LINES (review) ----`, ...flags.map(f => `# ${f}`));

    const file = path.join(OUT_DIR, `${meta.date}-${id}-${slug(cityClean || meta.city)}.txt`);
    fs.writeFileSync(file, out.join('\n') + '\n');
    files++; totalRows += rows.length; totalFlags += flags.length;
    console.log(`[${id}] ${meta.date} ${eventName} — ${rows.length} rows${flags.length ? `, ${flags.length} flagged` : ''}`);
  }
  console.log(`\n${files} events → ${totalRows} rows, ${totalFlags} flagged. Review ${path.relative(ROOT, OUT_DIR)} before importing.`);
}

main().catch(err => { console.error(err); process.exit(1); });
