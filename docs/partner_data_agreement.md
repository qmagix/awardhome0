# AwardHome Partner Data Access Agreement

> **DRAFT — template for attorney review. Not legal advice.** Have a lawyer
> review this (especially §8 FCRA, §12 liability, and §13 governing law)
> before the first partner signs. Bracketed [FIELDS] are filled per partner.
> Once signed, reference this agreement (date + storage location) in the
> "Data agreement reference" field when issuing the key at
> `/admin/partner-keys` — the form will not issue a key without it.

---

**Effective date:** [DATE]

**Between:** AwardHome ("**AwardHome**", "we") and [PARTNER LEGAL NAME], a
[ENTITY TYPE] with its principal place of business at [ADDRESS]
("**Partner**", "you").

## 1. Background

AwardHome maintains an archive of competitive dance results aggregated from
publicly published competition sources. Partner wishes to verify the
competition history of specific individuals who have a direct relationship
with Partner (e.g., applicants or enrolled students). AwardHome provides
keyed API access for that purpose, on the terms below. Because the records
concern primarily minors, the terms are deliberately narrow.

## 2. Definitions

- **Partner API** — the interface at `/api/v1/partner`, as documented at
  `/api/v1/partner/openapi.json`.
- **Dancer Record** — the award history returned for one dancer by the
  detail endpoint (`GET /dancers/{uniqueId}/awards`).
- **Lookup** — any request to the Partner API.
- **Subject** — the individual a Lookup concerns (and, where the Subject is
  a minor, their parent or legal guardian).
- **Suppression Notice** — a notice from AwardHome that a previously
  retrieved Dancer Record must be deleted (typically following a family
  safety request).

## 3. Access and credentials

1. AwardHome will issue Partner one API key. The key is confidential,
   must be stored server-side only, and must never appear in client-side
   code, mobile apps, repositories, or logs.
2. Partner will notify AwardHome within 24 hours of any suspected key
   compromise. AwardHome may revoke and reissue keys at any time.
3. Access is subject to rate limits and a daily lookup quota of
   [QUOTA, default 200] Lookups, adjustable by written agreement.

## 4. Permitted purpose

Partner may use the Partner API **solely** to verify the competition
history of Subjects who:

1. have applied to, enrolled with, or are otherwise in a direct,
   pre-existing relationship with Partner; **and**
2. have been informed by Partner that their competition history may be
   verified, with consent obtained from the Subject where such consent is
   required by applicable law.

Partner represents, for every Lookup, that these conditions hold.

## 5. Prohibited uses

Partner must not:

1. query individuals who have no direct relationship with Partner;
2. perform bulk extraction, systematic enumeration, or otherwise attempt
   to assemble a database or dataset from the Partner API;
3. sell, license, publish, redistribute, or disclose Dancer Records or any
   data derived from them to any third party, except to the Subject
   themselves or as required by law;
4. use the data for marketing, advertising, lead generation, or contacting
   families who have not applied to Partner;
5. combine Dancer Records with other data sources to profile, track, or
   re-identify any individual beyond the verification purpose in §4;
6. attempt to circumvent rate limits, quotas, visibility rules, or to
   access records the API declines to return;
7. use the data in any manner directed against the interests or safety of
   a Subject.

## 6. Data handling and retention

1. Partner may retain a raw Dancer Record for up to **90 days** from
   retrieval, solely to complete the verification in progress.
2. After verification, Partner may retain the **outcome** (e.g., "awards
   verified on [date]") in the Subject's file indefinitely, but must delete
   the raw Dancer Record.
3. Partner will protect retrieved data with security measures no less
   protective than those it applies to its own student records (and, where
   applicable, as required by FERPA or equivalent law).
4. Partner will notify AwardHome within 72 hours of any breach involving
   Dancer Records.

## 7. Suppression and deletion propagation

AwardHome removes dancers from public availability on family safety
requests. Where a previously retrieved Dancer Record is affected, AwardHome
will send Partner a Suppression Notice identifying the record. Partner will
delete all copies of the raw Dancer Record within **5 business days** of the
notice and confirm deletion in writing. Verification outcomes already
recorded under §6.2 may be retained but must not be re-associated with the
suppressed record.

## 8. Nature of the data; no consumer reporting

1. Dancer Records are aggregated from publicly published competition
   results and family submissions, provided **as is**, without warranty of
   accuracy or completeness. Each award carries a `verification_status`
   field; Partner is responsible for weighing provenance.
2. AwardHome is **not a consumer reporting agency** under the U.S. Fair
   Credit Reporting Act (FCRA), and the Partner API does not provide
   "consumer reports." Partner must not use Dancer Records to determine
   eligibility for credit, insurance, employment, housing, or for any other
   purpose that would subject the data to the FCRA.
3. Partner remains solely responsible for its admission or other decisions.
   An absent or incomplete record is not evidence that a Subject's claimed
   history is false.

## 9. Fees

1. **Prepaid blocks:** access is sold in prepaid blocks of **100 Dancer
   Records for USD $10** ($0.10 per record). Blocks are purchased in
   advance; Partner's first block is [included in / purchased at] signing.
2. **What consumes a credit:** each **unique Dancer Record retrieved per
   calendar month** consumes one credit. Repeated retrievals of the same
   dancer's record within the same calendar month do not consume another.
   Disambiguation searches (`GET /dancers`) are free and consume nothing.
3. **Rollover and expiry:** unused credits roll over and expire
   [12 months] after purchase. Credits are non-refundable except where
   AwardHome terminates without cause, in which case unused credits are
   refunded pro rata.
4. Consumption is computed from AwardHome's query log (§10). When credits
   are exhausted, detail lookups are declined until a further block is
   purchased; searches keep working.
5. AwardHome may revise block pricing with 30 days' written notice; blocks
   already purchased are honored at their purchase price.

## 10. Audit

AwardHome logs every Lookup — the key used, the query, and the dancer
identifiers returned — in an append-only audit log. This log is the basis
for invoicing, abuse detection, and responses to Subjects who ask who has
accessed their records. Partner will cooperate reasonably with AwardHome
inquiries into anomalous usage.

## 11. Term, termination, and suspension

1. This agreement runs from the Effective Date until terminated by either
   party on 30 days' written notice.
2. AwardHome may suspend or revoke access immediately on any breach of §4,
   §5, or §7, or where suspension is reasonably necessary to protect a
   Subject.
3. On termination: Partner's key is revoked; §6 (retention), §7
   (suppression), §8, §12, and accrued fee obligations survive.

## 12. Warranties, liability, indemnity

1. THE PARTNER API AND ALL DATA ARE PROVIDED "AS IS" WITHOUT WARRANTIES OF
   ANY KIND. AWARDHOME DISCLAIMS ALL IMPLIED WARRANTIES, INCLUDING
   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
2. NEITHER PARTY IS LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, OR
   CONSEQUENTIAL DAMAGES. AWARDHOME'S TOTAL LIABILITY UNDER THIS AGREEMENT
   IS CAPPED AT THE FEES PAID BY PARTNER IN THE 12 MONTHS PRECEDING THE
   CLAIM.
3. Partner will indemnify AwardHome against third-party claims arising
   from Partner's use of the data in breach of this agreement.

## 13. General

1. **Governing law / venue:** [STATE], [COUNTY/COURT].
2. **Assignment:** neither party may assign without the other's written
   consent, except to a successor in a merger or asset sale.
3. **Entire agreement:** this document is the entire agreement on its
   subject and supersedes prior discussions. Amendments must be in writing.
4. **Notices:** to AwardHome at [EMAIL]; to Partner at the contact email on
   file for the API key.

---

**AwardHome**  — Signature: ______________  Name/Title: ______________  Date: ______

**[PARTNER LEGAL NAME]** — Signature: ______________  Name/Title: ______________  Date: ______
