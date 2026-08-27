#!/usr/bin/env python3
"""Tremaine Dancers of the Year -> reviewable txt.

Tremaine's flagship dancer titles live on two WordPress pages, not in the
results PDFs:
  /doty-archive/            every season back to 1993-94: name + division
                            (modern: Pre-Pro/Senior/Teen/Pre-Teen/Junior,
                            early years: Senior Female/Senior Male/...)
  /winners/d-o-t-y-<season>/  the current season, with studio + home town

Fetches both (cached under raw/tremaine/doty/), emits one txt per season:
tobeprocessed/tremaine/txt/doty-<season>.txt with
  Event: D.O.T.Y. <season>   Year: <season end year>
  Sec: DOTY | Place: <Division> Dancer of the Year | Dancers: <name>
Titles are dancer-level; studio is known only for the current season.
Review before importing (the importer decides how season events land).

Usage: python3 scripts/extract_tremaine_doty.py [--season 2025-26]
"""
import argparse
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw", "tremaine", "doty")
OUT_DIR = os.path.join(ROOT, "tobeprocessed", "tremaine", "txt")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
ARCHIVE_URL = "https://www.tremainedance.com/doty-archive/"
CURRENT_URL = "https://www.tremainedance.com/winners/d-o-t-y-{season}/"

SEASON_HDR = re.compile(r"^((?:19|20)\d{2})\s*-\s*((?:19|20)?\d{2})\s+DANCERS? OF THE YEAR", re.I)
DIVISIONS = re.compile(r"^(Pre-?Pro|Senior|Teen|Pre-?Teen|Junior|Mini|Petite)(\s+(Female|Male))?$", re.I)


def fetch(url, cache_name):
    os.makedirs(RAW, exist_ok=True)
    path = os.path.join(RAW, cache_name)
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        data = urllib.request.urlopen(req, timeout=60).read()
        open(path, "wb").write(data)
    return open(path, encoding="utf-8", errors="replace").read()


def text_lines(html):
    i = html.rfind("</header>")
    if i > 0:
        html = html[i:]
    j = html.find("<footer")
    if j > 0:
        html = html[:j]
    t = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", html)
    t = re.sub(r"</(p|h[1-6]|li|td|tr|figcaption|div)>", "\n", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = t.replace("&#8211;", "-").replace("&ndash;", "-").replace("&amp;", "&").replace("&#8217;", "'").replace("&#8220;", '"').replace("&#8221;", '"')
    lines = [re.sub(r"\s+", " ", l).strip() for l in t.split("\n")]
    return [l for l in lines if l and len(l) > 1]


def season_key(a, b):
    end = b if len(b) == 4 else (a[:2] + b)
    return f"{a}-{end[-2:]}", int(end)


def parse_archive(lines):
    """-> {season: [(division, name), ...]}. Lines alternate name/division
    under each season heading."""
    out, season, pending_name = {}, None, None
    for ln in lines:
        m = SEASON_HDR.match(ln)
        if m:
            season = season_key(m.group(1), m.group(2))
            out.setdefault(season, [])
            pending_name = None
            continue
        if season is None:
            continue
        if DIVISIONS.match(ln):
            if pending_name:
                out[season].append((ln, pending_name))
                pending_name = None
            continue
        if re.match(r"^[A-ZÀ-Þ][\w'.À-ÿ-]*(\s+[\w'.À-ÿ()-]+){1,3}$", ln):
            if pending_name:   # two names in a row: previous had no division
                out[season].append(("", pending_name))
            pending_name = ln
        # anything else (blurbs, contact text) is ignored
    return out


def parse_current(lines, season_label):
    """Current-season page: '<SEASON> <DIV> D.O.T.Y.' / NAME / Studio / City.
    -> [(division, name, studio, city)]"""
    out = []
    hdr = re.compile(re.escape(season_label) + r"\s+(.+?)\s+D\.?O\.?T\.?Y\.?", re.I)
    i = 0
    while i < len(lines):
        m = hdr.search(lines[i])
        if m and i + 1 < len(lines) and lines[i + 1].upper() == lines[i + 1]:
            division = m.group(1).title()
            name = lines[i + 1].title()
            studio = lines[i + 2] if i + 2 < len(lines) else ""
            city = lines[i + 3] if i + 3 < len(lines) else ""
            if re.search(r"D\.?O\.?T\.?Y|dancer", studio, re.I):
                studio = city = ""
            out.append((division, name, studio, city))
        i += 1
    return out


def write_season(season, endyear, entries):
    path = os.path.join(OUT_DIR, f"doty-{season}.txt")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("# Tremaine Dancers of the Year (see extract_tremaine_doty.py) - review before importing\n")
        fh.write(f"Event: D.O.T.Y. {season}\n")
        fh.write(f"Year: {endyear}\n")
        fh.write(f"DateString: {season} season\n")
        fh.write(f"SourceURL: {ARCHIVE_URL}\n")
        for division, name, studio, city in entries:
            place = f"{division} Dancer of the Year" if division else "Dancer of the Year"
            note = f"   # {city}" if city else ""
            fh.write(f"Sec: DOTY | Cat: - | Place: {place} | Entry: - | Routine: - | "
                     f"Studio: {studio or '-'} | Dancers: {name}{note}\n")
    return len(entries)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2025-26", help="current season page to merge (studio info)")
    args = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)

    archive = parse_archive(text_lines(fetch(ARCHIVE_URL, "doty-archive.html")))
    current = []
    try:
        current = parse_current(text_lines(fetch(CURRENT_URL.format(season=args.season), f"doty-{args.season}.html")),
                                args.season)
    except Exception as e:
        print(f"current-season page: {e}", file=sys.stderr)

    total = 0
    for (season, endyear), pairs in sorted(archive.items()):
        entries = [(d, n, "", "") for d, n in pairs]
        n = write_season(season, endyear, entries)
        total += n
        print(f"doty-{season}.txt: {n} titles")
    if current:
        season = args.season
        endyear = int(season[:2] + season[-2:]) if len(season) == 7 else int("20" + season[-2:])
        n = write_season(season, endyear, current)
        total += n
        print(f"doty-{season}.txt: {n} titles (current season, with studios)")
    print(f"\n{total} DOTY titles across {len(archive) + (1 if current else 0)} seasons.")


if __name__ == "__main__":
    main()
