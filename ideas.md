# Product Ideas & Monetization Workflows

## 1. AI-Powered Studio Marketing Summaries
**Concept:** Instead of just providing a raw list of historical awards, the platform uses AI (OpenAI/LLMs) to transform a studio's historical data into highly inspiring, concise, and professional marketing copy. This copy is optimized for social media (Instagram, Facebook), newsletters, and press releases.

**Value Proposition:** Studio owners spend hours trying to write compelling marketing copy that highlights their students' achievements without sounding overly boastful or reciting a boring spreadsheet. This feature instantly generates "brag sheets" and engaging stories based on their verified data.

**Monetization Strategy:**
- **Freemium Hook:** Offer one "Free AI Marketing Summary" per year as an incentive for a studio owner to *claim* their studio profile and verify/improve their award data. This drives user acquisition and data integrity.
- **Premium Feature:** Unlimited AI summaries, customizable tones (e.g., "Professional Press Release", "Enthusiastic Instagram Post"), and cross-organization summaries are locked behind a SaaS subscription tier for paying customers.

**Technical Execution:**
1. The user selects a subset of their awards via the History Checklist UI.
2. The selected data is sent to an OpenAI backend endpoint.
3. A strict system prompt commands the AI to synthesize the raw awards into an inspiring narrative, highlighting major podium placements and ensemble victories.

## 2. Multi-Page "Flip-Book" Award Card (brainstormed 2026-08-12)
**Concept:** Extend the two-face flip card (trophy front / certificate back) into a paged mini-book on the back: certificate → dancer photo → acknowledgements → organizer colophon. Tap flips the card; swiping (or dot/edge-tap) pages through the back-stack. Pages with no content simply don't exist — the guaranteed faces (front + certificate) never depend on user uploads.

**Key elements:**
- **Photo page:** upload by studio owner or dancer owner; approval/consent-gated (minors) and default-off, mirroring the logo-coin concierge pattern. When present, also inset a small portrait medallion on the certificate page.
- **Acknowledgements page:** "With thanks to…" (teachers, teammates, parents). This is the viral page — a dancer thanking Mom and a named teacher is exactly what parents and studios re-share. For **group routines each dancer gets their own ack line** (stored per `award_dancers` row), rendered like a signed yearbook page with the viewing dancer's line pinned first. Owner-moderated before public display.
- **Organizer colophon (last page):** big logo, event name, optional organizer message/sponsor credit — the natural home for trophy_plan.md's premium sponsor tagging, sold as part of the organizer tier.
- Each page independently shareable as an image (share button per page).

**Monetization ties:** photo + ack pages drive dancer/parent engagement and claims; colophon page is an organizer-tier upsell; sponsor line fits Tier 2/3 of the Digital Trophy plan.

Patent-candidate details tracked in `maybe_patentable.md` (A3, A4).

**Status:** SHIPPED 2026-08-12 as the "flipbook" design behind the A/B card-design switch (see features.md §3b).

## 3. Auto-Generated Social Video Shorts from Card Faces (brainstormed 2026-08-12)
**Concept:** Automatically generate a short vertical video (Instagram Reels / TikTok / YouTube Shorts format) from a flip-book award card: the card flips face to face — award front → certificate → dancer photo → thank-you notes → organizer colophon — with flip/page-turn animations and appropriate audio (whoosh/chime per flip, optional music bed, possibly TTS reading the placement or the thank-you line).

**Why the flip-book structure matters:** each card face is already a complete, approval-gated composition. The video generator is then just a deterministic sequencer over existing faces — no per-video design work, and everything shown has already passed moderation.

**Value Proposition:** dancers/parents get a share-ready highlight clip in one tap ("Share as video"); studios get recap reels ("Our weekend at Nationals" — a montage across dancers' cards); organizers get branded reach (their colophon closes every clip — extends "your brand on every card" to "your brand closing every video").

**Monetization:** free watermark-light clips for dancers (growth loop); studio-level montages and organizer-branded end-cards as premium; per-event recap videos as an organizer-tier deliverable.

**Technical sketch:** server-side render of card faces to frames (headless Chromium screenshotting the existing EJS/CSS at fixed size), ffmpeg to compose flips/transitions + audio; or client-side via canvas/WebCodecs for instant no-server sharing. Prerequisite: per-page share-image rendering (see TODOS).

Patent-candidate details tracked in `maybe_patentable.md` (A6).

## 4. Superadmin Dynamic AI Model Switcher
**Concept:** A centralized "System Settings" dashboard for Superadmins that allows dynamic, zero-downtime switching of the underlying LLM model (e.g., from `gpt-4o-mini` to `gpt-4o` or `gpt-3.5-turbo`) used across the platform.

**Value Proposition:** AI costs and capabilities fluctuate rapidly. By exposing the model selection to the Superadmin interface instead of hardcoding it in the codebase or requiring a `.env` server restart, the platform operator can instantly optimize for cost during high-traffic periods, or switch to a higher-intelligence model for premium users or special use cases without any technical friction.
