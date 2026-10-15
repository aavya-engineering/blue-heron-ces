// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX-AO7 (2026-09-27): the web UI's tenant, refusal, evidence-loss and correlationId
// behaviour, exercised against the REAL served code — the inline scripts of
// public/index.html run in node:vm (test/uiHarness.ts). Replaces the earlier mirror test,
// which asserted the now-removed 'dev' fallback.

import { describe, it, expect } from 'vitest';
import { loadUi, jsonResponse, readIndexHtml, extractInlineScripts, type FetchImpl } from './uiHarness.js';

const TENANTS = { tenants: [{ slug: 'sim-a', kind: 'sim' }, { slug: 'prod-x', kind: 'live' }], liveAllowed: false };

const CMD = {
  id: 'A-01', title: 'Read users', overview: 'o', domain: 'A', domainName: 'Identity',
  sodTier: 'Tier 1', cmmcPractices: [], parameters: [{ name: 'upn', label: 'UPN', type: 'text', required: false }],
};
const FW_CMD = { ...CMD, id: 'F-11', title: 'Deallocate firewall', parameters: [] };

/** Default fetch: tenant list + registry + tenant config; execute answered by `exec`. */
function makeFetch(exec: (body: any) => { body: any; status?: number }): FetchImpl {
  return (url, init) => {
    if (url === '/api/tenants') return jsonResponse(TENANTS);
    if (url === '/api/commands') return jsonResponse({ domains: [{ commands: [CMD, FW_CMD] }] });
    if (url.startsWith('/api/tenant?')) return jsonResponse({ tenantSlug: 'sim-a' });
    if (url.startsWith('/api/execute/')) {
      const r = exec(JSON.parse(init.body));
      return jsonResponse(r.body, r.status ?? 200);
    }
    if (url.startsWith('/api/approvals')) return jsonResponse({ success: true, approvals: [] });
    return jsonResponse({}, 404);
  };
}

async function bootWith(exec: Parameters<typeof makeFetch>[0]) {
  const ui = loadUi(makeFetch(exec));
  await ui.run('loadTenants()');
  await ui.run('loadRegistry()');
  return ui;
}

const executeCalls = (ui: ReturnType<typeof loadUi>) => ui.calls.filter((c) => c.url.startsWith('/api/execute/'));

describe('FX-AO7 (a): no default tenant; execution without a selection is blocked client-side', () => {
  it('index.html carries no quoted "dev" tenant literal and no value="dev" default', () => {
    const html = readIndexHtml();
    expect(html).not.toMatch(/['"`]dev['"`]/);
    expect(html).not.toMatch(/value\s*=\s*["']?dev\b/);
    expect(html).not.toMatch(/liveTenantInput/);
    for (const s of extractInlineScripts(html)) expect(s).not.toMatch(/\|\|\s*['"`]dev/);
  });

  it('tenant select is populated from GET /api/tenants and starts EMPTY', async () => {
    const ui = await bootWith(() => ({ body: {} }));
    expect(ui.calls.some((c) => c.url === '/api/tenants')).toBe(true);
    const sel = ui.el('tenantSelect');
    expect(sel.value).toBe('');
    expect(sel.innerHTML).toContain('value="sim-a"');
    expect(sel.innerHTML).toContain('value="prod-x"');
    expect(sel.innerHTML).toMatch(/prod-x \(live — refused: server is sim-only\)/);
    expect(ui.run('getSelectedTenant()')).toBe('');
  });

  it('EXECUTE with no tenant selected never calls the execute API and shows a blocking error', async () => {
    const ui = await bootWith(() => ({ body: { success: true } }));
    await ui.run(`openCommandForm('A-01')`);
    expect(ui.el('tenantSelect').value).toBe(''); // openCommandForm does not pick one either
    await ui.run(`executeCommand(registry[0])`);
    expect(executeCalls(ui)).toHaveLength(0);
    expect(ui.calls.some((c) => c.url.startsWith('/api/tenant?'))).toBe(false);
    expect(ui.el('resultStatusBadge').textContent).toBe('NO TENANT');
    expect(ui.el('refusalBanner').classList.contains('visible')).toBe(true);
    expect(ui.el('refusalBanner').textContent).toMatch(/No tenant selected/);
  });

  it('firewall pre-check with no tenant selected never calls the execute API', async () => {
    const ui = await bootWith(() => ({ body: {} }));
    await ui.run(`checkFirewallState(registry[1])`);
    expect(executeCalls(ui)).toHaveLength(0);
    expect(ui.el('precheckBadge').textContent).toBe('NO TENANT');
  });

  it('with a tenant selected, the request carries exactly that tenant', async () => {
    const ui = await bootWith(() => ({ body: { success: true, result: { stdout: 'ok' } } }));
    ui.el('tenantSelect').value = 'sim-a';
    await ui.run(`onTenantChanged()`);
    expect(ui.calls.some((c) => c.url === '/api/tenant?tenant=sim-a')).toBe(true);
    await ui.run(`executeCommand(registry[0])`);
    const [call] = executeCalls(ui);
    expect(call.body.tenant).toBe('sim-a');
    expect(call.body.dryRun).toBe(true);
  });

  it("the server's sim-only refusal is shown as REFUSED with the server's reason", async () => {
    const reason =
      "Sim-only by default: refusing non-sim tenant (kind: 'live'); live execution requires CES_AO_ALLOW_LIVE=1 and a tenant record marked kind 'live'";
    const ui = await bootWith(() => ({
      status: 500,
      body: { success: false, result: { success: false, error: reason }, evidence: { outcome: 'denied_sim_only' }, evidencePersisted: true },
    }));
    ui.el('tenantSelect').value = 'prod-x';
    await ui.run(`executeCommand(registry[0])`);
    expect(ui.el('resultStatusBadge').textContent).toBe('REFUSED');
    expect(ui.el('refusalBanner').classList.contains('visible')).toBe(true);
    expect(ui.el('refusalBanner').textContent).toContain('sim-only rail');
    expect(ui.el('refusalBanner').textContent).toContain('CES_AO_ALLOW_LIVE=1');
  });

  it('a route-level 400 (unknown tenant) shows the top-level error instead of "No output"', async () => {
    const ui = await bootWith(() => ({ status: 400, body: { success: false, error: 'Failed to load tenant config: not found' } }));
    ui.el('tenantSelect').value = 'sim-a';
    await ui.run(`executeCommand(registry[0])`);
    expect(ui.el('resultStatusBadge').textContent).toBe('REFUSED');
    expect(ui.el('refusalBanner').textContent).toContain('Failed to load tenant config');
    expect(ui.el('resultOutput').textContent).toContain('Failed to load tenant config');
  });
});

describe('FX-AO7 (b): evidencePersisted:false renders a prominent error', () => {
  const LOST = {
    evidencePersisted: false,
    evidenceLost: true,
    evidenceError: 'simulated evidence store failure (disk full)',
    evidenceWarning: 'EVIDENCE NOT PERSISTED for A-01',
  };

  it('200 success with lost evidence → evidence-lost banner visible with warning + cause', async () => {
    const ui = await bootWith(() => ({ body: { success: true, result: { stdout: 'ok' }, ...LOST } }));
    ui.el('tenantSelect').value = 'sim-a';
    await ui.run(`executeCommand(registry[0])`);
    const b = ui.el('evidenceLostBanner');
    expect(b.classList.contains('visible')).toBe(true);
    expect(b.textContent).toContain('EVIDENCE NOT PERSISTED');
    expect(b.textContent).toContain('disk full');
  });

  it('evidencePersisted:false alone (no warning text) still renders the banner', async () => {
    const ui = await bootWith(() => ({ body: { success: true, result: { stdout: 'ok' }, evidencePersisted: false } }));
    ui.el('tenantSelect').value = 'sim-a';
    await ui.run(`executeCommand(registry[0])`);
    expect(ui.el('evidenceLostBanner').classList.contains('visible')).toBe(true);
    expect(ui.el('evidenceLostBanner').textContent).toMatch(/EVIDENCE NOT PERSISTED/);
  });

  it('202 pending-approval with lost evidence → banner rendered before the early return', async () => {
    const ui = await bootWith(() => ({ status: 202, body: { status: 'pending_approval', approvalId: 'ap-1', ...LOST } }));
    ui.el('tenantSelect').value = 'sim-a';
    await ui.run(`executeCommand(registry[0])`);
    expect(ui.el('resultStatusBadge').textContent).toBe('PENDING APPROVAL');
    expect(ui.el('evidenceLostBanner').classList.contains('visible')).toBe(true);
  });

  it('healthy evidence → no banner (and a previous banner is cleared)', async () => {
    let lost = true;
    const ui = await bootWith(() => ({ body: { success: true, result: { stdout: 'ok' }, ...(lost ? LOST : { evidencePersisted: true }) } }));
    ui.el('tenantSelect').value = 'sim-a';
    await ui.run(`executeCommand(registry[0])`);
    expect(ui.el('evidenceLostBanner').classList.contains('visible')).toBe(true);
    lost = false;
    await ui.run(`executeCommand(registry[0])`);
    expect(ui.el('evidenceLostBanner').classList.contains('visible')).toBe(false);
  });

  it('approvals view: a row flagged evidenceLost renders an error banner with the warning', async () => {
    const ui = loadUi((url) => {
      if (url.startsWith('/api/approvals')) {
        return jsonResponse({
          success: true,
          approvals: [
            { approvalId: 'ap-ok', commandId: 'T3', requestorUPN: 'r', createdAt: 't', inputs: {}, status: 'rejected' },
            { approvalId: 'ap-lost', commandId: 'T3', requestorUPN: 'r', createdAt: 't', inputs: {}, status: 'rejected', ...LOST },
          ],
        });
      }
      return jsonResponse({});
    });
    ui.el('approvalsStatusFilter').value = 'rejected';
    await ui.run('loadApprovals()');
    const list = ui.el('approvalsList');
    const banners = list.querySelectorAll('.approval-evidence-lost');
    expect(banners).toHaveLength(1);
    expect(banners[0].textContent).toContain('EVIDENCE NOT PERSISTED');
  });

  it('approval decision whose evidence was lost → modal banner visible', async () => {
    const ui = loadUi((url) => {
      if (url.includes('/decision')) return jsonResponse({ success: true, approval: {}, ...LOST });
      return jsonResponse({ success: true, approvals: [] });
    });
    ui.el('approverUpnInput').value = 'approver@x';
    ui.el('approvalsStatusFilter').value = 'pending';
    await ui.run(`decideApproval('ap-9', 'reject')`);
    const b = ui.el('approvalsEvidenceBanner');
    expect(b.classList.contains('visible')).toBe(true);
    expect(b.textContent).toContain('ap-9');
    expect(b.textContent).toContain('EVIDENCE NOT PERSISTED');
  });
});

describe('FX-AO7 (c): every execute request carries a correlationId (REQ-AO-GUI-NO-CORRELATION-ID)', () => {
  it('each EXECUTE click sends a fresh correlationId and the result panel shows it', async () => {
    const ui = await bootWith((body) => ({ body: { success: true, result: { stdout: 'ok' }, correlationId: body.correlationId } }));
    ui.el('tenantSelect').value = 'sim-a';
    await ui.run(`executeCommand(registry[0])`);
    await ui.run(`executeCommand(registry[0])`);
    const ids = executeCalls(ui).map((c) => c.body.correlationId);
    expect(ids).toHaveLength(2);
    ids.forEach((id) => expect(id).toMatch(/^ao-ui-[0-9a-f-]{36}$/));
    expect(new Set(ids).size).toBe(2);
    expect(ui.el('resultCorrelationId').textContent).toBe(`correlationId: ${ids[1]}`);
  });

  it('the firewall state probe also sends a correlationId', async () => {
    const ui = await bootWith(() => ({ body: { success: true, stdout: '{"AllocationState":"Allocated"}' } }));
    ui.el('tenantSelect').value = 'sim-a';
    await ui.run(`checkFirewallState(registry[1])`);
    const [call] = executeCalls(ui);
    expect(call.body.correlationId).toMatch(/^ao-ui-/);
  });

  it('falls back to getRandomValues when crypto.randomUUID is unavailable (plain-http remote)', async () => {
    const ui = loadUi(makeFetch(() => ({ body: { success: true, result: { stdout: 'ok' } } })), { withRandomUUID: false });
    await ui.run('loadTenants()');
    await ui.run('loadRegistry()');
    ui.el('tenantSelect').value = 'sim-a';
    await ui.run(`executeCommand(registry[0])`);
    const [call] = executeCalls(ui);
    expect(call.body.correlationId).toMatch(/^ao-ui-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('static: every /api/execute fetch body in index.html includes correlationId', () => {
    const src = extractInlineScripts().join('\n');
    const sites = src.split('fetch(`/api/execute/').slice(1);
    expect(sites.length).toBeGreaterThanOrEqual(2);
    for (const site of sites) {
      const body = site.slice(0, site.indexOf('});') + 3);
      expect(body).toMatch(/correlationId/);
    }
  });
});
