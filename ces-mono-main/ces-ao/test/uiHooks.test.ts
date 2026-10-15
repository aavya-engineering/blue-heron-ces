// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-AO4 (2026-09-27) — stable data-testid hooks for every command form, and a
// machine-readable result state, proven against the REAL served UI code
// (public/index.html inline scripts in node:vm, test/uiHarness.ts) with the REAL
// registry. Contract: docs/contracts/AO-UI-TEST-HOOKS.md.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadUi, jsonResponse, readIndexHtml, type FetchImpl } from './uiHarness.js';
import registry from '../src/registry/ao-commands.registry.json' assert { type: 'json' };
import type { AoCommand } from '../src/types/AoCommand.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS = registry as unknown as AoCommand[];
const HOOKS_DOC = fs.readFileSync(path.resolve(__dirname, '..', 'docs', 'contracts', 'AO-UI-TEST-HOOKS.md'), 'utf-8');

function grouped() {
  const m = new Map<string, AoCommand[]>();
  for (const c of COMMANDS) m.set(c.domain, [...(m.get(c.domain) ?? []), c]);
  return [...m.entries()].map(([id, commands]) => ({ id, name: commands[0].domainName, commands }));
}

function makeFetch(extra: (url: string, init: any) => ReturnType<FetchImpl> | undefined = () => undefined): FetchImpl {
  return (url, init) => {
    const r = extra(url, init);
    if (r) return r;
    if (url === '/api/tenants') return jsonResponse({ tenants: [{ slug: 'sim-a', kind: 'sim' }], liveAllowed: false });
    if (url === '/api/commands') return jsonResponse({ domains: grouped() });
    if (url.startsWith('/api/tenant?')) return jsonResponse({ tenantSlug: 'sim-a' });
    if (url.startsWith('/api/approvals')) return jsonResponse({ success: true, approvals: [] });
    return jsonResponse({}, 404);
  };
}

async function boot(extra?: Parameters<typeof makeFetch>[0]) {
  const ui = loadUi(makeFetch(extra));
  await ui.run('loadTenants()');
  await ui.run('loadRegistry()');
  ui.el('tenantSelect').value = 'sim-a';
  return ui;
}

const STATIC_HOOKS = [
  'approvals-open', 'approvals-count', 'command-search', 'search-results', 'form-title', 'result-panel',
  'result-status', 'refusal-banner', 'evidence-lost-banner', 'result-correlation-id', 'result-output',
  'evidence-section', 'evidence-outcome', 'evidence-verdict', 'form-params', 'fw-precheck', 'fw-precheck-btn',
  'fw-precheck-badge', 'fw-precheck-prov-badge', 'fw-precheck-warning', 'live-toggle', 'tenant-select',
  'requestor-upn', 'approval-id', 'execute', 'form-cancel', 'fw-confirm-modal', 'fw-confirm-title',
  'fw-confirm-text', 'fw-confirm-ok', 'fw-confirm-cancel', 'approvals-modal', 'approvals-status-filter',
  'approver-upn', 'approver-token', 'approvals-refresh', 'approvals-evidence-banner', 'approvals-list',
  'approvals-close',
];

describe('W4-AO4 UI hooks — static', () => {
  it('every static hook exists exactly once in the served HTML and is documented', () => {
    const html = readIndexHtml();
    for (const h of STATIC_HOOKS) {
      expect(html.split(`data-testid="${h}"`).length - 1, h).toBe(1);
      expect(HOOKS_DOC, `${h} documented`).toContain(`\`${h}\``);
    }
  });

  it('the command count is derived from the registry (no stale "85 commands" copy)', async () => {
    const ui = await boot();
    expect(readIndexHtml()).not.toMatch(/\b85 commands\b/);
    ui.run(`renderSearchResults('')`);
    expect(ui.el('searchResults').innerHTML).toContain(`search ${COMMANDS.length} commands`);
  });
});

describe(`W4-AO4 UI hooks — every one of the ${COMMANDS.length} registry commands`, () => {
  it('the family tree renders a cmd-<ID> item for every command', async () => {
    const ui = await boot();
    ui.run('renderFamilyTree()');
    let total = 0;
    for (const d of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      const html = ui.selected(`[data-family="${d}"]`).innerHTML;
      for (const c of COMMANDS.filter((x) => x.domain === d)) {
        expect(html, c.id).toContain(`data-testid="cmd-${c.id}"`);
        total++;
      }
    }
    expect(total).toBe(COMMANDS.length);
    expect(COMMANDS.length).toBe(95);
  });

  it('search renders a search-cmd-<ID> item', async () => {
    const ui = await boot();
    ui.run(`renderSearchResults('A-18')`);
    expect(ui.el('searchResults').innerHTML).toContain('data-testid="search-cmd-A-18"');
  });

  for (const cmd of COMMANDS) {
    it(`${cmd.id}: the form has param-<name> for every declared parameter`, async () => {
      const ui = await boot();
      await ui.run(`openCommandForm(${JSON.stringify(cmd.id)})`);
      expect(ui.el('formTitle').getAttribute('data-command-id')).toBe(cmd.id);
      const html = ui.el('formParams').innerHTML;
      if (cmd.parameters.length === 0) {
        expect(html).toContain('data-testid="no-params"');
      }
      for (const p of cmd.parameters) {
        expect(html, `${cmd.id}.${p.name}`).toContain(`data-testid="param-${p.name}"`);
        if (p.source) expect(html).toContain(`data-source="${p.source}"`);
      }
    });
  }
});

describe('W4-AO4 result panel data-state', () => {
  const cmd = COMMANDS.find((c) => c.id === 'A-18')!;
  const cases: Array<[string, any, string]> = [
    ['dry run', { success: true, result: { stdout: 'x' }, evidence: { outcome: 'dry_run', complianceVerdict: 'NOT_APPLICABLE', metadata: { dryRun: true, mode: 'dry_run' } } }, 'dry_run'],
    ['live success', { success: true, result: { stdout: 'x' }, evidence: { outcome: 'automated_success', complianceVerdict: 'SAT', metadata: { mode: 'live' } } }, 'executed'],
    ['CMMC denial', { success: false, result: { error: 'CMMC scope gate denied' }, evidence: { outcome: 'denied_cmmc', complianceVerdict: 'NOT_APPLICABLE', metadata: {} } }, 'denied'],
    ['route refusal', { success: false, error: 'Failed to load tenant config' }, 'denied'],
    ['failure', { success: false, result: { error: 'boom' }, evidence: { outcome: 'failed_no_remediation', complianceVerdict: 'NOT_SAT', metadata: { mode: 'live' } } }, 'failed'],
  ];
  for (const [name, result, state] of cases) {
    it(`${name} -> data-state=${state}`, async () => {
      const ui = await boot();
      ui.ctx.__r = result;
      ui.ctx.__c = cmd;
      ui.run(`displayExecutionResult(__r, __c, 'corr-1')`);
      const panel = ui.el('resultPanel');
      expect(panel.getAttribute('data-state')).toBe(state);
      expect(panel.getAttribute('data-correlation-id')).toBe('corr-1');
      if (result.evidence) {
        expect(panel.getAttribute('data-outcome')).toBe(result.evidence.outcome);
        expect(panel.getAttribute('data-verdict')).toBe(result.evidence.complianceVerdict);
      }
    });
  }

  it('the verdict text shows complianceVerdict and SAT styling follows the verdict (was: outcome === "SAT")', async () => {
    const ui = await boot();
    ui.ctx.__r = cases[1][1];
    ui.ctx.__c = cmd;
    ui.run(`displayExecutionResult(__r, __c, 'c')`);
    expect(ui.el('evidenceVerdict').textContent).toContain('SAT');
    expect(ui.el('evidenceOutcomeBadge').className).toContain('outcome-badge sat');
  });

  it('pending approval -> data-state=pending_approval and the approvalId is in the DOM', async () => {
    const ui = await boot();
    ui.ctx.__r = { success: false, status: 'pending_approval', approvalId: 'apr-123', message: 'm' };
    ui.ctx.__c = cmd;
    ui.run(`displayExecutionResult(__r, __c, 'c')`);
    expect(ui.el('resultPanel').getAttribute('data-state')).toBe('pending_approval');
    expect(ui.el('resultPanel').getAttribute('data-approval-id')).toBe('apr-123');
    expect(ui.el('approvalIdInput').value).toBe('apr-123');
  });

  it('no tenant -> data-state=blocked', async () => {
    const ui = await boot();
    ui.el('tenantSelect').value = '';
    ui.ctx.__c = cmd;
    await ui.run(`executeCommand(__c)`);
    expect(ui.el('resultPanel').getAttribute('data-state')).toBe('blocked');
  });
});

describe('W4-AO4 approvals hooks + W4-AO3 authenticated decision from the UI', () => {
  const pending = { approvalId: 'apr-9', commandId: 'A-03', commandTitle: 't', requestorUPN: 'r@x', createdAt: 'now', inputs: {}, status: 'pending' };

  it('a pending row renders approval-/approve-/reject- hooks', async () => {
    const ui = await boot((url) => (url.startsWith('/api/approvals?') ? jsonResponse({ success: true, approvals: [pending] }) : undefined));
    await ui.run('loadApprovals()');
    const html = ui.el('approvalsList').innerHTML;
    for (const h of ['approval-apr-9', 'approve-apr-9', 'reject-apr-9']) expect(html).toContain(`data-testid="${h}"`);
    expect(html).toContain('data-status="pending"');
  });

  it('APPROVE sends the sign-in token as x-ces-principal and no body approverUPN', async () => {
    const ui = await boot((url) =>
      url.endsWith('/decision') ? jsonResponse({ success: true, approval: { ...pending, status: 'approved' } }) : undefined,
    );
    ui.el('approverTokenInput').value = 'tok.en.value';
    ui.el('approverUpnInput').value = 'typed@x';
    await ui.run(`decideApproval('apr-9', 'approve')`);
    const call = ui.calls.find((c) => c.url.endsWith('/decision'))!;
    expect(call.init.headers['x-ces-principal']).toBe('tok.en.value');
    expect(call.body.approverUPN).toBeUndefined();
    expect(call.body.decision).toBe('approve');
  });

  it('a 401 from the server tells the operator sign-in is required', async () => {
    const ui = await boot((url) =>
      url.endsWith('/decision') ? jsonResponse({ error: 'unauthorized' }, 401) : undefined,
    );
    await ui.run(`decideApproval('apr-9', 'approve')`);
    expect(ui.alerts.some((a) => /Sign-in required/.test(a))).toBe(true);
  });
});
