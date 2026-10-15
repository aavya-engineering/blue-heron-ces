# Session-Controlled BYOD Narrative Specification

## Architecture Detection Logic

```
IF evidence.architecture_declared == "session_controlled_byod"
  AND evidence.directive IN ("validate", "document-prohibition", "implement")
THEN
  architecture = "session_controlled_byod"
  trigger BYOD narrative generation
ELSE
  architecture = null
  fall through to existing narrative logic
```

Detection is performed by `ArchitectureDetector.isByodArchitecture()` which checks both conditions.

## Dependency Table

The mechanism dependency table (`src/shared/data/mechanism-dependency-table.json`) maps 11 CMMC controls to 4 enforcement mechanisms:

| Control ID | CA App Control | CA Non-Browser Block | DLP | Sensitivity Labels |
|---|---|---|---|---|
| AC.L2-3.1.18 | required | required | - | - |
| AC.L2-3.1.19 | required | required | - | recommended |
| AC.L2-3.1.21 | required | required | - | - |
| CM.L2-3.4.6 | required | required | - | - |
| MP.L2-3.8.5 | required | - | - | - |
| MP.L2-3.8.6 | required | - | - | required |
| MP.L2-3.8.7 | required | required | - | - |
| SC.L2-3.13.16 | required | - | - | required |
| AC.L1-3.1.22 | - | - | required | - |
| MP.L2-3.8.8 | - | - | required | - |
| MP.L2-3.8.9 | - | - | required | recommended |

- **required**: mechanism must be active for control to be MET
- **recommended**: mechanism included in narrative but does not block MET determination
- **-** (null): mechanism not relevant to this control

## Template Variable Reference

| Variable | Type | Source | Example |
|---|---|---|---|
| `{sectionNumber}` | string | caller parameter (default "2.3") | "2.3" |
| `{tenant_variant}` | string | evidence metadata | "GCC High" |
| `{azure_mention}` | string | computed from azure_resources_present | " with a supporting Azure Government subscription for Sentinel" or "" |
| `{ca_app_control_policies_summary}` | string | evidence metadata | "The policy 'BYOD-Session-Controls' applies..." |
| `{non_browser_block_policy_summary}` | string | evidence metadata | "The policy 'Block-Native-Clients-BYOD' requires..." |
| `{dlp_policies_summary}` | string | evidence metadata | "Policies 'CUI-Egress-Block-Email' cover..." |
| `{sensitivity_labels_summary}` | string | evidence metadata | "Label 'CUI-Restricted' applies encryption..." |
| `{verification_date}` | string | evidence metadata (ISO formatted) | "April 15, 2026" |
| `{gap_disclosure}` | string | computed from mechanism_status | Paragraph listing failing mechanisms, or "" |

## SPRS Validation Rules

`SprsValidator.validateMechanismConsistency()` performs cross-validation:

```
IF enforcement_verified == true
  FOR EACH mechanism WHERE dependency_table[control_id][mechanism] == "required"
    IF mechanism_status[mechanism] == false
      THEN validation FAILS with submission-blocking error
```

This check prevents the case where Stamper reports enforcement as verified but the actual mechanism status shows a required mechanism is inactive. This mismatch indicates a Stamper bug or evidence tampering and violates FCA requirements.

## Sample Outputs

### Section 2 All Passing

```
2.3 Session-Controlled BYOD Architecture

The GCC High tenant operates a session-controlled Bring Your Own Device (BYOD) architecture.
Under this model, personally owned devices access CUI exclusively through browser-based sessions
governed by Conditional Access application-enforced restrictions. No CUI is stored, cached, or
processed on the endpoint device itself; all data interaction occurs within the cloud session boundary.

Four enforcement mechanisms underpin this architecture:

1. Conditional Access App Control: The policy 'BYOD-Session-Controls' applies session controls
   to 'Office 365 Exchange Online, Office 365 SharePoint Online' for the 'All Users' population.
2. Non-Browser Client Block: The policy 'Block-Native-Clients-BYOD' requires compliant or
   hybrid-joined devices for client app types 'mobileAppsAndDesktopClients' and 'exchangeActiveSync'.
3. Data Loss Prevention: Policies 'CUI-Egress-Block-Email', 'CUI-Egress-Block-SharePoint' cover
   'Exchange Online, SharePoint Online, OneDrive, Teams' with action 'block and notify'.
4. Sensitivity Labels: Label 'CUI-Restricted' applies encryption with rights restricted to
   'internal users only' and is auto-applied based on 'U.S. SSN, ITAR-controlled technical data'.

Enforcement was verified active as of April 15, 2026.

Organizations that do not issue managed endpoints to all CUI-handling personnel may opt out of
device-management controls (e.g., MDM enrollment, Intune compliance) when the session-controlled
BYOD architecture provides equivalent or superior data protection through the four mechanisms
listed above.
```

### Section 2 DLP Gap

Same as above, with this appended:

```
Gap Disclosure: The following enforcement mechanisms required by the session-controlled BYOD
architecture are not yet active: Data Loss Prevention. DLP policies not yet deployed to Exchange
Online. Planned deployment date: 2026-05-30. See POAM-2026-003 in the Plan of Action and
Milestones for remediation timeline.
```

### SC.L2-3.13.16 Passing

```
This requirement is satisfied under the session-controlled BYOD architecture described in
Section 2.3. Conditional Access App Control is active and Sensitivity Labels is active.
Enforcement was verified active as of April 15, 2026. The control is assessed as MET based
on the enforcement status of all required mechanisms for SC.L2-3.13.16.
```

### AC.L2-3.1.18 Mechanism 2 Gap (CA Non-Browser Block inactive)

```
This requirement is partially addressed under the session-controlled BYOD architecture described
in Section 2.3. Conditional Access App Control is active and Non-Browser Client Block is not active.
However, the following required mechanisms are not yet active: Non-Browser Client Block.
This control is assessed as NOT MET pending remediation. See POAM-2026-003 in the Plan of Action
and Milestones.
```

### AC.L2-3.1.16 Wireless

```
Wireless access to CUI within the GCC High tenant is protected through transport-layer encryption
(TLS 1.2+) enforced at the cloud service boundary. The session-controlled BYOD architecture
described in Section 2.3 ensures that all wireless sessions traverse encrypted channels before
reaching CUI-bearing workloads. No CUI is transmitted over unencrypted wireless links.
Conditional Access policies require compliant session parameters regardless of the wireless
network used by the endpoint device. Enforcement was verified active as of April 15, 2026.
```
