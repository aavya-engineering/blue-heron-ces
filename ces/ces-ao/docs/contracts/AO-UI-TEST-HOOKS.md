# AO UI test hooks (v1.0.0, W4-AO4, 2026-09-27)

Stable `data-testid` hooks on the AdminOps web UI (`public/index.html`) for UI automation
(ces-tester's full-UI simstack suite). Hooks are additive: existing element ids are unchanged, and
visual behaviour is unchanged. `test/uiHooks.test.ts` renders every one of the registry's commands through
the real inline scripts and proves every hook below exists. Renaming or removing a hook is a breaking change to this
contract: bump the version and tell ces-tester.

## Command catalog

| Hook | Element |
|---|---|
| `cmd-<ID>` | family-tree list item for command `<ID>` (e.g. `cmd-A-18`); also carries `data-command-id` |
| `search-cmd-<ID>` | search-result item for `<ID>` |
| `command-search` | search input |
| `search-results` | search results container (its placeholder shows the registry-derived command count) |

## Command form

| Hook | Element |
|---|---|
| `form-title` | form heading; `data-command-id` = the open command |
| `form-params` | parameter container |
| `param-<name>` | input/select for parameter `<name>`, one per declared parameter (e.g. `param-targetUPN`); tenant-sourced ones are readonly and carry `data-source` |
| `no-params` | shown instead of inputs when the command declares no parameters |
| `live-toggle` | Live Execution checkbox (unchecked = dry run) |
| `tenant-select` | tenant select (required; no default) |
| `requestor-upn` | requestor UPN (visible for live Tier-3) |
| `approval-id` | approvalId input (visible for live Tier-3; pre-filled after a pending-approval result) |
| `execute` | EXECUTE button |
| `form-cancel` | CANCEL button |

## Firewall pre-check and confirmation (F-11 / F-12)

`fw-precheck`, `fw-precheck-btn`, `fw-precheck-badge`, `fw-precheck-prov-badge`, `fw-precheck-warning`,
`fw-confirm-modal`, `fw-confirm-title`, `fw-confirm-text`, `fw-confirm-ok`, `fw-confirm-cancel`.

## Result panel

| Hook | Element |
|---|---|
| `result-panel` | the panel. Machine-readable attributes (never parse prose): |
| | `data-state` = `idle` \| `blocked` (client refused, e.g. no tenant) \| `executed` \| `dry_run` \| `denied` (server refusal: sim-only rail, CMMC/CUI gate, route 4xx) \| `pending_approval` \| `failed` |
| | `data-outcome` = evidence outcome (`automated_success`, `denied_cmmc`, `blocked_pending_approval`, ...) |
| | `data-verdict` = compliance verdict (`SAT`, `NOT_APPLICABLE`, ...) |
| | `data-approval-id` = approvalId of a pending Tier-3 request |
| | `data-correlation-id` = the correlationId sent with the request (also on the evidence row) |
| `result-status` | status badge |
| `refusal-banner` | server refusal / blocked message |
| `evidence-lost-banner` | shown when the evidence row was NOT persisted |
| `result-correlation-id` | correlation id line |
| `result-output` | command output |
| `evidence-section` | evidence block |
| `evidence-outcome` | evidence outcome badge (SAT styling follows the verdict) |
| `evidence-verdict` | compliance verdict text |

## Approvals (Tier-3 two-person rule)

| Hook | Element |
|---|---|
| `approvals-open` | header APPROVALS button; `approvals-count` = pending count |
| `approvals-modal`, `approvals-status-filter`, `approvals-refresh`, `approvals-close`, `approvals-list`, `approvals-evidence-banner` | modal parts |
| `approver-token` | approver sign-in token, sent as `x-ces-principal` (W4-AO3) |
| `approver-upn` | display only; the server records the authenticated principal, never this text |
| `approval-<approvalId>` | one approval row; `data-approval-id`, `data-command-id`, `data-status` |
| `approve-<approvalId>` / `reject-<approvalId>` | decision buttons on a pending row |

## Tier-3 round trip in the UI

1. Open the command, select the tenant, tick `live-toggle`, fill `requestor-upn`, click `execute` →
   `result-panel[data-state=pending_approval]`, `data-approval-id` set, `approval-id` pre-filled.
2. `approvals-open` → type the second person's token into `approver-token` → `approve-<approvalId>`.
   Without a verified principal the server answers 401 and nothing is recorded.
3. Back on the form (still live, `approval-id` pre-filled) → `execute` → `data-state=executed`.

Server posture for step 2: `CES_AO_PRINCIPAL_SECRET` (HS256 tokens) or, for local runs only,
`CES_AO_DEV_PRINCIPAL_UPN` (unverified, loopback only). See `src/server/principal.ts`.
