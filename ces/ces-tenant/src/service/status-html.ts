// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * Self-contained HTML status view -- M6 open decision 3, resolved at
 * planning (see docs/M6-RECORD.md): a single server-rendered page at
 * `GET /status`, no external assets (the JSON API remains the programmatic/
 * console surface). Renders the tenant x engine service x module matrix
 * (goal design requirement 6) plus the recent activity ledger, with the v1
 * honesty banner that activity is self-reported.
 *
 * Security: renders ONLY the redacted status payload -- token material never
 * reaches this module (see protocol.ts redaction contract).
 */

import type { ServiceStatusPayload, ServiceStatusTenantRow, WireActivityEntry } from './protocol.js';

const SESSION_ORDER = ['graph', 'exchange', 'purview', 'azure', 'sharepoint', 'teams'] as const;

function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '&mdash;';
  return esc(iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z'));
}

function sessionCells(row: ServiceStatusTenantRow): string {
  return SESSION_ORDER.map((type) => {
    const s = row.sessions.find((x) => x.type === type);
    if (!s) return '<td class="na">&mdash;</td>';
    const cls = s.connected ? 'on' : 'off';
    const label = s.connected ? 'connected' : 'off';
    const since = s.connectedAt ? `<br><small>${fmtTime(s.connectedAt)}</small>` : '';
    return `<td class="${cls}">${label}${since}</td>`;
  }).join('');
}

function tenantRow(row: ServiceStatusTenantRow): string {
  const kind = row.kind ? `<span class="kind kind-${esc(row.kind)}">${esc(row.kind)}</span>` : '<span class="kind">?</span>';
  const auth =
    row.authState.length === 0
      ? '<span class="muted">none</span>'
      : row.authState
          .map(
            (a) =>
              `${esc(a.strategyKind)}${a.sessionType ? ` (${esc(a.sessionType)})` : ''}` +
              `${a.holdsToken ? ' &#128273;' : ''}${a.expiresAt ? `<br><small>expires ${fmtTime(a.expiresAt)}</small>` : ''}` +
              `<br><small>by ${esc(a.registeredBy.module)}, claimed ${a.claimCount}x</small>`,
          )
          .join('<hr class="thin">');
  const modules =
    row.modules.length === 0
      ? '<span class="muted">none</span>'
      : row.modules
          .map((m) => `<b>${esc(m.module)}</b> &times;${m.operations}<br><small>${esc(m.lastOperation)} @ ${fmtTime(m.lastAt)}</small>`)
          .join('<hr class="thin">');
  return `<tr>
    <td><b>${esc(row.tenantSlug ?? '(unknown)')}</b><br>${kind}</td>
    <td>${auth}</td>
    ${sessionCells(row)}
    <td>${modules}</td>
    <td>${fmtTime(row.lastActivityAt)}</td>
  </tr>`;
}

function activityRow(e: WireActivityEntry): string {
  return `<tr class="${e.outcome === 'error' ? 'err' : ''}">
    <td>${fmtTime(e.at)}</td>
    <td>${e.consumer ? `<b>${esc(e.consumer.module)}</b><br><small>${esc(e.consumer.purpose)}</small>` : '<span class="muted">(none)</span>'}</td>
    <td>${esc(e.operation)}</td>
    <td>${e.tenantSlug ? esc(e.tenantSlug) : '&mdash;'}</td>
    <td>${e.sessionType ? esc(e.sessionType) : '&mdash;'}</td>
    <td>${esc(e.outcome)}</td>
    <td>${e.detail ? esc(e.detail) : ''}</td>
  </tr>`;
}

export function renderStatusHtml(status: ServiceStatusPayload, recentActivity: WireActivityEntry[]): string {
  const tenantRows = status.tenants.length
    ? status.tenants.map(tenantRow).join('\n')
    : `<tr><td colspan="10" class="muted">No tenants observed yet -- no auth state registered and no activity reported.</td></tr>`;
  const activityRows = recentActivity.length
    ? [...recentActivity].reverse().map(activityRow).join('\n')
    : `<tr><td colspan="7" class="muted">No activity recorded.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ces-tenant service status</title>
<style>
  :root { --bg:#0f1419; --panel:#161b22; --line:#2d333b; --fg:#e6edf3; --mut:#8b949e; --ok:#3fb950; --err:#f85149; --acc:#58a6ff; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; background:var(--bg); color:var(--fg); font:14px/1.45 "Segoe UI", system-ui, sans-serif; }
  h1 { font-size:18px; margin:0 0 4px; } h2 { font-size:15px; margin:28px 0 8px; }
  .sub { color:var(--mut); margin-bottom:16px; }
  .banner { background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--acc); padding:8px 12px; margin:12px 0 20px; color:var(--mut); }
  table { border-collapse:collapse; width:100%; background:var(--panel); }
  th, td { border:1px solid var(--line); padding:6px 10px; text-align:left; vertical-align:top; }
  th { color:var(--mut); font-weight:600; white-space:nowrap; }
  td.on { color:var(--ok); } td.off, td.na { color:var(--mut); }
  tr.err td { color:var(--err); }
  .muted { color:var(--mut); } small { color:var(--mut); }
  .kind { display:inline-block; padding:1px 8px; border-radius:10px; border:1px solid var(--line); font-size:12px; }
  .kind-live { color:var(--ok); border-color:var(--ok); } .kind-sim { color:var(--acc); border-color:var(--acc); }
  hr.thin { border:0; border-top:1px solid var(--line); margin:6px 0; }
</style>
</head>
<body>
<h1>ces-tenant service</h1>
<div class="sub">mode: <b>${esc(status.mode)}</b> &middot; up since ${fmtTime(status.startedAt)}</div>
<div class="banner">v1 auth-state-only: the service holds auth state; modules run their own engine processes.
Activity below is <b>self-reported</b> by modules via the caller-identity amendment &mdash; not centrally enforced.</div>

<h2>Tenants &times; engine services &times; modules</h2>
<table>
<tr><th>Tenant</th><th>Auth state</th><th>graph</th><th>exchange</th><th>purview</th><th>azure</th><th>sharepoint</th><th>teams</th><th>Modules</th><th>Last activity</th></tr>
${tenantRows}
</table>

<h2>Recent activity (newest first)</h2>
<table>
<tr><th>At</th><th>Module</th><th>Operation</th><th>Tenant</th><th>Service</th><th>Outcome</th><th>Detail</th></tr>
${activityRows}
</table>
</body>
</html>`;
}
