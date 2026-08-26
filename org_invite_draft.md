# Draft: Organization Outreach Letters (v4, 2026-08-25)

*(v4: numbers refreshed to 1.1M awards / 3,200+ events / 17 competitions;
the org page demo link now lands on the Rafters organizer edition — reach
hero, "your brand on every card" coin mock, champions wall — which IS the
pitch, so lead with it whenever their data is live; claim landing →
dashboard now opens on an upload-first three-step onboarding, so "two
minutes to claim, one upload to go live" is literally true.)*

## Strategy: the commitment ladder

Free-only offers get mentally discounted — zero price sets a zero reference
value, and an unreciprocated gift is easy to ignore. A small contribution
flips that: an organizer who has pledged something treats the platform as
partly theirs (commitment/consistency, endowment), and the willingness to
pledge filters for organizers who will actually engage. The perfect currency
already exists: **free entries/passes**. An empty slot costs the organizer
almost nothing, carries high face value to families, doubles as *their own
customer acquisition* (it returns a proven competitive dancer to their next
event), and becomes our prize inventory for Surprise Rewards (ideas.md §6).

But the ask must come AFTER demonstrated value, not in the first cold email —
reciprocity needs the gift to land first, and every extra ask in a cold touch
cuts reply rate. So we run a ladder:

1. **First touch** (below): near-zero friction CTA (claim link / reply with a
   file), unchanged — plus a short **Founding Partner tease**: the pledge is
   introduced as a limited-status opportunity, not a condition. Planting it
   early makes the later ask feel consistent, not like a bait-and-switch.
2. **The wow:** their events live, branding concierge done, demo page built.
3. **Follow-up letter** (below, 3–10 days after they claim or see the demo):
   the direct pledge ask, framed as joining, not paying.

**Legal guardrail:** letters say "surprise reward," never "lottery" or
"sweepstakes." Do not launch any random-reveal mechanic before the attorney
review (TODOS / maybe_patentable A7). Until then, pledged entries can be
awarded editorially to standout dancers (merit selection, not chance), which
we can start doing immediately.

---

## Letter 1 — first touch

**Subject options** (no "!", no "Free" — deliverability):
- [Competition Name]'s results are already live on AwardHome  *(strongest when we have their data — lead with this)*
- Featuring [Competition Name] on AwardHome
- A founding-partner idea for [Competition Name]

*(The code template in `utils/invites.js` `buildOrgInviteTemplate` mirrors
this letter and pre-fills the live event/award counts + claim link; the
superadmin edits before sending — always add one personal line about a
specific event of theirs.)*

Hi [Name or "Competition Director"],

I'm Q, founder of **AwardHome** — the digital trophy case for competitive
dance. We aggregate results from events nationwide into beautiful, shareable
award pages for dancers and studios: today that's over 900,000 awards from
2,700+ events across 14 competitions, including YAGP, Starpower, KAR, NYCDA,
and Rainbow.

*(If their data is live:)* In fact, [Competition Name] is already there:
[N] of your events, with [N] awards, are live today — see [org page link].
Claiming your organizer profile puts your branding on every one of those
award cards.

**The offer, plainly:** send us your results in whatever format you have —
CSV, Excel, PDFs, database exports, anything — and we handle 100% of the
processing. Zero technical work on your end, at no cost.

**What [Competition Name] gets:**

1. **Your brand on every card dancers share.** A free branding dashboard —
   your logo and custom trophy icons, hand-fitted onto the award cards by
   our design team — so your brand stays visible on social media long after
   the event ends. It's the kind of placement sponsors notice.
2. **Permanent, searchable results.** Dancers and parents constantly search
   for old placements. We host them forever, interactively — no more
   "where can I find 2023 results?" emails, and your events sit beside the
   biggest names in the industry.
3. **Attendance insights.** An organizer account unlocks analytics on the
   studios attending your events — including how many other competitions
   they attend each year — so you can spot loyal studios and understand
   your market.

**One more thing, while it's early:** we're inviting a limited group of
**Founding Partner** organizations this season. Founding Partners pledge a
handful of free entries to their own events — we award them to standout
dancers on the platform as surprise rewards, each one credited *"provided by
[Competition Name]"* — and in return get first access to premium placement
and organizer features as the platform grows. A pledged entry costs you an
empty slot; it returns a proven competitive dancer to your ballroom. If that
sounds interesting, mention it when you reply and I'll hold [Competition
Name] a founding slot.

Claiming your free organizer account takes about two minutes with your
private access link:

{CLAIM_LINK}

Or if you have a recent results file handy, just reply with it attached and
we'll build a live demo page for [Competition Name] — usually within a few
days. And if you'd rather talk first, I'm happy to do a quick 15-minute call.

Thank you for everything you do for the dance community.

Best regards,

Q
Founder, AwardHome
https://awardhome.com
hello@awardhome.com

---

## Letter 2 — Founding Partner follow-up (send 3–10 days after claim/demo)

**Subject:** A Founding Partner slot for [Competition Name]

Hi [Name],

Glad to see [Competition Name]'s page live — [one personal line: their logo
on the cards / a stat from their demo page / a studio that just claimed].

I'd like to hold [Competition Name] one of our **Founding Partner** slots.
The whole arrangement, plainly:

**You pledge [3] free entries** (or convention passes) for the [2027]
season. That's the entire cost — no fees, now or later, for founding
partners.

**We put them to work for you:**

- Each entry goes to a standout dancer on AwardHome as a **surprise
  reward**, revealed on one of their own award cards and credited
  *"provided by [Competition Name]"*.
- Winners are dancers with verified competitive records — exactly the
  families you want in the building, and most bring a studio's worth of
  attention with them.
- Dancers share these cards. Your name — and your generosity — rides along
  on every share.

Why we ask for a pledge instead of just giving everything away: partners
with a stake treat the platform as theirs, and it tells us who'll actually
use the branding and analytics we build. The entry costs you an empty slot;
it returns a converted attendee.

**Founding Partners also get:** permanent Founding Partner recognition on
your organization page, first access to new organizer features (attendance
analytics, priority logo concierge), and a direct line on what we build
next.

Reply "we're in" with the number of entries you'd like to pledge, and I'll
set everything up from there.

Best regards,

Q

---

## Notes for sending

- Send individually (not bulk) — this list is short and high-value; one
  personal line about a specific event dramatically lifts response rates.
- For orgs whose data is already live, the "your events are already there"
  variant beats any pitch — lead with their real page.
- The first-touch CTA stays near-zero friction: reply-with-a-file or the
  claim link. The pledge is a tease in letter 1 and an ask only in letter 2.
- Track pledges: for now record them in the org_invites notes / a scratch
  doc; build a `partner_pledges` table when the Surprise Rewards feature
  starts (ideas.md §6 technical sketch already covers prize pools).
- Never write "lottery"/"sweepstakes"; award editorially (merit) until the
  legal review clears a chance-based mechanic.
