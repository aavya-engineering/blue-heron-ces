// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Risk assessment setup (legacy risk-tab-setup): scope statement, frequency, the fixed methodology,
// the Authorizing Official, the threat catalog editor, the vulnerability sources, and the fixed
// NIST SP 800-30 scoring matrix. Each section saves on its own with a partial
// PUT /api/risk-assessment/config, as legacy does.

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { eoApi } from '../../api/eo';
import type { RiskAssessmentConfig, ThreatCatalog, VulnerabilitySources } from '../../api/types';
import { Card, ConfirmButton, Field, Notice, pretty, useAction } from '../../components/common';
import { LEVELS, NIST_RISK_MATRIX } from './riskModel';

function useSave(tenant: string) {
  const qc = useQueryClient();
  const a = useAction();
  const save = (partial: RiskAssessmentConfig) => void a.run(async () => {
    const r = await eoApi.saveRiskConfig(tenant, partial);
    await qc.invalidateQueries({ queryKey: ['risk-config', tenant] });
    return r;
  }, () => 'Saved.');
  return { ...a, save };
}

function ThreatCatalogEditor({ tenant, initial }: { tenant: string; initial: ThreatCatalog }) {
  const [cat, setCat] = useState<ThreatCatalog>(initial);
  const [newSource, setNewSource] = useState<Record<string, string>>({});
  const [newEvent, setNewEvent] = useState<Record<string, string>>({});
  const s = useSave(tenant);
  const groups: Array<[keyof ThreatCatalog, string]> = [['adversarial', 'Adversarial threats'], ['non_adversarial', 'Non-adversarial threats']];
  const update = (g: keyof ThreatCatalog, f: (list: ThreatCatalog[keyof ThreatCatalog]) => ThreatCatalog[keyof ThreatCatalog]) => setCat((c) => ({ ...c, [g]: f(c[g]) }));
  return (
    <Card title="Threat catalog" id="eo-risk-catalog">
      {groups.map(([g, title]) => (
        <fieldset key={g} className="eo-fieldset" data-category={g}>
          <legend>{title}</legend>
          {cat[g].map((src, i) => {
            const key = `${g}-${i}`;
            return (
              <details key={key} className="eo-details">
                <summary>{`${src.source} (${src.events.length} events)`}</summary>
                <ul className="eo-list">
                  {src.events.map((ev, j) => (
                    <li key={`${ev}-${j}`} className="eo-row">
                      <span>{ev}</span>
                      <button type="button" className="btn btn-ghost btn-small" aria-label={`Remove event ${ev} from ${src.source}`}
                        onClick={() => update(g, (l) => l.map((x, k) => (k === i ? { ...x, events: x.events.filter((_, m) => m !== j) } : x)))}>Remove</button>
                    </li>
                  ))}
                </ul>
                <div className="eo-row">
                  <Field label={`New event for ${src.source}`}><input value={newEvent[key] ?? ''} onChange={(e) => setNewEvent((x) => ({ ...x, [key]: e.target.value }))} /></Field>
                  <button type="button" className="btn btn-secondary btn-small" aria-label={`Add event to ${src.source}`} disabled={!(newEvent[key] ?? '').trim()}
                    onClick={() => { const v = (newEvent[key] ?? '').trim(); update(g, (l) => l.map((x, k) => (k === i ? { ...x, events: [...x.events, v] } : x))); setNewEvent((x) => ({ ...x, [key]: '' })); }}>
                    Add event
                  </button>
                  <ConfirmButton label="Remove source" ariaLabel={`Remove source ${src.source}`} onConfirm={() => update(g, (l) => l.filter((_, k) => k !== i))} />
                </div>
              </details>
            );
          })}
          <div className="eo-row">
            <Field label={`New ${title.toLowerCase().replace(/ threats$/, '')} threat source`}><input value={newSource[g] ?? ''} onChange={(e) => setNewSource((x) => ({ ...x, [g]: e.target.value }))} /></Field>
            <button type="button" className="btn btn-secondary btn-small" aria-label={`Add ${title.toLowerCase()} source`} disabled={!(newSource[g] ?? '').trim()}
              onClick={() => { const v = (newSource[g] ?? '').trim(); update(g, (l) => [...l, { source: v, events: [] }]); setNewSource((x) => ({ ...x, [g]: '' })); }}>
              Add source
            </button>
          </div>
        </fieldset>
      ))}
      <div className="eo-row"><button type="button" className="btn btn-primary btn-small" id="saveThreatCatalog" disabled={s.busy} onClick={() => s.save({ threatCatalog: cat })}>Save catalog</button></div>
      {s.message ? <Notice kind={s.message.kind}>{s.message.text}</Notice> : null}
    </Card>
  );
}

export function SetupTab({ tenant }: { tenant: string }) {
  const cfg = useQuery({ queryKey: ['risk-config', tenant], queryFn: () => eoApi.riskConfig(tenant), retry: false });
  const [scope, setScope] = useState('');
  const [freq, setFreq] = useState('12');
  const [ao, setAo] = useState({ displayName: '', upn: '', role: '' });
  const [vs, setVs] = useState<VulnerabilitySources>({});
  const [loaded, setLoaded] = useState(false);
  const scopeS = useSave(tenant);
  const freqS = useSave(tenant);
  const aoS = useSave(tenant);
  const vsS = useSave(tenant);

  useEffect(() => {
    if (!cfg.data || loaded) return;
    setScope(cfg.data.scopeStatement ?? '');
    setFreq(String(cfg.data.frequencyMonths ?? 12));
    setAo({ displayName: cfg.data.authorizingOfficial?.displayName ?? '', upn: cfg.data.authorizingOfficial?.upn ?? '', role: cfg.data.authorizingOfficial?.role ?? '' });
    setVs(cfg.data.vulnerabilitySources ?? {});
    setLoaded(true);
  }, [cfg.data, loaded]);

  if (cfg.isError) return <Notice kind="error">The risk assessment configuration could not be loaded.</Notice>;
  if (!cfg.data) return <p className="eo-muted">Loading setup...</p>;
  const freqN = parseInt(freq, 10);
  const enabled = (k: keyof VulnerabilitySources) => !!vs[k]?.enabled;
  const setEnabled = (k: keyof VulnerabilitySources, v: boolean) => setVs((x) => ({ ...x, [k]: { ...(x[k] ?? {}), enabled: v } }));

  return (
    <>
      <p className="eo-muted">Each section saves on its own.</p>
      <Card title="Scope statement" id="eo-risk-scope">
        <Field label="Scope statement" hint="The CUI-handling environment this risk assessment covers.">
          <textarea id="riskScopeStatementInput" rows={4} value={scope} onChange={(e) => setScope(e.target.value)} />
        </Field>
        <div className="eo-row"><button type="button" className="btn btn-primary btn-small" id="saveRiskScope" disabled={scopeS.busy} onClick={() => scopeS.save({ scopeStatement: scope })}>Save scope</button></div>
        {scopeS.message ? <Notice kind={scopeS.message.kind}>{scopeS.message.text}</Notice> : null}
      </Card>
      <Card title="Assessment frequency" id="eo-risk-frequency">
        <Field label="Frequency (months)" hint="CMMC L2 requires an annual (12 months) or more frequent assessment.">
          <input id="riskFrequencyInput" type="number" min={1} max={12} value={freq} onChange={(e) => setFreq(e.target.value)} />
        </Field>
        {isNaN(freqN) || freqN < 1 || freqN > 12 ? <Notice kind="warn">Frequency must be between 1 and 12 months.</Notice> : null}
        <div className="eo-row"><button type="button" className="btn btn-primary btn-small" id="saveRiskFrequency" disabled={freqS.busy || isNaN(freqN) || freqN < 1 || freqN > 12} onClick={() => freqS.save({ frequencyMonths: freqN })}>Save frequency</button></div>
        {freqS.message ? <Notice kind={freqS.message.kind}>{freqS.message.text}</Notice> : null}
        <p className="eo-muted">{`Methodology (fixed): ${cfg.data.methodology === 'nist_sp_800_30_rev1' || !cfg.data.methodology ? 'NIST SP 800-30 Rev. 1' : cfg.data.methodology}`}</p>
      </Card>
      <Card title="Authorizing Official" id="eo-risk-ao">
        <div className="eo-grid-2">
          <Field label="Display name"><input id="riskAODisplayName" value={ao.displayName} onChange={(e) => setAo({ ...ao, displayName: e.target.value })} /></Field>
          <Field label="Email (UPN)"><input id="riskAOUpn" value={ao.upn} onChange={(e) => setAo({ ...ao, upn: e.target.value })} /></Field>
          <Field label="Role"><input id="riskAORole" value={ao.role} onChange={(e) => setAo({ ...ao, role: e.target.value })} /></Field>
        </div>
        <div className="eo-row"><button type="button" className="btn btn-primary btn-small" id="saveRiskAO" disabled={aoS.busy} onClick={() => aoS.save({ authorizingOfficial: ao })}>Save AO</button></div>
        {aoS.message ? <Notice kind={aoS.message.kind}>{aoS.message.text}</Notice> : null}
      </Card>
      <ThreatCatalogEditor tenant={tenant} initial={{ adversarial: cfg.data.threatCatalog?.adversarial ?? [], non_adversarial: cfg.data.threatCatalog?.non_adversarial ?? [] }} />
      <Card title="Vulnerability sources" id="eo-risk-sources">
        <label className="eo-check"><input type="checkbox" id="vulnSrcDefender" checked={enabled('defender_for_cloud')} onChange={(e) => setEnabled('defender_for_cloud', e.target.checked)} /><span>Defender for Cloud</span></label>
        <Field label="Defender severity threshold">
          <select id="defenderSeverityThreshold" value={vs.defender_for_cloud?.severity_threshold ?? 'high'}
            onChange={(e) => setVs((x) => ({ ...x, defender_for_cloud: { ...(x.defender_for_cloud ?? {}), severity_threshold: e.target.value } }))}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
          </select>
        </Field>
        <label className="eo-check"><input type="checkbox" id="vulnSrcSecureScore" checked={enabled('microsoft_secure_score')} onChange={(e) => setEnabled('microsoft_secure_score', e.target.checked)} /><span>Microsoft Secure Score</span></label>
        <label className="eo-check"><input type="checkbox" id="vulnSrcPlanOutput" checked={enabled('plan_output_not_met')} onChange={(e) => setEnabled('plan_output_not_met', e.target.checked)} /><span>Plan output (NOT MET controls)</span></label>
        <label className="eo-check"><input type="checkbox" id="vulnSrcSentinel" checked={enabled('sentinel_incidents')} onChange={(e) => setEnabled('sentinel_incidents', e.target.checked)} /><span>Sentinel incidents</span></label>
        <div className="eo-row">
          <button type="button" className="btn btn-primary btn-small" id="saveVulnSources" disabled={vsS.busy}
            onClick={() => vsS.save({ vulnerabilitySources: {
              defender_for_cloud: { enabled: enabled('defender_for_cloud'), severity_threshold: vs.defender_for_cloud?.severity_threshold ?? 'high' },
              microsoft_secure_score: { enabled: enabled('microsoft_secure_score') },
              plan_output_not_met: { enabled: enabled('plan_output_not_met') },
              sentinel_incidents: { enabled: enabled('sentinel_incidents') },
            } })}>
            Save sources
          </button>
        </div>
        {vsS.message ? <Notice kind={vsS.message.kind}>{vsS.message.text}</Notice> : null}
      </Card>
      <Card title="NIST SP 800-30 scoring scale (fixed)" id="eo-risk-matrix">
        <div className="eo-table-wrap">
          <table className="eo-table" id="nistMatrix">
            <caption className="eo-sr-only">Composite risk by likelihood (rows) and impact (columns)</caption>
            <thead><tr><th scope="col">Likelihood \ Impact</th>{LEVELS.map((i) => <th key={i} scope="col">{pretty(i)}</th>)}</tr></thead>
            <tbody>
              {[...LEVELS].reverse().map((l) => (
                <tr key={l}><th scope="row">{pretty(l)}</th>{LEVELS.map((i) => <td key={i} className={`eo-risk-${NIST_RISK_MATRIX[l][i]}`}>{pretty(NIST_RISK_MATRIX[l][i])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
