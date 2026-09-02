// Evidence storage — private certificate photos and results screenshots
// (mobile design v2 §6.3, development plan M5).
//
// EVIDENCE IS PRIVATE BY DEFAULT AND IS NEVER SHARE MEDIA. It exists so a
// reviewer can check a family's submission, and for no other purpose. Nothing
// here may ever be written under public/uploads/, which is served statically —
// that single mistake would publish photographs of other people's children.
// Files land in a directory the web server does not serve, and reach a human
// only through an authenticated, authorised route.
//
// ---------------------------------------------------------------------------
// THE STORAGE DECISION IS STILL OPEN (design §16.4, plan §9.5): S3 vs R2, and
// the evidence retention period. Both cost money and need an account, so
// neither is a decision this code should quietly make. What is built instead
// is the DRIVER INTERFACE plus a local implementation that is correct at beta
// scale:
//
//   put(key, buffer, meta) -> void
//   get(key)               -> Buffer
//   remove(key)            -> void
//
// Swapping in S3/R2 is one module implementing three methods; nothing above
// this file knows which driver is in use. The `object_key` column already
// holds an opaque key rather than a path, so stored rows survive the swap.
//
// WHAT IS AND IS NOT DONE about hostile uploads:
//   ✔ magic-byte sniffing — the declared Content-Type is a claim, not evidence
//   ✔ hard size ceiling, enforced on the bytes actually received
//   ✔ metadata stripping (EXIF/GPS on JPEG, text chunks on PNG) — a
//     competition photo carries the venue's coordinates and often the child's
//     name, and evidence outlives the review that needed it
//   ✔ random opaque keys, so a key cannot be guessed or enumerated
//   ✔ scan_status gate: nothing is served while a file is unscanned unless
//     the requester is the uploader or a reviewer
//   ✘ malware scanning — needs ClamAV or a service; `scan_status` and
//     scanFile() are the hook, and the default driver leaves files 'pending'
//   ✘ re-encoding — needs an image library (sharp); metadata stripping covers
//     the privacy case, not the malformed-decoder case
//   ✘ PDFs — a results-sheet PDF is plausible evidence, but PDF sanitisation
//     is its own project. Images only until that is done deliberately.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openSubmissionsDb } = require('./submissionsDb');

const MAX_BYTES = parseInt(process.env.EVIDENCE_MAX_BYTES, 10) || 12 * 1024 * 1024;
const GRANT_TTL_SECONDS = parseInt(process.env.EVIDENCE_GRANT_TTL_SECONDS, 10) || 15 * 60;

// Deliberately NOT under public/. A misconfigured static mount is the only way
// this becomes public, and keeping it out of the served tree removes that.
function storageRoot() {
  return process.env.EVIDENCE_DIR || path.join(__dirname, '..', 'private_uploads', 'evidence');
}

// ---- Content sniffing ------------------------------------------------------

// The declared Content-Type is a claim by the uploader. These are the bytes.
const SIGNATURES = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { mime: 'image/png', ext: 'png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
  { mime: 'image/heic', ext: 'heic', test: (b) => b.slice(4, 8).toString('ascii') === 'ftyp' && /hei[cx]|mif1|msf1/.test(b.slice(8, 12).toString('ascii')) },
];

function sniff(buffer) {
  if (!buffer || buffer.length < 16) return null;
  return SIGNATURES.find(s => {
    try { return s.test(buffer); } catch (e) { return false; }
  }) || null;
}

// ---- Metadata stripping ----------------------------------------------------

// JPEG: walk the segment chain and drop every APPn and COM segment. EXIF
// (APP1) carries GPS coordinates and camera serial numbers; APP13 carries IPTC
// captions that often name the child. Image data (SOS onward) is copied
// untouched, so this is lossless for the picture and total for the metadata.
function stripJpegMetadata(buf) {
  if (!(buf[0] === 0xFF && buf[1] === 0xD8)) return buf;
  const out = [Buffer.from([0xFF, 0xD8])];
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xFF) break; // not a marker boundary; bail and keep the rest
    const marker = buf[i + 1];
    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD9)) { i += 2; continue; }
    if (marker === 0xDA) { out.push(buf.slice(i)); return Buffer.concat(out); } // start of scan
    const len = buf.readUInt16BE(i + 2);
    const isAppOrComment = (marker >= 0xE0 && marker <= 0xEF) || marker === 0xFE;
    if (!isAppOrComment) out.push(buf.slice(i, i + 2 + len));
    i += 2 + len;
  }
  return Buffer.concat(out);
}

// PNG: keep the critical chunks and the ones the image needs to render; drop
// text and EXIF chunks, which is where cameras and editors hide metadata.
const PNG_DROP = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);
function stripPngMetadata(buf) {
  const sig = buf.slice(0, 8);
  const out = [sig];
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.slice(i + 4, i + 8).toString('ascii');
    const end = i + 12 + len;
    if (end > buf.length) break;
    if (!PNG_DROP.has(type)) out.push(buf.slice(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}

function stripMetadata(buffer, mime) {
  try {
    if (mime === 'image/jpeg') return stripJpegMetadata(buffer);
    if (mime === 'image/png') return stripPngMetadata(buffer);
  } catch (e) {
    // A parser failure must not silently store the ORIGINAL, metadata intact.
    return null;
  }
  // WebP/HEIC metadata stripping needs a real decoder. Rather than pretend,
  // these are stored as received and flagged so the retention decision (§16.4)
  // can see them.
  return buffer;
}

const STRIPPED_MIMES = new Set(['image/jpeg', 'image/png']);

// ---- Storage driver --------------------------------------------------------

const localDriver = {
  name: 'local',
  async put(key, buffer) {
    const full = path.join(storageRoot(), key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    // 0600: readable by the app user only. Belt and braces beside "not in the
    // served tree".
    fs.writeFileSync(full, buffer, { mode: 0o600 });
  },
  async get(key) {
    return fs.readFileSync(path.join(storageRoot(), key));
  },
  async remove(key) {
    fs.rmSync(path.join(storageRoot(), key), { force: true });
  },
};

let driver = localDriver;
function setDriver(d) { driver = d; }
function currentDriver() { return driver; }

// Sharded by the first two hex characters so one directory never holds a
// hundred thousand files.
function newObjectKey(ext) {
  const id = crypto.randomBytes(16).toString('hex');
  return `${id.slice(0, 2)}/${id}.${ext}`;
}

// ---- Upload grants ---------------------------------------------------------
//
// A grant is a short-lived, signed capability to upload ONE file against ONE
// submission. It is signed rather than stored because it is single-purpose and
// short-lived, and because the alternative — a row per grant — is a write on
// every camera tap.

function grantSecret() {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET required to sign upload grants');
  // Dev only: stable for the process lifetime so grants survive a page reload.
  if (!grantSecret._dev) grantSecret._dev = crypto.randomBytes(32).toString('hex');
  return grantSecret._dev;
}

function signGrant(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', grantSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyGrant(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', grantSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  return payload;
}

// The submission must belong to the caller. Checked when the grant is ISSUED
// and again when it is REDEEMED — a grant outliving the ownership it was
// issued under is exactly the gap worth closing twice.
async function issueGrant({ submissionId, userId }) {
  const sdb = await openSubmissionsDb();
  const sub = await sdb.get('SELECT id, user_id FROM award_submissions WHERE id = ?', [submissionId]);
  if (!sub || sub.user_id !== userId) return { ok: false, reason: 'not_found' };
  const exp = Math.floor(Date.now() / 1000) + GRANT_TTL_SECONDS;
  return {
    ok: true,
    grant: signGrant({ sub: submissionId, uid: userId, exp }),
    expiresAt: new Date(exp * 1000).toISOString(),
    maxBytes: MAX_BYTES,
    acceptedTypes: SIGNATURES.map(s => s.mime),
  };
}

// Malware scanning hook. Nothing scans yet, so every file is recorded
// 'pending' — the honest value. `canServe` treats pending as
// uploader-and-reviewer-only rather than pretending it is clean, and once
// EVIDENCE_SCANNER is configured it additionally refuses anything not yet
// marked 'clean'. A real scanner replaces this function; the column and the
// gate are already in the right places.
async function scanFile(/* buffer, meta */) {
  return 'pending';
}

async function storeEvidence({ grantToken, buffer, declaredType, userId }) {
  const payload = verifyGrant(grantToken);
  if (!payload) return { ok: false, reason: 'invalid_grant' };
  if (userId != null && payload.uid !== userId) return { ok: false, reason: 'invalid_grant' };
  if (!buffer || !buffer.length) return { ok: false, reason: 'empty' };
  if (buffer.length > MAX_BYTES) return { ok: false, reason: 'too_large' };

  const sig = sniff(buffer);
  if (!sig) return { ok: false, reason: 'unsupported_type' };
  // A mismatch between what the client SAID and what the bytes ARE is worth
  // recording — it is either a broken client or a probe.
  const mismatched = declaredType && declaredType.split(';')[0].trim() !== sig.mime;

  const cleaned = stripMetadata(buffer, sig.mime);
  if (!cleaned) return { ok: false, reason: 'unreadable' };

  const sdb = await openSubmissionsDb();
  const sub = await sdb.get('SELECT id, user_id FROM award_submissions WHERE id = ?', [payload.sub]);
  if (!sub || sub.user_id !== payload.uid) return { ok: false, reason: 'not_found' };

  const key = newObjectKey(sig.ext);
  const checksum = crypto.createHash('sha256').update(cleaned).digest('hex');

  // Same file twice (a retried upload) is one row, not two.
  const dupe = await sdb.get(
    'SELECT id, object_key FROM award_submission_evidence WHERE submission_id = ? AND checksum = ?',
    [sub.id, checksum]);
  if (dupe) return { ok: true, evidenceId: dupe.id, objectKey: dupe.object_key, duplicate: true };

  await driver.put(key, cleaned);
  const scanStatus = await scanFile(cleaned, { mime: sig.mime });

  const res = await sdb.run(`
    INSERT INTO award_submission_evidence
      (submission_id, object_key, media_type, byte_size, checksum, uploaded_by,
       consent_context, scan_status, retention_state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [sub.id, key, sig.mime, cleaned.length, checksum, payload.uid,
     JSON.stringify({
       stripped: STRIPPED_MIMES.has(sig.mime),
       declared_type_mismatch: !!mismatched,
       driver: driver.name,
     }),
     scanStatus]);

  return { ok: true, evidenceId: res.lastID, objectKey: key, mediaType: sig.mime, bytes: cleaned.length };
}

// Who may read a piece of evidence: the household that uploaded it, and a
// reviewer. Never a public route, never another family, and never anyone at
// all while a scanner is configured and has not cleared the file.
async function canServe(db, { evidenceId, userId, role }) {
  const sdb = await openSubmissionsDb();
  const ev = await sdb.get('SELECT * FROM award_submission_evidence WHERE id = ?', [evidenceId]);
  if (!ev || ev.retention_state !== 'active') return { ok: false, reason: 'not_found' };
  if (process.env.EVIDENCE_SCANNER && ev.scan_status !== 'clean') return { ok: false, reason: 'not_found' };

  if (ev.uploaded_by === userId) return { ok: true, evidence: ev };
  if (role === 'admin' || role === 'superadmin') return { ok: true, evidence: ev };

  // The studio owner reviewing this submission.
  const sub = await sdb.get('SELECT studio_id FROM award_submissions WHERE id = ?', [ev.submission_id]);
  if (sub && sub.studio_id) {
    const studio = await db.get('SELECT owner_id FROM studios WHERE id = ?', [sub.studio_id]);
    if (studio && studio.owner_id === userId) return { ok: true, evidence: ev };
  }
  return { ok: false, reason: 'not_found' };
}

async function readEvidence(objectKey) {
  return driver.get(objectKey);
}

module.exports = {
  MAX_BYTES, GRANT_TTL_SECONDS, SIGNATURES,
  storageRoot, sniff, stripJpegMetadata, stripPngMetadata, stripMetadata,
  localDriver, setDriver, currentDriver, newObjectKey,
  signGrant, verifyGrant, issueGrant, storeEvidence, canServe, readEvidence, scanFile,
  // Exported so other private-upload paths (the studio-claim photo, M10) get
  // the SAME treatment rather than a second, weaker copy of it: the bytes are
  // believed instead of the Content-Type header, camera metadata is stripped,
  // and the file lands 0600 outside the publicly served tree.
  sniff, stripMetadata, newObjectKey, currentDriver,
};
