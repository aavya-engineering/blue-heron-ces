// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Offboarding (PS.L2-3.9.2; legacy openOffboardingWizard / renderOffboardingWizard /
// completeOffboardingStep / finalizeOffboarding / cancelOffboarding). Each step is attested by a
// named person; the final sign-off names the attestor. Nothing here changes the tenant.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { eoApi } from '../../api/eo';
import { ApiError } from '../../api/http';
import type { OffboardingRun } from '../../api/types';
import { Card, Field, Notice, TenantRequired, useAction } from '../../components/common';
import { usePersonnel } from '../../components/personnelQueries';

const SLA_LABEL: Record<string, string> = { green: 'SLA: OK', yellow: 'SLA: Warning', red: 'SLA: Breach' };

function Wizard({ tenant, personId, run, setRun, onClosed }: { tenant: string; personId: string; run: OffboardingRun; setRun: (r: OffboardingRun | null) => void; onClosed: (text: string) => void }) {
  const qc = useQueryClient();
  const [attestor, setAttestor] = useState('');
  const [notes, setNotes] = useState('');
  const [finalAttestor, setFinalAttestor] = useState('');
  const act = useAction();
  const step = run.currentStepIndex < run.steps.length ? run.steps[run.currentStepIndex] : null;
  const allDone = run.steps.every((s) => s.completed);
  const done = run.steps.filter((s) => s.completed);
  const refresh = () => qc.invalidateQueries({ queryKey: ['personnel', tenant] });

  return (
    <>
      <div className="eo-row">
        <strong id="offboardingTitle">{`Offboarding: ${run.personnelName}`}</strong>
        <span id="offboardingSla">{SLA_LABEL[run.slaStatus ?? 'green'] ?? 'SLA: OK'}</span>
        <span id="offboardingProgress">{`Step ${Math.min(done.length + 1, run.steps.length)} of ${run.steps.length}`}</span>
      </div>
      {act.message ? <Notice kind={act.message.kind}>{act.message.text}</Notice> : null}
      {step ? (
        <div className="eo-gdb" id="offboardingCurrentStep">
          <p><strong>{step.label}</strong></p>
          <Field label="Attestor name (who performed this action)">
            <input id="offboardingAttestor" value={attestor} onChange={(e) => setAttestor(e.target.value)} />
          </Field>
          <Field label="Notes (optional)">
            <textarea id="offboardingNotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="eo-row">
            <button type="button" className="btn btn-primary btn-small" id="offboardingStepBtn" disabled={!attestor.trim() || act.busy}
              onClick={() => void act.run(async () => {
                const r = await eoApi.completeOffboardingStep(tenant, personId, step.id, { attestor: attestor.trim(), ...(notes.trim() ? { notes: notes.trim() } : {}) });
                setRun(r); setAttestor(''); setNotes('');
                return r;
              }, () => `${step.label}: completed.`)}>
              Complete step
            </button>
          </div>
        </div>
      ) : (
        <Notice kind="success">All steps completed. Finalize to generate the procedural overlay artifact.</Notice>
      )}
      {done.length ? (
        <ol aria-label="Completed steps">
          {done.map((s) => (
            <li key={s.id}>{`${s.label}${s.completedAt ? ` — ${new Date(s.completedAt).toLocaleString()}` : ''}${s.attestor ? ` by ${s.attestor}` : ''}${s.notes ? ` — ${s.notes}` : ''}`}</li>
          ))}
        </ol>
      ) : null}
      {allDone ? (
        <div className="eo-row">
          <Field label="Final sign-off attestor">
            <input id="offboardingFinalAttestor" value={finalAttestor} onChange={(e) => setFinalAttestor(e.target.value)} />
          </Field>
          <button type="button" className="btn btn-primary btn-small" id="offboardingFinalizeBtn" disabled={!finalAttestor.trim() || act.busy}
            onClick={() => void act.run(async () => { await eoApi.finalizeOffboarding(tenant, personId, finalAttestor.trim()); await refresh(); onClosed('Offboarding finalized.'); setRun(null); })}>
            Finalize offboarding
          </button>
        </div>
      ) : null}
      <div className="eo-row">
        <button type="button" className="btn btn-destructive btn-small" id="offboardingCancelBtn" disabled={act.busy}
          onClick={() => void act.run(async () => { await eoApi.cancelOffboarding(tenant, personId); await refresh(); onClosed('Offboarding cancelled; the person reverts to cleared.'); setRun(null); })}>
          Cancel offboarding
        </button>
      </div>
    </>
  );
}

function OffboardingBody({ tenant }: { tenant: string }) {
  const qc = useQueryClient();
  const people = usePersonnel(tenant);
  // FIN-31b: the Personnel ledger's Offboard / Resume offboarding hands over ?person=<id>.
  const [params] = useSearchParams();
  const [personId, setPersonId] = useState(params.get('person') ?? '');
  const [run, setRun] = useState<OffboardingRun | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const open = useAction();

  const openRun = () =>
    void open.run(async () => {
      setClosed(null);
      try {
        const r = await eoApi.offboarding(tenant, personId);
        setRun(r);
        return r;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          const r = await eoApi.startOffboarding(tenant, personId);
          setRun(r);
          await qc.invalidateQueries({ queryKey: ['personnel', tenant] });
          return r;
        }
        throw e;
      }
    });

  return (
    <Card title="Offboarding" id="eo-offboarding-card">
      <Field label="Person">
        <select id="offboardingPerson" value={personId} onChange={(e) => { setPersonId(e.target.value); setRun(null); }}>
          <option value="">Select a person...</option>
          {(people.data ?? []).filter((p) => p.screeningState !== 'offboarded').map((p) => (
            <option key={p.id} value={p.id}>{`${p.displayName} (${p.screeningState})`}</option>
          ))}
        </select>
      </Field>
      <div className="eo-row">
        <button type="button" className="btn btn-primary btn-small" id="offboardingOpenBtn" disabled={!personId || open.busy} onClick={openRun}>
          Open or start offboarding
        </button>
      </div>
      {open.message ? <Notice kind={open.message.kind}>{open.message.text}</Notice> : null}
      {closed ? <Notice kind="success">{closed}</Notice> : null}
      {run && personId ? <Wizard tenant={tenant} personId={personId} run={run} setRun={setRun} onClosed={setClosed} /> : null}
    </Card>
  );
}

export default function OffboardingScreen() {
  return <div className="eo-screen"><TenantRequired>{(t) => <OffboardingBody tenant={t} />}</TenantRequired></div>;
}
