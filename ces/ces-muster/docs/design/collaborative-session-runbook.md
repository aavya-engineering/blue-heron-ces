# Collaborative-BHD session runbook — from kickoff call to delivered result

**Date:** 2026-07-25 · **Goal:** GP-MUSTER-2 M3.
**Audience:** a BHD operator who did NOT build Muster. Follow it top to bottom;
every step names what you click/run and what you must verify before moving on.
**Companion docs:** `result-handling-policy.md` (what happens to the result),
`delivery-vehicle-brief.md` (why the flow looks like this).

## Before the call (day before)

1. **Engagement exists.** Confirm the engagement and assessed party are created
   (operator UI / API: `POST /api/engagements`, `POST /api/engagements/:id/parties`).
   You need the `engagement_id` and `party_id` on hand.
2. **Environment sanity.** On the operator workstation: Muster SPA loads;
   muster-api answers; if live discovery is planned AND FD-LIVE-SMOKE's hold is
   lifted, the discovery lane's tenant entry exists in the ces-tenant registry
   (`kind: 'live'`). Until that hold lifts, discovery runs are sim/fixture only
   — say so on the call, do not improvise a live run.
3. **Consent language ready.** The customer contact on the call must be someone
   who can consent to a read-only tenant session (their global admin or
   delegated-admin role for the reads involved).

## On the call

### 1. Frame it (2 minutes, say this in your own words)

> "We'll run a read-only discovery of your Microsoft environment — nothing is
> changed, everything is logged. You'll see every question we ask. At the end
> you get a readiness report and your SPRS score, delivered through our portal.
> Anything the tooling can't see, we'll ask you directly."

### 2. Situation tab — the manifest

Fill the Situation tab WITH the customer, before anything runs:
- **mode:** `collaborative-bhd`
- **auth tier:** `device-code` (this flow) — the tier is provenance; do not
  overstate it.
- **tenant:** their tenant slug; **kind** `live` (or `sim` in rehearsal).
- **operator:** YOUR name and role. **bhd_presence:** your name again — this is
  the collaborative marker.
- **engagement / party:** the ids from prep.

The export will refuse to build without this manifest — if the export button
errors about a missing manifest later, you skipped this step.

### 3. Device-code consent (the customer types, not you)

- Start the discovery session; the device-code prompt appears.
- The CUSTOMER navigates to the verification URL and enters the code from their
  own machine. You never touch their credentials, never ask for a password —
  if you find yourself about to, stop; that is the flow telling you it is
  broken.
- Confirm on-screen which roles/scopes the consent grants. If a read needs a
  role they do not have, the walk records "unavailable at this auth tier" for
  that command and moves on — that is BY DESIGN. Tell the customer which areas
  degraded; those become interview questions instead.

### 4. The walk (read-only, logged)

- Run discovery. It walks the registry get-commands read-only; manual-only
  entries are recorded as skipped, degraded commands as unavailable-at-tier.
- While it runs, tell the customer what they are seeing. Nothing is written to
  their tenant; the sim-proven zero-writes gate is the standing guarantee of
  the code path.

### 5. Adaptive interview

- Proceed to the interview tabs. Discovery evidence pre-fills and prunes;
  degraded/unknown areas ask as questions. Boundary questions are NEVER
  auto-answered: the customer confirms CUI boundary drafts themselves —
  a draft only counts once a named human confirms it (that is the attestation
  record; it will carry their name and the date).
- Do not answer for the customer. You may explain a question; the answer and
  the confirmation click are theirs.

### 6. Review the result together

- Open the readiness report: SPRS now, the gap list, SPRS-after **as a labeled
  projection** — read it with them. The FCA framing matters: unknowns count
  against, drafts never pass, and you must not promise the projection.

## After the call (same day)

### 7. Export

- Export the readiness result (readiness-result.v1 JSON) and the customer
  readiness report from the session. The export validates against the schema
  before it downloads — a validation error is a stop-and-investigate, not a
  retry-until-green.

### 8. Stage on the portal and issue the grant

Operator lane (JWT, `bhd_operator` role):

```
POST /api/delivery/artifacts   { engagement_id, kind: "readiness_result",
                                 filename, content_base64 }
POST /api/delivery/artifacts   { engagement_id, kind: "readiness_report", ... }
POST /api/delivery/grants      { engagement_id, grantee_name, grantee_email }
```

- The grant token comes back ONCE. Deliver it to the named grantee over the
  established channel for this engagement (the one you verified during
  kickoff), together with the portal URL and the expiry date (7 days default).
- Never post the token anywhere persistent or shared; if it lands somewhere it
  shouldn't, revoke immediately: `POST /api/delivery/grants/:id/revoke`.

### 9. Tell them the retention terms (policy rule 6 — say it explicitly)

> "Your results are available for 90 days, then we purge them. Download and
> store your copy. If you need them re-delivered inside the window, ask; after
> the window they're gone from our side."

### 10. Log and close

- Confirm the pull happened: `GET /api/delivery/audit?engagement_id=…` should
  show a `pull` entry for the readiness result. Chase the grantee if the grant
  is about to expire un-pulled (re-issue if needed).
- At engagement close-out (or on customer request):
  `POST /api/delivery/purge { engagement_id, reason }`.

## If things go wrong

| Symptom | What it means | Do |
|---|---|---|
| Device-code consent fails | Wrong account or insufficient role | Retry with the right account; NEVER work around with credentials |
| Whole walk degrades | Session/auth broke mid-run | Stop, re-consent, re-run; per-command degradation is normal, total degradation is not |
| Export refuses: manifest missing | Situation tab skipped | Fill it and re-export; do not hand-edit the JSON |
| Export refuses: schema invalid | Real bug or hand-edited payload | Stop-and-investigate; file it — never deliver an invalid payload |
| Grant token lost before delivery | Token is unrecoverable (hashed at rest) | Revoke that grant, issue a fresh one |
| Customer wants someone else to pull | Grants are named | Issue a second grant to the new named grantee; don't share tokens |
