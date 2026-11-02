// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Personnel (legacy page-personnel). FIN-31 ported the ledger, add and the in-progress / cleared
// moves. FIN-31b ports the rest: the PS readiness banner and metrics (GET /api/personnel/readiness),
// the state and training filters, per-person screening (x/7) and training (done/total) columns,
// edit, permanent delete (DELETE /api/personnel/:id/record), attachments, the 7-element screening
// accordion, offboarding hand-off, and the Policy and Setup inner tabs (GET|PUT /api/personnel/config).

import { useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { TabNav } from 'ces-ui-kit';
import { eoApi } from '../../api/eo';
import type { PersonnelConfig, PersonnelReadiness, PersonnelRecord, ScreeningReadiness, TrainingDetail } from '../../api/types';
import { Card, ConfirmButton, Field, Metric, Notice, TenantRequired, day, useAction } from '../../components/common';
import { usePersonnel, usePersonnelConfig } from '../../components/personnelQueries';
import { TrainingPanel } from '../training';
import { AttachmentsPanel, EditPanel, stateUpdates } from './PersonPanels';
import { ScreeningPanel } from './ScreeningPanel';

export { usePersonnel } from '../../components/personnelQueries';

/** The states an operator sets by hand from the ledger (legacy offers in-progress and cleared; ScreeningStateSchema). */
export const SCREENING_STATES = ['in-progress', 'cleared'] as const;

type TrainingStatus = NonNullable<TrainingDetail['status']>;

/** Legacy applyPersonnelFilter: the state filter, then the training filter; offboarded people sort last. */
export function filterPeople(
  records: PersonnelRecord[], stateFilter: string, trainingFilter: string, training: Record<string, TrainingStatus | undefined>,
): PersonnelRecord[] {
  let rows = records;
  if (stateFilter === 'active') rows = rows.filter((r) => r.screeningState !== 'offboarded' && r.screeningState !== 'offboarding-in-progress');
  else if (stateFilter === 'offboarding-in-progress' || stateFilter === 'offboarded') rows = rows.filter((r) => r.screeningState === stateFilter);
  rows = [...rows.filter((r) => r.screeningState !== 'offboarded'), ...rows.filter((r) => r.screeningState === 'offboarded')];
  if (trainingFilter !== 'all') {
    rows = rows.filter((r) => {
      const tc = training[r.id];
      if (!tc) return trainingFilter === 'partial';
      const pct = tc.total > 0 ? tc.completed / tc.total : 1;
      if (trainingFilter === 'compliant') return pct >= 1;
      if (trainingFilter === 'partial') return pct < 1 && tc.overdue === 0;
      if (trainingFilter === 'overdue') return tc.overdue > 0;
      return true;
    });
  }
  return rows;
}

/** Legacy loadPersonnelReadiness banner text. */
export function readinessText(r: PersonnelReadiness): { met: boolean; text: string } {
  if (r.total === 0) return { met: false, text: 'No personnel records. Add personnel to track screening compliance.' };
  if (r.ps_3_9_1 === 'met') {
    const at = r.at_3_2_1
      ? ` | AT.L2-3.2.1: ${r.at_3_2_1 === 'met' ? 'MET' : 'NOT MET'}, AT.L2-3.2.2: ${r.at_3_2_2 === 'met' ? 'MET' : 'NOT MET'}, AT.L2-3.2.3: ${r.at_3_2_3 === 'met' ? 'MET' : 'NOT MET'}`
      : '';
    return {
      met: true,
      text: `PS.L2-3.9.1: MET — All ${r.cleared} active personnel are cleared.${r.ps_3_9_2 === 'met' ? ' PS.L2-3.9.2: MET' : ' PS.L2-3.9.2: NOT MET — No offboarding records.'}`
        + `${r.screening_evidence_complete ? ' | Screening Evidence: Complete' : ' | Screening Evidence: Incomplete'}${at}`,
    };
  }
  const issues: string[] = [];
  if (r.unscreened > 0) issues.push(`${r.unscreened} unscreened`);
  if (r.expiringSoon > 0) issues.push(`${r.expiringSoon} expiring`);
  return { met: false, text: `PS.L2-3.9.1: NOT MET — ${issues.join(', ')}. ${r.cleared} of ${r.total} cleared.` };
}

type Panel = { kind: 'edit' | 'attachments' | 'screening' | 'training'; id: string } | null;

function Ledger({ tenant }: { tenant: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const people = usePersonnel(tenant);
  const cfg = usePersonnelConfig(tenant);
  const records = people.data ?? [];
  const trainingQ = useQueries({
    queries: records.map((p) => ({ queryKey: ['training-status', tenant, p.id], queryFn: () => eoApi.training(tenant, p.id), retry: false })),
  });
  const screeningQ = useQueries({
    queries: records.map((p) => ({ queryKey: ['screening-readiness', tenant, p.id], queryFn: () => eoApi.screeningReadiness(tenant, p.id), retry: false })),
  });
  const training: Record<string, TrainingStatus | undefined> = {};
  const screening: Record<string, ScreeningReadiness | undefined> = {};
  records.forEach((p, i) => { training[p.id] = trainingQ[i]?.data?.status; screening[p.id] = screeningQ[i]?.data; });

  const [stateFilter, setStateFilter] = useState('all');
  const [trainingFilter, setTrainingFilter] = useState('all');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const add = useAction();
  const upd = useAction();
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['personnel', tenant] });
    await qc.invalidateQueries({ queryKey: ['personnel-readiness', tenant] });
  };

  const setState = (p: PersonnelRecord, screeningState: string) =>
    void upd.run(async () => {
      const r = await eoApi.updatePersonnel(tenant, p.id, stateUpdates(screeningState, cfg.data?.reviewCycleYears));
      await refresh();
      return r;
    }, (r) => `${r.displayName}: ${r.screeningState}.`);

  const rows = filterPeople(records, stateFilter, trainingFilter, training);
  const current = panel ? records.find((r) => r.id === panel.id) ?? null : null;
  const toggle = (kind: NonNullable<Panel>['kind'], id: string) => setPanel(panel && panel.kind === kind && panel.id === id ? null : { kind, id });

  return (
    <>
      <Card title="Add person" id="eo-personnel-add">
        <div className="eo-grid-2">
          <Field label="Name"><input id="pAddName" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Email"><input id="pAddEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Role (job title)"><input id="pAddRole" value={role} onChange={(e) => setRole(e.target.value)} /></Field>
        </div>
        <div className="eo-row">
          <button type="button" className="btn btn-primary btn-small" id="pAddBtn" disabled={!name.trim() || !email.trim() || !role.trim() || add.busy}
            onClick={() => void add.run(async () => {
              const r = await eoApi.addPersonnel(tenant, { displayName: name.trim(), email: email.trim(), role: role.trim() });
              setName(''); setEmail(''); setRole('');
              await refresh();
              return r;
            }, (r) => `Added ${r.displayName}.`)}>
            Add person
          </button>
        </div>
        {add.message ? <Notice kind={add.message.kind}>{add.message.text}</Notice> : null}
      </Card>
      <Card title="Personnel ledger" id="eo-personnel-ledger">
        <div className="eo-row">
          <Field label="Filter">
            <select id="personnelFilterSelect" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="offboarding-in-progress">Offboarding in progress</option>
              <option value="offboarded">Offboarded</option>
            </select>
          </Field>
          <Field label="Training">
            <select id="personnelTrainingFilterSelect" value={trainingFilter} onChange={(e) => setTrainingFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="compliant">Compliant (100%)</option>
              <option value="partial">Partial (&lt;100%)</option>
              <option value="overdue">Overdue</option>
            </select>
          </Field>
        </div>
        {upd.message ? <Notice kind={upd.message.kind}>{upd.message.text}</Notice> : null}
        {people.isError ? <Notice kind="error">Personnel could not be loaded.</Notice> : null}
        <div className="eo-table-wrap">
          <table className="eo-table" id="personnelLedger">
            <thead>
              <tr>
                <th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Screening</th><th scope="col">Screened</th>
                <th scope="col">Review due</th><th scope="col">Elements</th><th scope="col">Training</th><th scope="col">Events</th>
                <th scope="col">Attachments</th><th scope="col">Change state</th><th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={12}>No personnel records. Add a person above.</td></tr> : rows.map((p) => {
                const sc = screening[p.id];
                const tc = training[p.id];
                const offboard = p.screeningState === 'offboarding-in-progress' || p.screeningState === 'offboarded';
                return (
                  <tr key={p.id} data-person={p.id}>
                    <td>{p.displayName}</td>
                    <td>{p.email}</td>
                    <td>{p.role}</td>
                    <td>{p.screeningState === 'offboarding-in-progress' ? 'offboarding...' : p.screeningState}</td>
                    <td>{day(p.lastScreenedDate)}</td>
                    <td>{day(p.nextReviewDate)}</td>
                    <td>
                      <button type="button" className="eo-linkbtn" aria-label={`Screening elements for ${p.displayName}`} aria-pressed={panel?.kind === 'screening' && panel.id === p.id}
                        onClick={() => toggle('screening', p.id)}>
                        {sc ? `${sc.elementsComplete.length}/7` : '—'}
                      </button>
                    </td>
                    <td>
                      <button type="button" className="eo-linkbtn" aria-label={`Training for ${p.displayName}`} aria-pressed={panel?.kind === 'training' && panel.id === p.id}
                        onClick={() => toggle('training', p.id)}>
                        {tc && tc.total > 0 ? `${tc.completed}/${tc.total}${tc.overdue > 0 ? ' (overdue)' : ''}` : '—'}
                      </button>
                    </td>
                    <td>{p.lifecycleEvents?.length ?? 0}</td>
                    <td>
                      <button type="button" className="eo-linkbtn" aria-label={`Attachments for ${p.displayName}`} aria-pressed={panel?.kind === 'attachments' && panel.id === p.id}
                        onClick={() => toggle('attachments', p.id)}>
                        {p.evidenceArtifacts?.length ?? 0}
                      </button>
                    </td>
                    <td>
                      {offboard ? (
                        <span className="eo-muted">See Offboarding</span>
                      ) : (
                        <select aria-label={`Screening state for ${p.displayName}`} value={p.screeningState}
                          onChange={(e) => setState(p, e.target.value)} disabled={upd.busy}>
                          {[...new Set([p.screeningState, ...SCREENING_STATES])].map((st) => <option key={st} value={st}>{st}</option>)}
                        </select>
                      )}
                    </td>
                    <td>
                      <div className="eo-row">
                        <button type="button" className="btn btn-ghost btn-small" aria-label={`Edit ${p.displayName}`} onClick={() => toggle('edit', p.id)}>Edit</button>
                        {p.screeningState === 'offboarding-in-progress' || ['cleared', 'expiring-soon', 'expired'].includes(p.screeningState) ? (
                          <button type="button" className="btn btn-secondary btn-small" aria-label={`${p.screeningState === 'offboarding-in-progress' ? 'Resume offboarding' : 'Offboard'} ${p.displayName}`}
                            onClick={() => navigate(`/offboarding?person=${encodeURIComponent(p.id)}`)}>
                            {p.screeningState === 'offboarding-in-progress' ? 'Resume offboarding' : 'Offboard'}
                          </button>
                        ) : null}
                        <ConfirmButton label="Delete" confirmLabel="Delete permanently" ariaLabel={`Delete ${p.displayName}`} disabled={upd.busy}
                          onConfirm={() => void upd.run(async () => {
                            await eoApi.deletePersonnel(tenant, p.id);
                            if (panel?.id === p.id) setPanel(null);
                            await refresh();
                          }, () => `Deleted ${p.displayName}.`)} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {current && panel?.kind === 'edit' ? <EditPanel key={current.id} tenant={tenant} person={current} reviewCycleYears={cfg.data?.reviewCycleYears} onClose={() => setPanel(null)} /> : null}
      {current && panel?.kind === 'attachments' ? <AttachmentsPanel tenant={tenant} person={current} onClose={() => setPanel(null)} /> : null}
      {current && panel?.kind === 'screening' ? <ScreeningPanel tenant={tenant} person={current} onClose={() => setPanel(null)} /> : null}
      {current && panel?.kind === 'training' ? (
        <Card title={`Training: ${current.displayName}`} id="eo-person-training"
          actions={<button type="button" className="btn btn-ghost btn-small" onClick={() => setPanel(null)}>Close</button>}>
          <TrainingPanel tenant={tenant} personId={current.id} />
        </Card>
      ) : null}
    </>
  );
}

/** Legacy Policy inner tab: which policy documents EO renders for personnel, and from what. */
function PolicyTab() {
  const docs: Array<[string, string, string]> = [
    ['EDC-POL-009: Personnel Security Screening Policy', 'Generated from tenant configuration and screening criteria.', 'EO_RENDER_POLICY_PERSONNEL_SCREENING'],
    ['EDC-POL-010: Personnel Termination and Transfer Procedure', 'Generated from the termination checklist configuration.', 'EO_RENDER_POLICY_PERSONNEL_TERMINATION'],
    ['EDC-POL-012: Personnel Training and Awareness Policy', 'Generated from the training catalog and configuration.', 'EO_RENDER_POLICY_PERSONNEL_TRAINING'],
  ];
  return (
    <Card title="Personnel policies" id="eo-personnel-policy">
      {docs.map(([t, d, directive]) => (
        <div key={t} className="eo-ssp-control">
          <strong>{t}</strong>
          <p className="eo-muted">{d} Rendered during evidence assessment by the <code className="eo-mono">{directive}</code> directive; the rendered documents are in the Policy store and the evidence package.</p>
        </div>
      ))}
    </Card>
  );
}

/** Legacy Setup inner tab (loadPersonnelConfig / savePersonnelConfig); the course catalog is edited on the Training screen. */
function SetupTab({ tenant }: { tenant: string }) {
  const qc = useQueryClient();
  const cfg = usePersonnelConfig(tenant);
  const save = useAction();
  const [draft, setDraft] = useState<PersonnelConfig | null>(null);
  const c: PersonnelConfig = draft ?? cfg.data ?? {};
  const num = (k: keyof PersonnelConfig, d: number) => (typeof c[k] === 'number' ? String(c[k]) : String(d));
  const str = (k: keyof PersonnelConfig, d: string) => (typeof c[k] === 'string' ? (c[k] as string) : d);
  const set = (k: keyof PersonnelConfig, v: unknown) => setDraft({ ...c, [k]: v });
  return (
    <Card title="Personnel setup" id="eo-personnel-setup">
      {cfg.isError ? <Notice kind="error">The personnel configuration could not be loaded.</Notice> : null}
      <div className="eo-grid-2">
        <Field label="Review cycle (years)"><input id="pConfigReviewCycle" type="number" min={1} max={10} value={num('reviewCycleYears', 5)} onChange={(e) => set('reviewCycleYears', parseInt(e.target.value, 10) || 5)} /></Field>
        <Field label="Document retention (years)"><input id="pConfigRetention" type="number" min={6} max={20} value={num('docRetentionYears', 6)} onChange={(e) => set('docRetentionYears', parseInt(e.target.value, 10) || 6)} /></Field>
        <Field label="Default screening vendor">
          <select id="pConfigVendor" value={str('defaultScreeningVendor', 'checkr')} onChange={(e) => set('defaultScreeningVendor', e.target.value)}>
            <option value="checkr">Checkr</option><option value="sterling">Sterling</option><option value="goodhire">GoodHire</option>
          </select>
        </Field>
        <Field label="CUI acknowledgment source"><input id="pConfigCuiSource" value={str('cuiAcknowledgmentSource', 'https://www.archives.gov/cui')} onChange={(e) => set('cuiAcknowledgmentSource', e.target.value)} /></Field>
        <Field label="Training grace period (days)"><input id="pConfigTrainingGrace" type="number" min={1} max={90} value={num('trainingGracePeriodDays', 30)} onChange={(e) => set('trainingGracePeriodDays', parseInt(e.target.value, 10) || 30)} /></Field>
        <Field label="Training refresh (years)"><input id="pConfigTrainingRefresh" type="number" min={1} max={5} value={num('trainingRefreshYears', 1)} onChange={(e) => set('trainingRefreshYears', parseInt(e.target.value, 10) || 1)} /></Field>
        <Field label="Training email from" hint="Shown in the generated text only; EO sends no email (FD-6)."><input id="pConfigTrainingEmailFrom" value={str('trainingEmailFrom', 'training@edc.local')} onChange={(e) => set('trainingEmailFrom', e.target.value)} /></Field>
        <Field label="Training email subject"><input id="pConfigTrainingEmailSubject" value={str('trainingEmailSubject', 'Required Training Assignment')} onChange={(e) => set('trainingEmailSubject', e.target.value)} /></Field>
      </div>
      <div className="eo-row">
        <button type="button" className="btn btn-primary btn-small" id="pConfigSave" disabled={save.busy}
          onClick={() => void save.run(async () => {
            const body: PersonnelConfig = {
              reviewCycleYears: parseInt(num('reviewCycleYears', 5), 10), docRetentionYears: parseInt(num('docRetentionYears', 6), 10),
              defaultScreeningVendor: str('defaultScreeningVendor', 'checkr'), cuiAcknowledgmentSource: str('cuiAcknowledgmentSource', 'https://www.archives.gov/cui'),
              trainingGracePeriodDays: parseInt(num('trainingGracePeriodDays', 30), 10), trainingRefreshYears: parseInt(num('trainingRefreshYears', 1), 10),
              trainingEmailFrom: str('trainingEmailFrom', 'training@edc.local'), trainingEmailSubject: str('trainingEmailSubject', 'Required Training Assignment'),
            };
            const r = await eoApi.savePersonnelConfig(tenant, body);
            setDraft(null);
            await qc.invalidateQueries({ queryKey: ['personnel-config', tenant] });
            return r;
          }, () => 'Saved.')}>
          Save configuration
        </button>
      </div>
      {save.message ? <Notice kind={save.message.kind}>{save.message.text}</Notice> : null}
    </Card>
  );
}

const INNER_TABS = [
  { id: 'ledger', label: 'Ledger', controls: 'eo-personnel-panel' },
  { id: 'policy', label: 'Policy', controls: 'eo-personnel-panel' },
  { id: 'setup', label: 'Setup', controls: 'eo-personnel-panel' },
];

function PersonnelBody({ tenant }: { tenant: string }) {
  const readiness = useQuery({ queryKey: ['personnel-readiness', tenant], queryFn: () => eoApi.personnelReadiness(tenant), retry: false });
  const [tab, setTab] = useState('ledger');
  const banner = readiness.data ? readinessText(readiness.data) : null;
  return (
    <>
      {banner ? <Notice kind={banner.met ? 'success' : 'warn'} id="personnelStatusText">{banner.text}</Notice> : null}
      {readiness.data ? (
        <div className="eo-metrics" id="personnelMetrics">
          <Metric label="Cleared" value={readiness.data.cleared} id="personnelCleared" />
          <Metric label="Active total" value={readiness.data.total} id="personnelTotal" />
          <Metric label="Expiring" value={readiness.data.expiringSoon} id="personnelExpiring" />
          <Metric label="Unscreened" value={readiness.data.unscreened} id="personnelUnscreened" />
        </div>
      ) : null}
      <TabNav label="Personnel sections" idPrefix="eo-ptab-" tabs={INNER_TABS} active={tab} onChange={setTab} />
      <div id="eo-personnel-panel" role="tabpanel" aria-labelledby={`eo-ptab-${tab}`} className="eo-screen">
        {tab === 'ledger' ? <Ledger tenant={tenant} /> : tab === 'policy' ? <PolicyTab /> : <SetupTab tenant={tenant} />}
      </div>
    </>
  );
}

export default function PersonnelScreen() {
  return <div className="eo-screen"><TenantRequired>{(t) => <PersonnelBody tenant={t} />}</TenantRequired></div>;
}
