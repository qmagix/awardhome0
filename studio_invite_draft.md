# Draft: Studio Owner Outreach Letter (v3, 2026-08-20)

*(This letter is fully templated in code — `utils/invites.js`
`buildStudioInvite` — and sent per-row from `/admin/marketing/studios` with
real counts, first-places, leaderboard rank, and the beta magic link. This
doc is the reference copy; keep the two in sync.)*

**Subject** (mail-merged — proving we already know them is the strongest
personalization we have; no "!", no "free"):
- [Studio Name]: [N] awards, all in one place

**Psychology at work:** the letter leads with *their* accomplishment (the
award count is the subject line), shows rather than tells (the profile link
IS the pitch), and uses two honest scarcity/loss levers: duplicate profiles
may be splitting their rank today (loss aversion — claiming fixes it), and
rank 101–300 studios are shown the top-100 homepage threshold (attainable
status). Featured Studios eligibility is the commitment device on the studio
side: it rewards claiming + completing the profile, no payment — policy is
public in the FAQ.

---

Hi [Studio Name] team,

*(Beta sends only:)* **You're invited to our private beta.** The link below
is your early-access pass — AwardHome opens to the public soon, and beta
studios get a head start.

Congratulations on a great season. Your competition results are already live
on **AwardHome** — we aggregate results from 14 competitions (YAGP, KAR,
Starpower, NYCDA, Showstopper, Rainbow, and more) into a single digital
trophy case: over 900,000 awards from 17,000+ studios since 2022.

[Studio Name]'s page — with **[N] awards** and **[N] first-place
finishes** — is here:

**[ View Your Studio's Trophy Case ]** *(gold button → profile with beta
magic link)*

*(Rank ≤ 100:)* [Studio Name] currently ranks **#[rank]** on our all-time
leaderboard — already featured on the AwardHome homepage.
*(Rank 101–300:)* [Studio Name] currently ranks **#[rank]** on our all-time
leaderboard. The top 100 appear on our homepage — if some of your results
are missing from our records, adding them after you claim could move you up
the list.

Claiming your page takes about two minutes and costs nothing. It unlocks:

1. **Make it complete and correct.** Competitions spell studio names
   differently — duplicate profiles may be splitting your award count and
   leaderboard rank right now. Merge them, fix dancer-name typos, and add
   awards from events that never published results online.
2. **Give every dancer their own trophy case.** Invite your dance families
   to claim verified dancer profiles — a permanent, shareable record of
   their placements and scholarships that parents love.
3. **Put it on your own website.** Claimed studios get an embeddable awards
   widget, in your colors — your verified, multi-competition track record,
   live on your site for prospective parents. You control which stats are
   public.

Our homepage **Featured Studios** section is selected automatically from
claimed studios with complete profiles — no payment, no favoritism. Claim
early and you're eligible from day one.

Click **"Claim Studio"** on your page above. If your email matches your
studio's website domain, approval is instant.

— Q
Founder, AwardHome
https://awardhome.com

*(footer: one-time-note explanation + one-click unsubscribe — appended
automatically, RFC 8058 compliant)*

---

## Notes for sending

- Send from hello@awardhome.com (DKIM verified). Plain formatting, minimal
  links — cold email with many links goes to spam. Young-domain filtering
  bit us once (2026-08-08); watch the first sends of any batch.
- Resend free tier is 100/day — pace batches. Start with rank 101–300
  (the "bump into the top 100" incentive), pilot 10–20 first.
- The profile link is the whole pitch. Spot-check each studio's page before
  sending — garbled/duplicate names undermine the rank claim in the email
  (bulk cleanups done 08-09/08-10; 553 flagged suspects remain unmerged).
- Once ≥25 studios have claimed, add a social-proof line ("join the N
  studios already managing their trophy case") — update the code template
  when the number is real.
