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
   file) and NOTHING else — no partner-program tease (decided 2026-08-27: the
   pledge machinery — reward infra, legal review — isn't ready to receive
   commitments, a second ask cuts cold reply rates, and the proposal lands far
   better from a known collaborator than a stranger).
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

*(The code template in `utils/invites.js` `buildOrgInviteTemplate` mirrors
this letter and pre-fills the live event/award counts + claim link; the
superadmin edits before sending — always add one personal line about a
specific event of theirs.)*

Hi [Name or "Competition Director"],

I'm Sam, founder of **AwardHome** — the digital trophy case for competitive
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
3. **Your tour dates, where studios plan their season.** Our Upcoming
Events directory gathers every circuit's published dates in one place —
studios and parents browse it when deciding which competitions to attend,
sorted by distance from their studio, and they can shortlist your events
and export them straight into their family calendars, with your
registration one click away. You control your dates from your dashboard;
complete, current listings are what turn browsers into bookings.

Claiming your free organizer account takes about two minutes with your
private access link:

{CLAIM_LINK}

Or if you have a recent results file handy, just reply with it attached and
we'll build a live demo page for [Competition Name] — usually within a few
days. And if you'd rather talk first, I'm happy to do a quick 15-minute call.

However this lands, one thing is true either way: we'd welcome [Competition Name] as a partner, not just a name in our archive. And if anything on AwardHome could serve you better — how your events are presented, a feature you wish existed, anything at all — just tell us. We're building this for the people who actually run competitions, so your thoughts and needs genuinely shape what we build next.

Thank you for everything you do for the dance community.

Best regards,

Sam
Founder, AwardHome
https://awardhome.com
hello@awardhome.com

---

## Letter 2 — Season One Partner follow-up (send 3–10 days after claim/demo)

**Subject:** A Season One Partner slot for [Competition Name]

Hi [Name],

Glad to see [Competition Name]'s page live — [one personal line: their logo
on the cards / a stat from their demo page / a studio that just claimed].

I'd like to hold [Competition Name] one of our **Season One Partner** slots.
The whole arrangement, plainly:

**You pledge [3] free entries** (or convention passes) for the [2026-27]
season. That's the entire cost — no fees, now or later, for Season One
Partners.

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
use what we build for partners. The entry costs you an empty slot;
it returns a converted attendee.

**Season One Partners also get:** a "Season One Partner, 2026-27" mark on
your organization page (a fact of history — you were here first), first
access to the organizer features we ship this season (priority logo
concierge among the first), and a direct line on what we build next.

Reply "we're in" with the number of entries you'd like to pledge, and I'll
set everything up from there.

Best regards,

Sam

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


---

## Letter 3 — objection / takedown response (readiness playbook, added v4)

**Strategy (see also TODOS "org visibility"):** never argue the legal point in
email (results are facts and were published publicly — solid ground, but
winning that argument loses the partner). Ladder: (1) convert with the
concierge offer, (2) unlist gracefully with the family-first line, (3) full
hiding (phase 2 build) only if pressed, deletion only under legal compulsion
and after notifying claimed families. Superadmin control: /admin/orgs →
Visibility column (always record who/when in the note).

### 3a — first reply to an objection (goal: convert)

Subject: Re: [their subject]

Hi [Name],

Thanks for reaching out — and I want to start with what AwardHome is actually
for, because I suspect we're on the same side. We built the platform so that
the achievements dancers earn at events like [Competition Name] don't
disappear when a results page comes down — families keep a permanent, shareable
record, and the competitions that awarded them stay visible and credited.

Everything shown for [Competition Name] comes from your own published results,
presented with your name simply as the factual source — but how your brand
appears there should absolutely be in your control. That's what the free
organizer account is for: your logo (hand-fitted by our design team) on every
award card families share, authority to correct any record, and your
registration link in front of every family browsing results. Here's your page as it stands, and a private claim
link: [org page link] / [claim link].

If after seeing that you'd still prefer not to have a public presence on
AwardHome, I'll respect that — reply and I'll unlist [Competition Name]
within [3] business days (details below). But I'd love 15 minutes to show you
what your families already do with these pages before you decide.

[signature]

### 3b — unlisting confirmation (goal: graceful exit, door open)

Hi [Name],

Done — [Competition Name] is now unlisted on AwardHome: your organization
page is no longer publicly accessible and [Competition Name] no longer
appears in our public competition listings.

One thing we don't do is delete families' own records. Dancers and studios
who claimed their profiles keep access to the achievements they earned —
those belong to them, and removing them would punish your own customers for
a decision they didn't make. [Phase 2 wording, once built: "We have also
removed [Competition Name] results from public browsing entirely; they remain
visible only to the individual families and studios who claimed them."]

If you ever want the page back — with your branding on it, on your terms —
it's one email. The door stays open.

[signature]

**Never say:** "scrape", "we're legally allowed", "public data" as a retort,
anything about other organizers' arrangements. **Always:** family-first
framing, a concrete day count, the open door.

---

## v5 first-touch letter (reviewed + fact-checked 2026-08-27)

*(v5.1, 2026-08-29 — zero-events branch: when the invited org has no events in
the archive, the "already there" paragraph is replaced by a sample-page link:
"Want to see what it looks like in practice? KAR Dance Competition's page is
live here — their logo on every award card, champions wall, seasons of results
browsable: [beta-keyed /dance/org/kar]". Sample org = KAR (SAMPLE_ORG constant
in utils/invites.js buildOrgInviteTemplate): only org with an approved branding
coin, so the "your brand on every card" pitch is visible on the page itself;
swap the constant if a prouder partner page emerges. Terminology note: earlier
v4 line "org page demo link lands on the Rafters organizer edition" refers to
the RAFTERS DESIGN SYSTEM (site-wide default since 2026-08-24) — there is no
"Rafters" org. Orgs WITH archived events keep their own page as the demo link —
never the generic /dance homepage (dancer-facing, dilutes the claim CTA); the
organizer FAQ link with the flippable sample card is already in the letter.)*

*(v5: numbers refreshed to 1.5M awards / 4,200+ events / 27 competitions —
all verified against the live DB, incl. the YAGP/Starpower/KAR/NYCDA/Rainbow
name-drops; attendance-analytics item REMOVED from all letters (Q, 2026-08-27):
(a) mentioning attendance analytics primes the exact fear that blocks the core
ask — "results expose my client list to competitors" — and (b) we hold
award-WINNING studios, not attendance, so the claim overpromised. Analytics
stay unmentioned in outreach; if/when built, scope organizer-private and
introduce post-onboarding. Partner-program paragraph REMOVED from the first-touch letter
entirely (Q, 2026-08-27): the pledge is proposed only via Letter 2 after
demonstrated value, once reward infra + legal review are ready. Program naming
(for Letter 2, held in the drawer) REVISED to "Season One Partner"
(Q's call 2026-08-27, reversing the earlier keep): "Founding Partner" both
devalues when offered in a cold email (cheap-to-grant title reads as a low bar)
and issues un-scoped expectation debt ("founding" = permanent standing).
Season-scoped naming keeps the pledge mechanics, attaches privileges to a
defined period with renewal as the natural next conversation, and is
dance-native. Rejected: "Special Partner" (vague), "sister organizations"
(implies corporate affiliation). CAMPAIGN TIMING (confirmed 2026-08-27): invitations go out
ONE BY ONE (personalized), finishing ~Sept 8 — one week before the Sept 15
launch. Pre-launch /dance/* links carry ?beta=KEY automatically
(buildOrgInviteTemplate). After Sept 15, drop "when we launch" phrasing for
stragglers. PUBLIC-FACING NAME: all outreach signs "Sam" (confirmed; "Q" is
reserved for people who already know the founder — or Star Trek).
LAUNCH DATE CONFIRMED (Q, 2026-08-27): **September 15, 2026** — {LAUNCH_DATE}
resolves to "September 15"; consistent with features.md gold-button market
open Oct 15 (~1 month post-launch).)*

Hi {FIRST_NAME},

I'm Sam, founder of AwardHome — the award curation platform for competitive
dance. We aggregate results from events nationwide into beautiful, shareable
award pages for dancers and studios: today that's over 1.5 million awards from
4,200+ events across 27 competitions, including YAGP, Starpower, KAR, NYCDA,
and Rainbow.

We'd love to feature {ORG_NAME} alongside them when we launch on
September 15.

The offer, plainly: send us your results in whatever format you have — CSV,
Excel, PDFs, database exports, anything, one event or your entire history in a
single zip or Drive link — and we handle 100% of the processing. Zero technical
work on your end, free during our beta period.

What {ORG_NAME} gets:

1. **Your brand on every award card dancers share.** Organizers get a free
   branding dashboard — your logo and custom trophy icons, hand-fitted onto our
   patent-pending award cards by our design team — so your brand stays visible
   on social media long after the event ends.

2. **Permanent, searchable results.** Dancers and parents constantly search for
   old placements. We host them forever, interactively — no more fielding
   "where can I find 2023 results?" emails, and your events sit beside the
   biggest names in the industry for every studio browsing the platform.

3. **Your tour dates, where studios plan their season.** Our Upcoming Events
   directory gathers every circuit's published dates in one place — studios and
   parents browse it when deciding which competitions to attend, sorted by
   distance, and they can shortlist your events and export them straight into
   their family calendars, with your registration one click away. You control
   your dates from your dashboard; complete, current listings are what turn
   browsing into bookings. See it live: {UPCOMING_LINK} *(template fills a
   beta-keyed URL pre-launch — the key drops automatically at launch; URL kept
   at line end so mail clients don't linkify trailing punctuation)*

Curious how it all works? Our organizer FAQ covers the common questions — data
formats, branding, what it costs — and includes a sample award card you can
actually flip: https://awardhome.com/faq/organizer

Claiming your free organizer account takes about two minutes with your private
access link — and your dashboard walks you through the whole setup in three
steps (upload results, add your profile, send us your logo):

{CLAIM_LINK}

Or if you have a recent results file or links handy, just reply with it
attached — or with a Google Drive or Dropbox link — and we'll build a live demo
page for {ORG_NAME}, usually within a few days.

However this lands, one thing is true either way: we'd welcome {ORG_NAME} as a
partner, not just a name in our archive. And if anything on AwardHome could
serve you better — how your events are presented, a feature you wish existed,
anything at all — just tell us. We're building this for the people who actually
run competitions and for the dancers preserving those memories, so your
thoughts and needs genuinely shape what we build next.

Thank you for everything you do for the dance community.

Best regards,

Sam
Founder, AwardHome
https://awardhome.com
hello@awardhome.com
