# Interview-Readiness Matrix (vfsgov) — G-EUT-5 Phase 4

**Purpose:** the CMMC assessment uses three methods — Examine, **Interview**, Test. Our suite
covers Examine (config) and, via UC-T3, Test-as-evidence. The **Interview** method is people:
a C3PAO asks a control owner to *articulate* how a practice works and *point to* the evidence.
This matrix names, per NIST family, **who** answers and **what** they must be ready to say —
so the Interview method is rehearsed, not a surprise. It is the tracking artifact; the actual
readiness is a human activity.

**Owner roles** (from the SSP `responsibleParties`): SO = System Owner · AO = Authorizing
Official · ISSM · ISSO · SysAdmin · NetAdmin · FSO = Facility Security Officer · CUI-PM = CUI
Program Manager · PO = Privacy Officer · HR.

| Fam | Practices | Primary owner | Secondary | Must articulate (Interview) | Backing evidence to point at |
|-----|----------:|---------------|-----------|-----------------------------|------------------------------|
| **AC** | 22 | ISSO | SysAdmin | Least-privilege & PIM model; CUI group boundary; remote-access/CA policy; break-glass procedure | UC-B/UC-E probes; CA policy export; PIM eligibility |
| **AT** | 3 | CUI-PM | HR | Awareness + role-based + insider-threat training cadence and gating | Training records; UC-D training-gate probe; **attested** |
| **AU** | 9 | ISSO | SysAdmin | What is logged, 90-day retention, Sentinel review workflow, tamper-protection | UC-E audit probes; LAW retention; Sentinel rules |
| **CM** | 9 | SysAdmin | ISSM | Baseline (non-Autopilot/VDI), change control, least-functionality, inventory | UC-C/UC-F probes; Intune configs; device inventory |
| **IA** | 11 | SysAdmin | ISSO | Identification of users/processes/devices; MFA enforcement; password/lockout policy | UC-A probes (incl. new IA-3.5.1[a][b][c]) |
| **IR** | 3 | ISSO | ISSM | IR capability, detection→containment→recovery→reporting, DoD 72-hr reporting | UC-E IR probes; Sentinel; **containment automation partial** |
| **MA** | 6 | SysAdmin | — | Cloud maintenance is Microsoft-operated; no local CUI maintenance path (VDI) | applicability.json **ATTEST/NA** dispositions |
| **MP** | 9 | CUI-PM | ISSO | Media protection via sensitivity labels; sanitization/wipe; portable-media policy | UC-B/UC-C probes; **MP-3.8.1 DEFERRED (IPPS)** |
| **PS** | 2 | HR | FSO | Personnel screening (clearance/background) and termination actions | UC-E offboarding probe; **screening ATTEST (HR)** |
| **PE** | 6 | FSO | SO | Physical protection — Microsoft datacenters + customer office policy | applicability.json **ATTEST** (all PE) |
| **RA** | 3 | ISSM | ISSO | Vulnerability scan cadence, risk register, remediation SLAs | UC-E RA probes; Defender/Intune |
| **CA** | 4 | ISSM | AO | SSP/POA&M lifecycle, continuous monitoring, boundary/scoping | EvidenceOps SSP + POA&M; UC-E CA probes |
| **SC** | 21 | NetAdmin | ISSO | Boundary protection, CUI encryption in transit/at rest, FIPS, DKIM, VDI egress | UC-B/UC-D probes; **SC-3.13.2/4/7 INHERITED** |
| **SI** | 9 | SysAdmin | ISSO | Flaw remediation, malware protection, alerts/advisories, monitoring | UC-C/UC-E SI probes; Defender |

## How to use this before an assessment

1. **Assign every owner cell to a named person** (fill the roles from `responsibleParties`).
2. For each family, the owner does a **dry-run interview**: articulate the "Must articulate"
   column from memory, then produce the "Backing evidence" live.
3. Flag any family where the owner cannot both *articulate* and *show* — that is an Interview
   gap even when the Examine probe is green (a green board is a **B on Examine only**).
4. Families leaning on **ATTEST/INHERITED/DEFERRED** dispositions (AT, MA, PE, PS, parts of
   SC/MP) must have the citation ready: the applicability disposition + its `ssp_ref`, and for
   inherited controls the **Microsoft CRM** (see `crm-inheritance-package.md`).

*Status: matrix built (no external input required). Assigning named individuals to each owner
role is the customer action item.*
