// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// The annual risk-assessment review (legacy openAnnualReviewWizard / renderAnnualReviewStep /
// saveAnnualReviewStep / finalizeAnnualReview / cancelAnnualReview / oneClickAnnualReview).
// Six steps: scope, threats, vulnerability sources, scoring, treatment, AO sign-off. Each Next saves
// the step (PUT .../annual-review/step/:n); Finalize creates the immutable yearly snapshot.
// Deviation from legacy, on purpose: legacy step 3 shows fixed, invented finding counts
// ("47 findings", "Connected"). This port shows the configured sources, whether each is enabled,
// and how many register entries came from it, all read from EO.

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { eoApi } from '../../api/eo';
import { ApiError } from '../../api/http';
import type { AnnualReviewState, RiskEntry } from '../../api/types';
import { Card, ConfirmButton, Field, Notice, pretty, useAction } from '../../components/common';
import { LEVELS, RECOMMENDATION, compositeRisk, summarize } from './riskModel';

const STEP_LABELS = ['Scope', 'Threats', 'Vulnerability sources', 'Scoring', 'Treatment', 'Sign-off'];

/** Legacy step-3 source ids, with the register source type each one feeds. */
const VULN_SOURCES: Array<{ id: 'defender_for_cloud' | 'microsoft_secure_score' | 'plan_output_not_met' | 'sentinel_incidents'; name: string; entryType: string }> = [
  { id: 'defender_for_cloud', name: 'Defender for Cloud', entryType: 'defender_for_cloud' },
  { id: 'microsoft_secure_score', name: 'Microsoft Secure Score', entryType: 'secure_score' },
  { id: 'plan_output_not_met', name: 'Plan Output (Not Met)', entryType: 'plan_output' },
  { id: 'sentinel_incidents', name: 'Sentinel Incidents', entryType: 'sentinel_alert' },
];

type StepData = Record<string, any>;

export function AnnualReview({ tenant, entries, onClose, onDone }: { tenant: string; entries: RiskEntry[]; onClose: () => void; onDone: () => Promise<void> }) {
  const cfg = useQuery({ queryKey: ['risk-config', tenant], queryFn: () => eoApi.riskConfig(tenant), retry: false });
  const [state, setState] = useState<AnnualReviewState | null>(null);
  const [step, setStep] = useState(1);
  const [data, setData] = useState<StepData>({});
  const [done, setDone] = useState<string | null>(null);
  const act = useAction();

  useEffect(() => {
    void act.run(async () => {
      let s: AnnualReviewState;
      try {
        s = await eoApi.annualReviewState(tenant);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
        s = await eoApi.startAnnualReview(tenant, 'Authorizing Official');
      }
      setState(s);
      setStep(s.currentStep);
      return s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  useEffect(() => { setData((state?.stepData?.[String(step)] as StepData | undefined) ?? {}); }, [state, step]);

  const set = (k: string, v: unknown) => setData((d) => ({ ...d, [k]: v }));
  const setIn = (k: string, id: string, v: unknown) => setData((d) => ({ ...d, [k]: { ...(d[k] ?? {}), [id]: v } }));

  if (done) return <Card title="Annual risk assessment review" id="eo-annual-review"><Notice kind="success">{done}</Notice><button type="button" className="btn btn-ghost btn-small" onClick={onClose}>Close</button></Card>;
  if (!state) return <Card title="Annual risk assessment review" id="eo-annual-review">{act.message ? <Notice kind={act.message.kind}>{act.message.text}</Notice> : <p className="eo-muted">Opening the review...</p>}</Card>;

  const config = cfg.data ?? {};
  const catalog = [...(config.threatCatalog?.adversarial ?? []), ...(config.threatCatalog?.non_adversarial ?? [])];

  /** Legacy collectStepData defaults for fields the operator did not touch. */
  const stepBody = (): StepData => {
    switch (step) {
      case 1: return { scopeText: data.scopeText ?? config.scopeStatement ?? '', scopeConfirmed: !!data.scopeConfirmed };
      case 2: {
        const rel: Record<string, string> = {};
        for (const t of catalog) { const key = t.source.replace(/\s+/g, '_'); rel[key] = data.threatRelevance?.[key] ?? 'relevant'; }
        return { threatRelevance: rel, newThreats: data.newThreats ?? '' };
      }
      case 3: {
        const acks: Record<string, boolean> = {};
        for (const s of VULN_SOURCES) acks[s.id] = !!data.sourceAcknowledgments?.[s.id];
        return { sourceAcknowledgments: acks };
      }
      case 4: {
        const scores: Record<string, { likelihood: string | null; impact: string | null }> = {};
        for (const e of entries) scores[e.id] = { likelihood: data.scores?.[e.id]?.likelihood ?? e.likelihood ?? null, impact: data.scores?.[e.id]?.impact ?? e.impact ?? null };
        return { scores };
      }
      case 5: {
        const treatments: Record<string, { recommendation: string; reference: string }> = {};
        for (const e of entries) treatments[e.id] = { recommendation: data.treatments?.[e.id]?.recommendation ?? e.treatmentRecommendation ?? 'mitigate', reference: data.treatments?.[e.id]?.reference ?? e.treatmentReference ?? '' };
        return { treatments };
      }
      default: return { aoName: data.aoName ?? config.authorizingOfficial?.displayName ?? '', attestation: data.attestation ?? '', signOffMethod: data.signOffMethod ?? 'electronic' };
    }
  };

  const next = () => void act.run(async () => {
    const body = stepBody();
    if (step === 1 && !body.scopeConfirmed) throw new Error('Confirm the scope statement before proceeding.');
    const s = await eoApi.saveAnnualReviewStep(tenant, step, body);
    setState(s);
    setStep(s.currentStep);
    return s;
  }, () => `Step ${step} saved.`);

  const finalize = () => void act.run(async () => {
    const body = stepBody();
    if (!body.aoName) throw new Error('The Authorizing Official name is required.');
    if (!body.attestation) throw new Error('The AO attestation is required to finalize the review.');
    await eoApi.saveAnnualReviewStep(tenant, 6, body);
    const snap = await eoApi.completeAnnualReview(tenant, String(body.aoName), String(body.attestation));
    await onDone();
    setDone(`Annual review complete. Snapshot ${snap.assessmentYear ?? ''} created.`);
  });

  const s6 = step === 6 ? stepBody() : null;
  const counts = summarize(entries).byLevel;

  return (
    <Card title="Annual risk assessment review" id="eo-annual-review"
      actions={<button type="button" className="btn btn-ghost btn-small" id="annualReviewClose" onClick={onClose}>Close (progress is kept)</button>}>
      <ol className="eo-steps" aria-label="Review steps">
        {STEP_LABELS.map((l, i) => (
          <li key={l} className={i + 1 < step ? 'eo-step-done' : i + 1 === step ? 'eo-step-active' : 'eo-step-pending'} aria-current={i + 1 === step ? 'step' : undefined}>{`${i + 1}. ${l}`}</li>
        ))}
      </ol>

      {step === 1 ? (
        <section aria-label="Step 1: scope confirmation" id="arStep1">
          <Field label="Current scope statement"><textarea id="arScopeText" rows={4} value={stepBody().scopeText} onChange={(e) => set('scopeText', e.target.value)} /></Field>
          <label className="eo-check"><input type="checkbox" id="arScopeConfirm" checked={!!data.scopeConfirmed} onChange={(e) => set('scopeConfirmed', e.target.checked)} /><span>I confirm the scope statement is accurate for this review period</span></label>
        </section>
      ) : null}

      {step === 2 ? (
        <section aria-label="Step 2: threat catalog review" id="arStep2">
          <p className="eo-muted">Review each threat source and confirm relevance.</p>
          {catalog.length === 0 ? <p className="eo-muted">No threat catalog entries configured (Setup tab).</p> : catalog.map((t) => {
            const key = t.source.replace(/\s+/g, '_');
            return (
              <Field key={key} label={`${t.source} (${t.events.length} events)`}>
                <select value={data.threatRelevance?.[key] ?? 'relevant'} onChange={(e) => setIn('threatRelevance', key, e.target.value)}>
                  <option value="relevant">Still relevant</option><option value="mitigated">Mitigated</option><option value="new_variants">New variants</option>
                </select>
              </Field>
            );
          })}
          <Field label="New threats identified"><textarea id="arNewThreats" rows={3} value={data.newThreats ?? ''} onChange={(e) => set('newThreats', e.target.value)} /></Field>
        </section>
      ) : null}

      {step === 3 ? (
        <section aria-label="Step 3: vulnerability source check" id="arStep3">
          <p className="eo-muted">Confirm each vulnerability source is configured and feeding the register.</p>
          {VULN_SOURCES.map((s) => {
            const enabled = !!config.vulnerabilitySources?.[s.id]?.enabled;
            const n = entries.filter((e) => e.source?.type === s.entryType).length;
            return (
              <label key={s.id} className="eo-check">
                <input type="checkbox" className="ar-source-ack" checked={!!data.sourceAcknowledgments?.[s.id]} onChange={(e) => setIn('sourceAcknowledgments', s.id, e.target.checked)} />
                <span>{`${s.name}: ${enabled ? 'enabled' : 'disabled'} in setup, ${n} register entr${n === 1 ? 'y' : 'ies'}. Acknowledged`}</span>
              </label>
            );
          })}
        </section>
      ) : null}

      {step === 4 ? (
        <section aria-label="Step 4: re-score risk entries" id="arStep4">
          {entries.length === 0 ? <p className="eo-muted">No risk entries in the register.</p> : (
            <div className="eo-table-wrap">
              <table className="eo-table">
                <thead><tr><th scope="col">Entry</th><th scope="col">Likelihood</th><th scope="col">Impact</th><th scope="col">Composite</th></tr></thead>
                <tbody>
                  {entries.map((e) => {
                    const lk = data.scores?.[e.id]?.likelihood ?? e.likelihood ?? '';
                    const im = data.scores?.[e.id]?.impact ?? e.impact ?? '';
                    const setScore = (k: 'likelihood' | 'impact', v: string) => setIn('scores', e.id, { likelihood: lk || null, impact: im || null, [k]: v || null });
                    return (
                      <tr key={e.id}>
                        <td>{e.threatEvent ?? 'Untitled'}</td>
                        <td><select aria-label={`Likelihood for ${e.threatEvent ?? e.id}`} value={lk} onChange={(ev) => setScore('likelihood', ev.target.value)}><option value="">--</option>{LEVELS.map((l) => <option key={l} value={l}>{pretty(l)}</option>)}</select></td>
                        <td><select aria-label={`Impact for ${e.threatEvent ?? e.id}`} value={im} onChange={(ev) => setScore('impact', ev.target.value)}><option value="">--</option>{LEVELS.map((l) => <option key={l} value={l}>{pretty(l)}</option>)}</select></td>
                        <td>{compositeRisk(lk || undefined, im || undefined) ? pretty(compositeRisk(lk, im)) : 'Not scored'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {step === 5 ? (
        <section aria-label="Step 5: treatment recommendations" id="arStep5">
          {entries.length === 0 ? <p className="eo-muted">No risk entries in the register.</p> : (
            <div className="eo-table-wrap">
              <table className="eo-table">
                <thead><tr><th scope="col">Entry</th><th scope="col">Treatment</th><th scope="col">Reference</th></tr></thead>
                <tbody>
                  {entries.map((e) => {
                    const rec = data.treatments?.[e.id]?.recommendation ?? e.treatmentRecommendation ?? 'mitigate';
                    const ref = data.treatments?.[e.id]?.reference ?? e.treatmentReference ?? '';
                    const needsPoam = rec === 'mitigate' && e.treatmentStatus !== 'mitigated';
                    return (
                      <tr key={e.id}>
                        <td>{e.threatEvent ?? 'Untitled'}{needsPoam ? <strong> [POA&amp;M]</strong> : null}</td>
                        <td><select aria-label={`Treatment for ${e.threatEvent ?? e.id}`} value={rec} onChange={(ev) => setIn('treatments', e.id, { recommendation: ev.target.value, reference: ref })}>{RECOMMENDATION.map((r) => <option key={r} value={r}>{pretty(r)}</option>)}</select></td>
                        <td><input aria-label={`Reference for ${e.threatEvent ?? e.id}`} value={ref} placeholder="POA&M-001" onChange={(ev) => setIn('treatments', e.id, { recommendation: rec, reference: ev.target.value })} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {step === 6 && s6 ? (
        <section aria-label="Step 6: AO sign-off" id="arStep6">
          <p>{`Register: ${entries.length} entries — very high ${counts.very_high}, high ${counts.high}, moderate ${counts.moderate}, low ${counts.low}, very low ${counts.very_low}, unscored ${counts.unscored}.`}</p>
          <Field label="Authorizing Official"><input id="arAoName" value={s6.aoName} onChange={(e) => set('aoName', e.target.value)} /></Field>
          <Field label="AO attestation"><textarea id="arAttestation" rows={4} value={s6.attestation} placeholder="I have reviewed the risk assessment register and approve the identified risks and treatment plans..." onChange={(e) => set('attestation', e.target.value)} /></Field>
          <Field label="Sign-off method">
            <select id="arSignOffMethod" value={s6.signOffMethod} onChange={(e) => set('signOffMethod', e.target.value)}>
              <option value="electronic">Electronic</option><option value="wet">Wet signature</option><option value="docusign">DocuSign</option>
            </select>
          </Field>
        </section>
      ) : null}

      {act.message ? <Notice kind={act.message.kind}>{act.message.text}</Notice> : null}
      <div className="eo-row">
        <ConfirmButton label="Cancel review" confirmLabel="Discard all review progress" id="annualReviewCancel" disabled={act.busy}
          onConfirm={() => void act.run(async () => { await eoApi.cancelAnnualReview(tenant); onClose(); })} />
        {step > 1 ? <button type="button" className="btn btn-ghost btn-small" id="annualReviewBack" disabled={act.busy} onClick={() => setStep(step - 1)}>Back</button> : null}
        {step < 6 ? <button type="button" className="btn btn-primary btn-small" id="annualReviewNext" disabled={act.busy} onClick={next}>Next</button> : null}
        {step === 6 ? (
          <ConfirmButton label="Finalize annual review" confirmLabel="Finalize: create the immutable snapshot" id="annualReviewFinalize" className="btn btn-primary btn-small"
            disabled={act.busy} onConfirm={finalize} />
        ) : null}
      </div>
    </Card>
  );
}

/** Legacy oneClickAnnualReview: ingest, auto-score, mark reviewed, snapshot, in one call. The signer is named (legacy sent "admin"). */
export function OneClickReview({ tenant, onDone }: { tenant: string; onDone: () => Promise<void> }) {
  const cfg = useQuery({ queryKey: ['risk-config', tenant], queryFn: () => eoApi.riskConfig(tenant), retry: false });
  const [signer, setSigner] = useState('');
  const act = useAction();
  const who = signer.trim() || cfg.data?.authorizingOfficial?.displayName || '';
  return (
    <details className="eo-details" id="oneClickReview">
      <summary>Complete the annual review in one step</summary>
      <p className="eo-muted">Ingests the latest vulnerabilities, auto-scores every entry, marks all entries reviewed, and creates the immutable yearly snapshot. This cannot be undone.</p>
      <div className="eo-row">
        <Field label="Reviewed and signed off by" hint="Defaults to the Authorizing Official in Setup.">
          <input id="oneClickSigner" value={signer} placeholder={cfg.data?.authorizingOfficial?.displayName ?? ''} onChange={(e) => setSigner(e.target.value)} />
        </Field>
        <ConfirmButton label="Complete annual review" confirmLabel="Run it: ingest, score and snapshot" id="oneClickAnnualReviewBtn" className="btn btn-secondary btn-small"
          disabled={!who || act.busy}
          onConfirm={() => void act.run(async () => { const r = await eoApi.oneClickAnnualReview(tenant, who, who); await onDone(); return r; },
            (r) => `Annual review complete — ${r.summary.totalEntries} entries reviewed, ${r.summary.scored} auto-scored, ${r.summary.ingested.new} new ingested. Next review due: ${new Date(r.summary.nextReviewDue).toLocaleDateString()}.`)} />
      </div>
      {act.message ? <Notice kind={act.message.kind}>{act.message.text}</Notice> : null}
    </details>
  );
}
