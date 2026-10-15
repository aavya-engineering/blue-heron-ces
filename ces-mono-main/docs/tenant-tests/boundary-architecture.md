# Boundary Architecture — vfsgov (SSP SC-3.13.1 narrative source)

**Date:** 2026-07-04 · **Context:** G-FW-ALT Phase 0/2. The `fw-cmmc` firewall was removed from
the infra plan (G4, 2026-06-13). This document names the replacement mechanisms and addresses all
8 SC.L2-3.13.1 assessment objectives for the tenant as it exists today: a cloud-only M365 GCC
High + Azure Gov tenant with VDI/Cloud-PC access and **one customer VNet — `vfsgov-vnet-eo`**
(EvidenceOps infrastructure: `snet-pe` with NSG `vfsgov-nsg-pe` fronting Private Endpoints,
`snet-mgmt`, and a leftover `AzureFirewallSubnet` from the removed firewall). The UC-H boundary
probes examine this VNet live; the G-FW-ALT Phase-1 posture (NSG deny-all @4096, blackhole UDR,
VNet flow logs → Sentinel) is the open remediation set for it — see docs/G-FW-ALT-plan.md.

## The boundary, stated plainly

There is no customer network perimeter because there is no customer network: all CUI lives in
M365 GCC High SaaS services and Azure Gov PaaS (Key Vault `vfsgov-kv-prod`, evidence storage,
Log Analytics `vfsgov-law-prod`). The enforceable boundaries are:

1. **The platform boundary** — Azure/M365 GCC High FedRAMP High authorization (inherited:
   SC-3.13.2, SC-3.13.4, SC-3.13.7).
2. **The identity perimeter** — 6 enabled Conditional Access policies form the access boundary;
   3 blocking policies deny by exception (legacy auth, untrusted locations, device code flow).
3. **The data perimeter** — tenant sharing `disabled`, CUI sensitivity label with RMS encryption,
   Purview DLP flow control, guest-role restriction.

## SC.L2-3.13.1 objectives [a]–[h]

| Obj | Statement (abridged) | Mechanism (today) | Evidence |
|-----|----------------------|-------------------|----------|
| [a] | External boundary identified | M365 GCC High SaaS boundary + Entra identity perimeter, named in the SSP + asset inventory (ces-stamper diagram-data) | SSP architecture section; this document |
| [b] | Key internal boundaries identified | Admin/user plane separation; CUI-authorized group + labeled sites vs general collaboration; evidence storage (CMK) | SSP; UC-D admin/user separation probe |
| [c] | Comms TO the boundary monitored | Sign-in logs risk-evaluated (Entra ID Protection), unified audit log, Sentinel analytics (5 rules) | UC-E probes: sign-in logs, Sentinel review, risk detection |
| [d] | Comms FROM the boundary monitored | Unified audit (sharing/mail-flow events) + DLP incident logs + Defender alerts to Sentinel | UC-F unified-audit probe; UC-G DLP probe |
| [e] | Comms TO the boundary controlled | CA deny-by-exception: block legacy auth, block untrusted locations, MFA-for-all, compliant-device gate | UC-A/UC-D CA probes (PASS) |
| [f] | Comms FROM the boundary controlled | Sharing `disabled` (no outbound CUI path), DLP blocks unregistered flows, label encryption binds content to the CUI group | UC-B external-sharing probe; UC-G label/DLP probes |
| [g] | Internal-boundary comms monitored | Directory audit (role/privilege events), Purview audit on CUI-labeled content access | UC-E privileged-audit probe |
| [h] | Internal-boundary comms controlled/protected | Non-privileged users locked out of privileged functions; CUI group gates CUI access; label encryption at rest | UC-E AC-3.1.7 probes; UC-B CUI-group probe; UC-G |

## SC.L2-3.13.6 (deny by default)

Network-plane deny-by-default is expressed at the identity and data planes: 3 blocking CA policies
deny by exception, tenant sharing `disabled` denies all outbound file flows except registered
rails (see docs/policies/external-system-connections-policy.md), DLP denies unregistered CUI
flows. Examined by UC-D "Deny network access by default" probe (PASS).

## SI.L2-3.14.6 (monitor comms for attack)

With no customer VNets there is no packet flow to log; the communications that exist (sign-ins,
mail, sharing, content access) are monitored end-to-end: Entra ID Protection risk evaluation,
Defender alerts, Sentinel analytics + health alerting, unified audit. Examined by UC-E monitoring
probes (PASS). When VNets arrive, VNet flow logs → `NTANetAnalytics` → Sentinel extend this to
packet-flow metadata (G-FW-ALT Phase 1/2).

## Forward posture

Enclave compute (G-FW-ALT Scenario B) adds per-customer spoke VNets with NSG deny-all @4096,
Private Endpoints, no public IPs, private update/package paths, and VNet flow logs; CUI enters and
leaves compute only via registered rails at the M365 layer. A shared-hub Azure Firewall Basic is
the contingent egress tier (Decision Line).
