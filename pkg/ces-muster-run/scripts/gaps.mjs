#!/usr/bin/env node
// Synthetic-customer W4 (PLAN.md §4): the machine-generated gap list for one scenario's run.
//   node gaps.mjs --scenario <slug> [--root <WS>] [--run <dir>] [--bundle <dir>] [--out <dir>]   (same inputs as scorecard.mjs)
// Writes <out>\GAPS-<slug>.md and <out>\GAPS-<slug>.json: one row per gap with a stable id, the module that owns the fix
// (Muster / Stamper / AdminOps / EvidenceOps / simulator / content), the control or item, what the assessor needs (800-171A
// objective text from ces-shared and the examine item), what we have (status, tier, method, evidence kinds, presence-only,
// postcheckMode, placeholder count, unsure / defaulted answer, policy vs tenant reconciliation), the owner (BHD / contractor / founder content), the source
// and the weight (the control's SPRS points x 3 for P0, x 2 for P1, x 1 otherwise; 1 / 3 / 2 when no control applies).
// Output is deterministic: it is stamped with the SSP's generatedAt, never the clock, and ids come from content.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadInputs, computeScorecard, parseArgs, examineItems, documentaryItems, discoveryFacts, controlOfQuestion, sc8aSplit,
  placeholderHits, contentGapHits, NOT_SUPPLIED, policyCompleteness, odpAnswers,
} from './scorecard.mjs';

// The Muster policy document an item's family is credited against in W5 (the 22 rendered documents, by family).
export const FAMILY_DOCUMENT = {
  AC: 'access-control-policy', AT: 'awareness-training-policy', AU: 'audit-accountability-policy', CA: 'security-assessment-policy',
  CM: 'configuration-management-policy', IA: 'identification-authentication-policy', IR: 'incident-response-policy',
  MA: 'maintenance-policy', MP: 'media-protection-policy', PE: 'physical-protection-policy', PS: 'personnel-security-policy',
  RA: 'risk-assessment-policy', SC: 'system-communications-policy', SI: 'system-integrity-policy',
};
// PLAN §1 non-goals: orphans carried as GAPS rows, not fixed in this program.
export const ORPHANS = [
  ['mg11-posture', 'Muster', 'MG-11 assessor reports carry the Mission Plan posture, not the assessed one', 'reports that state the assessed posture'],
  ['package-zip', 'EvidenceOps', 'the EO package zip omits ledger, policies, store and reports (the evidence bundle carries them)', 'one package that holds every artefact it cites'],
  ['stamper-run-id', 'Stamper', 'Stamper evidence records carry no run id', 'evidence tied to the run that produced it'],
  ['gate-count', 'Stamper', 'the manual-gate count differs between the plan (28) and the gates written (24)', 'one manual-gate count across the plan and the run'],
  ['future-dates', 'content', 'policy effective dates lie in the future', 'policies in force on the SSP date'],
];
const SC_MODULE = { 'SC-1': 'EvidenceOps', 'SC-2': 'EvidenceOps', 'SC-3a': 'EvidenceOps', 'SC-3b': 'Muster', 'SC-4': 'EvidenceOps', 'SC-5': 'content', 'SC-6': 'content', 'SC-7': 'EvidenceOps', 'SC-8a': 'Muster', 'SC-8b': 'Muster' };
const SECTION_ORDER = ['scorecard', 'ssp-review', 'control-status', 'presence-only', 'examine-automatable', 'documentary', 'unsure', 'defaulted', 'placeholder', 'content-gap', 'postcheck-presence', 'manual-gate', 'manual-gate-read', 'renderable', 'collector', 'policy', 'odp', 'policy-reconciliation', 'review', 'deficiency', 'orphan'];
// W7-PKG: EO review findings (a signal that needs the organisation's review and decides no status). The shared-login marker is
// copied from ces-eo src\eo\mapping\evaluators\ia-evaluators.ts (SHARED_LOGIN_REVIEW, W7-EO); keep the two identical.
export const REVIEW_MARKERS = ['Review finding (shared-login name, not corroborated)'];
const SECTION_TITLE = {
  scorecard: 'Scorecard rows outside their threshold', 'ssp-review': 'SSP-review predicates failing (SC-1 / SC-2)',
  'control-status': 'Controls not met or not assessed', 'presence-only': 'Met controls decided by a presence-only evaluator',
  'examine-automatable': 'Automatable examine items not covered (SC-3a)', documentary: 'Documentary examine items (SC-3b), grouped per document',
  unsure: 'Discovery answers "unsure" (SC-8a)', defaulted: 'Defaulted inputs (SC-8b, plan-trace.json)', placeholder: 'Placeholders in the SSP JSON (SC-5)', 'content-gap': 'Content-gap sentences in the SSP JSON (SC-5, "Not supplied by the organisation (content gap)")',
  'postcheck-presence': 'Stamper SET-path records asserted on presence only', 'manual-gate': 'Manual gates without an action',
  'manual-gate-read': 'Manual-gate reads that came back NOT_SAT (founder Q2, 2026-11-01; display-only for EO, no status decided)',
  renderable: 'Renderables without a policy reference', collector: 'Empty or errored collector reads', policy: 'Policy documents incomplete (SC-6)',
  odp: 'ODPs not answered (SC-6)', 'policy-reconciliation': 'Policy vs tenant reconciliation findings (SSP policyReconciliation[]; findings about the organisation, not loop gaps)', review: 'EvidenceOps review findings (no status decided; for the organisation to review, not loop gaps)', deficiency: 'Seeded deficiencies not surfaced by any other row (customers/<slug>/deficiencies.json)', orphan: 'Orphans carried from PLAN §1 non-goals',
};

const short = (s, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
export const gapId = (...parts) => `G-${crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 10)}`;
const familyOf = (cid) => String(cid ?? '').slice(0, 2);
// The stable gate label of a Stamper task id: step_task_<control>_<run-specific suffix> -> step_task_<control>
// (control ids carry no underscore); manual-<control> and any other id are already stable and kept as they are.
export const gateLabel = (task) => { const m = /^(step_task_[^_]+)_.+$/.exec(String(task ?? '')); return m ? m[1] : String(task ?? ''); };

export function buildGaps(inp, sc = computeScorecard(inp)) {
  const ssp = inp.ssp;
  const ctl = ssp?.controlImplementations ?? [];
  const byId = new Map(ctl.map((c) => [c.control_id, c]));
  const weightOf = (cid) => Number(byId.get(cid)?.weight ?? 0);
  const P0 = new Set([1, 2, 3, 4, 5, 6, 7]);
  // Assessor needs: 800-171A objective text (ces-shared reference; the ledger's statements when it is unreachable).
  const objText = new Map();
  for (const o of inp.objectiveRef ?? inp.eoLedger?.objectives ?? []) {
    const k = o.controlId; if (!objText.has(k)) objText.set(k, []);
    objText.get(k).push(`${o.objectiveId.replace(k, '')} ${o.description ?? o.statement}`);
  }
  const needsFor = (cid) => short(`800-171A ${(objText.get(cid) ?? ['(objectives not found)']).join('; ')}`, 400);
  // What we have, per control.
  const tierOf = new Map((inp.snapshot?.controls ?? []).map((c) => [c.control_id, /^Tier (\d)/.exec(c.statusRationale ?? '')?.[1] ?? null]));
  const idx = new Map((inp.evidenceIndex?.examineCoverage ?? []).map((c) => [c.controlId, c]));
  const methods = new Map();
  for (const e of inp.evidenceIndex?.entries ?? []) { const m = methods.get(e.controlId) ?? {}; m[e.method ?? 'none'] = (m[e.method ?? 'none'] ?? 0) + 1; methods.set(e.controlId, m); }
  const stamper = new Map();
  for (const { rec } of inp.stamperRecords) for (const cid of rec.metadata?.controlIds ?? []) {
    const s = stamper.get(cid) ?? { SAT: 0, NOT_SAT: 0, other: 0, state: 0, presence: 0 };
    if (rec.complianceVerdict === 'SAT') s.SAT++; else if (rec.complianceVerdict === 'NOT_SAT') s.NOT_SAT++; else s.other++;
    if (rec.metadata?.postcheckMode === 'state') s.state++; else if (rec.metadata?.postcheckMode === 'presence') s.presence++;
    stamper.set(cid, s);
  }
  const answerOf = new Map(discoveryFacts(inp.readiness).map((f) => [controlOfQuestion(f.question_id), f.answer]));
  const haveFor = (cid) => {
    const c = byId.get(cid);
    if (!c) return 'not in the SSP';
    const st = stamper.get(cid);
    const m = methods.get(cid);
    const ph = placeholderHits(c).length;
    return [
      `status ${c.status}`,
      `tier ${tierOf.get(cid) ?? (inp.snapshot ? 'none' : 'n/a (no EO snapshot in this input)')}`,
      `methods ${m ? Object.entries(m).map(([k, v]) => `${k} ${v}`).join(', ') : 'none'}`,
      `evidence kinds ${(idx.get(cid)?.kindsPresent ?? []).join(', ') || 'none'}`,
      `presence-only ${c.presenceOnly === true ? 'yes' : 'no'}`,
      `Stamper ${st ? `SAT ${st.SAT} / NOT_SAT ${st.NOT_SAT}${st.other ? ` / other ${st.other}` : ''}; postcheckMode state ${st.state}, presence ${st.presence}` : 'no record'}`,
      `placeholders ${ph}`,
      `discovery answer ${answerOf.get(cid) ?? 'none'}`,
    ].join('; ');
  };
  const rows = [];
  const add = (r) => rows.push({ weight: 1, control: null, ...r });

  // Scorecard rows outside threshold, and the failing SSP-review predicates.
  for (const r of sc.rows.filter((x) => x.status === 'fail' || x.status === 'not computed')) {
    add({ id: gapId('scorecard', r.id), source: 'scorecard', module: SC_MODULE[r.id], control: null, item: r.id, needs: `${r.title}: within ${JSON.stringify(r.threshold)}`, have: `${r.status}: ${r.detail}`, owner: r.id === 'SC-6' || r.id === 'SC-5' ? 'founder content' : 'BHD', weight: 1 });
  }
  for (const r of sc.rows.filter((x) => x.id === 'SC-1' || x.id === 'SC-2')) for (const p of r.value?.rows ?? []) if (!p.pass) {
    add({ id: gapId('ssp-review', p.row), source: 'ssp-review', module: 'EvidenceOps', item: `REVIEW row ${p.row} (${p.pri})`, needs: p.title, have: p.detail, owner: 'BHD', weight: P0.has(p.row) ? 3 : 2 });
  }
  // Every not-met / not-assessed control.
  for (const c of ctl.filter((x) => x.status === 'not_met' || x.status === 'not_assessed')) {
    const st = stamper.get(c.control_id);
    const module = c.status === 'not_assessed' ? 'content' : st?.NOT_SAT ? 'Stamper' : 'EvidenceOps';
    // W6 (S3 run 63): the row carries EO's finding sentence (SSP assessmentFinding), shown in GAPS.md and matched by the
    // seeded-deficiency cross-check.
    add({ id: gapId('control-status', c.control_id), source: 'control-status', module, control: c.control_id, item: c.status, needs: needsFor(c.control_id), have: haveFor(c.control_id), owner: c.status === 'not_assessed' ? 'founder content' : 'BHD', weight: weightOf(c.control_id), finding: c.assessmentFinding ?? null });
  }
  // Every presence-only met control.
  for (const c of ctl.filter((x) => x.status === 'met' && x.presenceOnly === true)) {
    const why = /Presence only: ([^\n]*)/.exec(c.implementationNarrative ?? '')?.[1];
    add({ id: gapId('presence-only', c.control_id), source: 'presence-only', module: 'EvidenceOps', control: c.control_id, item: 'met on presence only', needs: needsFor(c.control_id), have: `${haveFor(c.control_id)}; ${short(why ?? 'presence-only label', 200)}`, owner: 'BHD', weight: weightOf(c.control_id) });
  }
  // Automatable examine items not covered (SC-3a).
  for (const x of examineItems(inp.evidenceIndex).automatable.filter((i) => i.status !== 'covered')) {
    add({ id: gapId('examine', x.controlId, x.index), source: 'examine-automatable', module: 'EvidenceOps', control: x.controlId, item: `examine #${x.index}: ${short(x.text, 120)}`, needs: `an artefact of kind ${(x.kinds ?? []).join(' / ') || '(none mapped)'} for "${short(x.text, 120)}"`, have: `kinds present: ${x.kindsPresent.join(', ') || 'none'}`, owner: 'BHD', weight: weightOf(x.controlId) });
  }
  // The documentary items (SC-3b), grouped per Muster document of the family.
  for (const x of documentaryItems(inp)) {
    const doc = FAMILY_DOCUMENT[familyOf(x.controlId)] ?? 'unmapped';
    const muster = /polic|procedure|plan/i.test(x.text);
    add({ id: gapId('documentary', x.controlId, x.index), source: 'documentary', group: `${doc}.md`, module: muster ? 'Muster' : 'content', control: x.controlId, item: `examine #${x.index}: ${short(x.text, 120)}`, needs: `the document or record "${short(x.text, 120)}"`, have: muster ? `${doc}.md rendered by Muster; the evidence index did not credit it (no policy text given, hash mismatch, or the text does not name the requirement family)` : 'no record in the run (customer record or document)', owner: muster ? 'BHD' : 'founder content', weight: weightOf(x.controlId) });
  }
  // Discovery "unsure" answers (SC-8a).
  // Ruling R-1: answers SC-8a leaves out of its denominator stay GAPS rows and carry the reason.
  // An interview answer that replaces the unsure is named on the row (SC-8a counts it in the denominator).
  const split = sc8aSplit(inp);
  const notDiscoverable = new Map(split.excluded.map((f) => [f.question_id, f.reason]));
  const byInterview = new Map(split.counted.filter((f) => f.replacedByInterview).map((f) => [f.question_id, f.answer]));
  for (const f of discoveryFacts(inp.readiness).filter((x) => x.answer === 'unsure')) {
    const cid = controlOfQuestion(f.question_id);
    const reason = notDiscoverable.get(f.question_id);
    const iv = byInterview.has(f.question_id) ? `; interview answer ${byInterview.get(f.question_id)} replaces it (counted in SC-8a)` : '';
    add({ id: gapId('unsure', f.question_id), source: 'unsure', module: 'Muster', control: cid, item: f.question_id, needs: short(f.question_text, 200), have: `discovery answer unsure (provenance ${f.provenance}, confidence ${f.confidence})${reason ? `; ${reason} (excluded from SC-8a)` : ''}${iv}`, owner: 'BHD', weight: weightOf(cid), ...(reason ? { reason } : {}) });
  }
  // Defaulted inputs (SC-8b).
  for (const d of inp.planTrace?.defaulted_inputs ?? []) {
    const content = /^(TCP |CUI boundary|FedRAMP)/.test(d);
    add({ id: gapId('defaulted', d), source: 'defaulted', module: content ? 'content' : 'Muster', item: short(d, 140), needs: 'an answered or discovered value', have: 'defaulted (plan-trace.json defaulted_inputs)', owner: content ? 'founder content' : 'BHD', weight: 1 });
  }
  // Placeholders, with their JSON paths (SC-5).
  for (const h of ssp ? placeholderHits(ssp) : []) {
    const m = /^controlImplementations\[(\d+)\]/.exec(h.path);
    const cid = m ? ctl[Number(m[1])]?.control_id : null;
    add({ id: gapId('placeholder', h.path, h.marker, h.occurrence), source: 'placeholder', module: 'content', control: cid, item: `${h.path}${h.occurrence > 1 ? ` (#${h.occurrence})` : ''}`, needs: 'the organisation value the marker stands for', have: `"${h.marker}"`, owner: 'founder content', weight: cid ? weightOf(cid) : 1 });
  }
  // Content-gap sentences, with their JSON paths (SC-5; the NOT_SUPPLIED constant of ces-eo ContentGap.ts, apart from the markers).
  for (const h of ssp ? contentGapHits(ssp) : []) {
    const m = /^controlImplementations\[(\d+)\]/.exec(h.path);
    const cid = m ? ctl[Number(m[1])]?.control_id : null;
    add({ id: gapId('content-gap', h.path, h.occurrence), source: 'content-gap', module: 'content', control: cid, item: `${h.path}${h.occurrence > 1 ? ` (#${h.occurrence})` : ''}`, needs: h.what ? `the organisation content: ${short(h.what, 160)}` : 'the organisation content this field stands for', have: `"${NOT_SUPPLIED}"${h.what ? `: ${short(h.what, 120)}` : ''}`, owner: 'founder content', weight: cid ? weightOf(cid) : 1 });
  }
  // Stamper: presence-type postchecks, manual gates without an action, renderables without a policy reference.
  for (const { rec } of inp.stamperRecords.filter(({ rec }) => rec.metadata?.postcheckMode === 'presence')) {
    const eid = rec.registryEntry?.entry_id;
    add({ id: gapId('postcheck', eid), source: 'postcheck-presence', module: 'Stamper', control: rec.metadata?.controlIds?.[0] ?? null, item: eid, needs: 'a postcheck that asserts the configured state', have: `postcheckMode presence (${rec.complianceVerdict}); ${short(rec.metadata?.presenceReason ?? '', 200)}`, owner: 'BHD', weight: weightOf(rec.metadata?.controlIds?.[0]) });
  }
  // W5 cycle 6: a manual-gate row is keyed by control + gate label (the task id without Stamper's run-specific suffix;
  // the records carry no registry entry id), so its id is the same every run; the task id is kept as a field.
  const gateSeen = new Map();
  for (const { p, rec } of [...inp.stamperTaskFiles].sort((a, b) => a.p.localeCompare(b.p))) {
    const task = path.basename(path.dirname(p));
    const cid = rec.metadata?.controlIds?.[0] ?? null;
    if (path.basename(p) === 'manual-gate.json' && rec.metadata?.gateAction !== 'approved') {
      const label = gateLabel(task);
      const n = (gateSeen.get(`${cid}|${label}`) ?? 0) + 1;
      gateSeen.set(`${cid}|${label}`, n);
      add({ id: gapId('manual-gate', cid, label, ...(n > 1 ? [n] : [])), source: 'manual-gate', module: 'Stamper', control: cid, item: label, task, needs: 'an owner action on the gate, or the evidence that replaces it', have: `gateAction ${rec.metadata?.gateAction ?? 'none'}; ${rec.complianceVerdict}`, owner: 'founder content', weight: weightOf(cid) });
    }
    // PH-11 Q2 (founder 2026-11-01): a read Stamper ran inside a manual gate (metadata.gateContext 'manual_gate', PH-7) that
    // came back NOT_SAT is a row: control, gate id (the gate label), the read's reason. evidence-by-task only (the gate's task
    // folder names the gate; the same record also sits under evidence\); one row per control + gate + entry.
    if (rec.metadata?.gateContext === 'manual_gate' && rec.complianceVerdict === 'NOT_SAT') {
      const gtask = path.basename(path.dirname(path.dirname(p)));
      const label = gateLabel(gtask), eid = rec.registryEntry?.entry_id ?? path.basename(p, '.json');
      const k = `read|${cid}|${label}|${eid}`;
      if (!gateSeen.has(k)) {
        gateSeen.set(k, 1);
        const fd = rec.failureDiagnostics ?? {};
        const why = [fd.rootCause && `root cause ${fd.rootCause}`, fd.httpStatus && `HTTP ${fd.httpStatus}`, short(rec.outcomeRationale ?? rec.verdictRationale ?? '', 200)].filter(Boolean).join('; ');
        add({ id: gapId('manual-gate-read', cid, label, eid), source: 'manual-gate-read', module: 'Stamper', control: cid, item: `${label}: ${eid}`, task: gtask, needs: 'a gate read that shows the state the gate asks the owner to confirm', have: `NOT_SAT (${rec.outcome ?? 'no outcome'}); ${why || 'no reason recorded'}`, owner: 'BHD', weight: weightOf(cid) });
      }
    }
    if (path.basename(p) === 'policy-reference.json' && !rec.metadata?.policyRef) {
      add({ id: gapId('renderable', task), source: 'renderable', module: 'Stamper', control: cid, item: task, needs: 'a reference to the hashed Muster policy', have: `no policyRef; ${rec.complianceVerdict}`, owner: 'BHD', weight: weightOf(cid) });
    }
  }
  // Empty or errored collector reads, one row per source and status.
  // A source that succeeded with rows in any pass of the run is not empty: later passes read only the window since
  // the last pass and honestly find nothing new (W5 cycle 1 finding: 13 of run 43's 16 "simulator" rows were this).
  const succeededWithRows = new Set((inp.storeRecords ?? []).filter((x) => x.status === 'success' && (x.itemCount ?? 0) > 0).map((x) => x.sourceId));
  const reads = new Map();
  for (const r of (inp.storeRecords ?? []).filter((x) => x.status !== 'success' && !(x.status === 'empty' && succeededWithRows.has(x.sourceId)))) {
    const k = `${r.sourceId}|${r.status}`; const e = reads.get(k) ?? { sourceId: r.sourceId, status: r.status, n: 0, controls: new Set() };
    e.n++; for (const c of r.controlIds ?? []) e.controls.add(c); reads.set(k, e);
  }
  for (const e of [...reads.values()]) {
    const cs = [...e.controls].sort();
    add({ id: gapId('collector', e.sourceId, e.status), source: 'collector', module: e.sourceId === 'collect.adminOps' ? 'AdminOps' : (e.status === 'empty' ? 'simulator' : 'EvidenceOps'), control: cs[0] ?? null, item: `${e.sourceId} ${e.status}`, needs: 'a read that returns the records the objectives need', have: `${e.n} ${e.status} reads; controls ${cs.join(', ') || 'none'}`, owner: 'BHD', weight: Math.max(1, ...cs.map(weightOf)) });
  }
  // Policy completeness and ODPs (SC-6).
  for (const d of inp.policies.map(policyCompleteness).filter((x) => !x.complete)) {
    add({ id: gapId('policy', d.file), source: 'policy', module: 'content', item: d.file, needs: 'owner and approver named; no unfilled name, title or placeholder', have: d.problems.join('; '), owner: 'founder content', weight: 1 });
  }
  for (const o of odpAnswers(inp).filter((x) => !x.answered)) {
    add({ id: gapId('odp', o.id), source: 'odp', module: 'content', item: `${o.id} ${o.key}`, needs: 'an answered value (answers file)', have: o.reason, owner: 'founder content', weight: 1 });
  }
  // Policy vs tenant reconciliation (H-C1, LOG-W5c3-eo-rules2.md §2): one row per ssp.policyReconciliation[] entry. A finding
  // about the organisation (its policy and its tenant differ), not a loop gap; EO changes no status for it.
  for (const r of ssp?.policyReconciliation ?? []) {
    add({ id: gapId('policy-reconciliation', r.controlId, r.odpId, r.tenantValue, ...(r.sourceRows ?? [])), source: 'policy-reconciliation', module: 'content', control: r.controlId ?? null, item: `${r.odpId} ${r.odpKey ?? ''}`.trim(), needs: short(`the organisation reconciles its policy and its tenant; source rows: ${(r.sourceRows ?? []).join('; ') || 'none listed'}`, 300), have: `Policy states ${r.policyValue}; tenant configured ${r.tenantValue} (${r.readReference})`, owner: 'founder content', weight: r.controlId ? weightOf(r.controlId) : 1 });
  }
  // W7-PKG: EO review findings (REVIEW_MARKERS) in the SSP's finding / narrative or the EO snapshot's rationale, finding and
  // source details (a name-only shared-login hit sits in a Tier 2 source even when another tier decides): one row per
  // control and marker. Findings about the organisation, not loop gaps (V57 leaves them out); no status moves.
  const reviewSeen = new Set();
  const reviewTexts = [
    ...ctl.map((c) => [c.control_id, [c.assessmentFinding, c.implementationNarrative]]),
    ...(inp.snapshot?.controls ?? []).map((c) => [c.control_id, [c.statusRationale, c.assessmentFinding, c.implementation_narrative, ...(c.sources ?? []).map((s) => s.detail)]]),
  ];
  for (const [cid, texts] of reviewTexts) for (const t of texts) for (const mk of REVIEW_MARKERS) {
    const at = String(t ?? '').indexOf(mk);
    if (at < 0 || reviewSeen.has(`${cid}|${mk}`)) continue;
    reviewSeen.add(`${cid}|${mk}`);
    add({ id: gapId('review', cid, mk), source: 'review', module: 'EvidenceOps', control: cid, item: mk, needs: 'the organisation reviews the finding (a roster record, or a corroborating signal, decides it)', have: short(String(t).slice(at), 300), owner: 'founder content', weight: weightOf(cid) || 1 });
  }
  for (const [k, module, have, needs] of ORPHANS) add({ id: gapId('orphan', k), source: 'orphan', module, item: k, needs, have, owner: 'BHD', weight: 1 });

  const deficiencies = inp.deficiencies ? crossCheckDeficiencies(inp, rows, add, weightOf) : null;
  rows.sort((a, b) => SECTION_ORDER.indexOf(a.source) - SECTION_ORDER.indexOf(b.source) || String(a.group ?? '').localeCompare(String(b.group ?? '')) || String(a.control ?? '').localeCompare(String(b.control ?? '')) || a.id.localeCompare(b.id));
  const tally = (k) => rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] ?? 0) + 1), m), {});
  return {
    schema: 'ces-muster-run/gaps@1',
    scenario: inp.slug, runId: inp.runId, sspId: ssp?.sspId ?? null, generatedAt: ssp?.generatedAt ?? null,
    rowCount: rows.length, bySource: tally('source'), byModule: tally('module'), byOwner: tally('owner'),
    // PH-11 Q2: always present (0 included), so V57 can tell a GAPS that knows manual-gate-read rows from an older one.
    manualGateReadRows: rows.filter((r) => r.source === 'manual-gate-read').length,
    scorecard: sc.rows.map((r) => ({ id: r.id, status: r.status, detail: r.detail })),
    notes: [...inp.notes, ...(inp.planTrace ? [] : ['defaulted inputs not listed: no plan-trace.json in this input']), ...(inp.storeRecords ? [] : ['collector reads not listed: no evidence store in this input']), ...(deficiencies ? [] : [`no customers/${inp.slug}/deficiencies.json: no seeded-deficiency cross-check`])],
    ...(deficiencies ? { deficiencies } : {}),
    rows,
  };
}

// W6 (S3, PLAN §1 "every §2.1b deficiency appears in GAPS.md"): cross-check customers\<slug>\deficiencies.json against
// this run's rows, the EO ledger, Stamper's records and the E7A (AdminOps step) record. Per deficiency (its control is
// gaps_row.control, else controls[0]):
//   surfaced  = a row of another source matches one of its gaps_also patterns (same source and control; item equal or
//               contained, case-insensitive);
//   fixerActed = Stamper: a SAT record with postcheckMode state on the control; AdminOps: an op the deficiency's e7a_op
//               names ran its apply call successfully in this scenario's E7A with a passing confirming read; else still open;
//   resolved  = the control is met in the ledger and its fixer acted (a finding-only or organisation deficiency never is).
// W6 follow-up (S3 run 63):
//   surfaced also when the deficiency's optional `match` keywords (case-insensitive substrings) occur in the finding
//     (control-status rows carry EO's assessmentFinding) or the text (item, needs, have) of a row on one of its controls;
//   Stamper fixerActed = a SAT record with postcheckMode state whose entry lists one of the deficiency's controls and,
//     when the deficiency names `stamper_entries`, is one of them;
//   resolved also when the fixer acted but the control stays not met because ANOTHER seeded deficiency on the same
//     control is still open ("fixed (control still not met: <ids>)"); fixer acted with no such other deficiency: stays
//     unsurfaced, noted "fixer acted but the control is still not met: review".
// W7-PKG: AdminOps fixerActed needs every E7A write op the e7a_op names to have applied with a passing confirming read; an
//   AdminOps fixer that acted resolves the deficiency whatever the control's status ("fixed: confirming read passed").
// A deficiency neither surfaced nor resolved gets one row of source 'deficiency' ("Seeded deficiency <id> not surfaced").
export function crossCheckDeficiencies(inp, rows, add, weightOf) {
  const ledger = new Map((inp.eoLedger?.controls ?? []).map((c) => [c.controlId, c.status]));
  const ssp = new Map((inp.ssp?.controlImplementations ?? []).map((c) => [c.control_id, c.status]));
  const e7a = inp.adminOpsE7a && (!inp.adminOpsE7a.tenant_slug || inp.adminOpsE7a.tenant_slug === inp.slug) ? inp.adminOpsE7a : null;
  const loopRows = rows.filter((r) => r.source !== 'deficiency');
  const lc = (x) => String(x ?? '').toLowerCase();
  const defs = (inp.deficiencies.deficiencies ?? []).map((d) => {
    const cid = d.gaps_row?.control ?? d.controls?.[0] ?? null;
    const controls = new Set([cid, ...(d.controls ?? [])].filter(Boolean));
    const fixer = String(d.fixer ?? '');
    let fixerActed = 'still open';
    if (fixer === 'Stamper') {
      const entries = Array.isArray(d.stamper_entries) && d.stamper_entries.length ? new Set(d.stamper_entries) : null;
      const rec = inp.stamperRecords.map(({ rec }) => rec).find((rec) => rec.complianceVerdict === 'SAT' && rec.metadata?.postcheckMode === 'state'
        && [...(rec.metadata?.controlIds ?? []), ...(rec.registryEntry?.control_ids ?? [])].some((c) => controls.has(c))
        && (!entries || entries.has(rec.registryEntry?.entry_id)));
      if (rec) fixerActed = entries ? `Stamper ${rec.registryEntry.entry_id} SAT (state)` : 'Stamper record SAT (state) on the control';
    } else if (fixer === 'AdminOps') {
      // W7-PKG: every E7A write op the e7a_op names (A-19 runs twice on S3) applied and its confirming read passed.
      const named = new Set(String(d.e7a_op ?? '').match(/\b[A-Z]-\d{2}\b/g) ?? []);
      const ops = (e7a?.ops ?? []).filter((o) => named.has(o.op) && o.kind === 'write');
      const confirmed = (o) => (o.calls ?? []).some((c) => c.call === 'apply' && c.success === true) && o.confirm?.pass === true;
      if (ops.length && ops.every(confirmed)) fixerActed = `AdminOps ${[...new Set(ops.map((o) => o.op))].join(', ')}${ops.length > new Set(ops.map((o) => o.op)).size ? ` x${ops.length}` : ''} in E7A (confirmed)`;
    }
    return { d, cid, controls, fixer, fixerActed, status: ledger.get(cid) ?? ssp.get(cid) ?? 'not in the ledger' };
  });
  const out = [];
  for (const { d, cid, controls, fixer, fixerActed, status } of defs) {
    const keywords = (Array.isArray(d.match) ? d.match : []).map(lc).filter(Boolean);
    const byPattern = (d.gaps_also ?? []).map((p) => loopRows.find((r) => r.source === p.source && r.control === p.control && (!p.item || lc(r.item) === lc(p.item) || lc(r.item).includes(lc(p.item))))).find(Boolean) ?? null;
    const byKeyword = keywords.length ? loopRows.find((r) => controls.has(r.control) && keywords.some((k) => [r.finding, r.item, r.needs, r.have].some((t) => lc(t).includes(k)))) ?? null : null;
    const match = byPattern ?? byKeyword;
    const acted = fixerActed !== 'still open';
    const othersOpen = defs.filter((o) => o.d.id !== d.id && o.cid === cid && o.fixerActed === 'still open').map((o) => o.d.id);
    let resolved = status === 'met' && acted, note = null;
    if (acted && status !== 'met') {
      // W7-PKG (PLAN §2, V64): an AdminOps fix is proven by its confirming read; the control's status may rest on other
      // objects (S3-D04: A-19's exclusion moves no status, AC.L2-3.1.7 is decided on S3-D03's standing role).
      if (fixer === 'AdminOps') { resolved = true; note = `fixed: confirming read passed (control ${status}, decided on other objects)`; }
      else if (othersOpen.length) { resolved = true; note = `fixed (control still not met: ${othersOpen.join(', ')})`; }
      else note = 'fixer acted but the control is still not met: review';
    }
    let fallback = null;
    if (!match && !resolved) {
      fallback = gapId('deficiency', d.id);
      add({ id: fallback, source: 'deficiency', module: d.gaps_row?.module ?? 'content', control: cid, item: d.gaps_row?.item ?? d.id, needs: d.gaps_row?.needs ?? 'the deficiency surfaced by the loop or fixed by its fixer', have: `Seeded deficiency ${d.id} not surfaced: ${short(d.what_is_wrong, 240)} (ledger ${status}; fixer ${fixer || 'none'}: ${fixerActed}${note ? `; ${note}` : ''})`, owner: d.gaps_row?.owner ?? 'BHD', weight: weightOf(cid) || 1, deficiency: d.id });
    }
    out.push({ id: d.id, control: cid, ledgerStatus: status, fixer, fixerActed, resolved, ...(note ? { note } : {}), surfaced: !!match, surfacedBy: match ? { id: match.id, source: match.source, item: match.item, by: byPattern ? 'gaps_also' : 'match' } : null, fallbackRow: fallback });
  }
  return { file: `customers/${inp.slug}/deficiencies.json`, count: out.length, surfaced: out.filter((x) => x.surfaced).length, resolved: out.filter((x) => x.resolved).length, unsurfaced: out.filter((x) => !x.surfaced && !x.resolved).map((x) => x.id), rows: out };
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
export function renderGapsMd(g) {
  const L = [`# GAPS: ${g.scenario}`, '',
    `Run ${g.runId ?? '?'}; SSP ${g.sspId ?? '?'} generated ${g.generatedAt ?? '?'}. Generated by \`scripts\\gaps.mjs\` (PLAN.md §4). **${g.rowCount} rows.**`, '',
    'Columns: id (stable, from content) | module (the fix) | control | item | what the assessor needs | what we have | owner | source | weight (SPRS points x 3 for P0, x 2 for P1, x 1 otherwise).', '',
    `By module: ${Object.entries(g.byModule).map(([k, v]) => `${k} ${v}`).join(', ')}. By owner: ${Object.entries(g.byOwner).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '',
    '## Scorecard', '', '| Row | Status | Value |', '|---|---|---|', ...g.scorecard.map((r) => `| ${r.id} | ${r.status} | ${cell(r.detail)} |`), ''];
  if (g.notes.length) L.push('Notes: ' + g.notes.join('; ') + '.', '');
  if (g.deficiencies) {
    const D = g.deficiencies;
    L.push(`## Seeded deficiencies (${D.count}: ${D.surfaced} surfaced, ${D.resolved} resolved, ${D.unsurfaced.length} not surfaced)`, '',
      '| deficiency | control | ledger status | fixer | fixer acted this run | surfaced by | GAPS row |', '|---|---|---|---|---|---|---|',
      ...D.rows.map((x) => `| ${x.id} | ${x.control ?? '-'} | ${x.ledgerStatus} | ${cell(x.fixer)} | ${cell(x.fixerActed)}${x.note ? `; ${cell(x.note)}` : ''} | ${x.surfacedBy ? `${x.surfacedBy.id} (${x.surfacedBy.source})` : (x.resolved ? 'resolved' : '-')} | ${x.fallbackRow ?? '-'} |`), '');
  }
  for (const src of SECTION_ORDER) {
    const rs = g.rows.filter((r) => r.source === src);
    if (!rs.length) continue;
    L.push(`## ${SECTION_TITLE[src]} (${rs.length})`, '');
    const groups = src === 'documentary' ? [...new Set(rs.map((r) => r.group))] : [null];
    for (const grp of groups) {
      if (grp) L.push(`### ${grp} (${rs.filter((r) => r.group === grp).length})`, '');
      L.push('| id | module | control | item | what the assessor needs | what we have | owner | source | weight |', '|---|---|---|---|---|---|---|---|---|');
      for (const r of rs.filter((x) => !grp || x.group === grp)) L.push(`| ${r.id} | ${r.module} | ${cell(r.control ?? '-')} | ${cell(r.item)} | ${cell(r.needs)} | ${cell(r.have)}${r.finding ? `; EO finding: ${cell(r.finding)}` : ''} | ${r.owner} | ${r.source} | ${r.weight} |`);
      L.push('');
    }
  }
  return L.join('\n');
}
export function writeGaps(g, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const md = path.join(outDir, `GAPS-${g.scenario}.md`), json = path.join(outDir, `GAPS-${g.scenario}.json`);
  fs.writeFileSync(md, `${renderGapsMd(g)}\n`);
  fs.writeFileSync(json, `${JSON.stringify(g, null, 2)}\n`);
  return { md, json };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const o = parseArgs(process.argv.slice(2));
  const g = buildGaps(loadInputs(o));
  const f = writeGaps(g, o.outDir);
  console.log(`GAPS ${g.scenario}: ${g.rowCount} rows ${JSON.stringify(g.bySource)}`);
  console.log(`written: ${f.md}, ${f.json}`);
}
