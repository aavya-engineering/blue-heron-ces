// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W8-KIT3 editors: behaviour against the legacy pages, legacy ids, axe per component. Fictional data only.
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import type { ReactElement } from 'react';
import * as editors from './index';
import * as kit from '../index';
import {
  ApprovalCard,
  ApprovalList,
  ApprovalRequestFields,
  ApprovalsButton,
  EvidenceViewer,
  PendingApprovalNotice,
  RegistryEditor,
  TWO_PERSON_APPROVAL_DEFAULT,
  VariablesEditor,
  approveRequestBody,
  classifyVariable,
  collectRegistryEntry,
  entryToDraft,
  escId,
  normalizeEvidence,
  serializeConfig,
  serializeVariables,
  configToDraft,
  type ApprovalRecord,
  type EvidenceRecord,
  type RegistryEntry,
} from './index';
import { EditorsGallery, SAMPLE_EVIDENCE } from '../../gallery/EditorsGallery';

afterEach(cleanup);

async function seriousViolations(root: Element) {
  // jsdom cannot compute colour contrast; that rule runs in the browser (SPA axe run).
  const result = await axe.run(root, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

async function expectAxeClean(ui: ReactElement) {
  const { container } = render(ui);
  expect(await seriousViolations(container)).toEqual([]);
  cleanup();
}

const byId = (id: string) => document.getElementById(id) as HTMLElement;

// ── ApprovalCard ──────────────────────────────────────────────────────────────

describe('ApprovalCard single (Stamper approve/abort)', () => {
  it('task scope: legacy row id, three decisions, legacy POST /api/approve body', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard mode="single" scope="task" taskId="AU LOG.01" onDecision={onDecision} />);
    const row = byId('approval-AU-LOG-01');
    expect(row).toBeInTheDocument();
    const buttons = within(row).getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Approve', 'Accomplished', 'Skip']);
    fireEvent.click(within(row).getByRole('button', { name: 'Accomplished' }));
    expect(onDecision).toHaveBeenCalledWith('accomplish', { taskId: 'AU LOG.01', decision: 'accomplish' });
  });

  it('sub-command scope: legacy id, pre-check badge, idempotency hint, body with subId', () => {
    const onDecision = vi.fn();
    render(
      <ApprovalCard mode="single" scope="sub" taskId="T1" subId="set/1" preCheck={{ alreadyApplied: true }} idempotency="unsafe" onDecision={onDecision} />,
    );
    const row = byId('sub-approval-T1-set-1');
    expect(row).toHaveTextContent('✓ Already applied');
    expect(row).toHaveTextContent('(unsafe — side effects possible)');
    fireEvent.click(within(row).getByRole('button', { name: 'Approve' }));
    expect(onDecision).toHaveBeenCalledWith('approve', { taskId: 'T1', subId: 'set/1', decision: 'approve' });
  });

  it('layer scope: legacy id and labels, no Accomplished, body { layer, decision }', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard mode="single" scope="layer" layer={3} taskCount={4} onDecision={onDecision} />);
    const row = byId('layer-approval-3');
    expect(row).toHaveTextContent('Layer 3 (4 tasks)');
    expect(within(row).queryByRole('button', { name: 'Accomplished' })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Skip Layer' }));
    expect(onDecision).toHaveBeenCalledWith('skip', { layer: 3, decision: 'skip' });
  });

  it('Halt carries the id the execute screen passes (btnHalt) and calls onAbort', () => {
    const onAbort = vi.fn();
    render(<ApprovalCard mode="single" scope="task" taskId="T1" onDecision={() => {}} onAbort={onAbort} abortId="btnHalt" />);
    fireEvent.click(byId('btnHalt'));
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it('approveRequestBody and escId follow the legacy rules', () => {
    expect(approveRequestBody({ scope: 'task', taskId: 'a' }, 'skip')).toEqual({ taskId: 'a', decision: 'skip' });
    expect(escId('a.b c/d_e-f')).toBe('a-b-c-d_e-f');
  });
});

const PENDING: ApprovalRecord = {
  approvalId: 'apr-fixture-0001',
  commandId: 'AO-USR-DISABLE',
  commandTitle: 'Disable a user account',
  requestorUPN: 'dana.okafor@ridgeline.example',
  createdAt: '2026-10-29T13:40:00Z',
  inputs: { upn: 'contractor7@ridgeline.example' },
  status: 'pending',
};

describe('ApprovalCard two-person (AdminOps Tier-3)', () => {
  it('shows requestor and approval id with the AdminOps test ids; a different approver can approve', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard mode="two-person" twoPersonApproval approval={PENDING} approverUpn="lee.marsh@ridgeline.example" onDecision={onDecision} />);
    const row = screen.getByTestId('approval-apr-fixture-0001');
    expect(row).toHaveAttribute('data-status', 'pending');
    expect(row).toHaveAttribute('data-command-id', 'AO-USR-DISABLE');
    expect(row).toHaveTextContent('requestor: dana.okafor@ridgeline.example');
    expect(row).toHaveTextContent('approvalId: apr-fixture-0001');
    fireEvent.click(screen.getByTestId('approve-apr-fixture-0001'));
    expect(onDecision).toHaveBeenCalledWith({ approvalId: 'apr-fixture-0001', decision: 'approve' });
  });

  it('requestor cannot approve their own request (case-insensitive)', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard mode="two-person" twoPersonApproval approval={PENDING} approverUpn=" Dana.Okafor@Ridgeline.example " onDecision={onDecision} />);
    expect(screen.getByTestId('approve-apr-fixture-0001')).toBeDisabled();
    expect(screen.getByTestId('reject-apr-fixture-0001')).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent('different person than the requestor');
  });

  it('reject asks for a reason and sends it', () => {
    const onDecision = vi.fn();
    render(<ApprovalCard mode="two-person" twoPersonApproval approval={PENDING} approverUpn="lee.marsh@ridgeline.example" onDecision={onDecision} />);
    fireEvent.click(screen.getByTestId('reject-apr-fixture-0001'));
    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: ' wrong user ' } });
    fireEvent.click(screen.getByTestId('reject-confirm-apr-fixture-0001'));
    expect(onDecision).toHaveBeenCalledWith({ approvalId: 'apr-fixture-0001', decision: 'reject', reason: 'wrong user' });
  });

  it('decided rows show the status badge, approver and evidence-loss alert', () => {
    render(
      <ApprovalCard
        mode="two-person" twoPersonApproval
        approval={{ ...PENDING, status: 'approved', approverUPN: 'lee.marsh@ridgeline.example', decidedAt: 'later', evidencePersisted: false }}
        onDecision={() => {}}
      />,
    );
    expect(screen.queryByTestId('approve-apr-fixture-0001')).toBeNull();
    expect(screen.getByText('APPROVED')).toBeInTheDocument();
    expect(screen.getByText(/decided by lee.marsh@ridgeline.example at later/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('EVIDENCE NOT PERSISTED');
  });

  it('ApprovalList: AdminOps ids, filter, empty and error states', () => {
    const onStatusChange = vi.fn();
    const base = {
      status: 'pending' as const,
      onStatusChange,
      approverUpn: '',
      onApproverUpnChange: () => {},
      approverToken: '',
      onApproverTokenChange: () => {},
      onRefresh: () => {},
      onDecision: () => {},
    };
    const { rerender } = render(<ApprovalList twoPersonApproval {...base} approvals={[PENDING]} />);
    for (const id of ['approvalsStatusFilter', 'approverUpnInput', 'approverTokenInput', 'approvalsList']) expect(byId(id)).toBeInTheDocument();
    expect(byId('approverTokenInput')).toHaveAttribute('type', 'password');
    fireEvent.change(byId('approvalsStatusFilter'), { target: { value: 'executed' } });
    expect(onStatusChange).toHaveBeenCalledWith('executed');
    rerender(<ApprovalList twoPersonApproval {...base} approvals={[]} />);
    expect(byId('approvalsList')).toHaveTextContent('no pending approvals');
    rerender(<ApprovalList twoPersonApproval {...base} approvals={[]} error="offline" />);
    expect(byId('approvalsList')).toHaveTextContent('failed to load approvals: offline');
  });

  it('request fields only for a live Tier-3 run; pending notice carries the approval id', () => {
    const fields = { requestorUpn: '', approvalId: '', onRequestorUpnChange: () => {}, onApprovalIdChange: () => {} };
    const { rerender } = render(<ApprovalRequestFields twoPersonApproval live={false} tier3 {...fields} />);
    expect(document.getElementById('requestorUpnInput')).toBeNull();
    rerender(<ApprovalRequestFields twoPersonApproval live tier3 {...fields} />);
    expect(byId('requestorUpnInput')).toBeInTheDocument();
    expect(byId('approvalIdInput')).toBeInTheDocument();
    rerender(<PendingApprovalNotice twoPersonApproval approvalId="apr-fixture-0009" />);
    expect(screen.getByRole('status')).toHaveTextContent('approvalId: apr-fixture-0009');
  });

  it('W9-C1: two-person mode is OFF by default and renders nothing until re-enabled', () => {
    expect(TWO_PERSON_APPROVAL_DEFAULT).toBe(false);
    const fields = { requestorUpn: '', approvalId: '', onRequestorUpnChange: () => {}, onApprovalIdChange: () => {} };
    const { container } = render(
      <>
        <ApprovalCard mode="two-person" approval={PENDING} approverUpn="lee.marsh@ridgeline.example" onDecision={() => {}} />
        <ApprovalsButton pendingCount={2} onOpen={() => {}} />
        <ApprovalRequestFields live tier3 {...fields} />
        <PendingApprovalNotice approvalId="apr-fixture-0009" />
        <ApprovalList
          approvals={[PENDING]}
          status="pending"
          onStatusChange={() => {}}
          approverUpn=""
          onApproverUpnChange={() => {}}
          approverToken=""
          onApproverTokenChange={() => {}}
          onRefresh={() => {}}
          onDecision={() => {}}
        />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
    render(<ApprovalsButton twoPersonApproval pendingCount={2} onOpen={() => {}} />);
    expect(screen.getByTestId('approvals-count')).toHaveTextContent('(2)');
  });

  it('axe: single, two-person and list are clean', async () => {
    await expectAxeClean(<ApprovalCard mode="single" scope="task" taskId="T1" onDecision={() => {}} onAbort={() => {}} abortId="btnHalt" />);
    await expectAxeClean(<ApprovalCard mode="two-person" twoPersonApproval approval={PENDING} approverUpn={PENDING.requestorUPN} onDecision={() => {}} />);
    await expectAxeClean(
      <ApprovalList
        twoPersonApproval
        approvals={[PENDING]}
        status="pending"
        onStatusChange={() => {}}
        approverUpn=""
        onApproverUpnChange={() => {}}
        approverToken=""
        onApproverTokenChange={() => {}}
        onRefresh={() => {}}
        onDecision={() => {}}
      />,
    );
  });
});

// ── EvidenceViewer ────────────────────────────────────────────────────────────

describe('EvidenceViewer', () => {
  it('normalizeEvidence merges a JSON evidenceContent and wraps raw text', () => {
    expect(normalizeEvidence({ outcome: 'a', evidenceContent: '{"complianceVerdict":"SAT"}' }).complianceVerdict).toBe('SAT');
    expect(normalizeEvidence('plain output')).toEqual({ rawResponse: 'plain output' });
    expect(normalizeEvidence('{"outcome":"x"}')).toEqual({ outcome: 'x' });
  });

  it('pop-out: legacy ids, title, controls, verdict, sections, OK', () => {
    const onOk = vi.fn();
    render(<EvidenceViewer mode="popout" evidence={SAMPLE_EVIDENCE} onOk={onOk} />);
    expect(byId('evidenceTitle')).toHaveTextContent('AU-LOG-RET-01 — Unified audit log retention');
    expect(within(byId('cmmcControls')).getAllByText(/AU\.L2/)).toHaveLength(2);
    expect(byId('verdictBadge')).toHaveTextContent('SAT');
    expect(byId('outcomeLabel')).toHaveTextContent('Outcome: state verified');
    expect(byId('commandSection')).toHaveTextContent('Command Executed (SET)');
    expect(byId('commandSection')).toHaveTextContent('GET Command (Template)');
    expect(byId('resultsSection')).toHaveTextContent('"changed": 1');
    expect(byId('stateDiffSection')).toHaveTextContent('ThreeYears');
    expect(byId('registryMetadata')).toHaveTextContent('L2');
    expect(byId('metadataGrid')).toHaveTextContent('simulator (s1-mach)');
    expect(byId('fullEvidenceSection')).not.toHaveAttribute('open');
    expect(document.querySelector('#resultsSection .json-null')).toHaveTextContent('null');
    fireEvent.click(byId('okButton'));
    expect(onOk).toHaveBeenCalledTimes(1);
  });

  it('pop-out: failure diagnostics, pending default, manual command hidden', () => {
    const failed: EvidenceRecord = {
      complianceVerdict: undefined,
      failureDiagnostics: { rootCause: 'Module missing', failureCategory: 'prerequisite', remediationSteps: ['Install it'] },
      metadata: { commandExecuted: '[manual gate]' },
    };
    render(<EvidenceViewer mode="popout" evidence={failed} onOk={() => {}} />);
    expect(byId('verdictBadge')).toHaveTextContent('PENDING');
    expect(byId('failureSection')).toHaveTextContent('Root Cause: Module missing');
    expect(document.getElementById('commandSection')).toBeNull();
    expect(byId('evidenceTitle')).toHaveTextContent('[manual gate]');
  });

  it('overlay: hidden when closed; legacy ids; Escape, backdrop and close button call onClose', () => {
    const onClose = vi.fn();
    const { rerender } = render(<EvidenceViewer mode="overlay" open={false} evidence={SAMPLE_EVIDENCE} onClose={onClose} />);
    expect(document.getElementById('evidenceViewerOverlay')).toBeNull();
    rerender(<EvidenceViewer mode="overlay" open evidence={SAMPLE_EVIDENCE} onClose={onClose} />);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('AU-LOG-RET-01 — Unified audit log retention');
    expect(byId('evidenceViewerBody')).toHaveTextContent('Results Received (Raw Response)');
    expect(document.getElementById('verdictBadge')).toBeNull();
    expect(screen.getByRole('button', { name: 'Close evidence' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(byId('evidenceViewerOverlay'));
    fireEvent.click(screen.getByRole('button', { name: 'Close evidence' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('overlay: nav bar, no-evidence and null states', () => {
    const onNext = vi.fn();
    const { rerender } = render(
      <EvidenceViewer
        mode="overlay"
        open
        evidence={{ noEvidence: true, expectedPath: 'evidence/x.json' }}
        onClose={() => {}}
        nav={{ index: 0, total: 3, onPrev: () => {}, onNext }}
      />,
    );
    expect(byId('evidenceNavCounter')).toHaveTextContent('1/3');
    expect(byId('evidenceNavPrevBtn')).toBeDisabled();
    fireEvent.click(byId('evidenceNavNextBtn'));
    expect(onNext).toHaveBeenCalled();
    expect(byId('evidenceViewerBody')).toHaveTextContent('No Evidence Found');
    expect(byId('evidenceViewerBody')).toHaveTextContent('evidence/x.json');
    rerender(<EvidenceViewer mode="overlay" open evidence={null} onClose={() => {}} />);
    expect(byId('evidenceViewerBody')).toHaveTextContent('No evidence data available.');
  });

  it('state verification block from the legacy modal', () => {
    render(
      <EvidenceViewer
        mode="overlay"
        open
        onClose={() => {}}
        evidence={{
          verificationResult: { passed: true, reason: 'matched', stateVerificationDetails: { method: 'regex', confidence: 'HIGH', confidenceScore: 95 } },
        }}
      />,
    );
    expect(screen.getByText('95/100')).toBeInTheDocument();
    expect(document.querySelector('.ck-ev-tone-high')).not.toBeNull();
  });

  it('axe: overlay and pop-out are clean', async () => {
    await expectAxeClean(<EvidenceViewer mode="overlay" open evidence={SAMPLE_EVIDENCE} onClose={() => {}} nav={{ index: 0, total: 2, onPrev() {}, onNext() {} }} />);
    await expectAxeClean(<EvidenceViewer mode="popout" evidence={SAMPLE_EVIDENCE} onOk={() => {}} />);
  });
});

// ── VariablesEditor ───────────────────────────────────────────────────────────

const CONFIG = {
  client: { slug: 'ridgeline-machining', name: 'Ridgeline Machining' },
  tenant: { domain: 'ridgeline.example', environment: 'gcc' },
  last_session: { translate_paths: ['a'] },
};
const VARS = { operatorUpn: 'operator@ridgeline.example', cuiGroupName: '', sessionHours: 8, apiSecret: 's', _internal: 'x', 'config_intent.a': 1 };

function renderVariables(overrides: Partial<Parameters<typeof VariablesEditor>[0]> = {}) {
  const props = {
    tenant: 'ridgeline-machining',
    config: CONFIG,
    variables: VARS,
    resolvable: ['cuiGroupName'],
    onSaveConfig: vi.fn(),
    onSaveConfigAs: vi.fn(),
    onSaveVariables: vi.fn(),
    ...overrides,
  };
  render(<VariablesEditor {...props} />);
  return props;
}

describe('VariablesEditor', () => {
  it('empty state for no tenant and the dev tenant', () => {
    render(<VariablesEditor tenant="dev" config={{}} variables={{}} onSaveConfig={() => {}} onSaveConfigAs={() => {}} onSaveVariables={() => {}} />);
    expect(byId('emptyState')).toHaveTextContent('No tenant selected.');
  });

  it('config tab: populated fields, section counts, dirty state, Save sends the legacy shape', () => {
    const props = renderVariables();
    expect(byId('tenantName')).toHaveTextContent('ridgeline-machining');
    expect(document.querySelector('[data-path="client.name"]')).toHaveValue('Ridgeline Machining');
    expect(byId('cfgClientCount')).toHaveTextContent('2/3');
    expect(byId('cfgResourcesCount')).toHaveTextContent('0/32');
    expect(byId('cfgEndpointsBody')).not.toBeVisible();
    expect(byId('configSaveBtn')).toBeDisabled();
    fireEvent.change(document.querySelector('[data-path="client.engagement_id"]') as Element, { target: { value: 'ENG-7' } });
    expect(byId('configDirtyHint')).toHaveTextContent('Unsaved changes');
    fireEvent.click(byId('configSaveBtn'));
    expect(props.onSaveConfig).toHaveBeenCalledWith({
      client: { slug: 'ridgeline-machining', name: 'Ridgeline Machining', engagement_id: 'ENG-7' },
      tenant: { domain: 'ridgeline.example', environment: 'gcc' },
      last_session: { translate_paths: ['a'] },
    });
  });

  it('Save As validates the slug and sets client.slug', () => {
    const props = renderVariables();
    fireEvent.click(screen.getByRole('button', { name: 'Save As' }));
    const slug = screen.getByLabelText(/New tenant slug/);
    fireEvent.change(slug, { target: { value: 'bad slug!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save As' }));
    expect(byId('toast')).toHaveTextContent('Invalid slug');
    fireEvent.change(slug, { target: { value: 'larkspur-avionics' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save As' }));
    expect(props.onSaveConfigAs).toHaveBeenCalledWith('larkspur-avionics', expect.objectContaining({ client: expect.objectContaining({ slug: 'larkspur-avionics' }) }));
  });

  it('search filters rows, expands collapsed sections and shows No matches', () => {
    renderVariables();
    fireEvent.change(byId('searchInput'), { target: { value: 'exchange_env' } });
    expect(byId('cfgEndpointsBody')).toBeVisible();
    expect(document.querySelector('[data-path="client.name"]')).toBeNull();
    fireEvent.change(byId('searchInput'), { target: { value: 'zzz-nothing' } });
    expect(byId('configNoResults')).toHaveTextContent('No matches');
  });

  it('variables tab: categories, hidden keys skipped, secrets masked, missing badge, resolve button', async () => {
    renderVariables();
    fireEvent.click(screen.getByRole('tab', { name: 'Variables' }));
    expect(document.querySelector('[data-var="_internal"]')).toBeNull();
    expect(document.querySelector('[data-var="config_intent.a"]')).toBeNull();
    expect(document.querySelector('[data-var="apiSecret"]')).toHaveAttribute('type', 'password');
    expect(document.querySelector('[data-var="cuiGroupName"]')).toHaveAttribute('data-resolvable', 'true');
    expect(screen.getByText('Controlled Unclassified Information')).toBeInTheDocument();
    expect(screen.getByText('Tenant Configuration Parameters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show apiSecret' }));
    expect(document.querySelector('[data-var="apiSecret"]')).toHaveAttribute('type', 'text');
  });

  it('Resolve All sends only empty resolvable names, fills values, then Save coerces types', async () => {
    const onResolveAll = vi.fn(async () => ({ resolved: { cuiGroupName: 'CUI-Enclave-Users' }, notFound: ['x'] }));
    const props = renderVariables({ onResolveAll });
    fireEvent.click(screen.getByRole('tab', { name: 'Variables' }));
    expect(byId('variablesSaveBtn')).toBeDisabled();
    await act(async () => {
      fireEvent.click(byId('resolveAllBtn'));
    });
    expect(onResolveAll).toHaveBeenCalledWith(['cuiGroupName']);
    expect(document.querySelector('[data-var="cuiGroupName"]')).toHaveValue('CUI-Enclave-Users');
    expect(byId('toast')).toHaveTextContent('Resolved 1 variable. 1 not found');
    fireEvent.click(byId('variablesSaveBtn'));
    expect(props.onSaveVariables).toHaveBeenCalledWith({
      operatorUpn: 'operator@ridgeline.example',
      cuiGroupName: 'CUI-Enclave-Users',
      sessionHours: 8,
      apiSecret: 's',
    });
  });

  it('Resolve All with nothing to resolve reports it; single resolve fills one field', async () => {
    const onResolve = vi.fn(() => ({ resolved: { cuiGroupName: 'Group-A' } }));
    renderVariables({ variables: { cuiGroupName: '' }, resolvable: ['cuiGroupName'], onResolve, onResolveAll: vi.fn() });
    fireEvent.click(screen.getByRole('tab', { name: 'Variables' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resolve cuiGroupName from tenant' }));
    });
    expect(document.querySelector('[data-var="cuiGroupName"]')).toHaveValue('Group-A');
    expect(byId('toast')).toHaveTextContent('Resolved cuiGroupName');
    await act(async () => {
      fireEvent.click(byId('resolveAllBtn'));
    });
    expect(byId('toast')).toHaveTextContent('No empty resolvable variables to resolve');
  });

  it('serialize helpers match the legacy rules', () => {
    expect(serializeVariables({ a: 'true', b: 'false', c: '12', d: ' 12', e: '', f: 'x' })).toEqual({ a: true, b: false, c: 12, d: ' 12', e: '', f: 'x' });
    expect(classifyVariable('cmkKeyName')).toBe('si');
    expect(classifyVariable('kvName')).toBe('cui');
    expect(classifyVariable('operatorUpn')).toBe('cui');
    expect(classifyVariable('sessionHours')).toBe('tcp');
    expect(serializeConfig(configToDraft({ client: { slug: 'a' }, auth: { app_id: '' } }), {})).toEqual({ client: { slug: 'a' } });
  });

  it('axe: both tabs are clean', async () => {
    const { container } = render(
      <VariablesEditor tenant="ridgeline-machining" config={CONFIG} variables={VARS} resolvable={['cuiGroupName']} onSaveConfig={() => {}} onSaveConfigAs={() => {}} onSaveVariables={() => {}} />,
    );
    expect(await seriousViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole('tab', { name: 'Variables' }));
    expect(await seriousViolations(container)).toEqual([]);
  });
});

// ── RegistryEditor ────────────────────────────────────────────────────────────

const ENTRIES: RegistryEntry[] = [
  { entry_id: 'AU-LOG-RET-01', label: 'Audit retention', control_ids: ['AU.L2-3.3.1'], engine: 'ipps', get_command: 'Get-X {a}', idempotency: 'get-then-set', layer_hint: 2 },
  { entry_id: 'AC-SESSION-02', label: 'Sign-in frequency', engine: 'unknown-engine', manual_only: true },
];

describe('RegistryEditor', () => {
  it('collectRegistryEntry reproduces the legacy save body', () => {
    const result = collectRegistryEntry(entryToDraft(ENTRIES[0]));
    expect(result).toEqual({
      entry: {
        entry_id: 'AU-LOG-RET-01',
        control_ids: ['AU.L2-3.3.1'],
        label: 'Audit retention',
        engine: 'ipps',
        get_command: 'Get-X {a}',
        set_command: undefined,
        idempotency: 'get-then-set',
        variables_required: undefined,
        variables_runtime: undefined,
        captures: [],
        layer_hint: 2,
        sequence_hint: 0,
        manual_only: undefined,
        on_failure: 'abort_step',
        evidence_commands: undefined,
        verification: {},
        notes: undefined,
      },
    });
    expect(collectRegistryEntry({ ...entryToDraft(ENTRIES[0]), captures: '{bad' })).toEqual({ error: 'Invalid JSON in captures field' });
    expect(entryToDraft(ENTRIES[1]).engine).toBe('mgraph');
  });

  it('navigation, counter, search and type toggle', () => {
    const onRegistryTypeChange = vi.fn();
    render(<RegistryEditor registryType="m365" entries={ENTRIES} onRegistryTypeChange={onRegistryTypeChange} onSave={() => {}} />);
    expect(byId('registryEntryCounter')).toHaveTextContent('Entry 1 of 2');
    expect(byId('regPrevBtn')).toBeDisabled();
    expect(byId('reg_entry_id')).toHaveValue('AU-LOG-RET-01');
    expect(byId('reg_entry_id')).toHaveAttribute('readonly');
    fireEvent.click(byId('regNextBtn'));
    expect(byId('reg_entry_id')).toHaveValue('AC-SESSION-02');
    expect(byId('reg_manual_only')).toBeChecked();
    fireEvent.change(byId('searchInput'), { target: { value: 'au-log' } });
    expect(byId('searchResultsCount')).toHaveTextContent('1 of 2');
    expect(byId('reg_entry_id')).toHaveValue('AU-LOG-RET-01');
    fireEvent.change(byId('searchInput'), { target: { value: 'nothing' } });
    expect(byId('registryFormContainer')).toHaveTextContent('No entries found.');
    fireEvent.click(byId('regToggleInfra'));
    expect(onRegistryTypeChange).toHaveBeenCalledWith('infra');
    expect(byId('regToggleM365')).toHaveAttribute('aria-pressed', 'true');
  });

  it('Save sends the edited entry; invalid JSON blocks the save', () => {
    const onSave = vi.fn();
    render(<RegistryEditor registryType="infra" entries={ENTRIES} onRegistryTypeChange={() => {}} onSave={onSave} />);
    fireEvent.change(byId('reg_label'), { target: { value: '  New label ' } });
    fireEvent.click(byId('regSaveBtn'));
    expect(onSave).toHaveBeenCalledWith('infra', expect.objectContaining({ entry_id: 'AU-LOG-RET-01', label: 'New label' }));
    fireEvent.change(byId('reg_verification'), { target: { value: '{nope' } });
    fireEvent.click(byId('regSaveBtn'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(byId('toast')).toHaveTextContent('Invalid JSON in verification field');
  });

  it('Resolve needs a tenant; resolve box text; variable status', async () => {
    const onResolveCommand = vi.fn(async () => ({ resolved: 'Get-X 1', unresolved: ['b'] }));
    const { rerender } = render(
      <RegistryEditor registryType="m365" entries={ENTRIES} tenant="dev" onRegistryTypeChange={() => {}} onSave={() => {}} onResolveCommand={onResolveCommand} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resolve GET' }));
    });
    expect(byId('toast')).toHaveTextContent('Select a tenant first');
    rerender(
      <RegistryEditor
        registryType="m365"
        entries={ENTRIES}
        tenant="ridgeline-machining"
        varStatus={{ unresolved: ['a'] }}
        onRegistryTypeChange={() => {}}
        onSave={() => {}}
        onResolveCommand={onResolveCommand}
      />,
    );
    expect(byId('varStatusText')).toHaveTextContent('Missing: a');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resolve SET' }));
    });
    expect(byId('toast')).toHaveTextContent('No SET command to resolve');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resolve GET' }));
    });
    expect(onResolveCommand).toHaveBeenCalledWith('get', 'Get-X {a}');
    expect(byId('registryResolveBox').textContent).toBe('# GET Command (Resolved)\n\nGet-X 1\n\n# Unresolved Variables:\n- {b}\n');
  });

  it('onEntryShown fires for each entry shown', () => {
    const onEntryShown = vi.fn();
    render(<RegistryEditor registryType="m365" entries={ENTRIES} onRegistryTypeChange={() => {}} onSave={() => {}} onEntryShown={onEntryShown} />);
    fireEvent.click(byId('regNextBtn'));
    expect(onEntryShown.mock.calls.map((c) => (c[0] as RegistryEntry).entry_id)).toEqual(['AU-LOG-RET-01', 'AC-SESSION-02']);
  });

  it('axe: clean', async () => {
    await expectAxeClean(
      <RegistryEditor registryType="m365" entries={ENTRIES} tenant="ridgeline-machining" varStatus={{ unresolved: [] }} onRegistryTypeChange={() => {}} onSave={() => {}} />,
    );
  });
});

// ── Barrel and gallery ────────────────────────────────────────────────────────

describe('editors API and gallery', () => {
  it('editors/index.ts exports ApprovalCard (W8-KIT3 landed-when) and the rest; the kit index re-exports them', () => {
    for (const name of ['ApprovalCard', 'ApprovalList', 'EvidenceViewer', 'VariablesEditor', 'RegistryEditor']) {
      expect(typeof (editors as Record<string, unknown>)[name]).toBe('function');
      expect((kit as Record<string, unknown>)[name]).toBe((editors as Record<string, unknown>)[name]);
    }
  });

  it('gallery entries render and are axe-clean, with the overlay open too', async () => {
    const { container } = render(<EditorsGallery />);
    expect(await seriousViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Open evidence overlay' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(byId('evidenceNavNextBtn'));
    expect(byId('evidenceViewerBody')).toHaveTextContent('No Evidence Found');
    expect(await seriousViolations(container)).toEqual([]);
  });
});
