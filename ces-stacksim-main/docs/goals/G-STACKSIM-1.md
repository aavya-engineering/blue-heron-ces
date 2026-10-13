# Goal Document — G-STACKSIM-1

**Definition of Operational Capability (DOC):** the simulator is operationally complete when, against a running `m365_azure`-profile sim tenant, with **zero code edits** to `ces-eo`, `ces-ao`, or `ces-stamper`:

1. Stamper stamps one baseline entry onto the sim tenant using Stamper's own baseline-stamping template for an authorization-policy-class control (Stamper's template source is separate from AO's `TemplateRegistry.ts`; the exact template is identified by the M4 coding-expert via a targeted read of Stamper's own template file — out of this plan's read scope). The mutation is visible in the object store on re-read.
2. EO's `ComplianceSignalFetcher.fetchAuthorizationPolicy()` (part of `fetchAllSignals()`) runs unmodified against the sim tenant and returns a `SignalResult` with `signalId: 'authorizationPolicy'` and `status: 'success'` (not `'error'`/`'not_assessed'`) — the exact field/value pair confirmed by reading `ComplianceSignalFetcher.ts:391-405`.
3. AO's `A-18` command (`TemplateRegistry.ts:59-62`, a single `Invoke-MgGraphRequest -Method PATCH -Uri '/v1.0/policies/authorizationPolicy'`) executes unmodified against the sim tenant; the mutation appears both as a `Get-MgAuditLogDirectoryAudit`-readable entry in the sim's `auditLogs/directoryAudits` collection **and** as a corresponding entry in the sim's own `ledger.jsonl`.
4. All of the above is reproducible via one CLI command (`stacksim verify-doc`) that seeds a fresh tenant, runs the three checks, and exits 0 only if all pass.

**On checks 1 and 3 targeting the same control via two different callers:** this is intentional, not redundant — check 1 proves Stamper's independent template/session path reaches the sim's `authorizationPolicy` resolver; check 3 proves AO's `TemplateRegistry` path reaches the same resolver via its own distinct command (`A-18`). Both must independently succeed against the identical store object; that dual-path agreement is itself part of the DOC, not incidental overlap.

Loop exit condition = DOC satisfied (M6 gate green).

Source: `PLAN.md` (repo root), "Goal Document — G-STACKSIM-1" section, revision v3.
