#!/usr/bin/env python3
"""Tremaine winners PDFs -> reviewable txt (step 2 of the two-step import).

Usage:
    python3 scripts/extract_tremaine.py [--from 2018] [--to 2026] [--file NAME.pdf]

The PDFs (raw/tremaine/<year>/, fetched by scripts/download_tremaine_pdfs.js)
are untagged, but their text layer is a clean outline:

    <City> Winter 2025-26 Competition          <- page header, repeated
    Junior                                     <- age division
    Solo                                       <- category
    Ballet                                     <- style
    Cupid Variation  2ND PLACE Studio Name     <- award row
    Seven Nation  1ST PLACE
      JR SOLO HIGH SCORE                       <- extra label, wraps freely
    SpotLite Dance Studio, LLC                 <- studio on its own line
    WonderingNationals Qualifier Studio B      <- no space before the label!

An award row = routine + one or more award labels + studio, wrapped
arbitrarily across lines (labels split mid-phrase: "SR DUO/TRIO JUDGES'" /
"OVATION"). Lines are accumulated until the buffer parses complete; a new
row starts at the next label-bearing line. One txt line is emitted PER
LABEL (placement, Nationals Qualifier, HIGH SCORE, JUDGES' OVATION, BEST
SHOWMANSHIP (pre-2020 name), NF Gold/Silver/Bronze/Showmanship at finals,
Faculty Show Invitee) because each is its own award in the DB.

'**' on a routine appears only in semi-finals books, on placing routines,
alongside explicit "Nationals Qualifier" rows for non-placing routines -
extracted as a QUALIFIER row with a CHECK note naming the assumption.

Dancer names appear only for independents ("Independent - Maely Weaver"):
captured into Dancers with Studio "Independent".

Output: tobeprocessed/tremaine/txt/<year>-<eventnum>-<city>.txt in the
Sec|Cat|Place|Entry|Routine|Studio|Dancers shape (Entry always '-';
Cat = "Age ~ Category ~ Style"). Review before importing.
"""
import argparse
import os
import re
import sys

try:
    from pypdf import PdfReader
except ImportError:
    sys.exit("pypdf is required:  pip3 install pypdf")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw", "tremaine")
OUT_DIR = os.path.join(ROOT, "tobeprocessed", "tremaine", "txt")
SEED = os.path.join(ROOT, "scripts", "seed", "tremaine_pdf_urls.txt")

AGES = {"petite", "junior", "teen", "senior", "pre-teen", "preteen", "pre-pro", "mini"}
CATS = {"solo", "duo/trio", "duo trio", "duet/trio", "group", "line", "production", "extended line"}
STYLES = {"ballet", "pointe", "musical theatre", "musical theater", "contemporary",
          "hip hop", "hip-hop", "open", "tap", "lyrical", "jazz", "specialty",
          "acro", "modern", "song & dance", "song and dance", "ballroom", "character"}

MARKER = re.compile(
    r"(?P<place>\d{1,2}(?:ST|ND|RD|TH)\s+PLACE)"
    r"|(?P<qual>Nationals?\s+Qualifier|Addtl\.?\s*NF\s*Qual\w*\.?\s*\d*)"
    r"|(?P<extra>(?:PT|JR|TN|SR)\s+(?:SOLO|DUO\s*/?\s*TRIO|GROUP|LINE|PRODUCTION)?\s*"
    r"(?:HIGH\s+SCORE|JUDGES'?\s+OVATION|BEST\s+SHOWMANSHIP))"
    r"|(?P<nf>(?:PT|JR|TN|SR)\s+(?:NF|NAT)[\w/ .&'-]*?(?:Gold|Silver|Bronze|Showmanship|High\s+Score|Judges'?\s+Ovation))"
    r"|(?P<fac>Faculty\s+Show\s+Invitee\s*\d*)"
    r"|(?P<ida>I\.?D\.?A\.?\s+Winner)",
    re.I)
# a buffer tail that is really the start of a wrapped label, not a studio:
# it STARTS with a division abbreviation ("SR DUO/TRIO JUDGES'") or ENDS
# mid-label ("... HIGH"). Substring matches would false-positive on real
# studios ("Eastlake High School").
PARTIAL_TAIL = re.compile(
    r"^(?:PT|JR|TN|SR)\s+(?:SOLO|DUO|GROUP|LINE|PRODUCTION|NF|NAT|HIGH|JUDGES|BEST)\b"
    r"|(?:JUDGES'?|OVATION|HIGH|SCORE|BEST|SHOWMAN\w*|\bNF)$", re.I)
HEADER = re.compile(r"^(?:All Competition Scores|.{2,40}\s(?:Winter|Summer)\s+\d{4}(?:-\d{2})?(?:\s+Competition)?|National Finals Competition.*)$", re.I)

SEC_OF = [("place", "PLACEMENT"), ("qual", "QUALIFIER"), ("fac", "FACULTY"), ("ida", "IDA"), ("nf", "NF-AWARD")]


def norm(s):
    return re.sub(r"\s+", " ", (s or "").replace("’", "'").replace(" ", " ")).strip()


def header_of(line):
    """Event/page header line -> event display name, or None."""
    t = norm(line)
    if re.match(r"^All Competition Scores$", t, re.I):
        return ""
    m = re.match(r"^(.{2,40}?)\s+(Winter|Summer)\s+(\d{4}(?:-\d{2})?)(?:\s+Competition)?$", t)
    if m:
        return f"{m.group(1)} {m.group(2)} {m.group(3)}"
    m = re.match(r"^National Finals Competition\s*(Winter|Summer)?\s*(\d{4}(?:-\d{2})?)?", t, re.I)
    if m and t.lower().startswith("national finals"):
        bits = [b for b in ("National Finals", m.group(1), m.group(2)) if b]
        return " ".join(bits)
    m = re.match(r"^(.{2,30}?)\s+National Finals(?:\s+Competition)?\s*(\d{4})?$", t, re.I)
    if m:
        return f"{m.group(1)} National Finals{' ' + m.group(2) if m.group(2) else ''}"
    return None


class Row:
    __slots__ = ("routine", "labels", "studio", "starred", "notes")


def parse_buffer(buf):
    """Joined buffer text -> (routine, [labels], studio, starred) or None."""
    text = norm(" ".join(buf))
    matches = list(MARKER.finditer(text))
    if not matches:
        return None
    routine = text[:matches[0].start()]
    studio = text[matches[-1].end():].strip(" -")
    starred = bool(re.search(r"\*\*\s*$", routine)) or "**" in routine
    routine = norm(routine.replace("**", ""))
    labels = []
    for m in matches:
        for grp, sec in SEC_OF:
            if m.group(grp):
                label = norm(m.group(grp))
                # finals medal group also carries HIGH SCORE / OVATION /
                # SHOWMANSHIP labels (older books write "NAT" for "NF")
                if grp == "nf":
                    if re.search(r"HIGH\s+SCORE", label, re.I):
                        sec = "HIGH SCORE"
                    elif re.search(r"OVATION", label, re.I):
                        sec = "OVATION"
                    elif re.search(r"SHOWMAN", label, re.I):
                        sec = "SHOWMANSHIP"
                labels.append((sec, label))
                break
        else:
            label = norm(m.group("extra"))
            sec = ("HIGH SCORE" if re.search(r"HIGH\s+SCORE", label, re.I)
                   else "OVATION" if re.search(r"OVATION", label, re.I)
                   else "SHOWMANSHIP")
            labels.append((sec, label))
    # text BETWEEN markers should be empty; anything there means we split wrong
    gaps = [norm(text[a.end():b.start()]) for a, b in zip(matches, matches[1:])]
    stray = [g for g in gaps if g]
    return routine, labels, studio, starred, stray


def is_complete(buf):
    parsed = parse_buffer(buf)
    if not parsed:
        return False
    routine, labels, studio, _, _ = parsed
    if not routine or not studio:
        return False
    if PARTIAL_TAIL.search(studio):
        return False
    if studio.endswith(("'", "-")):
        return False
    return True


def extract(path):
    reader = PdfReader(path)
    lines = []
    for page in reader.pages:
        for ln in (page.extract_text() or "").split("\n"):
            ln = norm(ln)
            if ln:
                lines.append(ln)

    event_name = None
    age = cat = style = None
    buf, rows, flags = [], [], []
    last_emitted = []   # rows from the most recent successful flush

    def flush(force=False):
        nonlocal buf
        if not buf:
            return
        start = len(rows)
        parsed = parse_buffer(buf)
        if parsed and (is_complete(buf) or force):
            routine, labels, studio, starred, stray = parsed
            dancers = []
            m = re.match(r"^Independent\s*[-–]\s*(.+)$", studio, re.I)
            if m:
                studio, dancers = "Independent", [norm(m.group(1))]
            note = None
            if stray:
                note = "unassigned text between labels: " + " / ".join(stray)
            for sec, label in labels:
                place = label.upper() if sec == "PLACEMENT" else label
                if sec == "PLACEMENT":
                    place = re.sub(r"\s+PLACE$", "", place)
                rows.append({"sec": sec, "cat": " ~ ".join(p for p in (age, cat, style) if p),
                             "place": place, "routine": routine, "studio": studio,
                             "dancers": dancers, "note": note})
            if starred:
                rows.append({"sec": "QUALIFIER", "cat": " ~ ".join(p for p in (age, cat, style) if p),
                             "place": "Nationals Qualifier", "routine": routine, "studio": studio,
                             "dancers": dancers,
                             "note": "from '**' marker - semis star placing routines that qualified"})
        else:
            flags.append(" / ".join(buf))
        if len(rows) > start:
            last_emitted[:] = rows[start:]
        buf = []

    pending = None   # short marker-less line right after a complete row:
                     # either the previous studio's wrapped tail or the next
                     # routine's wrapped start - the NEXT line decides

    def resolve_pending(to_prev):
        nonlocal pending
        if pending is None:
            return
        if to_prev and last_emitted:
            for r in last_emitted:
                r["studio"] = norm(r["studio"] + " " + pending)
                r["note"] = ((r["note"] + "; ") if r.get("note") else "") + \
                    f"studio joined from wrapped line '{pending}'"
        else:
            buf.insert(0, pending)
        pending = None

    for ln in lines:
        h = header_of(ln)
        low = ln.lower().rstrip(":")
        is_section = low in AGES or low in CATS or low in STYLES
        # a section/event header right after the fragment = the fragment was
        # the previous studio's tail; anything else = a wrapped routine start
        resolve_pending(to_prev=(h is not None or is_section))
        if h is not None:
            flush(force=bool(buf))
            if h and event_name is None:
                event_name = h
            continue
        if low in AGES:
            flush(force=bool(buf))
            age, cat, style = ln, None, None
            continue
        if low in CATS:
            flush(force=bool(buf))
            cat, style = ln, None
            continue
        if low in STYLES:
            flush(force=bool(buf))
            style = ln
            continue
        # a complete row ends at the NEXT row's first line - whether that
        # line carries a marker or is a routine that wraps before its
        # marker ("Whispers From The Surface of A / Lake / 2ND PLACE ...").
        # Lines reaching an incomplete buffer are always continuations.
        if buf and is_complete(buf):
            flush()
            if not MARKER.search(ln) and len(ln.split()) <= 4:
                pending = ln
                continue
        buf.append(ln)
    resolve_pending(to_prev=True)
    flush(force=bool(buf))
    return event_name, rows, flags


def file_meta(fname, year_dir):
    m = re.match(r"^(20\d\d)TREMAINE-(\d+)-([A-Za-z]+)-(SemiFinalsWinners|SummerWinners|NationalFinals\w*)-?A?L?L?-?(.*)\.pdf$", fname, re.I)
    if m:
        dates = m.group(5).replace("_b", "").replace("_update", "")
        dates = re.sub(r"([A-Za-z]+)(\d)", r"\1 \2", dates).replace("-", "-")
        return {"year": int(m.group(1)), "num": m.group(2), "city": m.group(3).title(),
                "kind": m.group(4), "dates": norm(dates)}
    m = re.match(r"^(20\d\d)", fname)
    return {"year": int(m.group(1)) if m else int(year_dir), "num": None,
            "city": None, "kind": "other", "dates": ""}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="yfrom", type=int, default=2018)
    ap.add_argument("--to", dest="yto", type=int, default=2026)
    ap.add_argument("--file", help="only this pdf basename")
    args = ap.parse_args()

    urlmap = {}
    if os.path.exists(SEED):
        for u in open(SEED):
            u = u.strip()
            if u:
                urlmap[os.path.basename(u).replace(".pdff", ".pdf")] = u

    os.makedirs(OUT_DIR, exist_ok=True)
    totals = {"files": 0, "rows": 0, "flags": 0}
    for year_dir in sorted(os.listdir(RAW)):
        d = os.path.join(RAW, year_dir)
        if not os.path.isdir(d) or not year_dir.isdigit():
            continue
        if not (args.yfrom <= int(year_dir) <= args.yto):
            continue
        listing = sorted(os.listdir(d))
        for fname in listing:
            if not fname.lower().endswith(".pdf"):
                continue
            if args.file and fname != args.file:
                continue
            if fname[:-4] + "_update.pdf" in listing:
                continue   # a corrected re-upload supersedes this book
            meta = file_meta(fname, year_dir)
            try:
                event_name, rows, flags = extract(os.path.join(d, fname))
            except Exception as e:
                print(f"{fname}: EXTRACT FAILED: {e}", file=sys.stderr)
                continue
            if not event_name:
                event_name = f"{meta['city'] or fname} {meta['year']}"
            slugc = re.sub(r"[^a-z0-9]+", "-", (meta["city"] or event_name).lower()).strip("-")
            out = os.path.join(OUT_DIR, f"{meta['year']}-{meta['num'] or 'x'}-{slugc}.txt")
            with open(out, "w", encoding="utf-8") as fh:
                fh.write("# Tremaine extraction -> review before importing (see extract_tremaine.py)\n")
                fh.write(f"Event: {event_name}\n")
                fh.write(f"Year: {meta['year']}\n")
                fh.write(f"DateString: {(meta['dates'] + ', ' if meta['dates'] else '')}{meta['year']}\n")
                fh.write(f"SourceFile: {year_dir}/{fname}\n")
                fh.write(f"SourceURL: {urlmap.get(fname, '-')}\n")
                for r in rows:
                    line = (f"Sec: {r['sec']} | Cat: {r['cat'] or '-'} | Place: {r['place']} | Entry: - | "
                            f"Routine: {r['routine'] or '-'} | Studio: {r['studio'] or '-'} | "
                            f"Dancers: {', '.join(r['dancers']) or '-'}")
                    if r.get("note"):
                        line += f"   # CHECK: {r['note']}"
                    fh.write(line + "\n")
                for f_ in flags:
                    fh.write(f"FLAGGED: {f_}\n")
            totals["files"] += 1
            totals["rows"] += len(rows)
            totals["flags"] += len(flags)
            print(f"{os.path.basename(out)}: {event_name} — {len(rows)} rows, {len(flags)} flagged")

    print(f"\n{totals['files']} events -> {totals['rows']} rows, {totals['flags']} flagged.")
    print(f"Review {os.path.relpath(OUT_DIR, ROOT)} before importing.")


if __name__ == "__main__":
    main()
