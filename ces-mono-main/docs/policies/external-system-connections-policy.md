# External System Connections Policy — vfsgov (Valor Forge Solutions)

**Policy ID:** POL-AC-3.1.20 · **Effective:** 2026-07-04 · **Review:** annually or on rail change
**Satisfies:** AC.L1-3.1.20[b][d] (use of external systems limited; connections verified), SC.L2-3.13.6 (allow-by-exception documentation) · **SSP ref:** SSP AC-3.1.20 — external-connection policy (this document)

## 1. Purpose

Connections between the vfsgov hardened tenant and any external information system — prime
contractors, government customers, subcontractors, or service providers — are permitted only
through an approved, enumerated communications rail. CUI never transits an unapproved channel.

## 2. Authorized rail types (in order of preference)

| # | Rail | Mechanism | Standing conditions |
|---|------|-----------|---------------------|
| 0 | **Enclave seat** | External collaborator is provisioned an identity (B2B member or licensed seat) and works on CUI *inside* the tenant via VDI/browser | CUI never leaves the boundary; collaborator subject to all tenant controls (MFA, CA, DLP, labels) |
| 1 | **GCC High B2B collaboration (you-host)** | Scoped SharePoint/Teams site; partner tenant named in cross-tenant access policy; sensitivity-label encryption; block-download session policy for view-only CUI | Tenant-wide sharing remains `disabled`; access is per-site, per-partner-domain |
| 2 | **Government-operated portal** | DoD SAFE, PIEE, or program-mandated system, accessed from the VDI session | CUI custody transfers at the government boundary |
| 3 | **Encrypted email** | Enforced-TLS transport rules + CUI sensitivity-label (RMS) or OME encryption | Routine correspondence only |

Network-layer transfer (SFTP/MFT) is **prohibited** unless contractually mandated by a prime,
approved per §3, and constrained to static partner IPs (NSG-pinnable) — otherwise it requires the
G-FW-ALT Decision Line review before adoption.

## 3. Approval and the rail registry

Every rail instance requires, before first CUI flow:

1. A named business justification and contract/program reference.
2. Verification of the partner endpoint (tenant ID for B2B; system authorization for portals).
3. Approval by the ISSM/AO delegate (recorded requestor + approver, two-person for new rail types).
4. A row in the **rail registry** (partner, channel, mechanism, authorization, DLP rule id,
   evidence pointer) — the registry is the authoritative list of allow-by-exceptions cited by the SSP.

## 4. Enforcement (technical)

Cross-tenant access policy restricted to named partners; tenant sharing `disabled`; guest invites
restricted to admins/guest-inviters; Purview DLP allows CUI flow only via registered rails and logs
all rail traffic; CUI sensitivity label encrypts content to authorized identities. These controls
are examined live by the tenant test suite (UC-B external-connection probe, UC-D cross-tenant and
guest probes, UC-G DLP probes).

## 5. Prohibitions

Personal accounts, consumer file-sharing, unregistered SaaS, and any CUI flow outside a registered
rail. Violations are security incidents under the incident-response plan (IR-3.6.2).
