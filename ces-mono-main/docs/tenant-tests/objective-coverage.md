# Tenant-Probe -> 800-171A Objective Coverage (vfsgov)

Maps every CES tenant probe to the 800-171A objectives its Script genuinely
**Examines** (queries tenant config; PASS = direct evidence the determination is true).
Full mapping: `tenant-tests/profiles/probe-objective-map.json`. Hardcoded
"platform-provided" PASSes and SKIPPED probes Examine nothing - **not** counted.

## Headline

- **Total objectives: 320** (110 practices; a practice is MET only if all objectives MET).
- **Objectives Examined by >=1 probe: 102 (31.9%).** *(G-EUT-5 Phase 2a: +7 from fixing
  the two miscredited probe sets - IA-3.5.1[a][b][c], AC-3.1.7[a][b][c][d]. Phase 2b: +10
  from six objective-depth probes - AC-3.1.5[c][d], IR-3.6.1[e], AC-3.1.20[a][c],
  CM-3.4.1[d][e], CM-3.4.2[a], IA-3.5.6[a][b].)*
- Out-of-scope by vfsgov disposition (N/A / ATTEST / INHERITED / DEFERRED):
  **50 objectives across 20 controls** - no probe required.
- **In-scope objectives: 270; Examined: 101 (37.4%)** -> ~169 in-scope objectives
  unverified. (1 of the 102, AC-3.1.3[e], sits on a DEFERRED control.)
- A further **~16 objectives are platform-*attested*** (hardcoded PASS: 3.5.5, 3.5.8,
  3.5.11, 3.3.7, 3.14.4, 3.13.12, 3.13.14, 3.1.13) - asserted by the M365 GCC High
  platform, not examined by a probe.

## Config-examinable subset

Of the 270 in-scope objectives, an estimated **~150 are cloud-config-examinable** via
Graph/ARM/EXO ("...is enforced/implemented/encrypted/monitored"). The other ~120 are
policy/definition/documentation determinations ("...is defined/documented/identified")
needing Interview or document Examine, not a tenant probe. The suite covers **~101 of
~150 config-examinable objectives (~67%)** - leaving **~49** as the realistic target
for new probes (most needing the IPPS/Purview channel or an Intune device fleet vfsgov's
VDI model does not deploy).

## Per-family

| Fam | Total | Examined | Disp. out-of-scope |
|-----|------:|---------:|-------------------:|
| AC  | 70 | 30 | 7 (3.1.17 NA; 3.1.3 DEFERRED) |
| AT  |  9 |  1 | 6 (3.2.1, 3.2.3 ATTEST) |
| AU  | 29 | 14 | 0 |
| CM  | 44 | 11 | 0 |
| IA  | 25 | 13 | 0 |
| IR  | 14 |  4 | 0 |
| MA  | 10 |  0 | 8 (3.7.1/2/4/6 ATTEST, 3.7.3 NA) |
| MP  | 15 |  3 | 4 (3.8.1 DEFERRED) |
| PS  |  4 |  1 | 1 (3.9.1 ATTEST) |
| PE  | 16 |  0 | 16 (all ATTEST) |
| RA  |  9 |  2 | 0 |
| CA  | 14 |  1 | 0 |
| SC  | 41 | 12 | 8 (3.13.2/4/7 INHERITED) |
| SI  | 20 | 10 | 0 |
| **All** | **320** | **102** | **50** |

## Biggest DEPTH gaps (thin probe, multi-objective control; UNVERIFIED determinations)

- **CM-3.4.7 (15 obj, 1 probe):** only [c] (nonessential programs restricted).
  Unverified: essential/nonessential **functions, ports, protocols, services**
  defined + restricted ([a][b][d]-[o]).
- **CM-3.4.5 (8, 1):** only [h] logical-restriction enforced. Unverified [a]-[g]
  (physical + logical restrictions defined/documented/approved).
- **SC-3.13.1 (8, 1):** only [e] control at external boundary. Unverified [a]-[d],[f]-[h]
  (boundary definition, monitoring, internal-boundary control/protection).
- **CM-3.4.1 (6, 1):** only [a] baseline established. Unverified [b] content, [c] maintained,
  [d]-[f] system **inventory**.
- **AC-3.1.1 (6, 1):** [a][d]. Unverified [b][c] (processes/devices identified),
  [e][f] (access limited to processes/devices).
- **AC-3.1.22 (5, 1):** [b]. Unverified [a][c][d][e] (authorized posters, review process,
  content reviewed, removal mechanism).
- **AC-3.1.20 (6, 2):** [e][f]. Unverified [a]-[d] (external connections/use identified & verified).
- **SI-3.14.1 (6, 1):** [e][f]. Unverified [a]-[d] (identify/report flaws within timeframe).
- **IR-3.6.1 (7, 1):** [a][c][d]. Unverified [b] prep, [e] containment, [f] recovery, [g] user response.
- **AC-3.1.5 / 3.1.12 / 3.1.15 (4 each, 1):** 1-2 objectives each; security-function
  least-privilege, remote-access types/monitoring, remote priv-command auth unverified.

## Probes with ZERO genuine coverage — FIXED (G-EUT-5 Phase 2)

- **AC-3.1.7** — RESOLVED. The two break-glass CA-exclusion probes still run (emergency-access
  **resilience**, tagged `objectives:[]`), and **three new probes** now examine the real
  determinations: [a] privileged functions defined (directory roleDefinitions/isPrivileged),
  [b][c] non-priv prevented (authorizationPolicy default-role lockdown), [d] execution audited
  (directoryAudits RoleManagement). All 4 objectives now examined.
- **IA-3.5.1** — RESOLVED. MFA-all-users retagged to **3.5.3[c][d]** (its true target);
  ADFS-federation stays `objectives:[]`; **three new probes** examine [a] users identified
  (unique id+UPN), [b] processes identified (servicePrincipals/appId), [c] devices identified
  (Entra device registry). All 3 objectives now examined.

## Out-of-scope (disposition-covered, 50 obj)

AC-3.1.17 (2 NA), MA-3.7.1/2/4/6 (7 ATTEST) + 3.7.3 (1 NA), PE-3.10.1-6 (16 ATTEST),
PS-3.9.1 (1 ATTEST), AT-3.2.1/3 (6 ATTEST), SC-3.13.2/4/7 (8 INHERITED),
MP-3.8.1 (4) + AC-3.1.3 (5) = 9 **DEFERRED pending IPPS probe**.

## Top ~20 probes to ADD (close in-scope objective gaps)

1. **IA-3.5.3[b]** MFA for local/privileged access - verify PIM activation requires MFA / auth context.
2. **AC-3.1.5[c][d]** security functions + least privilege - enumerate *all* admin role assignments (not just GA) and their scope.
3. **AC-3.1.20[a]-[d]** external connections identified/verified - read cross-tenant access policy + SharePoint allowed-domains list.
4. **AC-3.1.22[c][d]** public-posting review - DLP / content-review policy on public sites.
5. **CM-3.4.1[d][e]** system inventory - export Entra + Intune device inventory.
6. **AU-3.3.1[b][d]** audit content - verify LAW diagnostic-setting categories enabled (Entra/M365 -> LAW).
7. **AU-3.3.4[c]** audit-failure alert - Azure Monitor alert on LAW ingestion-health / Sentinel health.
8. **SC-3.13.1[c][g]** boundary monitor/protect - Defender for Cloud Apps + connector TLS enforcement.
9. **IR-3.6.1[e]** containment - Sentinel automation rules / playbooks (Logic Apps).
10. **SC-3.13.13[a][b]** mobile-code control - Defender ASR rules (block macros, Office child processes).
11. **AC-3.1.7[c][d]** privileged-function control - RBAC prevention + unified-audit capture of privileged ops.
12. **AC-3.1.10[c]** pattern-hiding display - Intune lock-screen config profile.
13. **AC-3.1.18[c]** mobile connections monitored - Intune enrollment / device sign-in logging.
14. **RA-3.11.2[a][d]** scan frequency + on-new-vuln - Defender Vulnerability Management config.
15. **SI-3.14.6[b][c]** inbound/outbound traffic monitored - Sentinel network connectors / Defender network protection.
16. **CM-3.4.2[a]** config settings established - Intune security baselines / settings-catalog assignment.
17. **MP-3.8.1 / 3.8.2 / 3.8.4** (DEFERRED) - IPPS channel: sensitivity-label publish, scope, and header/footer/watermark markings.
18. **AC-3.1.3[a]-[d]** (DEFERRED) - IPPS channel: DLP + information-barrier policy export.
19. **IA-3.5.6[a][b]** stale-identifier disable - access-review / lifecycle workflow disabling inactive accounts.
20. **CA-3.12.4** SSP/boundary artifacts - wire the EvidenceOps golden-SSP check into the suite.

*Bottom line: 102/320 objectives Examined (32%), ~37% of the 270 in-scope. The two
miscredited probe sets are fixed and six objective-depth probes added; remaining
config-Examine gaps mostly need the IPPS/Purview channel or an Intune device fleet the
VDI model does not deploy - the rest is Interview + Test + signed documentation (Phases 3-4).*
