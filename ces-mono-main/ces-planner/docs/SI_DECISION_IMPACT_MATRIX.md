# SI Decision Impact Matrix — Controls & Services

## 1. Overview

Strategic Intent (SI) decisions made during the SIT wizard directly determine which CMMC controls are in scope, which require alternative implementations, and which M365/Azure services are needed in the enclave. This matrix provides a single reference for VFS advisors and engineers to understand the downstream impact of each SI operational and dependency decision on control scoping, gap classification, service requirements, and SPRS scoring. Every field name, value, and control ID in this document is sourced from the CES codebase (`gapCompiler.ts`, `m365Alternatives.ts`, and the SI Question Bank YAML).

## 2. Master Impact Table

### 2.1 No Mobile Devices

**SI Field:** `si_baseline.operations.mobile_device_presence`
**SI Value:** `no_mobile_devices`
**SI Question:** S-25 — "Are mobile devices (phones, tablets) used to access CUI or in-scope systems?"
**Justification:** No mobile devices in CUI enclave per Strategic Intent baseline

| Control ID | NIST Ref | Control Title | Classification | Services No Longer Required |
|---|---|---|---|---|
| AC.L2-3.1.18 | 3.1.18 | Mobile Device Connection | `scoped_out` | Intune MDM/MAM mobile enrollment, Conditional Access mobile platform policies |
| AC.L2-3.1.19 | 3.1.19 | Encrypt CUI on Mobile Devices | `scoped_out` | Intune mobile device encryption policies, Intune compliance policies for mobile |

### 2.2 No Wireless

**SI Field:** `si_baseline.operations.wireless_posture`
**SI Value:** `no_wireless`
**SI Question:** S-26 — "Are wireless networks used within the CUI enclave or in-scope environment?"
**Justification:** No wireless networks in CUI enclave per Strategic Intent baseline

| Control ID | NIST Ref | Control Title | Classification | Services No Longer Required |
|---|---|---|---|---|
| AC.L2-3.1.16 | 3.1.16 | Wireless Access Authorization | `scoped_out` | Wireless access point management, 802.1X/WPA3-Enterprise authentication infrastructure |
| AC.L2-3.1.14 | 3.1.14 | Remote Access Routing | `scoped_out` | Managed wireless network monitoring, wireless access point inventory |

### 2.3 Removable Media Blocked

**SI Field:** `si_baseline.operations.removable_media_posture`
**SI Value:** `blocked`
**SI Question:** S-27 — "What is the removable media posture for in-scope systems?"
**Justification:** Removable media prohibited by policy and technical control per Strategic Intent baseline

| Control ID | NIST Ref | Control Title | Classification | Services No Longer Required |
|---|---|---|---|---|
| MP.L2-3.8.5 | 3.8.5 | Media Transport Protection | `scoped_out` | BitLocker To Go, removable media encryption enforcement |
| MP.L2-3.8.6 | 3.8.6 | Portable Storage Encryption | `scoped_out` | Removable storage encryption policies, USB device management |

### 2.4 No Remote Access

**SI Field:** `si_baseline.operations.remote_access_posture`
**SI Value:** `no_remote`
**SI Question:** S-28 — "Is remote access to CUI systems permitted from outside the enclave?"
**Justification:** No remote access to CUI systems per Strategic Intent baseline

| Control ID | NIST Ref | Control Title | Classification | Services No Longer Required |
|---|---|---|---|---|
| AC.L2-3.1.12 | 3.1.12 | Remote Access Session Monitoring | `scoped_out` | Azure VPN Gateway, VPN session logging, remote session monitoring tools |
| PE.L2-3.10.6 | 3.10.6 | Alternate Work Sites | `scoped_out` | Alternate work site security controls, remote workspace verification |

### 2.5 No Nonlocal Maintenance

**SI Field:** `si_baseline.operations.maintenance_posture`
**SI Value:** `no_nonlocal`
**SI Question:** S-29 — "Is nonlocal (remote) maintenance performed on in-scope systems?"
**Justification:** No nonlocal maintenance performed per Strategic Intent baseline

| Control ID | NIST Ref | Control Title | Classification | Services No Longer Required |
|---|---|---|---|---|
| MA.L2-3.7.4 | 3.7.4 | Nonlocal Maintenance Oversight | `scoped_out` | Remote administration tools, vendor remote support sessions, remote maintenance session logging |

### 2.6 M365-Only Infrastructure

**SI Field:** `si_baseline.dependencies.infrastructure_model`
**SI Value:** `m365_only`
**SI Question:** SIT-020 — "What infrastructure model is intended for the CMMC enclave?"
**Effect:** 9 controls receive `manual_alternative` classification. Each requires an assessor-approved alternative implementation using M365-native services instead of Azure infrastructure.

| Control ID | NIST Ref | Azure Approach (No Longer Required) | M365 Alternative (Replaces It) | Gap Severity |
|---|---|---|---|---|
| AU.L2-3.3.4 | 3.3.4 | Sentinel alerting on Log Analytics workspace heartbeat failure | Defender XDR custom detection rules monitoring Purview Audit log ingestion gaps + Power Automate email alerts. Alert rule: "If no Purview Audit events in 60 minutes, notify SOC mailbox." | MEDIUM |
| SC.L1-3.13.1 | 3.13.1 | NSG flow logs + Azure Firewall + Sentinel | Conditional Access policies as boundary enforcement + Defender for Cloud Apps session policies. Tenant boundary IS the security boundary. Document: "External boundary = M365 tenant edge with Conditional Access as access control point." | LOW |
| SC.L1-3.13.5 | 3.13.5 | VNet segregation with dedicated subnet | SharePoint external sharing policies + Conditional Access named locations limiting external collaboration sites to specific IP ranges. Separate SharePoint site collections for public content with restrictive DLP. | MEDIUM |
| SC.L2-3.13.6 | 3.13.6 | NSG default deny rules | Conditional Access "block all access" baseline + exception grants for trusted devices/locations/users. Intune compliance enforcing "deny non-compliant device access." | LOW |
| SC.L2-3.13.10 | 3.13.10 | Azure Key Vault with HSM-backed keys | Entra ID Certificate-Based Authentication + Microsoft Cloud PKI (G5 2026 feature) for device certificates. Customer-managed keys for SharePoint/Exchange at-rest encryption (requires G5 + compliance add-on). | HIGH |
| SI.L2-3.14.7 | 3.14.7 | Sentinel UEBA + Azure AD sign-in analytics | Entra ID Identity Protection risk-based Conditional Access + Defender for Cloud Apps anomaly detection (impossible travel, unusual file access). Purview Insider Risk Management for data exfiltration. | MEDIUM |
| AU.L2-3.3.3 | 3.3.3 | Sentinel retention policies + automated audit log review | Purview Audit Premium search with saved queries + Defender XDR Advanced Hunting scheduled queries for authentication failures, privilege escalations, DLP violations. Export to SharePoint for quarterly review. | LOW |
| IR.L2-3.6.2 | 3.6.2 | Sentinel incident tracking with auto-assignment and SLA | Defender XDR incident queue + integration with ServiceNow/Jira via Graph API for formal IR ticketing. Manual IR documentation in SharePoint IR library with Purview legal hold. | MEDIUM |
| SC.L2-3.13.2 | 3.13.2 | Azure Advisor security recommendations + Secure Score | Microsoft Secure Score for M365 + Compliance Manager CMMC template. Quarterly architecture review using Secure Score improvement actions. Document principles in System Security Plan (manual). | LOW |

### 2.7 Business Premium License

**SI Field:** `si_baseline.dependencies.license_tier`
**SI Value:** `business_premium`
**SI Question:** SIT-021 — "What license tier is intended for the M365 GCC High environment?"
**Effect:** 3 controls marked `control_not_available`. These controls require M365 features that are not available in Business Premium and require either a license upgrade to G3/G5 or a manual compensating process.

| Control ID | NIST Ref | Control Title | Classification | Missing Feature |
|---|---|---|---|---|
| AU.L2-3.3.1 | 3.3.1 | System Auditing | `control_not_available` | Purview Audit Premium (advanced audit search, long-term retention) |
| IR.L2-3.6.1 | 3.6.1 | Incident Handling | `control_not_available` | Purview Insider Risk Management (insider threat detection and investigation) |
| IR.L2-3.6.2 | 3.6.2 | Incident Tracking | `control_not_available` | Advanced eDiscovery (legal hold, case management, evidence preservation) |

### 2.8 No BYOD

**SI Field:** `si_baseline.operations.byod_posture`
**SI Value:** `not_allowed`
**SI Question:** S-13 — "What is the BYOD posture for in-scope work?"
**Effect:** Does NOT exclude any controls from scope. However, it simplifies endpoint compliance by eliminating the need for MAM (Mobile Application Management) policies, BYOD conditional access exceptions, and personal device enrollment flows. All in-scope access requires company-provided devices.

| Control ID | NIST Ref | Control Title | Classification | Effect |
|---|---|---|---|---|
| *(none excluded)* | — | — | — | Simplifies Intune enrollment (corporate-only), removes MAM container requirements, eliminates BYOD conditional access policy branches |

## 3. Services Impact Summary

| Service | Controls Requiring It | Eliminated When |
|---|---|---|
| Intune MDM/MAM | AC.L2-3.1.18, AC.L2-3.1.19, SC.L2-3.13.6 (compliance enforcement) | Mobile enrollment eliminated when `mobile_device_presence = no_mobile_devices`; MAM eliminated when `byod_posture = not_allowed`; SC.L2-3.13.6 still requires Intune for device compliance |
| Conditional Access | AC.L2-3.1.12, AC.L2-3.1.18, AC.L2-3.1.19, SC.L1-3.13.1, SC.L2-3.13.6 | Mobile platform policies eliminated when `mobile_device_presence = no_mobile_devices`; always required as core identity boundary for remaining controls |
| Azure VPN Gateway | AC.L2-3.1.12 | Eliminated when `remote_access_posture = no_remote`; also eliminated when `infrastructure_model = m365_only` |
| Azure Firewall | SC.L1-3.13.1 | Eliminated when `infrastructure_model = m365_only` (replaced by Conditional Access boundary) |
| Azure Key Vault | SC.L2-3.13.10 | Eliminated when `infrastructure_model = m365_only` (replaced by Entra ID CBA + Cloud PKI) |
| Azure Sentinel | AU.L2-3.3.3, AU.L2-3.3.4, SI.L2-3.14.7, IR.L2-3.6.2 | Eliminated when `infrastructure_model = m365_only` (replaced by Defender XDR + Purview Audit Premium) |
| Purview Audit Premium | AU.L2-3.3.1, AU.L2-3.3.3, AU.L2-3.3.4 | Feature unavailable when `license_tier = business_premium`; required for G3/G5 tiers |
| Purview Insider Risk | IR.L2-3.6.1, SI.L2-3.14.7 (M365-only alternative) | Feature unavailable when `license_tier = business_premium`; required for G3/G5 tiers |
| Defender XDR | AU.L2-3.3.4 (M365-only), AU.L2-3.3.3 (M365-only), IR.L2-3.6.2 (M365-only) | Core Defender available in all tiers; Advanced Hunting requires G3/G5 |
| Defender for Cloud Apps | SC.L1-3.13.1 (M365-only), SI.L2-3.14.7 (M365-only) | Required for M365-only infrastructure model as part of boundary enforcement and anomaly detection |
| Power Automate | AU.L2-3.3.4 (M365-only alert automation) | Only required for M365-only model audit alerting; not needed when Sentinel is deployed |
| SharePoint Online | AU.L2-3.3.3 (quarterly review export), IR.L2-3.6.2 (IR documentation), SC.L1-3.13.5 (public content separation) | Always required as core collaboration platform; scoping relevance depends on infrastructure model |
| Entra ID Identity Protection | SI.L2-3.14.7 (M365-only), AC.L2-3.1.18 (risk-based access) | Always required for identity risk detection; elevated importance in M365-only model |
| Microsoft Secure Score | SC.L2-3.13.2 (M365-only) | Only used as primary security architecture tool when `infrastructure_model = m365_only`; supplementary when Azure Advisor is available |
| Compliance Manager | SC.L2-3.13.2 (M365-only) | Used as CMMC template tracking tool; increased importance in M365-only model |

## 4. SPRS Scoring Impact

Each scope-excludable control carries an SPRS weight that is removed from the effective scoring denominator when the control is scoped out.

### 4.1 Per-Control SPRS Weights

| Control ID | NIST Ref | Control Title | SI Decision That Excludes It | SPRS Weight |
|---|---|---|---|---|
| AC.L2-3.1.12 | 3.1.12 | Remote Access Session Monitoring | `remote_access_posture = no_remote` | 5 |
| AC.L2-3.1.14 | 3.1.14 | Remote Access Routing | `wireless_posture = no_wireless` | 5 |
| AC.L2-3.1.16 | 3.1.16 | Wireless Access Authorization | `wireless_posture = no_wireless` | 1 |
| AC.L2-3.1.18 | 3.1.18 | Mobile Device Connection | `mobile_device_presence = no_mobile_devices` | 3 |
| AC.L2-3.1.19 | 3.1.19 | Encrypt CUI on Mobile Devices | `mobile_device_presence = no_mobile_devices` | 3 |
| MP.L2-3.8.5 | 3.8.5 | Media Transport Protection | `removable_media_posture = blocked` | 3 |
| MP.L2-3.8.6 | 3.8.6 | Portable Storage Encryption | `removable_media_posture = blocked` | 3 |
| PE.L2-3.10.6 | 3.10.6 | Alternate Work Sites | `remote_access_posture = no_remote` | 1 |
| MA.L2-3.7.4 | 3.7.4 | Nonlocal Maintenance Oversight | `maintenance_posture = no_nonlocal` | 3 |

**Total maximum scope reduction:** 27 points of weight removed from the effective 110-point SPRS scope.

### 4.2 Example Scenarios

| Scenario | SI Decisions | Controls Excluded | SPRS Weight Removed |
|---|---|---|---|
| **Typical SMB** (no mobile, no wireless, USB blocked) | `mobile_device_presence = no_mobile_devices`, `wireless_posture = no_wireless`, `removable_media_posture = blocked` | AC.L2-3.1.18, AC.L2-3.1.19, AC.L2-3.1.16, AC.L2-3.1.14, MP.L2-3.8.5, MP.L2-3.8.6 (6 controls) | 18 points |
| **Cloud-only org** (+ no remote access, no nonlocal maint) | All of the above + `remote_access_posture = no_remote`, `maintenance_posture = no_nonlocal` | All 9 scope-excludable controls | 27 points |

> **Note on the Typical SMB scenario:** The 6 controls yield 3+3+1+5+3+3 = 18 points (not 15), because AC.L2-3.1.14 (weight 5) is excluded by `wireless_posture = no_wireless`, not by `mobile_device_presence`. The Cloud-only org scenario adds AC.L2-3.1.12 (5), PE.L2-3.10.6 (1), and MA.L2-3.7.4 (3) for the full 27 points.

## 5. Classification Legend

Each `GapClassification` value indicates a different type of work required and has distinct implications for the advisor and the mission plan.

| Classification | Label | Meaning | Advisor Implication |
|---|---|---|---|
| `scoped_out` | Scoped Out (N/A) | Control removed from scope entirely based on SI operational decisions. Zero SPRS deduction. | No gap, no task, no plan step generated. Document the exclusion justification in the SSP. Assessor will verify the SI assertion matches the operational reality. |
| `manual_alternative` | Manual Alternative | M365 can cover the control but requires an assessor-approved alternative implementation instead of the standard Azure infrastructure approach. | Requires pre-assessment communication with the assessor. Document the alternative implementation approach and map it to assessment objectives. Higher documentation burden but lower infrastructure cost. |
| `control_not_available` | Not Available | The required M365 feature is not available in the selected license tier (Business Premium). The control cannot be satisfied without a license upgrade or a manual compensating process. | Recommend upgrading to G5 (which is paradoxically cheaper at $52/user/month vs. G3+add-ons at $56/user/month). If upgrade is not possible, document compensating controls and accept POA&M risk. |
| `configure` | Configure | The vendor stack (M365/Azure) natively supports this control. Satisfaction requires configuring existing features according to the playbook. | Lowest effort. Follow the playbook configuration steps. Evidence can typically be collected via automated export or API query. |
| `customize` | Customize | The vendor stack partially supports this control but requires custom configuration beyond defaults (custom policies, rules, or integrations). | Moderate effort. Requires engineering work beyond checkbox configuration. May involve PowerShell scripts, Graph API calls, or custom Conditional Access policies. |
| `manual` | Manual | The control requires manual process, documentation, or governance that cannot be automated through the vendor stack. | Highest ongoing effort. Requires policy documents, training records, manual attestations, or process documentation. Recurring evidence collection is manual. |
| `auto_generate` | Auto-Generated | Gap was automatically generated by the system (e.g., controls not assessed during RR that are required for the target CMMC level). | Review to confirm the gap is real. These gaps may exist because the control was not covered during the Readiness Recon assessment, not necessarily because it is unmet. |

## 6. Decision Interaction Notes

### AC.L2-3.1.16 exclusion depends on wireless, not mobile

AC.L2-3.1.16 (Wireless Access Authorization) is excluded by `wireless_posture = no_wireless`, **not** by `mobile_device_presence = no_mobile_devices`. The `gapCompiler.ts` code explicitly comments: "3.1.15 and 3.1.16 only excluded when BOTH no mobile AND no wireless (3.1.16 covers wireless access authorization for mobile devices)." In practice, the code scopes out 3.1.16 based solely on the `wireless_posture` field. Setting `mobile_device_presence = no_mobile_devices` without also setting `wireless_posture = no_wireless` will **not** exclude AC.L2-3.1.16.

### Infrastructure model and license tier classifications stack with precedence

When both `infrastructure_model = m365_only` and `license_tier = business_premium` apply to the same control, infrastructure classification takes precedence. From `gapCompiler.ts`:

```typescript
const infraClasses = classifyInfrastructureGaps(infrastructure_model, gap.requirement_id);
const tierClasses =
  infraClasses.length === 0
    ? classifyLicenseTierGaps(license_tier, gap.requirement_id)
    : [];
gap.gap_classifications = [...gap.gap_classifications, ...infraClasses, ...tierClasses];
```

This means:
- If a control has an infrastructure classification (`manual_alternative`), the license tier classification (`control_not_available`) is **not** applied, even if the control is also in `LICENSE_TIER_GAP_CONTROL_IDS`.
- IR.L2-3.6.2 appears in both `M365_ALTERNATIVES` (infrastructure gaps) and `LICENSE_TIER_GAP_CONTROL_IDS` (license tier gaps). When `infrastructure_model = m365_only`, it receives `manual_alternative` only. When `infrastructure_model = m365_azure` and `license_tier = business_premium`, it receives `control_not_available` only.

### BYOD does not directly exclude controls

Setting `byod_posture = not_allowed` does **not** trigger any scope exclusions in `buildScopeExclusions()`. It reduces the complexity of Intune enrollment and compliance policy configuration but every CMMC control that would apply with BYOD still applies without it. The benefit is operational simplification, not scope reduction.

### Scope exclusions remove controls from gap analysis entirely

Controls in the `scopeExclusions` map are filtered out at the top of the gap compilation loop (`if (scopeExclusions.has(rr.requirement_id)) continue;`). They never appear in the `GapSet.gaps` array, never generate tasks, and never appear in plan steps. They are recorded in `GapSet.scopeExclusions` for SSP documentation and assessor reference.

### M365-only controls still appear as gaps

Unlike `scoped_out` controls, `manual_alternative` controls remain in the gap set. They appear as gaps with the `manual_alternative` classification appended to their `gap_classifications` array. The advisor must address them in the mission plan with the documented M365 alternative approach. They are not removed from scope — they are reclassified to indicate the implementation approach differs from the standard Azure-based method.
