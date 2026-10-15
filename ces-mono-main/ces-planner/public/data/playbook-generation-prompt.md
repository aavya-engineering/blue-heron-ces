# Vendor Playbook Generation Prompt

You are generating a **CES Vendor Playbook** — a YAML file that maps every CMMC implementation pattern action to specific vendor stack services, admin portal paths, automation commands, and evidence collection procedures.

## Signal Field

Every playbook entry must include a `signal` field with one of three values:

| Signal | Meaning | When to use |
|---|---|---|
| `configure` | A service in the vendor stack **directly satisfies** this action. Enable and configure the existing capability. | The vendor product has a built-in feature that maps 1:1 to the action. Configuration is straightforward via admin portal or a single cmdlet. |
| `customize` | The vendor stack **can meet** this action with additional scripting, customization, or configuration layering. | The action requires PowerShell scripts, Graph API calls, custom Conditional Access policies, Sentinel analytics rules, or combining multiple services. |
| `manual` | This action must be **solved outside the vendor stack** through manual processes, policies, documentation, or third-party tools. | Physical security, personnel procedures, training programs, policy documents, or any action where the vendor product provides templates/scaffolding only. |

## Decision Criteria

1. **Does the vendor product have a native feature for this action?**
   - Yes, single-service → `configure`
   - Yes, but requires scripting/combining services → `customize`
   - No native feature → `manual`

2. **Can the action be fully automated via the vendor's APIs?**
   - Fully automatable via portal toggle or single cmdlet → `configure`
   - Automatable via multi-step scripts or API calls → `customize`
   - Not automatable → `manual`

3. **What is the m365_service value?**
   - If `m365_service` is a real product (Entra ID, Intune, Defender, Sentinel, Purview, etc.) → `configure` or `customize`
   - If `m365_service` is "Compliance Manager" or "N/A" and the action is about documentation → `manual`

## Examples

```yaml
# configure — Entra ID directly provides lifecycle workflows
- action_id: IAM-001-02
  signal: configure
  m365_service: Entra ID
  implementation: Configure Entra ID Lifecycle Workflows for provisioning/deprovisioning

# customize — Requires custom Sentinel analytics rules
- action_id: AUD-003-04
  signal: customize
  m365_service: Microsoft Sentinel
  implementation: Create custom analytics rules for privileged account monitoring

# manual — Policy document, M365 only provides template scaffolding
- action_id: IAM-001-01
  signal: manual
  m365_service: Compliance Manager
  implementation: Use Compliance Manager CMMC template to document access control policy
```

## YAML Structure

```yaml
ces:
  artifact: vendor_playbook
  vendor: <vendor_identifier>
  version: "<semver>"
  generated_on: "<YYYY-MM-DD>"
  license_requirements:
    - <required license 1>
    - <required license 2>

playbook:
  - action_id: <PATTERN-NNN-NN>
    signal: configure | customize | manual
    m365_service: <primary vendor service>
    implementation: <human-readable guidance>
    portal_path: <admin portal navigation path>
    powershell:
      - <PowerShell command 1>
    graph_api:
      - <Graph API call>
    evidence_commands:
      - <evidence collection command>
    notes: <caveats or prerequisites>
```

## Schema Constraints

- `action_id` must match pattern `^[A-Z]{2,4}-\d{3}-\d{2}$`
- `signal` must be exactly one of: `configure`, `customize`, `manual`
- `m365_service` is required and must be non-empty
- `implementation` is required and must be non-empty
- `evidence_commands` is required and must have at least one entry
- `portal_path`, `powershell`, `graph_api`, and `notes` are optional
