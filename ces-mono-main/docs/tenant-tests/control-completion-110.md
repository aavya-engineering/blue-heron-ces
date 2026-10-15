# End-User Testing Completion - all 110 CMMC 2.0 Level 2 controls (vfsgov)

**Date:** 2026-07-04 · **The total is always 110 controls** (NIST SP 800-171 R2). Control-by-control
record of how each of the 110 is **proven** (direct evidence) or **explained** (disposition with SSP
citation), grounded in Stamper's tenant config + the VDI/GCC-High mission profile.

## Bottom line: 110 of 110 proven or explained · 0 residual

The Security & Compliance PowerShell (IPPS/Purview) channel is now built (`Invoke-EutIpps` + UC-G),
which closed the last residual: **MP.L2-3.8.1** (sensitivity labels published) and **AC.L2-3.1.3** (DLP
information-flow control) are now examined live and PASS.

| Bucket | Count | Meaning |
|---|---:|---|
| **PROVE - tenant-suite probe** | 68 | a read-only probe genuinely examines an 800-171A objective |
| **PROVE - platform attestation** | 8 | satisfied by the M365 GCC High platform |
| **PROVE - EvidenceOps artifact** | 4 | CES produces the required artifact (SSP, assessment, POA&M, risk) |
| **EXPLAIN - attested** | 21 | policy/process or Microsoft-operated, SSP-cited |
| **EXPLAIN - platform-inherited** | 5 | inherited from the Azure/M365 GCC High FedRAMP authorization |
| **EXPLAIN - not applicable** | 4 | no such surface in a cloud-only/VDI model |
| **RESIDUAL** | 0 | none |
| **Total** | 110 | |

**FINDING F-LABEL — RESOLVED (2026-07-04, AO D-11):** the CUI sensitivity label now applies label
**encryption** (RMS template, rights scoped to the CUI group) and auto **content-marking** (header 'CUI',
footer 'CUI//SP-CTI', watermark 'CUI'), enabled live via AO command D-11 (Tier-3 two-person approved).
MP-3.8.2 and MP-3.8.4 are now **examined directly by the UC-G probes and PASS** — both converted from
EXPLAIN to PROVE. (Probe note: protection state lives in `Get-Label`'s `LabelActions`, not the flat
`Settings` list; the UC-G probes read `LabelActions` accordingly.)

## Per-control record (all 110)

### AC

| Control | Verdict | How proven / explained |
|---|---|---|
| AC.L1-3.1.1 | PROVE | examined by tenant-suite probe |
| AC.L1-3.1.2 | PROVE | examined by tenant-suite probe |
| AC.L2-3.1.3 | PROVE | examined by tenant-suite probe |
| AC.L2-3.1.4 | PROVE | examined by tenant-suite probe |
| AC.L2-3.1.5 | PROVE | examined by tenant-suite probe |
| AC.L2-3.1.6 | PROVE | examined by tenant-suite probe |
| AC.L2-3.1.7 | PROVE | examined by tenant-suite probe |
| AC.L2-3.1.8 | PROVE | examined by tenant-suite probe |
| AC.L2-3.1.9 | PROVE | examined by tenant-suite probe |
| AC.L2-3.1.10 | PROVE | examined by tenant-suite probe |
| AC.L2-3.1.11 | PROVE | examined by tenant-suite probe |
| AC.L2-3.1.12 | PROVE | examined by tenant-suite probe |
| AC.L2-3.1.13 | PROVE | platform attestation (M365 GCC High) |
| AC.L2-3.1.14 | EXPLAIN | attested: remote access is routed through the VDI/Cloud-PC managed gateway (Windows 365/AVD is the managed access point); no direct-to-service path for CUI |
| AC.L2-3.1.15 | PROVE | examined by tenant-suite probe |
| AC.L2-3.1.16 | EXPLAIN | N/A: cloud-only tenant; no wireless network infrastructure to authorize (same basis as AC-3.1.17) |
| AC.L2-3.1.17 | EXPLAIN | N/A: cloud-only tenant; no wireless network infrastructure in scope |
| AC.L2-3.1.18 | PROVE | examined by tenant-suite probe |
| AC.L2-3.1.19 | PROVE | examined by tenant-suite probe |
| AC.L1-3.1.20 | PROVE | examined by tenant-suite probe |
| AC.L2-3.1.21 | PROVE | examined by tenant-suite probe |
| AC.L1-3.1.22 | PROVE | examined by tenant-suite probe |

### AT

| Control | Verdict | How proven / explained |
|---|---|---|
| AT.L2-3.2.1 | EXPLAIN | attested: awareness program documented and evidenced by customer |
| AT.L2-3.2.2 | PROVE | examined by tenant-suite probe |
| AT.L2-3.2.3 | EXPLAIN | attested: insider-threat awareness - customer program |

### AU

| Control | Verdict | How proven / explained |
|---|---|---|
| AU.L2-3.3.1 | PROVE | examined by tenant-suite probe |
| AU.L2-3.3.2 | PROVE | examined by tenant-suite probe |
| AU.L2-3.3.3 | PROVE | examined by tenant-suite probe |
| AU.L2-3.3.4 | EXPLAIN | attested: audit-processing-failure alerting via Sentinel health + Log Analytics ingestion alerts to identified recipients; enforcing analytics exist (UC-E probe), recipient list attested |
| AU.L2-3.3.5 | PROVE | examined by tenant-suite probe |
| AU.L2-3.3.6 | PROVE | examined by tenant-suite probe |
| AU.L2-3.3.7 | PROVE | platform attestation (M365 GCC High) |
| AU.L2-3.3.8 | PROVE | examined by tenant-suite probe |
| AU.L2-3.3.9 | PROVE | examined by tenant-suite probe |

### CM

| Control | Verdict | How proven / explained |
|---|---|---|
| CM.L2-3.4.1 | PROVE | examined by tenant-suite probe |
| CM.L2-3.4.2 | PROVE | examined by tenant-suite probe |
| CM.L2-3.4.3 | EXPLAIN | attested: configuration change control (track/review/approve/log changes) via the change-management process + Entra/Intune directory audit logs |
| CM.L2-3.4.4 | EXPLAIN | attested: security impact analysis is performed within the change-control process prior to change approval |
| CM.L2-3.4.5 | PROVE | examined by tenant-suite probe |
| CM.L2-3.4.6 | PROVE | examined by tenant-suite probe |
| CM.L2-3.4.7 | PROVE | examined by tenant-suite probe |
| CM.L2-3.4.8 | PROVE | examined by tenant-suite probe |
| CM.L2-3.4.9 | PROVE | examined by tenant-suite probe |

### IA

| Control | Verdict | How proven / explained |
|---|---|---|
| IA.L1-3.5.1 | PROVE | examined by tenant-suite probe |
| IA.L1-3.5.2 | PROVE | examined by tenant-suite probe |
| IA.L2-3.5.3 | PROVE | examined by tenant-suite probe |
| IA.L2-3.5.4 | PROVE | examined by tenant-suite probe |
| IA.L2-3.5.5 | PROVE | platform attestation (M365 GCC High) |
| IA.L2-3.5.6 | PROVE | examined by tenant-suite probe |
| IA.L2-3.5.7 | PROVE | examined by tenant-suite probe |
| IA.L2-3.5.8 | PROVE | platform attestation (M365 GCC High) |
| IA.L2-3.5.9 | PROVE | examined by tenant-suite probe |
| IA.L2-3.5.10 | PROVE | examined by tenant-suite probe |
| IA.L2-3.5.11 | PROVE | platform attestation (M365 GCC High) |

### IR

| Control | Verdict | How proven / explained |
|---|---|---|
| IR.L2-3.6.1 | PROVE | examined by tenant-suite probe |
| IR.L2-3.6.2 | EXPLAIN | attested: incident reporting to designated authorities (DoD 72-hour DIBNet + internal chain) per the incident-response plan |
| IR.L2-3.6.3 | EXPLAIN | attested: incident-response capability is tested (annual tabletop exercise) per the incident-response plan |

### MA

| Control | Verdict | How proven / explained |
|---|---|---|
| MA.L2-3.7.1 | EXPLAIN | attested: maintenance is Microsoft-operated for cloud services; org maintenance procedures attested |
| MA.L2-3.7.2 | EXPLAIN | attested: maintenance tooling controls attested; no local maintenance for CUI systems |
| MA.L2-3.7.3 | EXPLAIN | N/A: no off-site equipment maintenance in scope (cloud-only, VDI access) |
| MA.L2-3.7.4 | EXPLAIN | attested: media inspection procedural; no removable media path in VDI model |
| MA.L2-3.7.5 | EXPLAIN | attested: nonlocal maintenance sessions require MFA and are terminated on completion; cloud maintenance is Microsoft-operated (MA family), org admin-MFA attested |
| MA.L2-3.7.6 | EXPLAIN | attested: maintenance-personnel supervision procedural |

### MP

| Control | Verdict | How proven / explained |
|---|---|---|
| MP.L2-3.8.1 | PROVE | examined by tenant-suite probe |
| MP.L2-3.8.2 | PROVE | examined by tenant-suite probe (UC-G: label encryption enabled via AO D-11 - rights scoped to the CUI group) |
| MP.L1-3.8.3 | PROVE | examined by tenant-suite probe |
| MP.L2-3.8.4 | PROVE | examined by tenant-suite probe (UC-G: auto content-marking enabled via AO D-11 - header 'CUI', footer 'CUI//SP-CTI', watermark) |
| MP.L2-3.8.5 | EXPLAIN | N/A: no CUI media transport outside controlled areas; cloud-only VDI model has no removable/physical media path |
| MP.L2-3.8.6 | PROVE | examined by tenant-suite probe |
| MP.L2-3.8.7 | PROVE | examined by tenant-suite probe |
| MP.L2-3.8.8 | EXPLAIN | attested: portable storage with no identifiable owner is prohibited; VDI/Cloud-PC blocks removable storage (no USB passthrough), policy-attested |
| MP.L2-3.8.9 | EXPLAIN | inherited: backup CUI confidentiality at storage locations is inherited from the Azure/M365 GCC High platform (encrypted, geo-redundant backups) |

### PE

| Control | Verdict | How proven / explained |
|---|---|---|
| PE.L1-3.10.1 | EXPLAIN | attested: physical access to CUI systems is Microsoft-operated (GCC High datacenters) + customer office policy |
| PE.L2-3.10.2 | EXPLAIN | attested: physical monitoring - Microsoft SRM + customer office |
| PE.L1-3.10.3 | EXPLAIN | attested: visitor escort - customer office policy |
| PE.L1-3.10.4 | EXPLAIN | attested: physical access logs - Microsoft SRM (datacenter) + customer office |
| PE.L1-3.10.5 | EXPLAIN | attested: manage physical access devices - customer office policy |
| PE.L2-3.10.6 | EXPLAIN | attested: alternate work sites - VDI/Cloud-PC access policy + customer telework policy |

### PS

| Control | Verdict | How proven / explained |
|---|---|---|
| PS.L2-3.9.1 | EXPLAIN | attested: personnel screening evidenced by customer HR (clearance/background) |
| PS.L2-3.9.2 | PROVE | examined by tenant-suite probe |

### RA

| Control | Verdict | How proven / explained |
|---|---|---|
| RA.L2-3.11.1 | PROVE | produced by EvidenceOps artifact |
| RA.L2-3.11.2 | PROVE | examined by tenant-suite probe |
| RA.L2-3.11.3 | PROVE | examined by tenant-suite probe |

### CA

| Control | Verdict | How proven / explained |
|---|---|---|
| CA.L2-3.12.1 | PROVE | produced by EvidenceOps artifact |
| CA.L2-3.12.2 | PROVE | produced by EvidenceOps artifact |
| CA.L2-3.12.3 | PROVE | examined by tenant-suite probe |
| CA.L2-3.12.4 | PROVE | produced by EvidenceOps artifact |

### SC

| Control | Verdict | How proven / explained |
|---|---|---|
| SC.L1-3.13.1 | PROVE | examined by tenant-suite probe |
| SC.L2-3.13.2 | EXPLAIN | inherited: security architecture/engineering inherited from Azure GCC High FedRAMP High authorization |
| SC.L2-3.13.3 | PROVE | examined by tenant-suite probe |
| SC.L2-3.13.4 | EXPLAIN | inherited: shared-resource isolation inherited from Azure GCC High platform |
| SC.L1-3.13.5 | PROVE | examined by tenant-suite probe |
| SC.L2-3.13.6 | PROVE | examined by tenant-suite probe |
| SC.L2-3.13.7 | EXPLAIN | inherited: split-tunneling blocked via VDI/Cloud-PC network egress (platform-managed) |
| SC.L2-3.13.8 | PROVE | examined by tenant-suite probe |
| SC.L2-3.13.9 | PROVE | examined by tenant-suite probe |
| SC.L2-3.13.10 | EXPLAIN | inherited: cryptographic key establishment and management via Azure Key Vault (FIPS 140-2 validated HSM) + platform-managed keys |
| SC.L2-3.13.11 | PROVE | examined by tenant-suite probe |
| SC.L2-3.13.12 | PROVE | platform attestation (M365 GCC High) |
| SC.L2-3.13.13 | PROVE | examined by tenant-suite probe |
| SC.L2-3.13.14 | PROVE | platform attestation (M365 GCC High) |
| SC.L2-3.13.15 | PROVE | examined by tenant-suite probe |
| SC.L2-3.13.16 | PROVE | examined by tenant-suite probe |

### SI

| Control | Verdict | How proven / explained |
|---|---|---|
| SI.L1-3.14.1 | PROVE | examined by tenant-suite probe |
| SI.L1-3.14.2 | PROVE | examined by tenant-suite probe |
| SI.L2-3.14.3 | PROVE | examined by tenant-suite probe |
| SI.L1-3.14.4 | PROVE | platform attestation (M365 GCC High) |
| SI.L1-3.14.5 | PROVE | examined by tenant-suite probe |
| SI.L2-3.14.6 | PROVE | examined by tenant-suite probe |
| SI.L2-3.14.7 | PROVE | examined by tenant-suite probe |

