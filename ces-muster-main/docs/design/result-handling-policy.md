# Result-handling policy — delivered readiness results and reports

**Date:** 2026-07-25 · **Goal:** GP-MUSTER-2 M1 (the portal, M2, implements this).
**Ruled inputs (founder HIL, 2026-07-25):** retention **90 days then purge**;
hosting locus **enclave-adjacent**; independent-mode self-serve SPA **yes, with
the M4 kit** (results still flow through the portal for the engagement record).

## What this covers

Every artifact a contractor receives from an engagement: the readiness-result.v1
file, the customer readiness report, and any capture files referenced by
`raw_capture_ref`. These are FCA-weight sensitive (they feed the SSP chain and
enumerate a defense contractor's gaps) and are handled as CUI-adjacent material
regardless of transport.

## The rules the portal implements

1. **Scope of access — per-engagement, nothing broader.** A delivery grant is
   scoped to ONE engagement's artifacts. There is no cross-engagement listing,
   search, or browse surface, for anyone, including BHD operators (operators use
   the operational store, not the portal). RLS enforces this at the row level.
2. **Who can pull.** Only holders of an unexpired delivery grant for that
   engagement: the engagement's named customer contact(s), issued by a BHD
   operator at delivery time. Grants are issued to named recipients, never
   shared links without a named grantee on record.
3. **Short-lived credentials.** Grant tokens expire (default 7 days per issue;
   re-issuable within the retention window). Expiry ends access, not existence —
   the artifact lives until retention purge.
4. **Download-only.** The portal serves bytes; it never renders an
   assessment-running surface, accepts no uploads (the M4 kit's upload lands on
   the operational import seam, not the portal), and mutates nothing.
5. **Audit on every touch.** Every pull, denied attempt, grant issue, and purge
   writes an audit entry: who, which engagement, which artifact, when, outcome.
   Audit entries outlive the artifacts they describe.
6. **Retention — 90 days from delivery, then purge.** Artifacts are purged 90
   days after their delivery date (per-artifact clock). Customers are told at
   delivery to pull and store their own copy. Purge removes artifact bytes and
   delivery grants; audit entries and the engagement's operational record (in
   the enclave store) are NOT purged by this policy.
7. **Secure destruction at close-out.** Engagement close-out may purge earlier
   than 90 days on customer request or contract terms; purge is recorded in the
   audit log with the reason. Destruction covers portal-side bytes and any
   staged copies.
8. **Encryption.** At rest: portal artifact storage is encrypted (disk- or
   volume-level at minimum in the enclave-adjacent deployment; per-artifact keys
   when the hosting substrate supports it). In transit: TLS only, no plaintext
   listener in any deployment.
9. **Hosting.** Enclave-adjacent (ruled): the portal runs on BHD-operated
   infrastructure alongside the enclave posture. No third-party replication of
   artifact bytes (no commercial CDN/object store) under this ruling; that
   trade re-opens only with the SaaS destination.
10. **No identity leakage.** Portal pages, filenames, headers, and notification
    text carry engagement/party identifiers only — no BHD-personnel personal
    identifiers, and (standing supreme rule) never the founder's.

## Independent-mode note (self-serve ruled YES)

A customer running the offline SPA + M4 kit themselves still receives their
DELIVERED result through the portal (rule 2), so the engagement record and audit
trail stay complete. Their local working copies are theirs; this policy governs
what BHD holds and serves.

## Ratification

Drafted under GP-MUSTER-2 M1 with all three HIL inputs ruled by the founder on
2026-07-25 (retention, hosting, self-serve). Policy is ACTIVE for M2
implementation; material changes re-open the HIL gate.
