// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Generate a live Assessor Determination Viewer from the real vfsgov tenant-suite data, so the
// viewer can be opened + clicked without the EO server/DB running. Composes the same way the
// /assessor route does, but sources control status from the tenant suite (Examine coverage) instead
// of the SQLite AssessmentSnapshot. Run: npx tsx scripts/gen-assessor-demo.mts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildDeterminationLedger } from '../src/eo/assessment/DeterminationLedger.js';
import { reconcilePoamLifecycle } from '../src/eo/poam/PoamLifecycle.js';
import { composeAssessorView } from '../src/eo/viewer/AssessorViewComposer.js';
import { renderAssessorHtml } from '../src/eo/viewer/AssessorViewHtml.js';
import { loadPersonas } from '../src/eo/persona/PersonaProjection.js';

const repo = path.resolve('..');
const rd = (p: string) => JSON.parse(fs.readFileSync(path.join(repo, p), 'utf-8').replace(/^﻿/, ''));

const map = rd('tenant-tests/profiles/probe-objective-map.json').map;
const results = path.join(repo, 'docs/tenant-tests/results');
const runFile = fs.readdirSync(results).filter(f => /^run-.*\.json$/.test(f)).sort().pop()!;
const run = rd(`docs/tenant-tests/results/${runFile}`);

// objective evidence from the suite
const vByProbe = new Map<string, string>();
for (const r of run.results) vByProbe.set(`${r.CaseId}|${r.Test}`, String(r.Verdict ?? ''));
const byObj = new Map<string, Set<string>>();
for (const e of map) { const v = vByProbe.get(`${e.case}|${e.test}`); if (!v) continue; for (const o of (e.objectives ?? [])) { if (!byObj.has(o)) byObj.set(o, new Set()); byObj.get(o)!.add(v); } }
const objectiveEvidence: Record<string, 'satisfied' | 'other_than_satisfied' | 'not_assessed'> = {};
for (const [o, vs] of byObj) objectiveEvidence[o] = vs.has('FAIL') ? 'other_than_satisfied' : vs.has('PASS') ? 'satisfied' : 'not_assessed';

// dispositions from applicability
const dispositions: Record<string, 'NA' | 'ATTEST' | 'INHERITED' | 'DEFERRED'> = {};
const DISPO: Record<string, 'NA' | 'ATTEST' | 'INHERITED' | 'DEFERRED'> = { NOT_APPLICABLE: 'NA', ATTEST: 'ATTEST', INHERITED: 'INHERITED', IN_SCOPE_DEFERRED: 'DEFERRED' };
for (const d of rd('tenant-tests/profiles/vfsgov.applicability.json').dispositions) { const m = DISPO[d.disposition]; if (m) dispositions[String(d.control).replace(/^[A-Z]+-/, '')] = m; }

// minimal snapshot (digital layer absent in this offline demo; suite drives the Examine story)
const catalog = rd('ces-shared/dist/data/assessment-objectives.reference.json').objectives;
const controlIds = [...new Set(catalog.map((o: { controlId: string }) => o.controlId))] as string[];
const snapshot = {
  snapshotId: 'demo', tenantId: 'vfsgov', generatedAt: run.startedAt ?? '2026-07-03T00:00:00Z',
  controls: controlIds.map(id => ({ control_id: id, nist_ref: id, status: 'not_assessed', classification: 'automated', sources: [], last_assessed: '', signals: [], evidenceArtifactIds: [], automationSource: 'graph', lastFetchedAt: '' })),
  sources_merged: [], sprs_score: 0, controls_met: 0, controls_not_met: 0, controls_partial: 0, controls_not_assessed: controlIds.length,
} as Parameters<typeof buildDeterminationLedger>[0]['snapshot'];

const ledger = buildDeterminationLedger({ tenantId: 'vfsgov', generatedAt: snapshot.generatedAt, snapshot, objectiveEvidence, dispositions });
const poamLedger = reconcilePoamLifecycle(null, ledger.deficiencies, snapshot.generatedAt, 'demo-poam', 'vfsgov');
const view = composeAssessorView({ ledger, poamLedger, personas: loadPersonas() });
const html = renderAssessorHtml(view);

const out = path.join(results, 'assessor-view.html');
fs.writeFileSync(out, html, 'utf-8');
console.log('Assessor viewer written:', out);
console.log(`objectives=${view.objectives.length} deficiencies=${view.summary.deficiencies} open-poam=${view.summary.openPoamItems} source-run=${runFile}`);
