# Demo profile: `demo-dib-small` — "Ridgeline Fabrication" (fictional)

> GP-STACKSIM-1 M4 (2026-07-25). **APPROVED — founder sign-off 2026-07-25.**
> This is the standard demo profile. The sign-off carried one rider: built
> for easy change — see "Changing the demo" below.
> Editable config: `scenarios/demo-dib-small.config.json` (source of truth)
> Generated scenario: `scenarios/demo-dib-small.json` · Test: `tests/integration/demo-profile.test.ts`

## Commands

| Action | Command |
|--------|---------|
| Seed + serve (one shot) | `npm run demo` |
| Reset to pristine demo state | `npm run demo:reset` (re-running the scenario IS the reset — deterministic wipe + rebuild; regenerates from config first) |
| Regenerate scenario from config | `npm run demo:build` |
| Serve after a reset | `node bin/stacksim.mjs serve m365_azure --slug demo-dib-small` (port 4390; inspector at `/`) |

## Changing the demo

**Edit `scenarios/demo-dib-small.config.json` — never the generated scenario.**
Then `npm run demo:build` (or just `npm run demo:reset`, which regenerates
first) and commit BOTH files. A drift-guard test fails the suite if they
disagree.

What the config controls:
- **Staff roster** (`staff`): name/title/department per person — UPNs derive
  from names (`Dana Okafor` → `dana.okafor@<domain>`); add an `upn` field to
  override. Add or remove people freely; user count follows the list.
- **Company + domain** (`company`, `domain`, `description`).
- **Groups / devices**: display names and descriptions. `group-1` keeps its
  seeded `CUI-Authorized-Users` name (`keepSeededName`) — EO reads it by
  that exact name; don't rename it.
- **Gap toggles** (`gaps`): `mfaReportOnly` (the headline — flips the CA
  policy state AND the expectedFacts ground truth), `kioskUnencrypted`
  (device marked `kiosk: true` goes red), `sharedLogin` (the shared kiosk
  account exists or not). Turn a gap off to demo a healthier tenant.

## The company (all fictional)

**Ridgeline Fabrication** — a 13-seat precision machine shop and DoD
subcontractor. AS9100 quality program, CNC and manual machining, receives CUI
in RFQ packages and drawing files. IT is a one-person MSP contract. This is
the archetypal CMMC L2 prospect: real contracts, real CUI, no security staff.

**Staff:** Dana Okafor (Owner) · Marcus Bell (Programs/FSO) · Priya Raman
(Quality) · Tom Kowalski (Shop Supervisor) · Aiko Tanaka (Design Engineer) ·
Luis Herrera, Sam Whitaker, Jenny Tran (CNC) · Bill Mercer (Manual/Weld) ·
Carol Jenkins (Office) · Frank Osei (Estimating) · Ray Dominguez (MSP IT) ·
plus a **shared "Shop Floor" kiosk login** (deliberate — see gaps).

**Groups:** CUI-Authorized-Users (the seeded well-known CUI group — EO reads
it by this exact name) · Shop Floor · Ridgeline All Staff.
**Devices:** RIDGE-ENG-01 (CAD), RIDGE-QC-01, RIDGE-FRONT-01, RIDGE-SHOP-KIOSK.

## The gaps (what the demo finds)

1. **MFA stuck in report-only (the headline).** The MSP created "Require MFA —
   all users" six months ago in `enabledForReportingButNotEnforced` and never
   flipped it. Muster's harvest reads **iam-001 = no, iam-004 = no** — and the
   demo moment writes itself: *"the policy exists; a checkbox audit would call
   this done — the tool reads the actual state."* Stamper's stamp then closes
   it live, and a re-harvest flips the answer to yes.
2. **Unencrypted, non-compliant shared kiosk.** RIDGE-SHOP-KIOSK is enrolled in
   MDM (so ep-001/ep-002 stay honest "yes") but `complianceState:
   noncompliant`, `isEncrypted: false` — red in any managed-device read.
3. **Shared login account.** `shop@ridgelinefab...` ("Shop Floor (shared)") is
   visible in every user listing — the IA.L2-3.5.1/3.5.2 individual-
   identification conversation.
4. **Admin hygiene (narrative).** Ray's daily-driver account holds Global
   Admin; no separate privileged account (iam-003 interview answer: no).
5. **The ambient EO gap set.** The default m365_azure posture already yields a
   realistic met/not-met split in EO's live assessment (~37 met / ~36 not_met
   in the G-EO-STAB-1 M4 smoke) and a negative SPRS trajectory — the
   engagement looks like a real first assessment, not a rigged demo.

## Demo arc (Muster → Stamper → EO)

1. **Muster discovery/harvest** against the live sim: realistic staff and
   devices come back; iam-001/iam-004 draft to "no" with the report-only
   evidence attached.
2. **Stamper** stamps the MFA baseline (real registry command, real PATCH
   through the sim resolver, ledger-recorded) — the exact command that would
   run against a real GCC High tenant.
3. **EO** assesses live: the CA-policy signal now reads enforced; the kiosk
   and the ambient not_mets remain as the "here's your roadmap" close.
4. `npm run demo:reset` between prospects — identical state every time
   (regression-tested, timestamps aside).

## Fidelity note

The realistic state is built **through the real resolver path** (21 PATCH
mutations, ledger-recorded), not fabricated seed objects. Three item-level
PATCH surfaces (`/v1.0/users/{id}`, `/v1.0/groups/{id}`,
`/v1.0/deviceManagement/managedDevices/{id}`) were added to the manual
resolver entries — real Graph accepts these calls, so the sim now does too
(sim-transparency contract; they were GET-only before).

## Resolved at sign-off (2026-07-25)

The founder approved the story as presented: report-only MFA stays the
headline, no fault-injection encore (demos run smooth), "Ridgeline
Fabrication" stands. All three are now config-changeable anyway (gap
toggles, `company`/`staff` fields) — see "Changing the demo."
