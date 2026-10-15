# vfsgov Mission Profile — control scoping for testing & remediation

**Source:** vfsgov SIT/RRT/MPT artifacts (Planner `ces-planner/customers/VFS/inputs/`, mission plans
`~/.stamper/tenants/vfsgov/plans/`, `discover-state.json`, `assess-state.json`). Date read: 2026-07-03.
**Purpose:** make CMMC L2 testing & remediation match what vfsgov's mission plan actually intends —
so out-of-scope controls aren't flagged as failures and tenant-specific controls are actually tested.

## Tenant type & end-state

- **Valor Forge, LLC** — engagement BHD-2026-001, **cloud-only Microsoft 365 GCC High**, single isolated enclave. Mission = `harden_existing` (retrofit an existing tenant).
- **CUI scope:** CTI (Controlled Technical Information) + ITAR/export-controlled, under DFARS 252.204-7012.
- **Users / endpoints in scope:** **0 traditional managed endpoints** (`in_scope_endpoints_estimate: 0`). No hybrid, no on-prem, no ADFS *server* to test (gov ADFS federates in via SAML).
- **Device strategy:** **VDI / Cloud PC** for remote/BYOD CUI access, gated by Conditional Access. Admin workstations *planned, not yet implemented*. **No Windows Autopilot. No native Intune-managed laptop fleet initially.** Mobile = controlled connection only (CA), not personal-device MDM.
- **CUI locations:** SharePoint Online / OneDrive / Exchange / Teams (all GCC High). Ingress via encrypted email, prime/customer portal, Teams. Backup = M365 native.
- **Security stack:** Entra ID (+ gov ADFS federation via SAML), Conditional Access, Sentinel + Defender, Key Vault (CMK), sensitivity labels + DLP.
- **Governance:** evidence owner = Compliance Officer; retention 365 days; manual PDF evidence export; self-assessment, asap timeline.

## Control scoping — the part that changes our tests

### OUT OF SCOPE / N/A by mission plan — must NOT be tested as FAIL
| Control | Why N/A for vfsgov |
|---|---|
| Autopilot provisioning (CM baseline via Autopilot) | Devices are VDI/Cloud PC or manual — no Autopilot. |
| Native Intune **Windows compliance policy** for a laptop fleet (CM.L2-3.4.2 as tested) | No managed endpoint fleet initially; compliance is the **VDI/Cloud PC + CA** model. |
| Mobile/personal-device MDM (native) | Only VDI access to CUI; no BYOD-to-personal-device enrollment. |
| On-prem / hybrid-join device controls | Cloud-only tenant. |
| AC.L2-3.1.17 Wireless protection | Marked incomplete/deferred — cloud-only, no wireless infra in scope. |
| MA.L2-3.7.3 Off-site equipment sanitization | No off-site equipment maintenance in scope. |
| PE.L1-3.10.x Physical access | Manual attestation at annual affirmation — not automatable. |
| PS.L2-3.9.x Personnel security | Manual attestation (screening/termination evidence). |
| AT.L2-3.2.x Awareness & training | Manual attestation — customer program. |

### IN SCOPE, tenant-specific implementation — SHOULD be tested (we currently don't)
| What | How vfsgov implements it |
|---|---|
| **VDI-only CUI access** | CA blocks CUI apps/sites from non-VDI/Cloud PC sessions. This is vfsgov's core device control — replaces the "compliant laptop" test. |
| **Break-glass exclusion** | Emergency-admin **group `eadmin`** excluded from all blocking CA policies (note: config also has `breakglass_upn=breakglass@vfsgov.us` — reconcile group vs account). |
| **Security-group naming** | Convention `<project><role><UPN>` — verify in Entra. |
| **ADFS→Entra federation** | Gov ADFS SAML tickets flow to Entra for session auth. |
| **M365 audit org settings** | Mailbox audit + org customization + time sync enabled (AU family). |
| **Sensitivity labels + DLP** | CUI egress prevention via SharePoint/Teams/Exchange (currently SKIPPED — needs IPPS channel). |
| **BitLocker / CMK / TLS** | Data-at-rest + Key Vault CMK + TLS enforced (SC family). |

### Inherited from platform (FedRAMP / GCC High) — SSP references, not tenant config
Several SC network-architecture controls (SC.L2-3.13.x) inherit from Azure GCC High FedRAMP authorization per NIST SP 800-18 R1.

## Current posture (from assess-state, 2026-03)
- Baseline: 111 controls NOT MET (0%) at discovery. After hardening pass: ~55 satisfied, ~55 deferred/N/A/pending-evidence.
- So a live test run finding gaps is expected — but gaps on **N/A** controls are noise, and gaps on **VDI/CA** controls are the real signal.

## Implications for the 6 G-EUT-1 findings (remediation realignment)
| Finding | Verdict under mission plan |
|---|---|
| F1 standing GA (AC-3.1.5) | **Valid** — least privilege applies. Keep A-10. |
| F2 CUI group drift (AC-3.1.1) | **Valid** — fixed (config → cui-users-sg). |
| F6 app/group creation (AC-3.1.2) | **Valid** — applied A-18 (verified PASS). |
| F4 transport/OME (SC-3.13.8) | **Valid** — CUI email encryption is in the plan. Keep D-06. |
| F3 compliance policy (CM-3.4.2) | **RE-SCOPE** — do NOT apply B-13 (Windows10 laptop compliance policy). Reframe as VDI/Cloud-PC + CA enforcement. |
| F5 Autopilot (CM-3.4.1) | **WITHDRAW** — out of scope. B-14 not applicable; its failures were correct. |

**Net:** apply A-10 (with break-glass check) + D-06; F2/F6 already done; **drop B-13 and B-14** as
mis-scoped; re-express device compliance as VDI/CA coverage.
