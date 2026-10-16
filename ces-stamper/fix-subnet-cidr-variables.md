# Fix: Subnet CIDR Variables Missing from Variable Resolution Pipeline

## Problem Statement

When the stamper executes or assesses networking sub-commands for tenant `vfsgov-xtra`, the assessment route fails with:

```
Unresolved manifest variables: vnetCidr. Ensure tenant manifest provides these values.
Unresolved manifest variables: mgmtSubnetCidr. Ensure tenant manifest provides these values.
Unresolved manifest variables: workloadSubnetCidr. Ensure tenant manifest provides these values.
Unresolved manifest variables: bastionSubnetCidr. Ensure tenant manifest provides these values.
Unresolved manifest variables: firewallSubnetCidr. Ensure tenant manifest provides these values.
```

This blocks 15+ sub-commands across tasks `AZ-NET-001` through `AZ-NET-005`, `AZ-NSG-004`, and dependent network resources (Firewall, Bastion, Private Endpoint), causing cascading UNSAT on controls including SC.L1-3.13.1, SC.L2-3.13.6, CM.L2-3.4.1, and 5 others.

## Root Cause Analysis

The variable pipeline has two parallel paths for loading variables into `ExecutionContext`:

1. **Execute route** — reads from the executable plan's `variables` block, which is populated during translation from the infra manifest's `stamper_variable_map`.
2. **Assess route** (`src/server/routes/assess.routes.ts`) — builds its variable map **only** from `VARIABLE_MAPPING` entries mapped to the tenant config JSON (`resources.*`). It never loads the infra manifest.

The variables `vnetCidr`, `mgmtSubnetCidr`, `workloadSubnetCidr`, `bastionSubnetCidr`, and `firewallSubnetCidr` are **not present in `VARIABLE_MAPPING`** and are **not present in the tenant config JSON** (`plan-data/vfsgov-xtra/vfsgov-xtra.json`). This means:

- The assess route cannot resolve them → assessment fails before execute ever runs
- Even if assess is skipped, the execute route won't have them either (they're not in `variables.json`)
- `vnetCidr` exists in `CESInfraVariableMapSchema` but the four subnet CIDRs do not, so Zod strips them from infra manifests even if added

The tenant config already has `vnet_name` and `nsg_name` in `resources` but has no CIDR fields at all.

## Recommended Approach

Add the 5 CIDR variables to every layer of the stack in one pass:

1. Add them to `VARIABLE_MAPPING` (the single source of truth for camelCase ↔ snake_case)
2. Add them as optional fields to `CESInfraVariableMapSchema` so Zod allows them in infra manifests
3. Add the concrete CIDR values to the tenant config JSON
4. Add input fields to the config card HTML

**Do not** modify assess route logic or execution context directly — the mapping in step 1 is sufficient; the existing VARIABLE_MAPPING loop in the assess route will pick them up automatically.

## Implementation

### File 1: `src/shared/variable-map.ts`

In the `VARIABLE_MAPPING` object, after the `vnetName: 'vnet_name'` entry (line ~26), add:

```typescript
  vnetName: 'vnet_name',
  vnetCidr: 'vnet_cidr',
  mgmtSubnetCidr: 'mgmt_subnet_cidr',
  workloadSubnetCidr: 'workload_subnet_cidr',
  bastionSubnetCidr: 'bastion_subnet_cidr',
  firewallSubnetCidr: 'firewall_subnet_cidr',
  nsgName: 'nsg_name',
```

(Replace the existing `vnetName` and `nsgName` lines with the block above — inserting 5 new lines between them.)

### File 2: `src/types/ces-artifacts.types.ts`

In `CESInfraVariableMapSchema` (around line 454), after the `vnetCidr` field, add 4 optional subnet CIDR fields:

```typescript
export const CESInfraVariableMapSchema = z.object({
  subscriptionId: z.string().min(1),
  resourceGroup: z.string().min(1),
  location: z.string().min(1),
  lawWorkspaceName: z.string().min(1),
  storageAccountName: z.string().min(1),
  keyVaultName: z.string().min(1),
  cmkKeyName: z.string().min(1),
  vnetName: z.string().min(1),
  vnetCidr: z.string().min(1),
  mgmtSubnetCidr: z.string().optional(),
  workloadSubnetCidr: z.string().optional(),
  bastionSubnetCidr: z.string().optional(),
  firewallSubnetCidr: z.string().optional(),
  subnetPeName: z.string().min(1),
  subnetPeCidr: z.string().min(1),
  nsgPeName: z.string().min(1),
  automationAccountName: z.string().min(1),
  eoAppDisplayName: z.string().min(1),
});
```

### File 3: `plan-data/vfsgov-xtra/vfsgov-xtra.json`

In the `resources` block, after `"vnet_name": "vfsgov-vnet-eo"`, add 5 CIDR fields. Use values consistent with the existing `approved_ip_range` of `10.0.0.0/20` and the hardcoded `10.0.0.0/16` already present in the AZ-NET-001 command body:

```json
    "vnet_name": "vfsgov-vnet-eo",
    "vnet_cidr": "10.0.0.0/16",
    "mgmt_subnet_cidr": "10.0.1.0/26",
    "workload_subnet_cidr": "10.0.2.0/24",
    "bastion_subnet_cidr": "10.0.3.0/26",
    "firewall_subnet_cidr": "10.0.4.0/26",
    "nsg_name": "vfsgov-nsg-pe",
```

> **Note:** These CIDR values are suitable defaults for a /16 supernet. Confirm with the tenant operator that the subnets don't conflict with any existing peered networks before running the plan.

### File 4: `public/config-variables.html`

After the `vnet_name` field (line 445), add 5 new fields. Keep them together as a logical group before `nsg_name`:

```html
        <div class="config-field"><label>vnet_name</label><input type="text" data-path="resources.vnet_name" /></div>
        <div class="config-field"><label>vnet_cidr</label><input type="text" data-path="resources.vnet_cidr" placeholder="10.0.0.0/16" /></div>
        <div class="config-field"><label>mgmt_subnet_cidr</label><input type="text" data-path="resources.mgmt_subnet_cidr" placeholder="10.0.1.0/26" /></div>
        <div class="config-field"><label>workload_subnet_cidr</label><input type="text" data-path="resources.workload_subnet_cidr" placeholder="10.0.2.0/24" /></div>
        <div class="config-field"><label>bastion_subnet_cidr</label><input type="text" data-path="resources.bastion_subnet_cidr" placeholder="10.0.3.0/26" /></div>
        <div class="config-field"><label>firewall_subnet_cidr</label><input type="text" data-path="resources.firewall_subnet_cidr" placeholder="10.0.4.0/26" /></div>
        <div class="config-field"><label>nsg_name</label><input type="text" data-path="resources.nsg_name" /></div>
```

(Replace just the `vnet_name` line and the `nsg_name` line with the full block above.)

## Verification

After making all four changes:

1. Run `npm run build` — confirm no TypeScript errors
2. Run `npm test` — the existing `infraManifestGenerator.test.ts` tests reference `vnetCidr` and should still pass; confirm no regressions
3. Open the config card UI and confirm the 5 new CIDR fields appear and save correctly
4. Re-run the stamper against `vfsgov-xtra` — assess should no longer report "Unresolved manifest variables" for any of the 5 CIDR keys

## Runtime-Capture Variables (Second Class of Failures)

The variables `breakGlassUserId`, `cuiGroupId`, `operatorUserId`, and `phishingResistantStrengthId` are a separate problem with a different root cause and different fix strategy.

### How they work

These are produced by **capture commands** — registry entries that run a `get_command`, extract an ID from the JSON output via `json_path`, and write it into the plan's variable store for downstream steps to consume. They are not pre-configured; they are discovered at runtime.

| Variable | Produced by | Registry file | Layer |
|---|---|---|---|
| `breakGlassUserId` | `AZ-ID-001` — `Get-MgUser` filtered on `{breakGlassUPN}` | `infra-cmmc-l2-commands.registry.json` | 0, seq 10 |
| `operatorUserId` | `AZ-ID-002` — `Get-MgUser` filtered on `{operatorUPN}` | `infra-cmmc-l2-commands.registry.json` | 0, seq 11 |
| `cuiGroupId` | `AC.L2-3.1.1.group-create` — `Get-MgGroup` / `New-MgGroup` on `{cuiGroupName}` | `cmmc-l2-commands.registry.json` | 1, seq 0 |
| `phishingResistantStrengthId` | `IA.L2-3.5.4.auth-strength` — `Get-MgPolicyAuthenticationStrengthPolicy` or `POST` to create | `cmmc-l2-commands.registry.json` | 3, seq 10 |

### Why they failed in this run

The capture commands require specific Azure AD objects to exist. The plan captures the ID of whatever exists, or creates it if missing. The failures shown in the report occurred because **the consuming commands (layers 5+) ran before layers 0–3 captured these values**, suggesting the plan was triggered at a mid-point or the early tasks failed silently.

Key `on_failure` behavior:
- `AZ-ID-001` and `AZ-ID-002`: `on_failure: warn_continue` — they fail silently, leaving the variable unset, with no obvious error until a downstream command can't resolve it
- `AC.L2-3.1.1.group-create` and `IA.L2-3.5.4.auth-strength`: `on_failure: abort_step` — they halt the step but the variable still never reaches `variables.json` for the assess route

### Fix: No code changes needed, but two failure modes exist

**Mode A — Execution order issue:** The plan was resumed mid-run, skipping layer 0–3 tasks. Fix: run the full plan from layer 0 in order. The capture commands will run, populate the variables, and downstream steps will resolve correctly.

**Mode B — Azure AD objects don't exist:** If `breakglass@vfsgov.us` or `operator@vfsgov.us` don't exist in the tenant, `Get-MgUser` returns empty and the capture writes nothing. Verify:

```powershell
# Run these manually to confirm the objects exist before executing the plan
Get-MgUser -Filter "userPrincipalName eq 'breakglass@vfsgov.us'" | Select-Object Id,DisplayName
Get-MgUser -Filter "userPrincipalName eq 'operator@vfsgov.us'" | Select-Object Id,DisplayName
Get-MgGroup -Filter "displayName eq 'cui-users-sg'" | Select-Object Id,DisplayName
Get-MgPolicyAuthenticationStrengthPolicy -All | Where-Object DisplayName -like 'CMMC-Phishing*'
```

If any return empty, the object needs to be created first (manually or via a prior bootstrap task). The UPN values come from `vfsgov-xtra.json` → `resources.breakglass_upn` and `resources.operator_upn`.

### Optional improvement: surface `warn_continue` failures

`AZ-ID-001` and `AZ-ID-002` use `on_failure: warn_continue`, which means a missing user produces no visible error — the variable is simply never set, and the failure only surfaces layers later with an unhelpful "unresolved runtime variable" message. Consider changing these to `on_failure: abort_step` so the root cause is surfaced immediately. This is a registry edit only:

In `src/registry/infra-cmmc-l2-commands.registry.json`, change both `AZ-ID-001` and `AZ-ID-002`:

```json
"on_failure": "abort_step"
```

This does not affect correctness, only error clarity.
