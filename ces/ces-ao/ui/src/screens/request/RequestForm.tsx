// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30: the request form (legacy #commandForm, L834-905 and openCommandForm L1216-1325).
// The flow is two explicit steps: 1 DRY RUN, then 2 APPLY. APPLY stays disabled until a dry run of
// this exact tenant, command and inputs has come back (the apply guard's UI half; the server's half
// is W4-AO5's confirmApply, which APPLY sends). Two-person inputs come from the kit and render only
// while two-person approval is on.

import { useEffect, useRef } from 'react';
import { ApprovalRequestFields } from 'ces-ui-kit';
import {
  applyUnlocked,
  closeCommand,
  confirmFirewall,
  dryRun,
  firewallPrecheck,
  needsRequestor,
  openCommand,
  requestApply,
  selectTenant,
  setInput,
  useAoStore,
} from '../../store/ao';
import { formParameters, isFirewall, isTier3, objectiveGroups, paramType } from '../../store/result';
import type { AoCommand } from '../../api';
import { CostPanel } from './CostPanel';
import { ResultPanel } from './ResultPanel';

export function tenantOptionLabel(t: { slug: string; kind: string }, liveAllowed: boolean): string {
  const note = t.kind === 'sim' ? 'sim' : liveAllowed ? t.kind : `${t.kind} — refused: server is sim-only`;
  return `${t.slug} (${note})`;
}

export function TenantSelect() {
  const tenants = useAoStore((s) => s.tenants);
  const tenant = useAoStore((s) => s.tenant);
  const liveAllowed = useAoStore((s) => s.liveAllowed);
  const routed = useAoStore((s) => s.stacksimModeActive);
  return (
    <div className="ao-row">
      <label htmlFor="tenantSelect" className="ao-label">
        Tenant
      </label>
      <select
        id="tenantSelect"
        data-testid="tenant-select"
        className={tenant ? '' : 'needs-selection'}
        title="Tenant to run against (required)"
        value={tenant}
        onChange={(e) => void selectTenant(e.target.value)}
      >
        <option value="">— select tenant —</option>
        {tenants.map((t) => (
          <option key={t.slug} value={t.slug}>
            {tenantOptionLabel(t, liveAllowed)}
          </option>
        ))}
      </select>
      <span
        id="stacksimModeBadge"
        data-testid="stacksim-mode-badge"
        className={`state-badge ${routed ? 'allocated' : 'deallocated'}`}
        title={
          routed
            ? 'This server process is routed to the stacksim simulator (STACKSIM_SERVER_URL + PSModulePath shim detected).'
            : 'This server process is NOT routed to stacksim — any sim-kind tenant will be refused by the executor.'
        }
      >
        {routed ? 'stacksim: ROUTED' : 'stacksim: NOT ROUTED'}
      </span>
    </div>
  );
}

function Params({ cmd }: { cmd: AoCommand }) {
  const inputs = useAoStore((s) => s.inputs);
  const params = formParameters(cmd);
  // Legacy keeps #formParams and puts the no-params note inside it (L1238-1240).
  return (
    <div id="formParams" data-testid="form-params" className="ao-params">
      {cmd.parameters.length === 0 ? (
        <p data-testid="no-params" className="ao-muted">
          No parameters required for this command.
        </p>
      ) : null}
      {params.map((p) => {
        const id = `param-${p.name}`;
        const label = `${p.label || p.name}${p.required ? ' *' : ''}`;
        const t = paramType(p);
        return (
          <div key={p.name} className="ao-param">
            <label htmlFor={id}>{label}</label>
            {t === 'select' ? (
              <select id={id} data-testid={id} required={p.required} value={inputs[p.name] ?? ''} onChange={(e) => setInput(p.name, e.target.value)}>
                {(p.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                id={id}
                data-testid={id}
                data-source={p.source}
                readOnly={t === 'readonly'}
                required={p.required}
                placeholder={p.placeholder || ''}
                value={inputs[p.name] ?? ''}
                onChange={(e) => setInput(p.name, e.target.value)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Objectives({ cmd }: { cmd: AoCommand }) {
  const groups = objectiveGroups(cmd);
  if (!groups.length) return null;
  return (
    <div className="ao-objectives" data-testid="form-objectives">
      <span className="ao-label">Evidences (display only; objectives never score)</span>
      <ul>
        {groups.map((g) => (
          <li key={g.control} data-control={g.control}>
            <span className="ao-mono">{g.control}</span>
            {g.objectives.length ? <span className="ao-mono ao-muted">{` ${g.objectives.join(', ')}`}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FirewallPrecheck() {
  const pc = useAoStore((s) => s.precheck);
  const busy = useAoStore((s) => s.busy);
  return (
    <div className="fw-precheck ao-row" id="firewallPrecheck" data-testid="fw-precheck">
      <button type="button" className="btn btn-secondary btn-small" id="precheckBtn" data-testid="fw-precheck-btn" disabled={busy} onClick={() => void firewallPrecheck()}>
        CHECK CURRENT STATE
      </button>
      {pc ? (
        <span id="precheckBadge" data-testid="fw-precheck-badge" className={`state-badge${pc.stateClass ? ` ${pc.stateClass}` : ''}`}>
          {pc.badge}
        </span>
      ) : null}
      {pc?.prov ? (
        <span id="precheckProvBadge" data-testid="fw-precheck-prov-badge" className="state-badge prov-badge">
          {pc.prov}
        </span>
      ) : null}
      {pc?.warning ? (
        <div id="precheckWarning" data-testid="fw-precheck-warning" className="fw-warning" role="alert">
          {pc.warning}
        </div>
      ) : null}
    </div>
  );
}

function FirewallConfirm({ cmd }: { cmd: AoCommand }) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => ok.current?.focus(), []);
  const deallocate = cmd.id === 'F-11';
  return (
    <div className="ao-overlay" id="confirmModal" data-testid="fw-confirm-modal">
      <div className="ao-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmModalTitle" aria-describedby="confirmModalText">
        <h3 id="confirmModalTitle" data-testid="fw-confirm-title">
          {deallocate ? 'Confirm Firewall DEALLOCATE' : 'Confirm Firewall ALLOCATE'}
        </h3>
        <p id="confirmModalText" data-testid="fw-confirm-text">
          {deallocate
            ? 'This will DEALLOCATE the Azure Firewall. Network egress filtering will STOP until re-allocated. Confirm?'
            : 'This will ALLOCATE the Azure Firewall. Network egress filtering will RESUME. Confirm?'}
        </p>
        <div className="ao-row">
          <button type="button" className="btn btn-secondary" id="confirmCancelBtn" data-testid="fw-confirm-cancel" onClick={() => void confirmFirewall(false)}>
            CANCEL
          </button>
          <button
            ref={ok}
            type="button"
            className={deallocate ? 'btn btn-destructive' : 'btn btn-primary'}
            id="confirmOkBtn"
            data-testid="fw-confirm-ok"
            onClick={() => void confirmFirewall(true)}
          >
            {deallocate ? 'CONFIRM DEALLOCATE' : 'CONFIRM ALLOCATE'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function RequestForm() {
  const openId = useAoStore((s) => s.openId);
  const commands = useAoStore((s) => s.commands);
  const twoPersonOn = useAoStore((s) => s.twoPersonOn);
  const requestorUpn = useAoStore((s) => s.requestorUpn);
  const approvalId = useAoStore((s) => s.approvalId);
  const busy = useAoStore((s) => s.busy);
  const confirmOpen = useAoStore((s) => s.confirmOpen);
  const unlocked = useAoStore((s) => applyUnlocked(s));
  const cmd = commands.find((c) => c.id === openId) ?? null;

  if (!cmd) {
    return (
      <section id="blankState" className="ao-blank" aria-label="No command open">
        <TenantSelect />
        <p className="ao-muted">Pick a command from the list, or search for one.</p>
      </section>
    );
  }

  const { kitFields, operatorField } = needsRequestor(cmd, twoPersonOn);

  return (
    <section id="commandForm" className="ao-form" aria-labelledby="formTitle">
      <h2 id="formTitle" data-testid="form-title" data-command-id={cmd.id}>
        <span className="ao-cmd-id">{cmd.id}</span> {cmd.title}
      </h2>
      <p id="formOverview" className="ao-overview">
        {cmd.overview}
      </p>
      <div className="ao-meta ao-muted">
        {[cmd.domainName, cmd.sodTier].filter(Boolean).join(' · ')}
        {isTier3(cmd) && !twoPersonOn ? ' · two-person approval is off' : ''}
      </div>
      <Objectives cmd={cmd} />
      <TenantSelect />
      <Params cmd={cmd} />
      {isFirewall(cmd) ? <FirewallPrecheck /> : null}
      <CostPanel cmd={cmd} />

      <div className="ao-row ao-request-fields">
        <ApprovalRequestFields
          live={unlocked}
          tier3={isTier3(cmd)}
          requestorUpn={requestorUpn}
          approvalId={approvalId}
          onRequestorUpnChange={(v) => useAoStore.setState({ requestorUpn: v })}
          onApprovalIdChange={(v) => useAoStore.setState({ approvalId: v })}
          twoPersonApproval={kitFields}
        />
        {operatorField ? (
          <input
            type="text"
            id="requestorUpnInput"
            data-testid="requestor-upn"
            aria-label="Operator UPN (recorded on DP-1)"
            placeholder="operator UPN (recorded on DP-1)"
            value={requestorUpn}
            onChange={(e) => useAoStore.setState({ requestorUpn: e.target.value })}
          />
        ) : null}
      </div>

      <ol className="ao-steps" aria-label="Request steps">
        <li>
          <button type="button" className="btn btn-secondary" id="dryRunBtn" data-testid="dry-run" disabled={busy} onClick={() => void dryRun()}>
            1 · DRY RUN
          </button>
        </li>
        <li>
          <button
            type="button"
            className="btn btn-primary"
            id="applyBtn"
            data-testid="apply"
            disabled={busy || !unlocked}
            aria-describedby="applyHint"
            onClick={() => void requestApply()}
          >
            2 · APPLY
          </button>
        </li>
        <li>
          <button type="button" className="btn btn-ghost" data-testid="form-cancel" onClick={() => closeCommand()}>
            CANCEL
          </button>
        </li>
      </ol>
      <p id="applyHint" className="ao-muted" data-testid="apply-hint">
        {unlocked
          ? 'APPLY makes the live write (the server still applies every gate).'
          : 'APPLY unlocks after a dry run of this exact request (tenant, command and inputs).'}
      </p>
      <ResultPanel />
      {confirmOpen && openCommand() ? <FirewallConfirm cmd={cmd} /> : null}
    </section>
  );
}
