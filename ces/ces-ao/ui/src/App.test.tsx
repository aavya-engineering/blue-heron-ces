// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.
// @vitest-environment jsdom

// FIN-30: the AO console on the kit, end to end against a fake AO API (setFetcher seam):
// command list, DRY RUN then APPLY (apply guard), DP-1 / DP-2, two-person controls hidden while
// the switch is off, evidence rows with objectives, the F-11/F-12 confirmation, and axe.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { resetAoStore } from './store/ao';
import { installFakeServer, okExecute } from './test/fixtures';
import type { FakeServer } from './test/fixtures';
import { seriousAxe } from './test/axe-helper';

let fake: FakeServer;

beforeEach(() => {
  resetAoStore();
  fake = installFakeServer();
});

afterEach(() => {
  cleanup();
  fake.restore();
});

async function boot() {
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByTestId('cmd-A-02');
  return { user, ...view };
}

async function open(user: ReturnType<typeof userEvent.setup>, id: string, tenant = 'sim-s1') {
  await user.selectOptions(screen.getAllByTestId('tenant-select')[0], tenant);
  await user.click(screen.getByTestId(`cmd-${id}`));
  await screen.findByTestId('form-title');
}

describe('shell and command list', () => {
  it('uses the kit shell: header "CES Blue Heron Defense — AdminOps", banner, footer; no serious axe findings', async () => {
    const { container } = await boot();
    expect(container.querySelector('#header')).toHaveTextContent('Blue Heron Defense — AdminOps');
    expect(container.querySelector('#tenantBanner')).toHaveAttribute('data-simulator', 'true');
    expect(container.querySelector('footer')).toHaveTextContent('CES v2.2.3');
    expect(await seriousAxe(container)).toEqual([]);
  });

  it('lists every command by domain and searches by id, title, domain and practice', async () => {
    const { user } = await boot();
    for (const id of ['A-02', 'B-09', 'F-12']) expect(screen.getByTestId(`cmd-${id}`)).toHaveAttribute('data-command-id', id);
    expect(screen.getByTestId('search-results')).toHaveTextContent('Start typing to search 3 commands');
    await user.type(screen.getByTestId('command-search'), 'SC.L1');
    expect(screen.getByTestId('search-cmd-F-12')).toBeInTheDocument();
    expect(screen.queryByTestId('search-cmd-A-02')).toBeNull();
  });

  it('lists tenants with no default, and marks live tenants refused on a sim-only server', async () => {
    await boot();
    const sel = screen.getAllByTestId('tenant-select')[0] as HTMLSelectElement;
    expect(sel.value).toBe('');
    expect(within(sel).getByText('contoso (live — refused: server is sim-only)')).toBeInTheDocument();
  });
});

describe('request flow: DRY RUN, then APPLY', () => {
  it('blocks without a tenant and never calls execute', async () => {
    const { user } = await boot();
    await user.click(screen.getByTestId('cmd-A-02'));
    await user.click(await screen.findByTestId('dry-run'));
    expect(screen.getByTestId('result-panel')).toHaveAttribute('data-state', 'blocked');
    expect(screen.getByTestId('result-status')).toHaveTextContent('NO TENANT');
    expect(fake.executeCalls()).toEqual([]);
  });

  it('fills tenant-sourced params from /api/tenant/bindings, readonly', async () => {
    const { user } = await boot();
    await open(user, 'A-02');
    await waitFor(() => expect(screen.getByTestId('param-tenantDomain')).toHaveValue('sim-s1.example.test'));
    expect(screen.getByTestId('param-tenantDomain')).toHaveAttribute('readonly');
    expect(screen.getByTestId('param-tenantDomain')).toHaveAttribute('data-source', 'tenant.domain');
    expect(screen.getByTestId('param-reason')).toHaveValue('leaver');
  });

  it('APPLY is locked until a dry run of this exact request returns; it sends confirmApply, the dry run does not', async () => {
    const { user, container } = await boot();
    await open(user, 'A-02');
    await user.type(screen.getByTestId('param-targetUPN'), 'leaver@example.test');
    expect(screen.getByTestId('apply')).toBeDisabled();

    await user.click(screen.getByTestId('dry-run'));
    await waitFor(() => expect(screen.getByTestId('result-panel')).toHaveAttribute('data-state', 'dry_run'));
    const dry = fake.executeCalls()[0];
    expect(dry.url).toBe('/api/execute/A-02');
    expect(dry.body).toMatchObject({ tenant: 'sim-s1', dryRun: true, inputs: { targetUPN: 'leaver@example.test', tenantDomain: 'sim-s1.example.test', reason: 'leaver' } });
    expect(dry.body).not.toHaveProperty('confirmApply');
    expect(dry.body.correlationId).toMatch(/^ao-ui-/);
    expect(screen.getByTestId('result-panel')).toHaveAttribute('data-correlation-id', dry.body.correlationId);
    expect(screen.getByTestId('apply')).toBeEnabled();

    // Changing an input re-locks APPLY: the dry run was for a different request.
    await user.type(screen.getByTestId('param-targetUPN'), 'x');
    expect(screen.getByTestId('apply')).toBeDisabled();
    await user.click(screen.getByTestId('dry-run'));
    await waitFor(() => expect(screen.getByTestId('apply')).toBeEnabled());

    await user.click(screen.getByTestId('apply'));
    await waitFor(() => expect(screen.getByTestId('result-panel')).toHaveAttribute('data-state', 'executed'));
    const live = fake.executeCalls()[2];
    expect(live.body).toMatchObject({ dryRun: false, confirmApply: 'A-02', tenant: 'sim-s1' });
    expect(live.body).not.toHaveProperty('costAck');
    expect(screen.getByTestId('result-panel')).toHaveAttribute('data-verdict', 'SAT');
    expect(screen.getByTestId('evidence-outcome')).toHaveTextContent('automated_success');
    expect(await seriousAxe(container)).toEqual([]);
  });

  it('shows a server refusal verbatim as REFUSED / denied', async () => {
    fake.execute = () => ({ status: 403, body: { success: false, result: { success: false, error: 'tenant is live' }, evidence: { outcome: 'denied_sim_only' } } });
    const { user } = await boot();
    await open(user, 'B-09');
    await user.click(screen.getByTestId('dry-run'));
    await waitFor(() => expect(screen.getByTestId('result-panel')).toHaveAttribute('data-state', 'denied'));
    expect(screen.getByTestId('refusal-banner')).toHaveTextContent('Refused by the server (sim-only rail): tenant is live');
  });

  it('shows lost evidence as an alert', async () => {
    fake.execute = (id, body) => {
      const r = okExecute(id, body);
      return { status: 200, body: { ...r.body, evidencePersisted: false, evidenceLost: true, evidenceError: 'disk full' } };
    };
    const { user } = await boot();
    await open(user, 'B-09');
    await user.click(screen.getByTestId('dry-run'));
    expect(await screen.findByTestId('evidence-lost-banner')).toHaveTextContent('Cause: disk full');
    expect(screen.getByTestId('evidence-row-1')).toHaveAttribute('data-evidence-lost', 'true');
  });
});

describe('DP-1 / DP-2 (recurring cost)', () => {
  const costReply = (id: string, body: any) => {
    const r = okExecute(id, body);
    const ev = (r.body as any).evidence;
    ev.metadata.costGate = { classification: 'recurring', ackHash: 'h-123', monthlyUsd: 1597, priceDate: '2026-10-31', costKey: 'azure.firewall.premium' };
    return r;
  };

  it('shows the panel only for a recurring op; DP-1 stays disabled until a dry run returns the notice', async () => {
    fake.execute = costReply;
    const { user, container } = await boot();
    await open(user, 'A-02');
    expect(screen.queryByTestId('cost-gate-panel')).toBeNull();

    await user.click(screen.getByTestId('cmd-F-12'));
    await screen.findByTestId('cost-gate-panel');
    expect(screen.getByTestId('cost-ack')).toBeDisabled();
    expect(screen.getByTestId('cost-notice')).toHaveTextContent('run a DRY RUN first');
    expect(screen.getByTestId('cost-no-other-means')).toBeInTheDocument();

    await user.click(screen.getByTestId('dry-run'));
    await waitFor(() => expect(screen.getByTestId('cost-ack')).toBeEnabled());
    expect(screen.getByTestId('cost-notice')).toHaveTextContent('about $1597.00 a month');
    expect(screen.getByTestId('cost-notice')).toHaveTextContent('type "F-12 1597.00"');
    expect(screen.getByTestId('confirm-cost')).toHaveAttribute('placeholder', 'DP-2: type F-12 1597.00');
    expect(await seriousAxe(container)).toEqual([]);
  });

  it('APPLY sends costAck (with the operator) and confirmCost; nothing cost-related without the tick', async () => {
    fake.execute = costReply;
    const { user } = await boot();
    await open(user, 'F-12');
    await user.click(screen.getByTestId('dry-run'));
    await waitFor(() => expect(screen.getByTestId('apply')).toBeEnabled());

    // Without the tick and the typed text: no DP-1, no DP-2 (the server refuses, dp1_missing).
    await user.click(screen.getByTestId('apply'));
    await user.click(await screen.findByTestId('fw-confirm-ok'));
    await waitFor(() => expect(fake.executeCalls()).toHaveLength(2));
    expect(fake.executeCalls()[1].body).not.toHaveProperty('costAck');
    expect(fake.executeCalls()[1].body).not.toHaveProperty('confirmCost');

    await user.type(screen.getByTestId('requestor-upn'), 'operator@example.test');
    await user.click(screen.getByTestId('cost-ack'));
    await user.type(screen.getByTestId('cost-no-other-means'), 'NSG rules cannot inspect FQDNs');
    await user.type(screen.getByTestId('confirm-cost'), 'F-12 1597.00');
    await user.click(screen.getByTestId('apply'));
    await user.click(await screen.findByTestId('fw-confirm-ok'));
    await waitFor(() => expect(fake.executeCalls()).toHaveLength(3));
    const body = fake.executeCalls()[2].body;
    expect(body).toMatchObject({
      dryRun: false,
      confirmApply: 'F-12',
      confirmCost: 'F-12 1597.00',
      requestorUPN: 'operator@example.test',
      costAck: { opId: 'F-12', ackHash: 'h-123', monthlyUsd: 1597, priceDate: '2026-10-31', operator: 'operator@example.test', noOtherMeans: 'NSG rules cannot inspect FQDNs' },
    });
    expect(typeof body.costAck.at).toBe('string');
  });
});

describe('F-11 / F-12 confirmation and pre-check', () => {
  it('APPLY opens the confirmation; CANCEL sends nothing', async () => {
    const { user } = await boot();
    await open(user, 'F-12');
    await user.click(screen.getByTestId('dry-run'));
    await waitFor(() => expect(screen.getByTestId('apply')).toBeEnabled());
    await user.click(screen.getByTestId('apply'));
    expect(await screen.findByTestId('fw-confirm-title')).toHaveTextContent('Confirm Firewall ALLOCATE');
    await user.click(screen.getByTestId('fw-confirm-cancel'));
    expect(screen.queryByTestId('fw-confirm-modal')).toBeNull();
    expect(fake.executeCalls()).toHaveLength(1);
  });

  it('CHECK CURRENT STATE reads AllocationState from the dry run', async () => {
    fake.execute = (id, body) => {
      const r = okExecute(id, body);
      (r.body as any).result.stdout = JSON.stringify(JSON.stringify({ AllocationState: 'Allocated', ProvisioningState: 'Succeeded' }));
      return r;
    };
    const { user } = await boot();
    await open(user, 'F-12');
    await user.click(screen.getByTestId('fw-precheck-btn'));
    await waitFor(() => expect(screen.getByTestId('fw-precheck-badge')).toHaveTextContent('ALLOCATED'));
    expect(screen.getByTestId('fw-precheck-prov-badge')).toHaveTextContent('SUCCEEDED');
    expect(screen.getByTestId('fw-precheck-warning')).toHaveTextContent('already ALLOCATED');
  });
});

describe('two-person approval: hidden while off', () => {
  it('a Tier 3 op shows no APPROVALS button, no requestor or approval-id field, and applies for one operator', async () => {
    const { user } = await boot();
    expect(screen.queryByTestId('approvals-open')).toBeNull();
    await open(user, 'B-09');
    expect(screen.getByText(/two-person approval is off/)).toBeInTheDocument();
    expect(within(screen.getByTestId('form-params')).getByTestId('no-params')).toBeInTheDocument();
    await user.click(screen.getByTestId('dry-run'));
    await waitFor(() => expect(screen.getByTestId('apply')).toBeEnabled());
    expect(screen.queryByTestId('approval-id')).toBeNull();
    expect(screen.queryByTestId('requestor-upn')).toBeNull();
    await user.click(screen.getByTestId('apply'));
    await waitFor(() => expect(screen.getByTestId('result-panel')).toHaveAttribute('data-state', 'executed'));
    expect(screen.queryByTestId('approvals-open')).toBeNull();
  });

  it('a 202 pending approval turns the controls on and pre-fills the approval id', async () => {
    fake.execute = (id, body) =>
      body.dryRun ? okExecute(id, body) : { status: 202, body: { status: 'pending_approval', approvalId: 'apr-1', message: 'awaiting second person', evidencePersisted: true } };
    const { user } = await boot();
    await open(user, 'B-09');
    await user.click(screen.getByTestId('dry-run'));
    await waitFor(() => expect(screen.getByTestId('apply')).toBeEnabled());
    await user.click(screen.getByTestId('apply'));
    await waitFor(() => expect(screen.getByTestId('result-panel')).toHaveAttribute('data-state', 'pending_approval'));
    expect(screen.getByTestId('result-panel')).toHaveAttribute('data-approval-id', 'apr-1');
    expect(screen.getByTestId('result-panel')).toHaveAttribute('data-outcome', 'blocked_pending_approval');
    expect(screen.getByTestId('approvals-open')).toBeInTheDocument();
    expect(screen.getByTestId('approval-id')).toHaveValue('apr-1');
    expect(screen.getByTestId('result-output')).toBeInTheDocument();
    expect(screen.getByTestId('requestor-upn')).toBeInTheDocument();
  });

  it('a row recording mode "on" shows the controls; a later "off" hides them again', async () => {
    let mode = 'on';
    fake.execute = (id, body) => {
      const r = okExecute(id, body);
      (r.body as any).evidence.metadata.twoPersonApproval = { mode, tierRequired: true };
      return r;
    };
    const { user } = await boot();
    await open(user, 'B-09');
    await user.click(screen.getByTestId('dry-run'));
    await screen.findByTestId('approvals-open');
    mode = 'off';
    await user.click(screen.getByTestId('dry-run'));
    await waitFor(() => expect(screen.queryByTestId('approvals-open')).toBeNull());
  });

  it('pending approvals at load show the count; the dialog decides with the x-ces-principal token', async () => {
    fake.pending = [{ approvalId: 'apr-9', commandId: 'B-09', commandTitle: 'Grant Privileged Role', requestorUPN: 'requestor@example.test', status: 'pending', inputs: {} }];
    const { user, container } = await boot();
    const btn = await screen.findByTestId('approvals-open');
    expect(screen.getByTestId('approvals-count')).toHaveTextContent('(1)');
    await user.click(btn);
    expect(await screen.findByTestId('approval-apr-9')).toHaveAttribute('data-status', 'pending');
    expect(await seriousAxe(container)).toEqual([]);
    await user.type(screen.getByTestId('approver-token'), 'tok-approver');
    await user.click(screen.getByTestId('approve-apr-9'));
    await waitFor(() => expect(fake.calls.some((c) => c.method === 'POST' && c.url === '/api/approvals/apr-9/decision')).toBe(true));
    const decision = fake.calls.find((c) => c.url === '/api/approvals/apr-9/decision')!;
    expect(decision.headers['x-ces-principal']).toBe('tok-approver');
    expect(decision.body).toMatchObject({ decision: 'approve' });
    expect(await screen.findByTestId('approvals-notice')).toHaveTextContent('APPROVED');
  });

  it('a 401 decision records nothing and says sign-in is required', async () => {
    fake.pending = [{ approvalId: 'apr-9', commandId: 'B-09', requestorUPN: 'requestor@example.test', status: 'pending' }];
    fake.decision = { status: 401, body: { success: false, error: 'unauthenticated' } };
    const { user } = await boot();
    await user.click(await screen.findByTestId('approvals-open'));
    await user.click(await screen.findByTestId('approve-apr-9'));
    expect(await screen.findByTestId('approvals-notice')).toHaveTextContent('Sign-in required');
  });
});

describe('evidence rows with objectives', () => {
  it('each request that reaches the server adds a row with the command\'s objectives under its practices', async () => {
    const { user, container } = await boot();
    await open(user, 'A-02');
    await user.type(screen.getByTestId('param-targetUPN'), 'leaver@example.test');
    await user.click(screen.getByTestId('dry-run'));
    await waitFor(() => expect(screen.getByTestId('apply')).toBeEnabled());
    await user.click(screen.getByTestId('apply'));
    await waitFor(() => expect(screen.getByTestId('evidence-row-2')).toBeInTheDocument());
    const live = screen.getByTestId('evidence-row-2');
    expect(live).toHaveAttribute('data-mode', 'apply');
    expect(live).toHaveAttribute('data-verdict', 'SAT');
    expect(live).toHaveAttribute('data-correlation-id', fake.executeCalls()[1].body.correlationId);
    const objectives = within(screen.getByTestId('evidence-objectives-2'));
    expect(objectives.getByText('AC.L1-3.1.1')).toBeInTheDocument();
    expect(objectives.getByText(/AC\.L1-3\.1\.1\[a\]/)).toBeInTheDocument();
    expect(objectives.getByText(/PS\.L2-3\.9\.2\[b\]/)).toBeInTheDocument();
    expect(screen.getByTestId('evidence-row-1')).toHaveAttribute('data-mode', 'dry_run');
    expect(screen.getByTestId('form-objectives')).toHaveTextContent('display only');
    expect(await seriousAxe(container)).toEqual([]);
  });
});
