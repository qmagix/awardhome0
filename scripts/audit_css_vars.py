#!/usr/bin/env python3
# CSS variable audit — finds var(--x) usages with no --x: definition in scope.
# Born 2026-08-28 after --accent-gold turned out to be referenced for months
# but never defined (FAQ "gold" highlights silently rendered gray).
#
#   python3 scripts/audit_css_vars.py
#
# Scopes: (1) main app — a var used by a view/css file must be defined in
# styles.css, the same file, ANY public/css sibling (cross-file palettes like
# the v2 system live in studio_v2.css — flagged separately so you can check
# the page actually loads the defining sheet); (2) each static landing dir;
# (3) utils/invites.js emails, where var() is entirely unsupported.
import re, glob, os, sys
root = os.path.join(os.path.dirname(__file__), '..')
defs_in = lambda t: set(re.findall(r'--([\w-]+)\s*:', t))
# Set inline per-element by design (card coin fit vars from the partial),
# with CSS fallbacks as the default — not stylesheet-defined on purpose.
INLINE_BY_DESIGN = {'org-logo-opacity', 'org-logo-transform'}
uses_in = lambda t: set(re.findall(r'var\(\s*--([\w-]+)', t))
fb_in   = lambda t: set(re.findall(r'var\(\s*--([\w-]+)\s*,', t))

css = {os.path.basename(f): open(f).read() for f in glob.glob(root + '/public/css/*.css')}
all_css_defs = set().union(*[defs_in(t) for t in css.values()])
base = defs_in(css.get('styles.css', ''))
bad, warn = [], []

for f in glob.glob(root + '/views/**/*.ejs', recursive=True) + glob.glob(root + '/public/css/*.css'):
    t = open(f).read(); local = defs_in(t); rel = os.path.relpath(f, root)
    for u in sorted(uses_in(t)):
        if u in local or u in base or u in INLINE_BY_DESIGN: continue
        (warn if u in all_css_defs else bad).append(
            (rel, u, u in fb_in(t),
             [k for k, v in css.items() if u in v] if u in all_css_defs else []))

for d in ['public2', 'public3', 'landing']:
    texts = []
    for f in glob.glob(root + f'/{d}/*'):
        try: texts.append(open(f).read())
        except Exception: pass
    ad = set().union(*[defs_in(t) for t in texts]) if texts else set()
    au = set().union(*[uses_in(t) for t in texts]) if texts else set()
    for u in sorted(au - ad): bad.append((d + '/*', u, False, []))

t = open(root + '/utils/invites.js').read()
for u in sorted(uses_in(t)): bad.append(('utils/invites.js (EMAIL: var() unsupported!)', u, False, []))

if bad:
    print('UNDEFINED VARIABLES (broken unless fallback):')
    for f, u, fb, _ in bad: print(f'  {f}: --{u}' + ('  [fallback]' if fb else ''))
if warn:
    print('\nDefined only in a sibling css file (verify the page loads it):')
    for f, u, fb, owners in sorted(set((a, b, c, tuple(d)) for a, b, c, d in warn)):
        print(f'  {f}: --{u} <- {",".join(owners)}')
print('\n' + ('FAIL' if bad else 'CLEAN — every var resolves'))
sys.exit(1 if bad else 0)
