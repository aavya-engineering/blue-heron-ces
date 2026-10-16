# EvidenceOps Deployment — Issues Log & Lessons Learned
**Session date:** 2026-03-08  
**Audience:** Future Claude sessions regenerating the EO Execution Plan; Stamper engineering team  
**Purpose:** Prevent recurrence of every issue encountered during Day-1 EO infrastructure deployment  

---

## How to Use This Document

For Claude regenerating the execution plan: treat every item in this document as a hard constraint. Do not generate the original command — generate the fixed command. Do not generate Bash — generate PowerShell. Do not assume GCC High behaves like commercial Azure — it doesn't.

For Stamper engineers: every issue below represents either a gap in Stamper's output (wrong syntax, wrong region, wrong resource name) or an Azure API behavior that Stamper must account for when generating deployment scripts.

---

## Issue 1 — Bash Syntax Generated for a PowerShell Environment

**What happened:** The original execution plan document was written with Bash shell syntax throughout — `for x in ...; do ... done` loops, `$()` subshell substitution, `| tee` piping, `echo`, and `\` line continuation. The operator was running PowerShell on Windows. Every loop and multi-line command failed immediately.

**Root cause:** The plan assumed a Linux/Bash environment. GCC High Cloud Shell defaults to PowerShell on Windows for many operators. No shell was specified in the document.

**Fix applied:** Rebuilt the entire document with PowerShell syntax.

**What to do next time:**
- Always ask the operator what shell they are running before generating any commands.
- Default to PowerShell if unknown — it runs on both Windows and Linux (pwsh).
- Never generate Bash-only constructs without explicitly confirming the shell.

**PowerShell equivalents to always use:**

| Bash | PowerShell |
|---|---|
| `for x in a b c; do ... done` | `@("a","b","c") \| ForEach-Object { ... }` |
| `for x in a b c; do ... done` (simple) | `foreach ($x in @("a","b","c")) { ... }` |
| `VAR=$(az ... -o tsv)` | `$VAR = az ... -o tsv` |
| `\` line continuation | `` ` `` backtick |
| `\| tee file` | `\| Tee-Object -FilePath file` |
| `\| tee -a file` | `\| Tee-Object -Append -FilePath file` |
| `echo "text"` | `Write-Host "text"` |
| `mkdir -p dir` | `New-Item -ItemType Directory -Force dir` |
| `nslookup` | `Resolve-DnsName` |
| `sha256sum file` | `(Get-FileHash file -Algorithm SHA256).Hash` |
| `&&` chaining | separate lines or `;` |
| `"string with \"quotes\""` in --args | `'string with "quotes"'` (single quotes) |

**Additional PowerShell gotchas:**
- PowerShell cannot pipe a `foreach` loop: `foreach (...) { ... } \| Tee-Object` fails with "empty pipe element". Run the loop without the pipe and use `Tee-Object` inside the loop body instead.
- JSON arguments to `az` CLI must use single-quoted strings in PowerShell: `'{"key":"value"}'` not `"{\"key\":\"value\"}"`. The backslash-escape approach fails because PowerShell processes the escapes before passing to az.
- `$true` and `$false` are PowerShell booleans. In az CLI arguments use the string `true`/`false` or pass as JSON.

---

## Issue 2 — Wrong Azure Region (usgovtexas vs usgovvirginia)

**What happened:** The original execution plan specified `usgovtexas` as the deployment region throughout. Microsoft Sentinel is not available in `usgovtexas` — only `usgovvirginia` and `usgovarizona`. This was discovered at Step 13 when the Sentinel onboarding call returned a "location not supported" error. All resources deployed up to that point (resource group, LAW) had to be deleted and recreated in `usgovvirginia`.

**Root cause:** Plan was authored without verifying Sentinel's GCC High regional availability. `usgovtexas` is the paired disaster recovery region for `usgovvirginia`, not a primary deployment target.

**Fix applied:** Deleted LAW, removed RG lock, deleted RG, recreated everything in `usgovvirginia`. Steps 9–12 were repeated.

**What to do next time:**
- **Always use `usgovvirginia` as the primary region for all EO resources.** It has the broadest service availability in GCC High.
- `usgovtexas` is DR only. Do not deploy primary workloads there.
- `usgovarizona` is an acceptable alternative for Sentinel but has less service coverage overall.
- Before specifying any region in a plan, verify the target services are available there using: `az provider show --namespace Microsoft.SecurityInsights --query "resourceTypes[?resourceType=='workspaces'].locations"`

**Stamper note:** Stamper must default all GCC High deployments to `usgovvirginia` unless the operator explicitly overrides with a verified justification.

---

## Issue 3 — Microsoft Sentinel CLI Extension Too Old

**What happened:** `az sentinel workspace onboard` failed with "misspelled or not recognized." Installing the `sentinel` extension revealed version `0.1.2` was already installed — far too old to have the `onboard` subcommand. Updating to preview also failed silently.

**Root cause:** The `az sentinel` extension in GCC High Cloud Shell is severely outdated. The `onboard` command does not exist in the installed version.

**Fix applied:** Used `az rest --method PUT` directly against the ARM API endpoint.

**What to do next time:**
- Never use `az sentinel workspace onboard` — use the REST call directly:
```powershell
az rest --method PUT `
  --url "https://management.usgovcloudapi.net/subscriptions/{SUB}/resourceGroups/{RG}/providers/Microsoft.OperationalInsights/workspaces/{LAW}/providers/Microsoft.SecurityInsights/onboardingStates/default?api-version=2023-11-01" `
  --body '{}'
```
- Register `Microsoft.OperationsManagement` provider before attempting Sentinel onboarding — it is not in the standard provider list and Sentinel requires it.
- Similarly, `az sentinel workspace show` does not work — use `az rest --method GET` against the same URL.

**Stamper note:** Stamper should never emit `az sentinel` CLI commands. Use ARM REST calls for all Sentinel operations.

---

## Issue 4 — Microsoft.OperationsManagement Provider Not Registered

**What happened:** Sentinel onboarding failed with `MissingSubscriptionRegistration` for `Microsoft.OperationsManagement` even after the standard provider registration step (Step 2). This provider was not in the original registration list.

**Root cause:** `Microsoft.OperationsManagement` is a Sentinel dependency that is not obvious from the service name. It was omitted from the Step 2 provider list.

**Fix applied:** Ran `az provider register --namespace Microsoft.OperationsManagement` separately and retried.

**What to do next time:**
- Add `Microsoft.OperationsManagement` to the Step 2 provider registration list.
- Updated complete provider list for GCC High EO deployment:
  - Microsoft.OperationalInsights
  - Microsoft.SecurityInsights
  - Microsoft.Security
  - Microsoft.Automation
  - Microsoft.KeyVault
  - Microsoft.Storage
  - Microsoft.Network
  - Microsoft.Compute
  - microsoft.insights
  - Microsoft.AlertsManagement
  - **Microsoft.OperationsManagement** ← add this

---

## Issue 5 — Graph API Scope Insufficient for Security Defaults and CA Policies

**What happened:** `az rest --method PATCH` against the Graph API to disable Security Defaults returned `AccessDenied: required scopes are missing in the token`. The same error occurred when attempting to create Conditional Access policies via CLI. Re-authenticating with `az login` did not resolve it — the Azure CLI requests ARM scopes by default and does not request `Policy.ReadWrite.ConditionalAccess` or equivalent Graph scopes.

**Root cause:** The Azure CLI acquires tokens for ARM (`management.usgovcloudapi.net`) but not for Graph API policy endpoints. These are separate OAuth audiences and the CLI has no mechanism to request Graph-specific scopes interactively.

**Fix applied:** Security Defaults were disabled manually via the Entra portal. CA policies were deferred and remain pending.

**What to do next time:**
- Do not attempt to disable Security Defaults or create CA policies via `az rest` against Graph. It will always fail with scope errors.
- For Security Defaults: use Entra portal → Identity → Overview → Properties → Manage security defaults.
- For CA policies: use Entra portal → Protection → Conditional Access → New policy.
- Alternatively, use the Microsoft Graph PowerShell SDK (`Connect-MgGraph -Scopes "Policy.ReadWrite.ConditionalAccess"`) which handles Graph scopes correctly.
- Document these steps as portal-only in the execution plan with explicit screenshots required as evidence.

**Stamper note:** Any Stamper-generated step that calls `graph.microsoft.us` policy endpoints via `az rest` will fail. These must be emitted as portal instructions, not CLI commands.

---

## Issue 6 — `--enable-soft-delete` Flag Removed from az keyvault create

**What happened:** `az keyvault create` failed with `unrecognized arguments: --enable-soft-delete true --soft-delete-retention-days 90`.

**Root cause:** Microsoft made soft delete permanent and always-on for Key Vaults. The flags to control it were removed from the CLI. Soft delete at 90 days is now the default and cannot be disabled.

**Fix applied:** Removed both flags from the command. Verified the output confirmed `"enableSoftDelete": true` and `"softDeleteRetentionInDays": 90` without specifying them.

**What to do next time:**
- Remove `--enable-soft-delete` and `--soft-delete-retention-days` from `az keyvault create`.
- Simply omit them — soft delete is always on at 90 days.
- Keep `--enable-purge-protection true` — this is still a required explicit flag.

---

## Issue 7 — KeyVaults Is Not a Valid Defender for Cloud Plan Name

**What happened:** `az security pricing create --name KeyVaults` failed with `InvalidResourceName`. The error message listed the valid plan names.

**Root cause:** Microsoft consolidated Key Vault protection into the `CloudPosture` plan. The `KeyVaults` plan name no longer exists.

**Fix applied:** Used `CloudPosture` instead.

**What to do next time:**
- The correct Defender for Cloud plan names for a GCC High EO deployment are:
  - `VirtualMachines`
  - `StorageAccounts`
  - `CloudPosture` ← replaces KeyVaults
  - `Arm`
- Do not use `KeyVaults` — it will fail.
- If in doubt, run `az security pricing list` first to see all valid plan names in the target subscription.

---

## Issue 8 — Storage Account Public Network Access Blocked Container Creation

**What happened:** Running `az storage container create` returned what appeared to be a success message ("Created: audit-logs") but was actually just the `Write-Host` echo — the actual Azure API call had silently failed due to network rules. When WORM policies were applied, the containers did not exist and the commands failed with "container does not exist."

**Root cause:** The storage account was created with `--public-network-access Disabled`. The CLI was running outside the VNet (no private endpoint access from the operator's machine). The `--account-key` auth method still attempted a data plane call that was blocked. The network warning was printed but `Write-Host` ran regardless, making it look like success.

**Fix applied:** Added the operator's public IP to the storage account network rules, enabled public network access temporarily, recreated the containers, applied WORM policies, then removed the IP rule and disabled public access again.

**What to do next time:**
- Never assume a storage data plane operation succeeded just because the loop continued. Check the actual JSON output — a real success returns `{"created": true}`.
- The correct sequence for bootstrapping a storage account with public access disabled:
  1. Create the storage account with `--public-network-access Disabled`
  2. Get operator IP: `(Invoke-WebRequest -Uri "https://api.ipify.org").Content`
  3. Add IP rule: `az storage account network-rule add --ip-address {IP}`
  4. Enable public access: `az storage account update --public-network-access Enabled`
  5. Create containers and apply WORM policies
  6. Disable public access: `az storage account update --public-network-access Disabled`
  7. Remove IP rule: `az storage account network-rule remove --ip-address {IP}`
- Alternatively, deploy the private endpoint first (Steps 21–24) before creating containers, then use `--auth-mode login` which routes through ARM and is not blocked by data plane network rules.

**Stamper note:** Stamper must sequence storage container creation and WORM locking AFTER private endpoint deployment, or include the temporary IP allowance pattern above.

---

## Issue 9 — PowerShell foreach Loop Cannot Be Piped to Tee-Object

**What happened:** `foreach ($C in @(...)) { ... } | Tee-Object -FilePath file` failed with `An empty pipe element is not allowed`.

**Root cause:** In PowerShell, `foreach` is a statement, not a cmdlet. Statements cannot be piped. Only cmdlets and functions produce pipeline output.

**Fix applied:** Removed the pipe and ran the loop without capturing to a single file. Used `Tee-Object` inside the loop body where needed.

**What to do next time:**
- Never pipe a `foreach` statement in PowerShell.
- If output capture is needed across a loop, use one of:
  - `Tee-Object` inside each iteration: `az ... | Tee-Object -Append -FilePath file`
  - `ForEach-Object` (the cmdlet version) which can be piped: `@(...) | ForEach-Object { az ... } | Tee-Object`
  - Redirect all output at the end: wrap in `& { foreach ... }` script block

---

## Issue 10 — JSON Arguments with Escaped Quotes Fail in PowerShell

**What happened:** `az monitor diagnostic-settings create --logs "[{\"category\":\"AuditEvent\",\"enabled\":true}]"` failed with `Failed to parse '--logs' argument: Shorthand Syntax Error`.

**Root cause:** PowerShell processes backslash escapes in double-quoted strings before passing them to the CLI. By the time `az` receives the argument, the JSON is malformed.

**Fix applied:** Used single-quoted JSON strings: `--logs '[{"category":"AuditEvent","enabled":true}]'`

**What to do next time:**
- All JSON arguments in PowerShell must use single quotes: `'{"key":"value"}'`
- Never use `\"` inside double-quoted strings for JSON arguments to az CLI.
- This applies to `--logs`, `--metrics`, `--body`, `--properties`, and any other parameter that accepts JSON.

---

## Issue 11 — az monitor diagnostic-settings create Fails for Subscription Scope

**What happened:** `az monitor diagnostic-settings create --resource /subscriptions/{ID}` failed with `KeyError: 'resource_group'`. The CLI parser expects a resource group in the resource ID and cannot handle subscription-level resources.

**Root cause:** The `az monitor diagnostic-settings create` command requires a resource ID that contains a resource group. Subscription-level resources (like the Activity Log) do not have a resource group in their ID, so the parser throws a KeyError.

**Fix applied:** Used the separate `az monitor diagnostic-settings subscription create` command which is purpose-built for subscription-scope diagnostic settings.

**What to do next time:**
- For subscription activity log diagnostic settings, always use:
```powershell
az monitor diagnostic-settings subscription create `
  --name "{name}" `
  --subscription {SUB_ID} `
  --workspace {LAW_ID} `
  --logs '[{"category":"Administrative","enabled":true},...]'
```
- Never use `az monitor diagnostic-settings create` for subscription-scope resources.

---

## Issue 12 — Automation Account --assign-identity Flag Not Supported

**What happened:** `az automation account create --assign-identity "[system]"` failed with `unrecognized arguments: --assign-identity [system]`. The automation extension does not support this flag.

**Root cause:** The `az automation` extension is experimental and incomplete. The `--assign-identity` flag available in other resource types (storage, VMs) was not implemented in this extension.

**Fix applied:** Created the account without the identity flag, then used `az rest --method PATCH` to assign the system-assigned managed identity post-creation.

**What to do next time:**
- Create the Automation Account without `--assign-identity`.
- Immediately follow with:
```powershell
az rest --method PATCH `
  --url "https://management.usgovcloudapi.net/subscriptions/{SUB}/resourceGroups/{RG}/providers/Microsoft.Automation/automationAccounts/{AA_NAME}?api-version=2021-06-22" `
  --body '{"identity": {"type": "SystemAssigned"}}'
```
- Then retrieve the MI principal ID:
```powershell
$AA_MI_ID = az automation account show `
  --name {AA_NAME} --resource-group {RG} `
  --query identity.principalId -o tsv
```

**Stamper note:** Stamper must not emit `--assign-identity` for Automation Account creation. Use the PATCH pattern above.

---

## Issue 13 — az Diagnostic Settings Retention Policy No Longer Accepted

**What happened:** Setting `retentionPolicy` in the `--logs` JSON body for `az monitor diagnostic-settings create` (Entra diagnostic settings via `az rest`) returned `BadRequest: Diagnostic settings does not support retention for new diagnostic settings`.

**Root cause:** Microsoft removed per-diagnostic-setting retention configuration. Retention is now controlled at the Log Analytics Workspace level only.

**Fix applied:** Removed all `retentionPolicy` objects from the logs array. Retention is handled by the 90-day setting on the LAW itself.

**What to do next time:**
- Do not include `retentionPolicy` in diagnostic settings log configurations.
- Set retention at the LAW level using `--retention-time 90` on workspace creation.
- The correct log entry format is simply: `{"category":"AuditLogs","enabled":true}`

---

## Issue 14 — CMK Storage Encryption Requires Separate Steps

**What happened:** The original plan attempted to pass `--encryption-key-source`, `--encryption-key-vault`, and `--encryption-key-name` at storage account creation time. This would have failed because the storage account's managed identity did not yet exist and therefore had no permission to access the Key Vault.

**Root cause:** Chicken-and-egg: storage account needs a managed identity to access KV, but the identity is created when the storage account is created. The KV RBAC assignment for the identity cannot be made until the identity exists. Storage cannot use CMK until the RBAC assignment exists.

**Fix applied:** Correct three-step sequence:
1. Create storage account without CMK flags
2. Assign system identity: `az storage account update --assign-identity`
3. Grant MI the `Key Vault Crypto Service Encryption User` role on KV
4. Update storage account to use CMK: `az storage account update --encryption-key-source Microsoft.Keyvault ...`

**What to do next time:**
- Always deploy storage CMK in four steps as above. Never attempt to set CMK at creation time.
- The RBAC assignment for the storage MI must propagate before the CMK update — wait 30–60 seconds between the role assignment and the encryption update if hitting permission errors.

---

## Issue 15 — Key Vault Requires Temporary Public Access for Key Creation

**What happened:** Key Vault was deployed with `--public-network-access Disabled`. Before the private endpoint existed, there was no way to create keys in it from outside the VNet. The private endpoint for KV had to be created first (Step 23), but the key was needed for storage encryption (Step 18–19) before that.

**Root cause:** Circular dependency: storage needs CMK key → key lives in KV → KV is private → PE not yet deployed → can't reach KV.

**Fix applied:** Temporarily re-enabled public access on KV, created the key, then disabled public access again. Also assigned `Key Vault Administrator` role to `admin@vfsgov.us` before key creation since RBAC auth was enabled.

**What to do next time:**
- Reorder the deployment sequence:
  1. Deploy KV with public access temporarily enabled
  2. Assign Key Vault Administrator to deploying account
  3. Create CMK key
  4. Deploy storage account + assign MI + grant KV RBAC + link CMK
  5. Deploy VNet, DNS zones, private endpoints
  6. Disable KV public access
- Or: deploy PE for KV before creating the key and accessing KV from within the VNet.
- Always assign `Key Vault Administrator` to the deploying account before attempting key operations when RBAC auth is enabled. Ownership of the vault does not grant data plane access under RBAC mode.

---

## Issue 16 — WORM Lock Appeared to Succeed on Non-Existent Containers

**What happened:** The first WORM lock attempt ran against containers that didn't actually exist (because the container creation had silently failed due to network rules — see Issue 8). The immutability policy create command also failed, but `Write-Host "LOCKED: $CONTAINER"` ran anyway because it was not inside the same command chain. The output looked like success.

**Root cause:** PowerShell `foreach` loops do not short-circuit on command failure unless `$ErrorActionPreference = "Stop"` is set. Individual `az` command failures return exit codes but do not throw terminating errors in PowerShell by default.

**Fix applied:** Detected the issue when actual WORM lock verification showed containers didn't exist. Recreated containers and re-ran WORM locking successfully.

**What to do next time:**
- Set `$ErrorActionPreference = "Stop"` at the top of any critical deployment script so that failed `az` commands terminate the script rather than continuing silently.
- After container creation, always verify with: `az storage container list --account-name {SA} --auth-mode login` before proceeding to WORM policies.
- Alternatively, check the JSON output of each `az storage container create` — real success returns `{"created": true}`.

---

## Issue 17 — Subscription Activity Log Diagnostic Settings Require Different Command

**What happened:** `az monitor diagnostic-settings create --resource /subscriptions/{ID}` failed (see Issue 11). This was separate from the JSON parsing issue — even with correct JSON, the command fails for subscription-scope resources.

**Documented separately** because the fix is a completely different command, not just a parameter change. See Issue 11 for details.

---

## Summary Table for Stamper Engineering

| # | Issue | Stamper Action Required |
|---|---|---|
| 1 | Bash syntax | Always emit PowerShell. Never emit Bash for GCC High deployments |
| 2 | Wrong region | Default all resources to `usgovvirginia` |
| 3 | `az sentinel` CLI broken | Use ARM REST for all Sentinel operations |
| 4 | Missing OperationsManagement provider | Add to provider registration list |
| 5 | Graph scope insufficient for CA/Security Defaults | Emit portal instructions, not CLI commands |
| 6 | `--enable-soft-delete` removed | Remove flag; soft delete is always on |
| 7 | `KeyVaults` plan name invalid | Use `CloudPosture` |
| 8 | Storage data plane blocked by network rules | Include temp IP allowance pattern before container creation |
| 9 | `foreach` cannot be piped | Use `ForEach-Object` or `Tee-Object` inside loop |
| 10 | Escaped JSON fails in PowerShell | Use single-quoted JSON strings |
| 11 | `diagnostic-settings create` fails for subscription scope | Use `diagnostic-settings subscription create` |
| 12 | `--assign-identity` not supported in automation extension | Use PATCH REST call after account creation |
| 13 | Retention policy in diagnostic settings rejected | Remove `retentionPolicy` from log configs |
| 14 | CMK requires 4-step sequence | Never set CMK at storage creation time |
| 15 | KV private + key creation = deadlock | Temp-enable public access or deploy PE first |
| 16 | Silent failure in loops | Add `$ErrorActionPreference = "Stop"` and verify container existence before WORM |
