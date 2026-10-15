# End-User Use Cases — Day-to-Day Operations Inside a CES-Hardened GCC High Tenant

**Date:** 2026-07-03 · **Grounding:** `ces-ao/src/registry/ao-commands.registry.json` (85 commands),
`ces-shared/src/data/control-signal-registry.json` (110 controls / 91 Graph evaluators),
`ces-stamper/src/registry/cmmc-l2-commands.registry.json` · **Live reference tenant:** `vfsgov`
(Valor Forge, LLC — `vfsgov.onmicrosoft.us`, GCC High)

**Purpose.** This document describes what the client organization's people actually *do* inside
their hardened tenant on a normal working day, and where the CMMC 2.0 Level 2 controls that CES
stamped into the tenant intersect their work. Every use case is written to be **testable**: it
names the observable enforcement behavior and the probe that can verify it automatically. This is
the source catalog for the G-EUT-1 automated test cases (`docs/G-EUT-1-plan.md`).

---

## 1. The personas (most common roles/actors in a small-to-mid DIB contractor)

| ID | Persona | Population | CUI access | Day-to-day surface |
|---|---|---|---|---|
| P1 | **CUI Engineer** (design/manufacturing engineer, technician) | The core workforce | ✅ full | SharePoint CUI libraries (drawings, specs), Outlook to primes, Teams, Office desktop, corporate laptop |
| P2 | **Program Manager / Contracts** | Small | ✅ full | Same as P1 + heavy external collaboration: primes, subs, DCMA; meeting invites, controlled document exchange |
| P3 | **Business staff** (finance, HR, front office) | Small-mid | ❌ none | Email, calendars, non-CUI SharePoint, payroll/ERP SaaS; must be *unable* to touch CUI |
| P4 | **New hire** (any of P1–P3, first week) | Transient | pending | Onboarding: first login, MFA enrollment, device pickup/enrollment, security training |
| P5 | **Departing employee** | Transient | revoked | Offboarding target: account disable, session revoke, device wipe, mailbox hold |
| P6 | **Client IT admin / owner-operator** | 1–2 people | ✅ + privileged | Day-2 administration via AdminOps; PIM elevation for admin tasks; the guardrailed control plane |
| P7 | **External partner / guest** (prime's engineer, auditor) | External | ❌ (or scoped) | Receives shares/invites from P1/P2; joins Teams meetings; the tenant must constrain them |
| P8 | **Remote / traveling worker** (P1 or P2 off-site) | Recurring | ✅ | Same work from hotel/home/abroad: conditional access geography, device compliance, personal-device attempts |

---

## 2. A day in the tenant — high-probability activities and where controls bite

The activities below are ordered roughly by frequency (multiple times daily → episodic). Each has
a use-case ID, the personas involved, the enforcement the user can *observe*, and the CMMC
practice(s) behind it (from the CES registries).

### Tier A — many times a day, everyone

**UC-01 · Sign in to M365** (P1–P3, P6, P8)
Open laptop → Entra sign-in → MFA challenge (phishing-resistant method; SMS/voice not offered).
*Observable:* MFA prompt on every eligible sign-in; weak methods absent from the picker.
*Controls:* IA.L2-3.5.1 (A-07 CA requires MFA), IA.L2-3.5.3 (A-06/A-08 auth-methods policy).

**UC-02 · Work in a CUI SharePoint library** (P1, P2)
Open drawings/specs from the CUI site; documents carry the CUI sensitivity label; access works only
because the user is in the CUI-authorized group on a compliant device.
*Observable:* label badge on documents/sites; access granted seamlessly (the control is invisible when satisfied).
*Controls:* AC.L2-3.1.1 (A-01 CUI group + CA targeting), MP.L2-3.8.1 (D-09 label publishing), AC.L2-3.1.18 (B-07 compliant-device CA).

**UC-03 · Email a prime contractor** (P1, P2)
Compose to `@prime.com` with a controlled attachment; the message flows via IRM/OME transport
rules; mislabeling or over-sharing triggers DLP.
*Observable:* encryption/label banners; DLP policy tip or hard block on labeled content to unauthorized recipients.
*Controls:* SC.L2-3.13.8 (C-05 transport rules), AC.L2-3.1.3 (A-09/G-08 DLP + barriers).

**UC-04 · Teams collaboration** (P1–P3)
Chat, calls, channel files (files inherit SharePoint controls); meetings with externals possible
but guests are constrained (lobby, no CUI channel access).
*Observable:* guests wait in lobby; guest cannot open CUI-labeled channel files.
*Controls:* AC.L2-3.1.20 (D-04 external sharing), AC.L2-3.1.3.

### Tier B — daily/weekly, role-dependent

**UC-05 · Share a document externally** (P2, occasionally P1)
Attempt to share a CUI-site document to an external address. Tenant policy allows only existing
external users (no open/anyone links); CUI sites block guest sharing outright.
*Observable:* "Your organization's policies don't allow you to share with these users" on new
external addresses; no "Anyone with the link" option exists.
*Controls:* AC.L2-3.1.20 (D-04 SharePoint external sharing = ExistingExternalUserSharingOnly).

**UC-06 · Business staff tries a CUI resource (boundary case)** (P3)
Finance clicks a CUI-site link from a misc email/search. Not in the CUI group → access denied.
*Observable:* "You need permission" / access-denied page; no CUI content reachable.
*Controls:* AC.L2-3.1.1, AC.L2-3.1.3.

**UC-07 · Work from home / travel** (P8)
Sign-in from a new network/geography. Trusted named locations + geo rules evaluate; compliant
corporate device required; risky/foreign sign-ins blocked.
*Observable:* works from home on the corporate laptop; blocked from disallowed geographies or
untrusted contexts.
*Controls:* AC.L2-3.1.12 (A-14 named locations), AC.L2-3.1.18 (B-07).

**UC-08 · Personal device attempt (BYOD boundary)** (P1–P3, P8)
Try Outlook/Teams/OWA from a personal phone or home PC. Device is not Intune-compliant → blocked
(or app-protection-contained where policy allows).
*Observable:* "Your sign-in was successful but you don't meet the criteria to access this
resource" (CA block page) or enrollment interstitial.
*Controls:* AC.L2-3.1.18 (B-07), CM.L2-3.4.1 (B-01/B-12 enrollment + compliance).

**UC-09 · Install / run software on the corporate laptop** (P1, P3)
Download a random utility → blocked by app control; catalog apps install fine from Company Portal.
*Observable:* WDAC/Smart App Control block dialog; Defender web filter blocks risky download sites.
*Controls:* CM.L2-3.4.7 (B-08 WDAC/app control).

**UC-10 · Change / reset a password** (P1–P3)
Self-service or forced reset. 14+ char minimum, banned-password list, smart lockout on brute force.
*Observable:* short/banned password rejected with policy message.
*Controls:* IA.L2-3.5.7 (C-09 password policy).

### Tier C — episodic lifecycle events

**UC-11 · New-hire onboarding** (P4, executed by P6)
Account created → first sign-in forces MFA registration (strong methods only) → corporate device
enrolls via Autopilot (BitLocker enforced) → **training gate: CUI/network access withheld until
security training completes**.
*Observable:* the sequence itself: MFA registration wizard, Autopilot provisioning, access denied
to CUI resources until the training CA grant clears.
*Controls:* IA.L2-3.5.1/3.5.3, CM.L2-3.4.1 (B-01 Autopilot + BitLocker XTS-AES-256), AT.L2-3.2.2 (G-02 training-gated CA).

**UC-12 · Offboarding / termination** (P5, executed by P6)
Disable account, revoke sessions, wipe or retire device, hold mailbox.
*Observable (from the org's side):* the departed user's credentials stop working everywhere within
minutes; device is wiped/deregistered.
*Controls:* AC.L2-3.1.2 (A-02/A-11 lifecycle), MP.L2-3.8.3 (B-05/B-06 wipe).

**UC-13 · Lost/stolen device** (P1/P8 reports, P6 executes)
Report loss → remote wipe issued → BitLocker already protects data at rest.
*Observable:* device wiped remotely; encryption was always-on beforehand.
*Controls:* MP.L2-3.8.3, CM.L2-3.4.1.

**UC-14 · Admin performs privileged work** (P6)
Day-2 admin needs Global Admin/Exchange Admin rights → PIM elevation (JIT, approval for Tier-3),
break-glass account stays excluded and monitored; destructive AdminOps commands need two-person
approval.
*Observable:* role activation flow with justification/approval; standing admin rights absent.
*Controls:* AC.L2-3.1.4 (PIM approval), AC.L2-3.1.5 (A-10 JIT), AC.L2-3.1.7 (A-15 break-glass).

**UC-15 · External guest experience** (P7)
Guest invited by P2 to a project Teams/non-CUI site: joins via lobby, sees only what's scoped;
attempts on CUI content fail.
*Observable:* guest reaches invited resources only; CUI-labeled content inaccessible.
*Controls:* AC.L2-3.1.20, AC.L2-3.1.3.

### Tier D — invisible to users but running all day (verified for completeness)

**UC-16 · Everything is audited** — sign-ins, file operations, admin actions land in audit logs
with 90+ day retention (WORM storage, Sentinel ingestion). *Controls:* AU.L2-3.3.1 (E-01).
**UC-17 · Patch + baseline drift** — devices patch on schedule; baseline drift detected/remediated.
*Controls:* SI.L2-3.14.1 (B-03), CM.L2-3.4.2 (B-04).
**UC-18 · Incident pipeline live** — risky sign-ins/alerts create Sentinel incidents for triage.
*Controls:* IR.L2-3.6.1 (D-03/H-01/H-02).

---

## 3. Use case → control → probe matrix (the automation contract)

Probe tiers (how G-EUT-1 verifies each without breaking anything):
- **T1 policy-state** — read-only Graph query proving the enforcing policy exists, is enabled, and
  is scoped correctly (e.g., the CA policy requiring MFA targets all users, state=enabled).
- **T2 behavioral-evidence** — read-only audit/sign-in log query proving the control *fired in
  practice* (e.g., interactive sign-ins show `authenticationRequirement=multiFactorAuthentication`;
  CA blocks recorded for noncompliant devices).
- **T3 interactive-simulation** — a real or synthetic test user walks the path (blocked share,
  password rejection). Requires dedicated test personas; **designed but gated off** until test
  accounts are provisioned.

| UC | Practices | T1 probe (policy state) | T2 probe (behavioral evidence) | T3 |
|---|---|---|---|---|
| UC-01 | IA.L2-3.5.1, 3.5.3 | CA policy grants=MFA, state=enabled, scope=all users; authMethods: SMS/voice disabled | signInLogs: interactive sign-ins satisfied MFA; no legacy-auth successes | login attempt w/o MFA |
| UC-02 | AC.L2-3.1.1, MP.L2-3.8.1, AC.L2-3.1.18 | CUI group exists+populated; CUI label published; CA device-compliance policy on | auditLogs: CUI-site access only by group members | non-member access attempt |
| UC-03 | SC.L2-3.13.8, AC.L2-3.1.3 | transport rules present (IRM/OME); DLP policies enabled for CUI label | message trace: encrypted sends; DLP match events | send labeled doc to gmail |
| UC-05 | AC.L2-3.1.20 | SharePoint tenant sharingCapability ≤ ExistingExternalUserSharingOnly; CUI site = Disabled | sharing-blocked audit events | share to new external addr |
| UC-06 | AC.L2-3.1.1 | CUI site permissions = CUI group only | access-denied audit events for non-members | P3 opens CUI link |
| UC-07 | AC.L2-3.1.12 | named locations defined; geo-block CA policy enabled | sign-in logs: blocks with CA failure reason from disallowed geo | VPN-exit sign-in |
| UC-08 | AC.L2-3.1.18, CM.L2-3.4.1 | compliant-device CA on; Intune compliance policy assigned | sign-in logs: `deviceDetail.isCompliant=false` → failure | personal-device login |
| UC-09 | CM.L2-3.4.7 | WDAC/app-control policies assigned to device groups | Defender/Intune app-block events | run unsigned exe |
| UC-10 | IA.L2-3.5.7 | password policy: banned list on, smart lockout thresholds | (limited — directory logs) | set "password1" |
| UC-11 | IA.L2-3.5.x, CM.L2-3.4.1, AT.L2-3.2.2 | Autopilot profile + BitLocker policy assigned; training CA/grant configured | device enrollment + MFA registration events for recent joiners | scripted new-hire walkthrough |
| UC-12 | AC.L2-3.1.2, MP.L2-3.8.3 | lifecycle commands available (A-02/A-11); wipe capability (B-05/B-06) | audit: disable→revoke→wipe sequence on last offboard | offboard a test user |
| UC-14 | AC.L2-3.1.4/5/7 | PIM rules require approval; no standing GA besides break-glass; break-glass excluded from CA | PIM activation audit events | elevation walkthrough |
| UC-15 | AC.L2-3.1.20, AC.L2-3.1.3 | guest-access settings scoped; CUI label blocks guests | guest access audit trail | guest opens CUI file |
| UC-16 | AU.L2-3.3.1 | audit enabled; retention ≥90d; Sentinel/LAW connected (vfsgov-law-prod) | audit records exist, fresh, and queryable | — |
| UC-17 | SI.L2-3.14.1, CM.L2-3.4.2 | update rings + baseline assigned | device compliance/patch state ≥ threshold | — |
| UC-18 | IR.L2-3.6.1 | Sentinel workspace + analytics rules active | incidents/alerts flowing | trigger benign test alert |

UC-04/13 fold into UC-02/05 (Teams files = SharePoint) and UC-12 (wipe path) for testing purposes.

---

## 4. Notes for the test-case author (G-EUT-1)

- **T1+T2 are fully automatable today** with the existing app-only cert auth
  (`CN=EvidenceOps-Automation`, thumbprint `B57C…9F11`, confirmed live 2026-07-03 with all needed
  read scopes: Policy.Read.All, AuditLog.Read.All, DeviceManagementConfiguration.Read.All,
  SharePointTenantSettings.ReadWrite.All, Directory.Read.All…).
- **T2 caveat:** behavioral evidence requires the tenant to have real usage history; a quiet
  tenant yields "no evidence yet," which must be reported as INCONCLUSIVE, not PASS/FAIL.
- **T3 requires test personas** (a P1-like licensed test user, an unenrolled device identity, an
  external address). Absent those, T3 cases are authored with `skip` + a provisioning note.
- A failing T1/T2 probe is a **finding about the tenant**, never a reason to weaken the probe.
- EO's 91 evaluators (`ces-shared/src/data/control-signal-registry.json`) already encode much of
  the T1 logic per-control; the test suite verifies from the *user's use-case perspective* and can
  cross-reference evaluator IDs rather than duplicating their internals.
