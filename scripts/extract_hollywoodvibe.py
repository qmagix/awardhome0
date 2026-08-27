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

try:
    import pypdf
    from pypdf.generic import IndirectObject, DictionaryObject, ArrayObject, NumberObject
except ImportError:
    sys.exit("pypdf is required:  pip3 install pypdf")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_DIR = os.path.join(ROOT, "tobeprocessed", "pdf", "hollywoodvibe")
OUT_DIR = os.path.join(ROOT, "tobeprocessed", "hollywoodvibe", "txt")

ORDINAL = re.compile(r"^\s*(\d{1,2})\s*(st|nd|rd|th)\b", re.I)
AWARDISH = re.compile(
    r"AWARD|BEST|OUTSTANDING|ENTERTAINING|COSTUME|DIRECTION|CHOREOGRAPH|JUDGE|SPIRIT|"
    r"SCHOLARSHIP|EXCELLENCE|DANCER OF THE YEAR|FINALIST|INTENSIVE|CONSERVATORY",
    re.I,
)
ESCAPES = {b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b", b"f": b"\f",
           b"(": b"(", b")": b")", b"\\": b"\\"}
TOKEN = re.compile(
    rb"/MCID\s+(\d+)[^>]*>>\s*BDC"          # 1: marked content begins
    rb"|\bEMC\b"                              # marked content ends
    rb"|\[((?:[^\[\]\\]|\\.)*)\]\s*TJ"     # 2: TJ array
    rb"|\(((?:\\.|[^\\()])*)\)\s*(?:Tj|')"   # 3: Tj / ' literal string
    rb"|/([A-Za-z0-9_.#-]+)\s+Do\b"           # 4: draw an XObject
    rb"|<([0-9A-Fa-f\s]+)>\s*(?:Tj|')"        # 5: Tj hex string
    rb"|/([A-Za-z0-9_.#-]+)\s+[\d.]+\s+Tf",   # 6: select font
    re.S,
)


def norm(s):
    return re.sub(r"\s+", " ", (s or "").replace("’", "'")).strip()


def slug(s):
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", str(s).lower()))


def _unescape(b):
    b = re.sub(rb"\\([nrtbf()\\])", lambda m: ESCAPES[m.group(1)], b)
    return re.sub(rb"\\([0-7]{1,3})", lambda m: bytes([int(m.group(1), 8) & 0xFF]), b)


def decode_pdf_string(b):
    b = re.sub(rb"\\([nrtbf()\\])", lambda m: ESCAPES[m.group(1)], b)
    b = re.sub(rb"\\([0-7]{1,3})", lambda m: bytes([int(m.group(1), 8) & 0xFF]), b)
    return b.decode("latin-1")


def _font_maps(resources, cache):
    fonts = {}
    try:
        fdict = resolve(resources.get("/Font")) if resources else None
    except Exception:
        fdict = None
    if not fdict:
        return fonts
    for name in fdict.keys():
        ref = fdict.raw_get(name) if hasattr(fdict, "raw_get") else fdict.get(name)
        key = getattr(ref, "idnum", None) or f"{id(resources)}{name}"
        if key not in cache:
            cache[key] = parse_tounicode(resolve(ref))
        fonts[name] = cache[key]
    return fonts


def _walk_stream(data, resources, out, stack, depth=0, cache=None):
    """Tokenise a content stream into out[MCID] += text.

    Recurses into Form XObjects: Word nests parts of a page (and in some of
    these files whole table cells) in form streams, and their text would
    otherwise be invisible to a page-level scan.
    """
    cache = {} if cache is None else cache
    fonts = _font_maps(resources, cache)
    cur = (None, 1)
    for m in TOKEN.finditer(data):
        if m.group(1) is not None:
            stack.append(int(m.group(1)))
        elif m.group(0) == b"EMC":
            if stack:
                stack.pop()
        elif m.group(6) is not None:
            cur = fonts.get("/" + m.group(6).decode("latin-1"), (None, 1))
        elif m.group(4) is not None:
            if depth >= 6 or resources is None:
                continue
            try:
                xobjs = resolve(resources.get("/XObject"))
                xo = resolve(xobjs.get("/" + m.group(4).decode("latin-1"))) if xobjs else None
                if xo is not None and str(xo.get("/Subtype", "")) == "/Form":
                    _walk_stream(xo.get_data(), resolve(xo.get("/Resources")) or resources,
                                 out, stack, depth + 1, cache)
            except Exception:
                continue
        else:
            if not stack:
                continue
            fontmap, width = cur
            if m.group(2) is not None:          # TJ array: literals and/or hex
                parts = []
                for tok in re.findall(rb"\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>", m.group(2), re.S):
                    if tok.startswith(b"("):
                        parts.append(decode_pdf_string(tok[1:-1]) if not fontmap
                                     else decode_with_font(_unescape(tok[1:-1]), fontmap, width))
                    else:
                        parts.append(decode_with_font(bytes.fromhex(re.sub(rb"\s", b"", tok[1:-1]).decode("latin-1")),
                                                      fontmap, width))
                text = "".join(parts)
            elif m.group(3) is not None:
                text = (decode_pdf_string(m.group(3)) if not fontmap
                        else decode_with_font(_unescape(m.group(3)), fontmap, width))
            else:
                text = decode_with_font(bytes.fromhex(re.sub(rb"\s", b"", m.group(5)).decode("latin-1")),
                                        fontmap, width)
            out[stack[-1]] = out.get(stack[-1], "") + text


def mcid_text(page):
    """MCID -> concatenated text for one page."""
    # Read the raw /Contents stream(s). (pypdf's get_contents() returns a
    # re-serialised ContentStream that can come back empty on first access,
    # and a page may legitimately carry an array of streams.)
    try:
        raw = page.get("/Contents")
        raw = raw.get_object() if isinstance(raw, IndirectObject) else raw
        parts = list(raw) if isinstance(raw, (list, ArrayObject)) else [raw]
        data = b"\n".join(
            (p.get_object().get_data() if hasattr(p.get_object(), "get_data") else b"")
            for p in parts if p is not None
        )
    except Exception:
        return {}
    out = {}
    _walk_stream(data, resolve(page.get("/Resources")), out, [], 0, {})
    return out


def resolve(o):
    return o.get_object() if isinstance(o, IndirectObject) else o


def _hexdec(h):
    b = bytes.fromhex(h.decode("latin-1"))
    try:
        return b.decode("utf-16-be")
    except Exception:
        return b.decode("latin-1", errors="replace")


def parse_tounicode(font):
    """code -> text map from a font's /ToUnicode CMap (subset fonts encode
    their glyphs as hex codes that mean nothing without it)."""
    try:
        tu = resolve(font.get("/ToUnicode"))
        data = tu.get_data()
    except Exception:
        return None, 1
    out = {}
    for block in re.findall(rb"beginbfchar(.*?)endbfchar", data, re.S):
        for src, dst in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            out[int(src, 16)] = _hexdec(dst)
    for block in re.findall(rb"beginbfrange(.*?)endbfrange", data, re.S):
        for lo, hi, arr in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*?)\]", block, re.S):
            start = int(lo, 16)
            for i, dst in enumerate(re.findall(rb"<([0-9A-Fa-f]+)>", arr)):
                out[start + i] = _hexdec(dst)
        for lo, hi, dst in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            start, end, base = int(lo, 16), int(hi, 16), _hexdec(dst)
            if len(base) != 1:
                continue
            for k in range(start, min(end, start + 65535) + 1):
                out[k] = chr(ord(base) + (k - start))
    width = 2 if str(resolve(font).get("/Subtype", "")) == "/Type0" else 1
    return (out or None), width


def decode_with_font(raw_bytes, fontmap, width):
    if not fontmap:
        return raw_bytes.decode("latin-1")
    chars = []
    step = width
    for i in range(0, len(raw_bytes) - step + 1, step):
        code = int.from_bytes(raw_bytes[i:i + step], "big")
        chars.append(fontmap.get(code, ""))
    return "".join(chars)


class Doc:
    def __init__(self, path):
        self.reader = pypdf.PdfReader(path)
        self.pagemap = {}
        for idx, p in enumerate(self.reader.pages):
            if p.indirect_reference is not None:
                self.pagemap[p.indirect_reference.idnum] = idx
        self.texts = [mcid_text(p) for p in self.reader.pages]

    def _gather(self, node, page, acc):
        node = resolve(node)
        if isinstance(node, (int, NumberObject)):
            acc.append(self.texts[page].get(int(node), ""))
            return
        if isinstance(node, (list, ArrayObject)):
            for kid in node:
                self._gather(kid, page, acc)
            return
        if not isinstance(node, DictionaryObject):
            return
        if str(node.get("/Type", "")) == "/MCR":
            pg = node.get("/Pg")
            idx = self.pagemap.get(pg.idnum, page) if isinstance(pg, IndirectObject) else page
            acc.append(self.texts[idx].get(int(node.get("/MCID", -1)), ""))
            return
        pg = node.get("/Pg")
        if isinstance(pg, IndirectObject):
            page = self.pagemap.get(pg.idnum, page)
        if "/K" in node:
            self._gather(node["/K"], page, acc)

    def cell_text(self, node, page, raw=False):
        acc = []
        self._gather(node, page, acc)
        joined = "".join(acc)
        return joined if raw else norm(joined)

    def blocks(self):
        """Document-ordered blocks: {'kind':'table','rows':[[cell,...]]} or
        {'kind':'text','text':...}, each with its page number."""
        out = []

        def walk(node, page=0, table=None):
            node = resolve(node)
            if isinstance(node, (list, ArrayObject)):
                for kid in node:
                    walk(kid, page, table)
                return
            if not isinstance(node, DictionaryObject):
                return
            pg = node.get("/Pg")
            if isinstance(pg, IndirectObject):
                page = self.pagemap.get(pg.idnum, page)
            stype = str(node.get("/S", ""))

            if stype == "/Table":
                tbl = {"kind": "table", "page": page, "rows": []}
                out.append(tbl)
                if "/K" in node:
                    walk(node["/K"], page, tbl)
                return
            if stype == "/TR" and table is not None:
                kids = resolve(node.get("/K"))
                kids = kids if isinstance(kids, (list, ArrayObject)) else [node.get("/K")]
                row = []
                for kid in kids:
                    kd = resolve(kid)
                    if isinstance(kd, DictionaryObject) and str(kd.get("/S", "")) in ("/TH", "/TD"):
                        row.append(self.cell_text(kd, page))
                if row:
                    table["rows"].append(row)
                return
            if stype == "/P" and table is None:
                raw = self.cell_text(node, page, raw=True)
                if norm(raw):
                    out.append({"kind": "text", "page": page, "text": norm(raw), "raw": raw})
                return
            if "/K" in node:
                walk(node["/K"], page, table)

        root = self.reader.trailer["/Root"].get("/StructTreeRoot")
        if root is None:
            return out
        walk(resolve(root).get("/K"))
        return out


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
