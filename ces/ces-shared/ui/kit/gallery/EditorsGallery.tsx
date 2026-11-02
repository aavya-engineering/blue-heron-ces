// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Gallery entries for the W8-KIT3 editors. Every name here is fictional (AR6).
import { useState } from 'react';
import {
  ApprovalCard,
  ApprovalList,
  ApprovalRequestFields,
  ApprovalsButton,
  EvidenceViewer,
  PendingApprovalNotice,
  RegistryEditor,
  VariablesEditor,
  type ApprovalRecord,
  type ApprovalStatus,
  type EvidenceRecord,
  type RegistryEntry,
  type RegistryType,
  type TenantConfig,
} from '../src';

export const SAMPLE_EVIDENCE: EvidenceRecord = {
  complianceVerdict: 'SAT',
  verdictRationale: 'Audit log retention matches the plan value.',
  outcome: 'state_verified',
  outcomeRationale: 'Post-set read shows the expected retention.',
  registryEntry: {
    entry_id: 'AU-LOG-RET-01',
    label: 'Unified audit log retention',
    engine: 'ipps',
    layer_hint: 2,
    sequence_hint: 4,
    idempotency: 'get-then-set',
    on_failure: 'abort_step',
    control_ids: ['AU.L2-3.3.1', 'AU.L2-3.3.2'],
    get_command: 'Get-UnifiedAuditLogRetentionPolicy',
    set_command: 'Set-UnifiedAuditLogRetentionPolicy -RetentionDuration {retentionDuration}',
  },
  metadata: {
    commandExecuted: 'Set-UnifiedAuditLogRetentionPolicy -RetentionDuration ThreeYears',
    preStateOutput: '{"RetentionDuration":"OneYear"}',
    postStateOutput: '{"RetentionDuration":"ThreeYears"}',
    stateChanged: true,
    timestamp: '2026-10-29T14:02:11Z',
    executorIdentity: 'operator@ridgeline.example',
    environment: 'simulator (s1-mach)',
    sha256Hash: 'fixture-digest-not-real',
  },
  rawResponse: '{"ok":true,"changed":1,"note":null}',
};

const SAMPLE_CONFIG: TenantConfig = {
  client: { slug: 'ridgeline-machining', name: 'Ridgeline Machining', engagement_id: 'ENG-0042' },
  tenant: { tenant_id: 'tenant-guid-fixture', domain: 'ridgeline.example', environment: 'gcchigh' },
  auth: { app_id: 'app-id-fixture' },
  subscription: { location: 'usgovvirginia' },
};

const SAMPLE_VARIABLES = {
  operatorUpn: 'operator@ridgeline.example',
  cuiGroupName: '',
  retentionDuration: 'ThreeYears',
  sessionHours: 8,
  initialPassword: '',
};

const SAMPLE_ENTRIES: RegistryEntry[] = [
  {
    entry_id: 'AU-LOG-RET-01',
    label: 'Unified audit log retention',
    control_ids: ['AU.L2-3.3.1'],
    engine: 'ipps',
    get_command: 'Get-UnifiedAuditLogRetentionPolicy',
    set_command: 'Set-UnifiedAuditLogRetentionPolicy -RetentionDuration {retentionDuration}',
    idempotency: 'get-then-set',
    layer_hint: 2,
    sequence_hint: 4,
    on_failure: 'abort_step',
  },
  {
    entry_id: 'AC-SESSION-02',
    label: 'Sign-in frequency',
    control_ids: ['AC.L2-3.1.11'],
    engine: 'mgraph',
    get_command: 'Get-MgIdentityConditionalAccessPolicy',
    idempotency: 'unsafe_requires_gate',
    manual_only: true,
    on_failure: 'warn_continue',
  },
];

const SAMPLE_APPROVALS: ApprovalRecord[] = [
  {
    approvalId: 'apr-fixture-0001',
    commandId: 'AO-USR-DISABLE',
    commandTitle: 'Disable a user account',
    requestorUPN: 'dana.okafor@ridgeline.example',
    createdAt: '2026-10-29T13:40:00Z',
    inputs: { upn: 'contractor7@ridgeline.example' },
    status: 'pending',
  },
  {
    approvalId: 'apr-fixture-0002',
    commandId: 'AO-CA-BREAKGLASS',
    commandTitle: 'Exclude break-glass from a policy',
    requestorUPN: 'lee.marsh@ridgeline.example',
    createdAt: '2026-10-29T13:52:00Z',
    inputs: { policy: 'Require MFA' },
    status: 'pending',
  },
];

export function EditorsGallery() {
  const [log, setLog] = useState<string[]>([]);
  const note = (line: string) => setLog((l) => [line, ...l].slice(0, 6));
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [navIndex, setNavIndex] = useState(0);
  const [regType, setRegType] = useState<RegistryType>('m365');
  const [status, setStatus] = useState<ApprovalStatus>('pending');
  const [approverUpn, setApproverUpn] = useState('dana.okafor@ridgeline.example');
  const [token, setToken] = useState('');
  const [requestor, setRequestor] = useState('');
  const [approvalId, setApprovalId] = useState('');

  return (
    <>
      <section className="gal-section" aria-labelledby="gal-approval">
        <div className="ces-titleblock">
          <h2 id="gal-approval" className="tb-title">Approval card</h2>
          <span className="tb-designator">ApprovalCard</span>
        </div>
        <h3 className="gal-subhead">single: task, sub-command (already applied), layer, with Halt</h3>
        <ApprovalCard mode="single" scope="task" taskId="AU-LOG-RET-01" idempotency="get-then-set" onDecision={(d, body) => note(`task ${d}: ${JSON.stringify(body)}`)} />
        <ApprovalCard
          mode="single"
          scope="sub"
          taskId="AU-LOG-RET-01"
          subId="set-1"
          preCheck={{ alreadyApplied: true }}
          idempotency="unsafe"
          onDecision={(d, body) => note(`sub ${d}: ${JSON.stringify(body)}`)}
        />
        <ApprovalCard
          mode="single"
          scope="layer"
          layer={2}
          taskCount={5}
          onDecision={(d, body) => note(`layer ${d}: ${JSON.stringify(body)}`)}
          onAbort={() => note('halt')}
          abortId="galleryHalt"
        />
        <h3 className="gal-subhead">two-person: the approver below is the first requestor, so that row is blocked</h3>
        <ApprovalsButton pendingCount={SAMPLE_APPROVALS.length} onOpen={() => note('open approvals')} />
        <ApprovalList
          approvals={SAMPLE_APPROVALS.filter((a) => a.status === status)}
          status={status}
          onStatusChange={setStatus}
          approverUpn={approverUpn}
          onApproverUpnChange={setApproverUpn}
          approverToken={token}
          onApproverTokenChange={setToken}
          onRefresh={() => note('refresh')}
          onDecision={(r) => note(`decision: ${JSON.stringify(r)}`)}
        />
        <ApprovalRequestFields
          live
          tier3
          requestorUpn={requestor}
          approvalId={approvalId}
          onRequestorUpnChange={setRequestor}
          onApprovalIdChange={setApprovalId}
        />
        <PendingApprovalNotice approvalId="apr-fixture-0003" message="Tier-3 command AO-USR-DISABLE needs a second approver." />
        <ul className="gal-note" aria-label="Approval callbacks" id="galleryApprovalLog">
          {log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </section>

      <section className="gal-section" aria-labelledby="gal-evidence">
        <div className="ces-titleblock">
          <h2 id="gal-evidence" className="tb-title">Evidence viewer</h2>
          <span className="tb-designator">EvidenceViewer</span>
        </div>
        <button type="button" className="btn btn-secondary gal-reset" onClick={() => setOverlayOpen(true)}>
          Open evidence overlay
        </button>
        <EvidenceViewer
          mode="overlay"
          open={overlayOpen}
          evidence={navIndex === 0 ? SAMPLE_EVIDENCE : { noEvidence: true, expectedPath: 'evidence/ridgeline-machining/AC-SESSION-02.json' }}
          onClose={() => setOverlayOpen(false)}
          nav={{ index: navIndex, total: 2, onPrev: () => setNavIndex(0), onNext: () => setNavIndex(1) }}
        />
        <h3 className="gal-subhead">Pop-out page</h3>
        <EvidenceViewer mode="popout" evidence={SAMPLE_EVIDENCE} onOk={() => note('evidence ok')} />
      </section>

      <section className="gal-section" aria-labelledby="gal-variables">
        <div className="ces-titleblock">
          <h2 id="gal-variables" className="tb-title">Variables editor</h2>
          <span className="tb-designator">VariablesEditor</span>
        </div>
        <VariablesEditor
          idPrefix="galVars-"
          tenant="ridgeline-machining"
          pathHint="tenants/ridgeline-machining.json"
          config={SAMPLE_CONFIG}
          variables={SAMPLE_VARIABLES}
          resolvable={['cuiGroupName']}
          onSaveConfig={() => note('save config')}
          onSaveConfigAs={(slug) => note(`save config as ${slug}`)}
          onSaveVariables={(v) => note(`save variables ${JSON.stringify(v)}`)}
          onResolve={(name) => ({ resolved: { [name]: 'CUI-Enclave-Users' } })}
          onResolveAll={(names) => ({ resolved: Object.fromEntries(names.map((n) => [n, 'CUI-Enclave-Users'])) })}
        />
      </section>

      <section className="gal-section" aria-labelledby="gal-registry">
        <div className="ces-titleblock">
          <h2 id="gal-registry" className="tb-title">Registry editor</h2>
          <span className="tb-designator">RegistryEditor</span>
        </div>
        <RegistryEditor
          idPrefix="galReg-"
          registryType={regType}
          entries={regType === 'm365' ? SAMPLE_ENTRIES : []}
          onRegistryTypeChange={setRegType}
          onSave={(type, entry) => note(`save ${type}/${entry.entry_id}`)}
          tenant="ridgeline-machining"
          varStatus={{ unresolved: ['retentionDuration'] }}
          onResolveCommand={(_which, command) => ({ resolved: command.replace('{retentionDuration}', 'ThreeYears') })}
        />
      </section>
    </>
  );
}
