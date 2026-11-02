// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-13: the AO web form (public/index.html, the REAL served inline scripts via uiHarness):
// (1) two-person controls are hidden while two-person approval is off (the default) and appear
//     once the server shows it is on; (2) a recurring-cost op shows the cost panel, DP-1 is
//     enabled only against a dry run's notice, and a live request carries costAck + confirmCost.

import { describe, it, expect } from 'vitest';
import { loadUi, jsonResponse, readIndexHtml, type FetchImpl } from './uiHarness.js';
import registry from '../src/registry/ao-commands.registry.json' assert { type: 'json' };
import type { AoCommand } from '../src/types/AoCommand.js';

const COMMANDS = registry as unknown as AoCommand[];

function grouped() {
  const m = new Map<string, AoCommand[]>();
  for (const c of COMMANDS) m.set(c.domain, [...(m.get(c.domain) ?? []), c]);
  return [...m.entries()].map(([id, commands]) => ({ id, name: commands[0].domainName, commands }));
}

function makeFetch(pending: unknown[] = [], execute?: (body: any) => any): FetchImpl {
  return (url, init) => {
    if (url === '/api/tenants') return jsonResponse({ tenants: [{ slug: 'sim-a', kind: 'sim' }], liveAllowed: false });
    if (url === '/api/commands') return jsonResponse({ domains: grouped() });
    if (url.startsWith('/api/tenant?')) return jsonResponse({ tenantSlug: 'sim-a' });
    if (url.startsWith('/api/approvals')) return jsonResponse({ success: true, approvals: pending });
    if (url.startsWith('/api/execute/') && execute) return jsonResponse(execute(JSON.parse(init.body)));
    return jsonResponse({}, 404);
  };
}

async function boot(fetchImpl: FetchImpl = makeFetch()) {
  const ui = loadUi(fetchImpl);
  await ui.run('loadTenants()');
  await ui.run('loadRegistry()');
  ui.el('tenantSelect').value = 'sim-a';
  return ui;
}

const F12_NOTICE = {
  success: true,
  result: { success: true, stdout: '{}' },
  evidence: {
    outcome: 'dry_run',
    metadata: {
      dryRun: true,
      twoPersonApproval: { mode: 'off', tierRequired: true },
      costGate: { gate: 'cost', classification: 'recurring', opId: 'F-12', costKey: 'azure.firewall.premium', monthlyUsd: 1597, priceDate: '2026-10-31', ackHash: 'h'.repeat(64), outcome: 'notice' },
    },
  },
};

describe('FIN-13: two-person controls follow the switch (default off)', () => {
  it('the APPROVALS button is hidden in the served HTML', () => {
    expect(readIndexHtml()).toMatch(/id="approvalsBtn"[^>]*display:none;/);
  });

  it('off: a Tier 3 op in live mode shows no requestor or approval-id fields', async () => {
    const ui = await boot();
    await ui.run(`openCommandForm('A-19')`);
    ui.el('liveExecToggle').checked = true;
    ui.el('liveExecToggle').onchange();
    expect(ui.el('requestorUpnInput').style.display).toBe('none');
    expect(ui.el('approvalIdInput').style.display).toBe('none');
  });

  it('on (a row records mode on): the button and the Tier 3 fields appear', async () => {
    const ui = await boot();
    await ui.run(`openCommandForm('A-19')`);
    ui.ctx.__r = { success: true, result: { stdout: 'x' }, evidence: { outcome: 'dry_run', metadata: { twoPersonApproval: { mode: 'on', tierRequired: true } } } };
    ui.ctx.__c = COMMANDS.find((c) => c.id === 'A-19');
    ui.run(`displayExecutionResult(__r, __c, 'c')`);
    expect(ui.el('approvalsBtn').style.display).toBe('inline-block');
    ui.el('liveExecToggle').checked = true;
    ui.el('liveExecToggle').onchange();
    expect(ui.el('requestorUpnInput').style.display).toBe('inline-block');
    expect(ui.el('approvalIdInput').style.display).toBe('inline-block');
    // and back off when a later row says off
    ui.ctx.__r = { ...ui.ctx.__r, evidence: { outcome: 'dry_run', metadata: { twoPersonApproval: { mode: 'off', tierRequired: true } } } };
    ui.run(`displayExecutionResult(__r, __c, 'c')`);
    expect(ui.el('approvalsBtn').style.display).toBe('none');
    expect(ui.el('requestorUpnInput').style.display).toBe('none');
  });

  it('a 202 pending approval turns the controls on', async () => {
    const ui = await boot();
    await ui.run(`openCommandForm('A-19')`);
    ui.ctx.__r = { success: false, status: 'pending_approval', approvalId: 'apr-1', message: 'm' };
    ui.ctx.__c = COMMANDS.find((c) => c.id === 'A-19');
    ui.run(`displayExecutionResult(__r, __c, 'c')`);
    expect(ui.el('approvalsBtn').style.display).toBe('inline-block');
  });
});

describe('FIN-13: the cost panel (DP-1 + typed DP-2) on the web form', () => {
  it('a free op hides the panel; a recurring op shows it with DP-1 disabled until a dry run', async () => {
    const ui = await boot();
    await ui.run(`openCommandForm('A-11')`);
    expect(ui.el('costGatePanel').style.display).toBe('none');
    await ui.run(`openCommandForm('F-12')`);
    expect(ui.el('costGatePanel').style.display).toBe('flex');
    expect(ui.el('costAckCheck').disabled).toBe(true);
    expect(ui.el('costNoOtherMeans').style.display).toBe('block'); // F-12 is last resort
  });

  it('a dry run notice enables DP-1 and shows the price and the text to type', async () => {
    const ui = await boot();
    await ui.run(`openCommandForm('F-12')`);
    ui.ctx.__r = F12_NOTICE;
    ui.ctx.__c = COMMANDS.find((c) => c.id === 'F-12');
    ui.run(`displayExecutionResult(__r, __c, 'c')`);
    expect(ui.el('costAckCheck').disabled).toBe(false);
    expect(ui.el('costNoticeText').textContent).toContain('$1597.00 a month');
    expect(ui.el('costNoticeText').textContent).toContain('"F-12 1597.00"');
  });

  it('a live request carries costAck (from the notice) and the typed confirmCost', async () => {
    const ui = await boot(makeFetch([], () => F12_NOTICE));
    await ui.run(`openCommandForm('F-12')`);
    ui.ctx.__c = COMMANDS.find((c) => c.id === 'F-12');
    await ui.run(`executeCommand(__c)`); // dry run: captures the notice
    const dry = ui.calls.filter((c) => c.url === '/api/execute/F-12').pop()!;
    expect(dry.body.dryRun).toBe(true);
    expect(dry.body.costAck).toBeUndefined();
    ui.el('costAckCheck').checked = true;
    ui.el('costNoOtherMeans').value = 'vendor endpoint cannot be a service tag';
    ui.el('confirmCostInput').value = 'F-12 1597.00';
    ui.el('liveExecToggle').checked = true;
    ui.el('liveExecToggle').onchange();
    expect(ui.el('requestorUpnInput').style.display).toBe('inline-block'); // operator field for a cost op, switch off
    ui.el('requestorUpnInput').value = 'operator@sim-a.onmicrosoft.us';
    await ui.run(`executeCommand(__c)`);
    const live = ui.calls.filter((c) => c.url === '/api/execute/F-12').pop()!;
    expect(live.body.costAck.operator).toBe('operator@sim-a.onmicrosoft.us');
    expect(live.body.requestorUPN).toBe('operator@sim-a.onmicrosoft.us');
    expect(live.body).toMatchObject({
      dryRun: false,
      confirmApply: 'F-12',
      confirmCost: 'F-12 1597.00',
      costAck: { opId: 'F-12', ackHash: 'h'.repeat(64), monthlyUsd: 1597, priceDate: '2026-10-31', noOtherMeans: 'vendor endpoint cannot be a service tag' },
    });
  });

  it('without the DP-1 tick a live request sends no costAck (the server then refuses: dp1_missing)', async () => {
    const ui = await boot(makeFetch([], () => F12_NOTICE));
    await ui.run(`openCommandForm('F-12')`);
    ui.ctx.__c = COMMANDS.find((c) => c.id === 'F-12');
    await ui.run(`executeCommand(__c)`);
    ui.el('liveExecToggle').checked = true;
    await ui.run(`executeCommand(__c)`);
    const live = ui.calls.filter((c) => c.url === '/api/execute/F-12').pop()!;
    expect(live.body.dryRun).toBe(false);
    expect(live.body.costAck).toBeUndefined();
    expect(live.body.confirmCost).toBeUndefined();
  });
});
