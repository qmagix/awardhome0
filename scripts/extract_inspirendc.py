#!/usr/bin/env python3
"""Inspire NDC results (PDF + title-report HTML) -> reviewable txt.

Step 2 of the Inspire import (step 1 = scripts/scrape_inspirendc_results.js,
which fills raw/inspirendc/<year>/ and writes index.json per year). Run
offline against the cached files; never re-downloads.

Usage:
    python3 scripts/extract_inspirendc.py [--from 2023] [--to 2026] [--file NAME]

WHAT THE FILES LOOK LIKE
------------------------
The PDFs are tagged (Word-derived tables merged with designed Canva-style
pages by iLovePDF), so tables are read straight off the accessibility tree
via scripts/lib/pdf_tags.py - the same machinery as Hollywood Vibe.
One results book carries up to five kinds of award content:

  Overall Awards   sections like "Solo ~ Mini ~ Recreational" with columns
                   Placement|Entry|Routine Title|Studio Name|Performers -
                   the Performers column carries the FULL group roster,
                   which is why this org is worth the PDF parse. Variants:
                   no-Performers (4 col), + "# of Dancers" (6), + Score (7).
  Title Winners    Miss/Mr. title results; a table in some books, loose
                   text runs (section, ENTRY/ROUTINE/STUDIO headers, then
                   value triplets) in others. "~ Runner Up" sections too.
  Top Score        per-session high-score tables introduced by
                   "Session N - ..." + "Top Score - 11 & Under/12 & Up"
                   text, with a class-level row (Recreational/Competition/
                   Competition Elite/...) ahead of each run of rows.
  Photogenic       designed pages; label: name pairs ("Miss Petite: ...",
  /Costume/Studio  "Entry #145 - Routine", "... Studio of Excellence: X").
                   The tag tree LOSES some of this text, so these pages are
                   parsed from the text layer (extract_text) instead, with
                   unparseable fragments FLAGGED rather than guessed.

Some events (all of 2024's HTML rows, two 2023 ones, 2026 nationals) only
published the CompGenie "Title Result" report - title_<guid>.html - which
is parsed for its Miss/Mr. winners (the MEDAL column is an adjudication
band, not an award, and is dropped per docs/org_top_awards.md).

Bare books (2024, late 2023, the one zip) have no event-name header page;
their event name falls back to the grid's state + date range from
index.json. Books with a header page give the host city, e.g.
"Inspire National Dance Competition Fort Mill, SC (May 15-17, 2026)".
Every event name gets its date range appended - cities repeat within a
season, and "Fort Mill, SC (May 15-17)" is how families identify the
weekend anyway.

Output: tobeprocessed/inspirendc/txt/<year>-<mmdd>-<slug>.txt, one line per
award:
  Sec: OVERALL | Cat: <section> | Place: 1ST | Entry: 155 | Routine: ... |
  Studio: ... | Dancers: NAME, NAME, ...
Sec is OVERALL / TOPSCORE / TITLE-MISS / TITLE-MR / PHOTOGENIC / COSTUME /
STUDIO. Names stay exactly as published (all-caps); the importer decides
matching. Review the txt before running the importer.
"""
import argparse
import html as htmllib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib.pdf_tags import Doc, norm, slug  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw", "inspirendc")
OUT_DIR = os.path.join(ROOT, "tobeprocessed", "inspirendc", "txt")
BASE_URL = "https://inspirendc.dancecompgenie.com"

PLACE = re.compile(r"^\d{1,2}(ST|ND|RD|TH)$", re.I)
LEVELS = {"recreational", "competition", "competition elite", "inspiring gem", "pro/am", "pro-am"}
TITLE_HEADERS = {"entry", "routine title", "studio name", "medal placement", "class/ level", "class/level", "age category 1", "age"}
# The one zipped book has no header page; its inner file name carries the city.
CITY_OVERRIDES = {"2024_03_18_09_48_12_Result.zip": "Columbus, GA"}


def clean(s):
    return norm(s).strip()


def dash(s):
    return s if s else "-"


def split_parens_dancers(routine):
    """'FABULOUS (CHARLEE YOUNG)' -> ('FABULOUS', ['CHARLEE YOUNG']).
    Only strips the parens when the content looks like performer names."""
    m = re.match(r"^(.*?)\s*\(([^()]+)\)\s*$", routine, re.S)
    if not m:
        return routine, []
    inner = clean(m.group(2))
    names = [clean(n) for n in re.split(r",|&", inner) if clean(n)]
    if names and all(re.match(r"^[A-Z][\w'.’-]*(\s+[\w'.’()-]+)+$", n) for n in names):
        return clean(m.group(1)), names
    return routine, []


# Pageant-style "label: name" awards (photogenic page and friends).
# Label cores seen across the corpus: Miss X / Mr. X / N-Year-Old Miss /
# Natural Beauty / Most Creative / Best Eyes / Pretty Smile / ...
PAIR_CORE = re.compile(
    r"\b(Miss|Mister|Mr\.?|Natural Beauty|Fresh Face|Photogenic|Personality"
    r"|(?:Most|Best|Pretty|Sweet|Cute|Striking)\s+[A-Z]\w+)\b")


def label_pairs(seg):
    """'8-Year-Old Miss: Sutton Lovett' -> [('8-Year-Old Miss','Sutton Lovett')].
    Also handles the occasional colon-less book ('Senior Miss Kaytlin
    Prevatt'). Returns [] for text that isn't a pair at all, None for text
    that looks pair-ish but doesn't parse (caller flags it)."""
    if not PAIR_CORE.search(seg):
        return []
    if ":" not in seg:
        m = re.match(r"^(.*?(?:Miss|Mr\.?|Natural Beauty))\s+([A-Z][\w'.’-]*(?:\s+[A-Z][\w'.’-]+){1,3})$", seg)
        return [(clean(m.group(1)), clean(m.group(2)))] if m else []
    left, _, right = seg.partition(":")
    label, name = clean(left), clean(right)
    if ":" in right or not PAIR_CORE.search(label):
        return None   # multi-pair leftovers or junk: caller flags
    if len(label.split()) > 5 or len(name.split()) > 5:
        return None
    # a following label's age prefix can wrap onto this name ("Lora Gore Teen")
    m = re.match(r"^(.+\S)\s+(?:Mini|Petite|Junior|Teen|Senior)$", name)
    if m and len(m.group(1).split()) >= 2:
        name = m.group(1)
    return [(label, name)]


class EventRows:
    def __init__(self):
        self.rows = []    # dicts: sec, cat, place, entry, routine, studio, dancers
        self.flags = []   # raw strings for review
        self.city = None
        self.date_in_header = None

    def add(self, sec, cat, place, entry, routine, studio, dancers, note=None):
        dancers = [re.sub(r"\s*\((?:MALE|FEMALE)\)$", "", clean(d)) for d in dancers if clean(d)]
        self.rows.append({"sec": sec, "cat": clean(cat), "place": clean(place),
                          "entry": clean(entry), "routine": clean(routine),
                          "studio": clean(studio), "dancers": dancers,
                          "note": note})

    def flag(self, why, raw):
        self.flags.append(f"{why}: {raw}")


def header_map(cells):
    """['Placement','Entry','Routine Title','Studio Name','Performers'] ->
    column index map, tolerant of squashed variants (StudioName), of a
    stray word in the Placement slot ('page', bled in from a heading), of
    the routine-first title-candidates layout (no Placement column), and
    of a Class/Level column."""
    idx = {}
    for i, c in enumerate(cells):
        k = re.sub(r"\s+", "", c.lower())
        if k == "placement":
            idx["place"] = i
        elif k == "entry":
            idx["entry"] = i
        elif k.startswith("routine"):
            idx["routine"] = i
        elif k.startswith("studio"):
            idx["studio"] = i
        elif k == "performers":
            idx["dancers"] = i
        elif k == "score":
            idx["score"] = i
        elif k.startswith("#ofdancer"):
            idx["count"] = i
        elif k.startswith("class"):
            idx["klass"] = i
    if {"entry", "routine", "studio"} <= set(idx):
        if "place" not in idx and cells and re.sub(r"\s+", "", cells[0].lower()) not in (
                "entry", "routinetitle", "studioname", "performers"):
            # unknown word in the first slot = the Placement column header
            # got mangled; data rows still start with the ordinal
            idx["place"] = 0
        return idx
    return None


def is_header_row(cells):
    known = {"placement", "entry", "routinetitle", "studioname", "performers",
             "score", "#ofdancers", "class/level", "page"}
    hits = sum(1 for c in cells if re.sub(r"\s+", "", c.lower()) in known)
    return hits >= 3


def gender_of(text):
    m = re.search(r"Title Result\s*(Miss|Mr\.?|Non.?Binary)|(Non.?Binary)\s+Title", text, re.I)
    if not m:
        return None
    g = (m.group(1) or m.group(2)).upper()
    if g.startswith("MISS"):
        return "MISS"
    if g.startswith("MR"):
        return "MR"
    return "NB"


def emit_title(ev, gender, section, entry, routine, studio):
    sec = f"TITLE-{gender}" if gender else "TITLE"
    label = {"MISS": "Miss", "MR": "Mr.", "NB": "Non-Binary"}.get(gender, "")
    runner = re.search(r"~\s*Runner[- ]?Up\s*$", section, re.I)
    cat = re.sub(r"~\s*Runner[- ]?Up\s*$", "", section, flags=re.I).strip(" ~")
    place = (f"Title Runner-Up ({label})" if runner else f"Title Winner ({label})").replace(" ()", "")
    routine, dancers = split_parens_dancers(routine)
    ev.add(sec, cat, place, entry, routine, studio, dancers)


def extract_pdf(path):
    """One results book -> EventRows via the unified block/row state machine."""
    doc = Doc(path)
    ev = EventRows()
    mode = None            # None | OVERALL | TITLE | TOPSCORE | SHOWCASE
    cat = None             # current Overall/Showcase section
    gender = None
    session, topage, level = None, None, None
    showcase = None        # {'head': 'Crystal Showcase ...', 'sub': None}
    hmap = None            # persists across continuation tables
    title_sec, title_buf = None, []   # for the loose-text title style

    def flush_title_buf():
        nonlocal title_buf
        if title_sec and len(title_buf) == 3:
            emit_title(ev, gender, title_sec, title_buf[0], title_buf[1], title_buf[2])
        elif title_buf:
            ev.flag("partial title run", " / ".join(title_buf))
        title_buf = []

    def on_marker(t):
        """Mode headers arrive both as text blocks and single-cell rows."""
        nonlocal mode, cat, gender, session, topage, level, showcase
        if re.search(r"Overall Awards", t, re.I):
            flush_title_buf()
            mode, cat, showcase = "OVERALL", None, None
            return True
        if re.search(r"Crystal Showcase|Showcase", t, re.I) and "~" not in t:
            # Nationals-only: top-N showdown rounds, grouped under headings
            # like "Crystal Showcase S/D/T" / "Group Crystal Showcase"
            flush_title_buf()
            mode, cat = "SHOWCASE", None
            showcase = {"head": t, "sub": None}
            return True
        if re.search(r"Title Winners", t, re.I):
            flush_title_buf()
            mode = "TITLE"
            return True
        g = gender_of(t)
        if g:
            flush_title_buf()
            mode, gender = "TITLE", g
            return True
        if re.match(r"^Session\b", t, re.I):
            flush_title_buf()
            session = t
            return True
        if re.search(r"Top\s*Score", t, re.I) or re.match(r"^Score\s*-", t):
            flush_title_buf()
            mode, topage, level = "TOPSCORE", re.sub(r"^.*?(Top\s*Score|Score)", r"\1", t), None
            return True
        return False

    def data_row(cells):
        nonlocal hmap
        if hmap is None:
            ev.flag("data row before any header", " | ".join(cells))
            return
        short = None
        if len(cells) > len(hmap_cells):
            ev.flag("more cells than header (columns ambiguous)", " | ".join(cells))
            return
        if len(cells) < len(hmap_cells):
            # trailing column(s) wrapped into their own row; a continuation
            # row usually follows and is merged by try_merge below
            short = f"only {len(cells)}/{len(hmap_cells)} cells (trailing columns wrapped)"
            cells = cells + [""] * (len(hmap_cells) - len(cells))
        get = lambda k: cells[hmap[k]] if k in hmap and hmap[k] < len(cells) else ""
        routine, parens = split_parens_dancers(get("routine"))
        dancers = [clean(d) for d in get("dancers").split(",") if clean(d)] if "dancers" in hmap else []
        if not dancers:
            dancers = parens
        note = short
        if "count" in hmap and get("count").isdigit() and dancers and int(get("count")) != len(dancers):
            note = ((note + "; ") if note else "") + f"# of dancers says {get('count')}, parsed {len(dancers)}"
        if "place" not in hmap:
            # routine-first title-candidates table (no Placement column)
            note = ((note + "; ") if note else "") + "from routine-first table without a heading - verify title winners"
            ev.add("TITLE", get("klass"), "Title Winner", get("entry"), routine, get("studio"), dancers, note)
        elif mode == "SHOWCASE":
            parts = [showcase["head"] if showcase else None,
                     showcase["sub"] if showcase else None, cat]
            ev.add("SHOWCASE", " ~ ".join(p for p in parts if p), get("place"),
                   get("entry"), routine, get("studio"), dancers, note)
        elif mode == "TOPSCORE":
            parts = [p for p in (session, topage, level) if p]
            ev.add("TOPSCORE", " ~ ".join(parts), get("place"), get("entry"), routine, get("studio"), dancers, note)
        else:
            if not cat:
                ev.flag("placement row with no current section", " | ".join(cells))
                return
            ev.add("OVERALL", cat, get("place"), get("entry"), routine, get("studio"), dancers, note)
        last_data["row"] = ev.rows[-1]

    def try_merge(cells):
        """A data row that wraps grows a continuation TR holding the tail of
        its studio and/or performers cell. Merge it back, leaving a CHECK
        note so review can eyeball the join."""
        lr = last_data["row"]
        if lr is None:
            return False
        frag_studio = frag_perf = None
        if len(cells) == 2:
            frag_studio, frag_perf = cells
        elif len(cells) == 1:
            c = cells[0]
            caps = c == c.upper()
            if caps and "," in c:
                frag_perf = c
            elif not caps:
                frag_studio = c
            elif caps and not lr["dancers"]:
                frag_perf = c
            else:
                return False   # all-caps, no comma, roster present: ambiguous
        else:
            return False
        added = []
        if frag_studio:
            lr["studio"] = clean(lr["studio"] + " " + frag_studio)
            added.append(f"studio ends '{frag_studio}'")
        if frag_perf:
            names = [clean(n) for n in frag_perf.split(",") if clean(n)]
            if lr["dancers"] and names:
                last = lr["dancers"][-1]
                if last.endswith("-"):
                    lr["dancers"][-1] = last + names.pop(0)
                    added.append("fused hyphen-wrapped name")
                elif " " not in last and " " not in names[0]:
                    # roster wrapped mid-name without a hyphen ("ARIANA" / "CARRILLO, ...")
                    lr["dancers"][-1] = last + " " + names.pop(0)
                    added.append(f"fused split name '{lr['dancers'][-1]}'")
                elif " " not in last:
                    added.append(f"POSSIBLE split name at join: '{last}' + '{names[0]}'")
            if names:
                lr["dancers"].extend(names)
                added.append(f"+{len(names)} performers")
        lr["note"] = ((lr["note"] + "; ") if lr.get("note") else "") + \
            "merged continuation row (" + ", ".join(added) + ")"
        return True

    hmap_cells = None
    last_data = {"row": None}
    for b in doc.blocks():
        if b["kind"] == "text":
            t = b["text"]
            if "Inspire National Dance Competition" in t:
                if ev.city is None:
                    rest = clean(t.split("Inspire National Dance Competition", 1)[1])
                    m = re.match(r"^(.*?)\s*\(([^)]*)\)\s*$", rest)
                    ev.city, ev.date_in_header = (clean(m.group(1)), clean(m.group(2))) if m else (rest or None, None)
                continue  # books repeat this banner between sections
            if on_marker(t):
                continue
            if t.strip().lower() == "top":   # "Top / Score - 12 & Up" split across blocks
                continue
            if mode == "SHOWCASE" and showcase is not None and "~" not in t:
                showcase["sub"] = t          # e.g. "Small/Large Groups 11 & Under"
                continue
            if mode == "TITLE":
                if "~" in t and not re.match(r"^\d", t):
                    flush_title_buf()
                    title_sec = t
                elif t.strip().lower() in TITLE_HEADERS:
                    pass
                elif title_sec:
                    title_buf.append(t)
                    if len(title_buf) == 3:
                        flush_title_buf()
            # everything else (designed-page fragments) is covered by extras()
            continue

        for raw_row in b["rows"]:
            cells = [clean(c) for c in raw_row]
            if not any(cells):
                continue
            # pageant "label: name" cells (photogenic tables, 2023 style,
            # and the Most Creative/Pretty Smile/... variants)
            nonempty = [c for c in cells if c]
            pairs = [label_pairs(c) for c in nonempty]
            if pairs and all(p for p in pairs) and all(p[0][1] for p in pairs):
                for p in pairs:
                    ev.add("PHOTOGENIC", "", p[0][0], "", "", "", [p[0][1]])
                last_data["row"] = None
                continue
            if len(cells) == 1:
                c = cells[0]
                if on_marker(c):
                    last_data["row"] = None
                    continue
                if "~" in c:
                    flush_title_buf()
                    last_data["row"] = None
                    if mode == "TITLE":
                        title_sec = c
                    elif mode == "SHOWCASE":
                        cat = c
                    else:
                        if mode == "TOPSCORE":
                            ev.flag("section row while in Top Score (treated as Overall)", c)
                        mode = "OVERALL"
                        cat = c
                    continue
                if c.lower() in LEVELS:
                    level = c
                    last_data["row"] = None
                    if mode not in ("TOPSCORE", "SHOWCASE"):
                        mode = "TOPSCORE"
                    continue
                if try_merge(cells):
                    continue
                ev.flag("orphan single-cell row", c)
                continue
            low0 = cells[0].lower()
            if low0 == "placement" or is_header_row(cells):
                hm = header_map(cells)
                if hm:
                    hmap, hmap_cells = hm, cells
                else:
                    ev.flag("unrecognised header row", " | ".join(cells))
                last_data["row"] = None
                continue
            if PLACE.match(cells[0]) and len(cells) >= 4:
                if mode == "TITLE":   # a placement table resumed without its marker
                    mode = "OVERALL" if not showcase else "SHOWCASE"
                data_row(cells)
                continue
            if (hmap is not None and "place" in hmap and len(cells) == len(hmap_cells)
                    and cells[hmap["place"]] == "" and last_data["row"] is not None):
                # blank placement cell between ranked rows = a tie with the
                # row above (how these books publish tied placements)
                tied = list(cells)
                tied[hmap["place"]] = last_data["row"]["place"]
                data_row(tied)
                r = ev.rows[-1]
                r["note"] = ((r["note"] + "; ") if r.get("note") else "") + \
                    "blank placement cell - assumed tie with previous row"
                continue
            if mode == "TITLE":
                if low0 in TITLE_HEADERS:
                    continue
                if re.match(r"^\d+[A-Za-z]?$", cells[0]) and len(cells) >= 3:
                    emit_title(ev, gender, title_sec or "", cells[0], cells[1], cells[-1])
                    continue
                ev.flag("unrecognised title row", " | ".join(cells))
                continue
            if hmap is not None and "place" not in hmap and len(cells) == len(hmap_cells):
                data_row(cells)   # routine-first title-candidates rows
                continue
            if try_merge(cells):
                continue
            ev.flag("unrecognised row", " | ".join(cells))
    flush_title_buf()

    extras(doc, ev)
    return ev


# ---------------------------------------------------------------- extras ----

# Designed pages double their display text as shadow layers ("RESULTSRESULTS
# PAGEPAGE") - a junk token is one display word possibly repeated onto itself.
JUNK_TOKEN = re.compile(r"^(?:RESULTS?|PAGE|ADDITIONAL|AWARDS?|WINNERS?|CONGRATULATIONS!?|TO|OUR)+!?$", re.I)
LABELISH = re.compile(r"(Miss|Mister|Mr\.?|Natural Beauty|Fresh Face|Personality|King|Queen)", re.I)


def is_junk(seg):
    if not seg or seg.startswith("#"):
        return True
    return all(JUNK_TOKEN.match(tok) for tok in seg.split())


def extras(doc, ev):
    """Photogenic / costume / studio awards live on designed pages whose text
    the tag tree drops, so read those PAGES from the text layer. Anything
    that doesn't parse is FLAGGED, not guessed."""
    entry_map = {}
    for r in ev.rows:          # any section; OVERALL wins on collisions
        if r["entry"] and (r["entry"] not in entry_map or r["sec"] == "OVERALL"):
            entry_map[r["entry"]] = r
    # photogenic tables already emitted from the tag stream must not be
    # double-counted when the same page parses from the text layer
    seen_pairs = {(r["place"].lower(), d.lower())
                  for r in ev.rows if r["sec"] == "PHOTOGENIC" for d in r["dancers"]}
    for page in doc.reader.pages:
        try:
            text = page.extract_text() or ""
        except Exception:
            continue
        # detect on space-squashed text: display headings often arrive
        # letter-spaced ("C o s t u m e  W i n n e r s")
        squash = re.sub(r"\s+", "", text).lower()
        has_photo = "photogenic" in squash
        has_costume = "costume" in squash and "entry" in squash
        has_studio = "studioofexcellence" in squash or "studioaward" in squash
        if not (has_photo or has_costume or has_studio):
            continue
        # de-shadow doubled headline text ("RESULTSRESULTS"), split lines that
        # picked up two columns ("...TickleMiss Teen: ..."), rejoin wrapped
        # names ("Miss Junior: Scarlett" / "Jones").
        segs = []
        for line in text.split("\n"):
            line = clean(line)
            if is_junk(line):
                continue
            if re.match(r"^(?:[A-Za-z#] ){3,}", line):   # spaced-out display caps
                continue
            # two columns can concatenate without a break ("...TickleMiss
            # Teen: ...") or two pairs can share one line ("Mr. X: A Miss
            # Y: B") - split before any interior label that leads to a colon
            cores = (r"Mister|Miss|Mr\.?|Natural\s+Beauty|Fresh\s+Face"
                     r"|(?:Most|Best|Pretty|Sweet|Cute|Striking)\s+[A-Z]\w*")
            parts = re.split(r"(?<=[a-z.!])(?=(?:Entry\s*#|\w[\w-]*-Year-Old"
                             r"|(?:(?:Mini|Petite|Junior|Teen|Senior|Little|Young)\s+)?(?:" + cores + r"))\s)", line)
            parts = [p2 for p in parts for p2 in re.split(
                r"\s+(?=(?:(?:Mini|Petite|Junior|Teen|Senior|Little|Young|\w[\w-]*-Year-Old)\s+)?"
                r"(?:" + cores + r"|Entry\s*#)"
                r"[^:]{0,20}:)", p)]
            for seg in parts:
                seg = clean(seg)
                if not is_junk(seg):
                    segs.append(seg)
        merged = []
        for seg in segs:
            if merged and (merged[-1].endswith(":") or (
                    not re.search(r"[:#]", seg)
                    and not LABELISH.search(seg)
                    and len(seg.split()) <= 3
                    and re.match(r"^[A-Z]", seg))):
                merged[-1] = merged[-1] + " " + seg
            else:
                merged.append(seg)
        for seg in merged:
            hm = re.search(r"Photogenic\s+Winners?", seg, re.I)
            if hm:
                # the heading itself - and on bare books it is the only place
                # the host city is printed ("Rocky Mount, NC #2 ~ March 20-22
                # Photogenic Winners")
                city = clean(re.sub(
                    r"[~-]?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d[\d\s,–-]*", "",
                    seg[:hm.start()]))
                city = re.sub(r"^Inspire National Dance Competition\s*", "", city).strip(" ~-")
                if ev.city is None and len(city) > 2:
                    ev.city = city
                continue
            m = re.match(r"^Entry\s*#?\s*(\d+[A-Z]?)\s*[-–—]?\s*(.*)$", seg, re.I)
            if m and has_costume:
                entry, routine = m.group(1), clean(m.group(2))
                hit = entry_map.get(entry) or entry_map.get(entry.zfill(3))
                ev.add("COSTUME", "", "Costume Winner", entry,
                       routine or (hit["routine"] if hit else ""),
                       hit["studio"] if hit else "", hit["dancers"] if hit else [])
                continue
            m = re.match(r"^(.*?(?:Studio of Excellence|Inspirational Studio Award|Studio Award))\s*:?\s*(.*)$", seg, re.I)
            if m and has_studio:
                if clean(m.group(2)):
                    ev.add("STUDIO", "", clean(m.group(1)), "", "", clean(m.group(2)), [])
                else:
                    ev.flag("studio award without a studio name", seg)
                continue
            pairs = label_pairs(seg)
            if pairs:
                for label, name in pairs:
                    if not name:
                        ev.flag("pageant label without a name", seg)
                    elif (label.lower(), name.lower()) not in seen_pairs:
                        seen_pairs.add((label.lower(), name.lower()))
                        ev.add("PHOTOGENIC", "", label, "", "", "", [name])
                continue
            if pairs is None or LABELISH.search(seg) or "#" in seg:
                ev.flag("unparsed extras line", seg)


# ------------------------------------------------- title-report HTML --------

def extract_title_html(path):
    """CompGenie 'Title Result' report (title_<guid>.html): a single table of
    Title Result Miss/Mr. headers, '~' section rows, and 6-column data rows
    ENTRY|ROUTINE|MEDAL|CLASS|AGE|STUDIO. Medal = adjudication band, dropped."""
    html = open(path, encoding="utf-8", errors="replace").read()
    ev = EventRows()
    gender, section, seen_in_section = None, None, 0
    for rowhtml in re.split(r"</tr>", html, flags=re.I):
        cells = [clean(htmllib.unescape(re.sub(r"<[^>]+>", " ", c)))
                 for c in re.split(r"<td[^>]*>", rowhtml, flags=re.I)[1:]]
        cells = [c for c in cells if c]
        if not cells:
            continue
        joined = " ".join(cells)
        g = gender_of(joined)
        if g:
            gender, section, seen_in_section = g, None, 0
            continue
        if len(cells) == 1 and "~" in cells[0]:
            section, seen_in_section = cells[0], 0
            continue
        if cells[0].lower() in TITLE_HEADERS:
            continue
        if section and re.match(r"^\d+[A-Za-z]?$", cells[0]) and len(cells) >= 3:
            seen_in_section += 1
            emit_title(ev, gender, section, cells[0], cells[1], cells[-1])
            if seen_in_section > 1:
                ev.flag("extra row in title section (winner? runner-up?)",
                        f"{section}: {' | '.join(cells)}")
    return ev


# ------------------------------------------------------------- output -------

def compress_range(date):
    """'May 15 - May 17' -> 'May 15-17'; cross-month ranges stay as-is."""
    m = re.match(r"^(\w+) (\d+) - (\w+) (\d+)$", date or "")
    if not m:
        return date or ""
    if m.group(1) == m.group(3):
        if m.group(2) == m.group(4):
            return f"{m.group(1)} {int(m.group(2))}"
        return f"{m.group(1)} {int(m.group(2))}-{int(m.group(4))}"
    return f"{m.group(1)} {int(m.group(2))} - {m.group(3)} {int(m.group(4))}"


MONTHS = {m: i + 1 for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June",
     "July", "August", "September", "October", "November", "December"])}


def mmdd(date):
    m = re.match(r"^(\w+) (\d+)", date or "")
    return f"{MONTHS.get(m.group(1), 0):02d}{int(m.group(2)):02d}" if m and m.group(1) in MONTHS else "0000"


def write_txt(year, entry, ev, out_rows, used):
    date = compress_range(entry.get("date"))
    city = ev.city or CITY_OVERRIDES.get(entry.get("file") or "", None)
    name_base = city or entry.get("location") or "Unknown"
    event_name = f"{name_base} ({date})" if date else name_base
    fname = f"{year}-{mmdd(entry.get('date'))}-{slug(name_base)}.txt"
    # two same-state events can share a weekend (title-report rows carry no
    # city) - keep them distinct or they'd merge into one event at import
    n = used.get(fname, 0) + 1
    used[fname] = n
    if n > 1:
        event_name += f" #{n}"
        fname = fname[:-4] + f"-{n}.txt"
    path = os.path.join(OUT_DIR, fname)
    lines = [
        "# Inspire NDC extraction -> review before importing (see extract_inspirendc.py)",
        f"Event: {event_name}",
        f"Year: {year}",
        f"DateString: {date}, {year}" if date else f"DateString: {year}",
        f"Location: {entry.get('location') or '-'}",
        f"SourceFile: {entry.get('srcpath')}",
        f"SourceURL: {BASE_URL}{entry.get('url')}" if entry.get("url") else "SourceURL: -",
    ]
    if not ev.city and city:
        lines.append(f"# city from archive file name ({entry.get('file')})")
    if not city:
        lines.append("# NO city in the book - event named from grid state + dates; rename if you know the host city")
    for r in ev.rows:
        line = (f"Sec: {r['sec']} | Cat: {dash(r['cat'])} | Place: {dash(r['place'])} | "
                f"Entry: {dash(r['entry'])} | Routine: {dash(r['routine'])} | "
                f"Studio: {dash(r['studio'])} | Dancers: {dash(', '.join(r['dancers']))}")
        if r.get("note"):
            line += f"   # CHECK: {r['note']}"
        lines.append(line)
    for f in ev.flags:
        lines.append(f"FLAGGED: {f}")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    out_rows.append((fname, len(ev.rows), len(ev.flags)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="yfrom", type=int, default=2023)
    ap.add_argument("--to", dest="yto", type=int, default=2026)
    ap.add_argument("--file", help="only process this raw file (basename)")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    out_rows, totals, used = [], {"rows": 0, "flags": 0, "files": 0, "checks": 0}, {}
    for year in range(args.yfrom, args.yto + 1):
        idx_path = os.path.join(RAW, str(year), "index.json")
        if not os.path.exists(idx_path):
            continue
        for entry in json.load(open(idx_path)):
            if entry.get("kind") == "none" or not entry.get("file"):
                continue
            if args.file and entry["file"] != args.file:
                continue
            src = os.path.join(RAW, str(year), entry["file"])
            entry["srcpath"] = f"{year}/{entry['file']}"
            if entry["kind"] == "zip":
                inner = [f for f in os.listdir(os.path.join(RAW, str(year), "zip_extracted"))
                         if f.lower().endswith(".pdf")]
                if not inner:
                    print(f"{entry['file']}: zip not extracted - run unzip first", file=sys.stderr)
                    continue
                src = os.path.join(RAW, str(year), "zip_extracted", inner[0])
                entry["srcpath"] = f"{year}/zip_extracted/{inner[0]}"
            if not os.path.exists(src):
                print(f"{entry['srcpath']}: missing", file=sys.stderr)
                continue
            try:
                if entry["kind"] == "title-report":
                    ev = extract_title_html(src)
                else:
                    ev = extract_pdf(src)
            except Exception as e:
                print(f"{entry['srcpath']}: EXTRACT FAILED: {e}", file=sys.stderr)
                continue
            write_txt(year, entry, ev, out_rows, used)
            checks = sum(1 for r in ev.rows if r.get("note"))
            totals["rows"] += len(ev.rows)
            totals["flags"] += len(ev.flags)
            totals["checks"] += checks
            totals["files"] += 1
            print(f"{out_rows[-1][0]}: {len(ev.rows)} rows, {len(ev.flags)} flagged"
                  + (f", {checks} count-checks" if checks else ""))

    print(f"\n{totals['files']} events -> {totals['rows']} rows, "
          f"{totals['flags']} flagged, {totals['checks']} roster-count checks.")
    print(f"Review {os.path.relpath(OUT_DIR, ROOT)} before importing.")


if __name__ == "__main__":
    main()
