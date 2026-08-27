#!/usr/bin/env python3
"""Hollywood Vibe results PDFs -> reviewable txt (step 1 of the two-step import).

Usage:
    python3 scripts/extract_hollywoodvibe.py [--from 2022] [--to 2026] [--file NAME.pdf]

WHY TAGS, NOT COORDINATES
-------------------------
These PDFs are Word exports and carry a real accessibility structure tree:
/Table -> /THead|/TBody -> /TR -> /TH|/TD -> /P.  That is genuine table
markup - the same information an HTML <table> carries - so rows and cells
are READ, not inferred.  No column x-positions, no row-height guessing, no
per-page calibration, and nothing breaks when a later event re-flows the
layout, changes column widths, or splits a category across pages.

Cell text comes from marked content: each /TD points at MCIDs, and the page
content stream brackets its text runs with `/Span <</MCID n>> BDC ... EMC`.
We build MCID -> text per page, then read each cell straight off the tree.

Table kinds are recognised from their header row, not their position:
  * ordinals ("1st".."5th", and the 6th-10th continuation tables some
    events publish further down)  -> COMPETITION
  * ordinals containing "OVERALL"                                  -> OVERALL
  * award names (MOST ENTERTAINING, BEST COSTUME, ...)             -> SPECIALTY
A table with no header row continues the previous one's columns, which is
how these documents span pages.

Everything outside a table (scholarships, studio excellence, agency
finalists) arrives as ordered paragraphs; those sections are name-and-studio
lists.

Cell text is decoded through each font's /ToUnicode CMap, because several
events embed subset fonts and write their text as hex strings - without the
CMap those cells come back empty or truncated (that was the difference
between reading 742 and 1388 characters on a Norfolk page).

Two routine/studio conventions appear across the tour and both are handled:
  "#243 BEAUTIFUL THINGS-YOUNG ARTIST SPACE"   (dash separator)
  "#412 \u201cName In Lights\u201d Dance Republic"     (quoted routine, no dash)
A few events use neither, so the extractor also learns the tour's studio
names from the unambiguous rows across every file and uses that vocabulary
to split the rest.  Anything still unresolved is written to the txt as a
FLAGGED line for review rather than guessed at.
"""
import argparse
import json
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib.pdf_tags import Doc, norm, slug  # noqa: E402  (shared tagged-PDF table reader)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_DIR = os.path.join(ROOT, "tobeprocessed", "pdf", "hollywoodvibe")
OUT_DIR = os.path.join(ROOT, "tobeprocessed", "hollywoodvibe", "txt")

ORDINAL = re.compile(r"^\s*(\d{1,2})\s*(st|nd|rd|th)\b", re.I)
AWARDISH = re.compile(
    r"AWARD|BEST|OUTSTANDING|ENTERTAINING|COSTUME|DIRECTION|CHOREOGRAPH|JUDGE|SPIRIT|"
    r"SCHOLARSHIP|EXCELLENCE|DANCER OF THE YEAR|FINALIST|INTENSIVE|CONSERVATORY",
    re.I,
)


def split_entry(cell, studio_vocab=None):
    """'#242 PERFECT DAY-BIRMINGHAM DANCE THEATRE' -> entry/routine/studio.

    The separator is a bare '-', and routine titles can contain dashes, so
    prefer a split whose right-hand side is a studio we have already seen in
    this corpus; otherwise fall back to the last dash.
    """
    text = norm(cell)
    if not text:
        return None
    entry = ""
    m = re.match(r"^#\s*([\d.]+)\s*(.*)$", text)
    if m:
        entry, text = "#" + m.group(1), m.group(2).strip()
    # Some events quote the routine title instead of using a dash
    # ("#412 \u201cName In Lights\u201d Dance Republic") — unambiguous, so try it first.
    q = re.match(r'^[\u201c"\u2018\'](.+?)[\u201d"\u2019\']\s*(.*)$', text, re.S)
    if q and q.group(2).strip():
        return {"entry": entry, "routine": norm(q.group(1)),
                "studio": norm(q.group(2)), "ambiguous": False}
    positions = [i for i, ch in enumerate(text) if ch == "-"]
    if not positions:
        # Some events omit the separator entirely ("#515 YOU SAY MOVE DANCE
        # STUDIO").  Studios repeat across the tour, so fall back to the
        # longest known-studio suffix.
        if studio_vocab:
            words = text.split(" ")
            for start in range(1, len(words)):
                cand = " ".join(words[start:])
                if cand.upper() in studio_vocab:
                    return {"entry": entry, "routine": " ".join(words[:start]),
                            "studio": cand, "ambiguous": False}
        return {"entry": entry, "routine": text, "studio": "", "ambiguous": False}
    chosen, ambiguous = positions[-1], len(positions) > 1
    if studio_vocab:
        for i in reversed(positions):
            cand = text[i + 1:].strip(" -")
            if cand.upper() in studio_vocab:
                chosen, ambiguous = i, False
                break
    return {
        "entry": entry,
        "routine": text[:chosen].strip(" -"),
        "studio": text[chosen + 1:].strip(" -"),
        "ambiguous": ambiguous,
    }


def classify(row):
    """Return (kind, labels, offset). offset=1 when the table's first column
    holds the row category (COMPETITION/OVERALL) and 0 when every column is
    data (SPECIALTY)."""
    cells = [norm(c) for c in row]
    for offset in (1, 0):
        labels = cells[offset:]
        if not labels:
            continue
        if sum(1 for c in labels if ORDINAL.match(c)) >= 2:
            kind = "OVERALL" if any(re.search(r"OVERALL", c, re.I) for c in labels) else "COMPETITION"
            return kind, labels, offset
    named = [c for c in cells if c and AWARDISH.search(c)]
    if len(named) >= 2 and not any("#" in c for c in cells):
        return "SPECIALTY", cells, 0
    return None, cells, 1


def extract(path, global_vocab=None, blocks=None):
    if blocks is None:
        blocks = Doc(path).blocks()

    # pass 1 - studio vocabulary from unambiguous single-dash cells
    vocab = Counter()
    for b in blocks:
        if b["kind"] != "table":
            continue
        for row in b["rows"]:
            for cell in row:
                t = norm(cell)
                if t.count("-") == 1 and "#" in t:
                    vocab[t.split("-", 1)[1].strip().upper()] += 1
    studio_vocab = {k for k, n in vocab.items() if n >= 2 and len(k) > 3}
    if global_vocab:
        studio_vocab = studio_vocab | global_vocab

    rows, flags = [], []
    header, section, offset = None, "COMPETITION", 1
    list_sections = [""]

    for b in blocks:
        if b["kind"] == "text":
            txt, raw = b["text"], b.get("raw", b["text"])
            # Section heading. These pages put two award columns side by
            # side, so one heading paragraph can name both — keep them as a
            # list and match entries to columns by position.
            if txt.upper() == txt and "-" not in txt and len(txt) > 3 and not txt.startswith("#"):
                parts = [norm(p).rstrip(":") for p in re.split(r"\s{3,}", raw) if norm(p)]
                list_sections = parts if len(parts) > 1 else [txt.rstrip(":")]
                continue
            if "-" not in txt:
                continue
            for ci, chunk in enumerate(re.split(r"\s{4,}", raw)):
                seg = norm(chunk)
                if not seg or "-" not in seg:
                    continue
                sec = list_sections[ci] if ci < len(list_sections) else list_sections[-1]
                if seg.startswith("#"):
                    # routine-style entry ("#206 GALE SONG - INFINITY DANCE CO")
                    parts = split_entry(seg, studio_vocab)
                    if not parts or not parts["studio"]:
                        flags.append(f"p{b['page']+1} odd list entry ({sec}): {seg}")
                        continue
                    rows.append({"section": sec or "LIST", "category": "", "place": "",
                                 "entry": parts["entry"], "routine": parts["routine"],
                                 "dancer": "", "studio": parts["studio"]})
                    continue
                left, right = seg.split(" - ", 1) if " - " in seg else seg.split("-", 1)
                dancer, studio = norm(left), norm(right)
                if not dancer or not studio:
                    flags.append(f"p{b['page']+1} odd list entry ({sec}): {seg}")
                    continue
                rows.append({"section": sec or "LIST", "category": "", "place": "",
                             "entry": "", "routine": "", "dancer": dancer, "studio": studio})
            continue

        for row in b["rows"]:
            kind, labels, off = classify(row)
            if kind:
                section, header, offset = kind, labels, off
                continue
            category = norm(row[0]) if row and offset else ""
            for i, cell in enumerate(row[offset:]):
                cell = norm(cell)
                if not cell:
                    continue
                place = header[i] if header and i < len(header) and header[i] else f"col{i+1}"
                parts = split_entry(cell, studio_vocab)
                if not parts:
                    continue
                if not parts["studio"]:
                    flags.append(f"p{b['page']+1} no studio ({category} / {place}): {cell}")
                elif parts["ambiguous"]:
                    flags.append(f"p{b['page']+1} ambiguous dash ({category} / {place}): {cell}")
                rows.append({"section": section, "category": category, "place": place,
                             "entry": parts["entry"], "routine": parts["routine"],
                             "dancer": "", "studio": parts["studio"]})
    return rows, flags


def _year_of(pdf):
    side = os.path.join(PDF_DIR, re.sub(r"\.pdf$", ".json", pdf, flags=re.I))
    if os.path.exists(side):
        try:
            y = json.load(open(side)).get("year")
            if y:
                return int(y)
        except Exception:
            pass
    m = re.search(r"(20\d{2})", pdf)
    return int(m.group(1)) if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="year_from", type=int, default=2022)
    ap.add_argument("--to", dest="year_to", type=int, default=2026)
    ap.add_argument("--file", dest="only")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    pdfs = sorted(f for f in os.listdir(PDF_DIR) if f.lower().endswith(".pdf"))
    files = rows_total = flags_total = skipped = 0

    # Phase 1: parse every in-scope PDF once and learn the tour's studio
    # names from cells that split unambiguously.  Studios recur across
    # events, so this vocabulary rescues the events that publish without a
    # separator.
    parsed, vocab = {}, Counter()
    for pdf in pdfs:
        if args.only and pdf != args.only:
            continue
        year = _year_of(pdf)
        if not year or (not args.only and not (args.year_from <= year <= args.year_to)):
            continue
        try:
            blocks = Doc(os.path.join(PDF_DIR, pdf)).blocks()
        except Exception as exc:
            print(f"[FAIL] {pdf}: {exc}")
            continue
        parsed[pdf] = blocks
        for b in blocks:
            if b["kind"] != "table":
                continue
            for row in b["rows"]:
                for cell in row:
                    t = norm(cell)
                    if t.count("-") == 1 and "#" in t:
                        vocab[t.split("-", 1)[1].strip().upper()] += 1
    global_vocab = {k for k, n in vocab.items() if n >= 2 and len(k) > 3}
    print(f"studio vocabulary: {len(global_vocab)} names learned from {len(parsed)} files\n")

    for pdf in pdfs:
        if args.only and pdf != args.only:
            continue
        meta = {}
        side = os.path.join(PDF_DIR, re.sub(r"\.pdf$", ".json", pdf, flags=re.I))
        if os.path.exists(side):
            try:
                meta = json.load(open(side))
            except Exception:
                pass
        year = meta.get("year")
        if not year:
            m = re.search(r"(20\d{2})", pdf)
            year = int(m.group(1)) if m else None
        if not year:
            print(f"[skip] {pdf} - no year in sidecar or filename")
            skipped += 1
            continue
        year = int(year)
        if not args.only and not (args.year_from <= year <= args.year_to):
            continue

        try:
            rows, flags = extract(os.path.join(PDF_DIR, pdf), global_vocab, parsed.get(pdf))
        except Exception as exc:
            print(f"[FAIL] {pdf}: {exc}")
            skipped += 1
            continue
        if not rows:
            print(f"[empty] {pdf} - no rows parsed")
            skipped += 1
            continue

        location = norm(meta.get("location") or re.sub(r"\.pdf$", "", pdf, flags=re.I).replace("-", " "))
        event_name = f"Hollywood Vibe {year} {location}"
        out = [
            f"# Hollywood Vibe - extracted from {pdf} via the PDF's own table tags",
            f"#   (/Table -> /TR -> /TD structure elements; no positional guessing).",
            f"# Sections: COMPETITION = per-category placements, OVERALL = overall awards,",
            f"#   SPECIALTY = named judge awards, others = scholarship/list sections.",
            f"# Text decoded through each font's /ToUnicode CMap (several events embed",
            f"#   subset fonts as hex strings). Routine/studio split handles both the",
            f"#   dash and quoted-title conventions; unresolved cells are FLAGGED below.",
            f"Event: {event_name}",
            f"Year: {year}",
            f"Location: {location}",
            f"SourceURL: {meta.get('source_url', '')}",
            "# Format: Sec | Cat | Place | Entry | Routine | Dancer | Studio",
            "",
        ]
        out += [
            f"Sec: {r['section']} | Cat: {r['category'] or '-'} | Place: {r['place'] or '-'} | "
            f"Entry: {r['entry'] or '-'} | Routine: {r['routine'] or '-'} | "
            f"Dancer: {r['dancer'] or '-'} | Studio: {r['studio'] or '-'}"
            for r in rows
        ]
        if flags:
            out += ["", f"# ---- {len(flags)} FLAGGED (review) ----"] + [f"# {f}" for f in flags]

        path = os.path.join(OUT_DIR, f"{year}-{slug(location) or slug(pdf)}.txt")
        with open(path, "w") as fh:
            fh.write("\n".join(out) + "\n")
        files += 1
        rows_total += len(rows)
        flags_total += len(flags)
        print(f"[{year}] {location} - {len(rows)} rows"
              + (f", {len(flags)} flagged" if flags else "")
              + f" -> {os.path.basename(path)}")

    print(f"\n{files} events -> {rows_total} rows, {flags_total} flagged, {skipped} skipped.")
    print(f"Review {os.path.relpath(OUT_DIR, ROOT)} before importing.")


if __name__ == "__main__":
    main()
