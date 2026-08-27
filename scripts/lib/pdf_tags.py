"""Tagged-PDF table reader shared by the PDF extractors (Hollywood Vibe,
Inspire NDC, ...).

Reads accessibility structure trees (/StructTreeRoot -> /Table -> /TR ->
/TH|/TD) so tables are READ, not inferred from coordinates: no column
x-positions, no row-height guessing, nothing breaks when an event re-flows
its layout.  Cell text comes from marked content - each cell points at
MCIDs, and the page content stream brackets its text runs with
`/Span <</MCID n>> BDC ... EMC` - decoded through each font's /ToUnicode
CMap because subset fonts write their text as opaque hex strings.

Usage:
    from lib.pdf_tags import Doc, norm, slug
    doc = Doc("results.pdf")
    for block in doc.blocks():   # document order
        if block["kind"] == "table":  block["rows"]  # [[cell, ...], ...]
        else:                         block["text"]  # paragraph text

Grown for the Hollywood Vibe import (see scripts/extract_hollywoodvibe.py
for the war story), factored out when Inspire NDC needed the same machinery.
"""
import re
import sys

try:
    import pypdf
    from pypdf.generic import IndirectObject, DictionaryObject, ArrayObject, NumberObject
except ImportError:
    sys.exit("pypdf is required:  pip3 install pypdf")

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


def resolve(o):
    return o.get_object() if isinstance(o, IndirectObject) else o


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

    Recurses into Form XObjects: Word nests parts of a page (and in some
    files whole table cells) in form streams, and their text would
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
