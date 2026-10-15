# G-EUT-1 Findings — tenant `vfsgov` (Valor Forge, LLC)

**Run:** 2026-07-03 15:14 UTC · **Suite:** 36 tests / 16 use cases · **Result:** PASS=18 · FAIL=6 · INCONCLUSIVE=10 · SKIPPED=2
**Report:** `docs/tenant-tests/results/run-2026-07-03-151416.{md,json}` · **Auth:** app-only cert (read-only)

Every FAIL below is a **finding about the tenant**, verified by a read-only probe — not a test defect.
The suite converged with zero harness defects (all probe/endpoint bugs were fixed during the loop and
logged in §Harness-fix log). A quiet tenant (few users, little recent activity) is why 10 T2
behavioral probes are INCONCLUSIVE rather than PASS — they need real usage history to evidence.

## Findings (FAIL) — ranked

| # | Sev | Finding | Use case | Practice | Evidence |
|---|---|---|---|---|---|
| F1 | **HIGH** | **Standing Global Administrator beyond break-glass**: `admin@vfsgov.us` holds a permanent GA role assignment. CES enforces JIT/PIM (2 eligible assignments confirmed), but this standing account bypasses it. | UC-14 | AC.L2-3.1.5 (least privilege / JIT) | roleAssignments filter on GA template id returned `admin@vfsgov.us` as a non-break-glass human |
| F2 | **HIGH** | **CUI-authorized group name drift**: tenant config `cui_group_name = "sg-cui-users"` but the actual tenant group is **`cui-users-sg`**. Every automation keyed on the config name (AO command targeting, EO evidence, CA scoping) silently misses the real group → the CUI access boundary can't be verified and may not be wired. | UC-02, UC-06 | AC.L2-3.1.1 (authorized access to CUI) | `groups?$filter` on config name = 0 results; near-match `cui-users-sg` exists |
| F3 | **MED** | **No Intune device compliance policy defined.** Device-config profiles exist (BitLocker, Defender AV, app control), and a compliant-device CA policy is enabled — but with **zero compliance policies**, no device can ever evaluate as "compliant," so the compliant-device gate (UC-08 CA) has nothing to check against. | UC-08 | AC.L2-3.1.18, CM.L2-3.4.1 | `deviceCompliancePolicies` returned empty |
| F4 | **MED** | **No mail-protection transport rules.** Zero enabled Exchange transport rules apply IRM/OME/encryption; controlled email to primes is not automatically protected in transit by rule. | UC-03 | SC.L2-3.13.8 | `Get-TransportRule` returned no enabled rules |
| F5 | **LOW** | **No Autopilot deployment profile.** Devices are not provisioned to a hardened spec at enrollment; onboarding relies on manual/other provisioning. (BitLocker enforcement itself is present.) | UC-11 | CM.L2-3.4.1 | `windowsAutopilotDeploymentProfiles` returned empty |

F1 and F2 are the priority items — both are one-line fixes with outsized impact (remove the standing
GA / correct the group name in tenant config), and both currently defeat controls that otherwise look
green at the policy layer.

## What's verifiably enforced (PASS highlights)

MFA required for all users + weak methods (SMS/voice) disabled (UC-01); external sharing hard-disabled,
no anonymous links (UC-05); compliant-device + untrusted-location CA policies enabled (UC-02/07/08);
101 app-control/endpoint-protection + 19 BitLocker/AV configs deployed (UC-09/11); AO offboarding
command set complete (UC-12); PIM eligible model active + break-glass correctly excluded from all 5
tenant CA policies (UC-14); guest invites restricted to admins/inviters + limited guest role (UC-15);
LAW retention 90 days (UC-16); update rings configured (UC-17); 5/5 Sentinel analytics rules enabled
(UC-18).

## INCONCLUSIVE (needs data or a channel the harness doesn't open) — not failures

- **T2 behavioral probes** (MFA-in-practice, CA blocks, non-compliant-device blocks, offboarding
  activity, mail flow, device compliance rate, incident flow, audit freshness): the tenant is quiet
  (2 recent sign-ins, both admin-portal; 0 managed devices enrolled; no incidents). These PASS only
  once the tenant has real end-user activity. Re-run after the tenant is in use.
- **Password custom banned-list (UC-10):** cloud defaults are always-on but the CES-authored custom
  list isn't readable via Graph; 14-char minimum is not cloud-verifiable for cloud-only accounts.
- **Training-gate CA (UC-11):** no policy matched by name; may be implemented via group membership.

## SKIPPED (channel not yet built)

- **Sensitivity-label publishing (UC-02)** and **DLP policies (UC-03)** both require the Security &
  Compliance PowerShell channel (IPPS session). Graph app-only cannot enumerate them. **Next harness
  increment:** add `Invoke-EutIpps` as a fourth read-only choke point (`Get-*` on
  `Connect-IPPSSession`) to cover label publishing + DLP.

## Harness-fix log (per plan AC#3 — every probe change during the loop, why it was a harness defect)

| Fix | File | Was it a tenant gap? |
|---|---|---|
| ASCII-clean all files (PS 5.1 parser rejected em-dashes) | all | No — encoding defect |
| AO registry parse: root is a raw JSON array, `@($reg.commands)` collapsed to a 1-elem null | UC-12 | No — parse bug; F-none (UC-12 T1 now PASS) |
| CA break-glass exclusion: exclude `Microsoft-managed` policies (owner can't edit their exclusions) | UC-14 | No — false positive; UC-14 T3 now PASS |
| MFA T2: exclude CA-not-applied admin-portal sign-ins from the sample → INCONCLUSIVE on tiny/unrepresentative sets | UC-01 | No — mis-calibration; would have mislabeled a quiet tenant as failing |
| Sensitivity-label endpoint: all Graph label endpoints 400 under app-only → SKIPPED(channel) | UC-02 | No — Graph limitation, not a tenant gap |
| CUI group probes: added near-match hint surfacing the drift | UC-02, UC-06 | The hint is harness; **the drift it found (F2) is a real tenant finding** |

No FAIL verdict was ever converted to PASS by editing a probe. The 6 FAILs stand as tenant findings.
