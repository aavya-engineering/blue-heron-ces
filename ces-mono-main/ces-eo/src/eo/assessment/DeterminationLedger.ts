// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// DeterminationLedger — the unified per-objective status spine (G-EUT-5 "tie it together").
//
// EO historically had four independent status worlds that never met: the digital
// AssessmentSnapshot (110 controls, Graph signals), the tenant-suite objective evidence
// (320 determinations, fed into the SSP only), the non-digital readiness stores
// (personnel/training/policy — surfaced only in SSP narrative + readiness endpoints), and
// a POA&M that rebuilt itself from the snapshot alone. This module composes ALL of them into
// ONE per-objective determination ledger with provenance, from which the POA&M lifecycle,
// the SSP, and the persona views all project.
//
// It is ADDITIVE and PURE: it does not modify ControlAssessor. It takes already-resolved
// inputs (the caller wires the stores) so it is trivially testable.

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import type { AssessmentSnapshot, ControlStatus } from 'ces-shared/types/controls';

/** Objective-level determination status (mirrors the SSP ObjectiveStatus vocabulary). */
export type DeterminationStatus = 'satisfied' | 'other_than_satisfied' | 'not_assessed';

/** Which source decided an objective's status — the provenance the assessor asks about. */
export type DeterminationSource =
  | 'tenant-suite'        // a read-only probe examined this exact determination
  | 'digital-signal'      // inherited from the Graph/PowerShell control assessment
  | 'personnel'           // PS screening store
  | 'training'            // AT training store
  | 'policy'              // signed policy document (completeness)
  | 'disposition'         // mission-plan applicability (N/A / ATTEST / INHERITED / DEFERRED)
  | 'none';               // no source has an opinion yet

/** A mission-plan applicability disposition for a control (out-of-scope or attested). */
export type Disposition = 'NA' | 'ATTEST' | 'INHERITED' | 'DEFERRED' | 'PRODUCED';

/** Caller-resolved manual/non-digital status for a control (from the readiness stores). */
export interface ManualControlStatus {
  status: 'met' | 'not_met' | 'not_assessed';
  source: DeterminationSource;
  rationale: string;
}

export interface ObjectiveDetermination {
  objectiveId: string;      // "AC.L2-3.1.7[c]"
  controlId: string;        // "AC.L2-3.1.7"
  statement: string;
  methods: string[];        // examine / interview / test
  status: DeterminationStatus;
  source: DeterminationSource;
  rationale: string;
  weight: number;           // SPRS weight of the parent control (5 / 3 / 1)
  noPoam: boolean;          // true for 5-point (cannot go on a POA&M)
  disposition?: Disposition;
}

export interface ControlRollup {
  controlId: string;
  status: ControlStatus;
  weight: number;
  noPoam: boolean;
  disposition?: Disposition;
  objectives: ObjectiveDetermination[];
}

/** A concrete deficiency with a STABLE, deterministic key for cross-run reconciliation. */
export interface Deficiency {
  key: string;              // deterministic — the objectiveId (stable across runs)
  objectiveId: string;
  controlId: string;
  statement: string;
  status: 'other_than_satisfied' | 'not_assessed';
  source: DeterminationSource;
  weight: number;
  noPoam: boolean;          // 5-point => certification blocker, not a POA&M item
}

export interface DeterminationLedger {
  tenantId: string;
  generatedAt: string;
  objectives: ObjectiveDetermination[];   // all catalog objectives (~320)
  controls: ControlRollup[];              // 110 rollups
  deficiencies: Deficiency[];             // objectives not satisfied and in scope
  summary: {
    objectivesTotal: number;
    objectivesSatisfied: number;
    objectivesOther: number;
    objectivesNotAssessed: number;
    controlsMet: number;
    controlsNotMet: number;
    controlsPartial: number;
    controlsNotAssessed: number;
    deficiencies: number;
    certificationBlockers: number;        // 5-point deficiencies
  };
}

interface ObjectiveRef { objectiveId: string; controlId: string; description: string; methods: string[]; }

export interface BuildLedgerInput {
  tenantId: string;
  generatedAt: string;               // ISO — passed in (Date.now is unavailable in some contexts)
  snapshot: AssessmentSnapshot;      // digital control status (110)
  objectiveEvidence?: Record<string, DeterminationStatus>;   // from SspGenerator.buildObjectiveEvidence
  manualControlStatus?: Record<string, ManualControlStatus>; // controlId -> resolved manual status
  dispositions?: Record<string, Disposition>;                // numeric-ref ("3.1.17") -> mission-plan disposition
  // Test/override hooks — default to the shipped catalogs.
  objectivesCatalog?: ObjectiveRef[];
  sprsWeights?: Record<string, number>;   // controlId -> weight
}

function loadDefaultCatalog(): ObjectiveRef[] {
  const _require = createRequire(import.meta.url);
  const raw = JSON.parse(fs.readFileSync(_require.resolve('ces-shared/data/assessment-objectives'), 'utf-8').replace(/^﻿/, ''));
  return raw.objectives ?? [];
}

function loadDefaultWeights(): Record<string, number> {
  const _require = createRequire(import.meta.url);
  const raw = JSON.parse(fs.readFileSync(_require.resolve('ces-shared/data/sprs-weights'), 'utf-8').replace(/^﻿/, ''));
  const out: Record<string, number> = {};
  // sprs-weights keys by nist_ref ("3.1.7"); our control ids are "AC.L2-3.1.7". Map by the numeric tail.
  for (const w of (raw.controls ?? [])) out[String(w.nist_ref)] = w.weight;
  return out;
}

const numericRef = (controlId: string): string => controlId.replace(/^[A-Z]+\.L[12]-/, '');

function controlStatusToObjective(status: ControlStatus): DeterminationStatus {
  if (status === 'met') return 'satisfied';
  if (status === 'not_met') return 'other_than_satisfied';
  return 'not_assessed';   // partial / not_assessed
}

/**
 * Compose the determination ledger. Per objective, the most specific source that has an opinion
 * wins: an out-of-scope disposition first, then a tenant-suite probe that examined THIS exact
 * determination, then the non-digital readiness store that owns the (manual) control, then the
 * digital control status inherited from the snapshot. Objectives with no source are not_assessed.
 */
export function buildDeterminationLedger(input: BuildLedgerInput): DeterminationLedger {
  const catalog = input.objectivesCatalog ?? loadDefaultCatalog();
  const weights = input.sprsWeights ?? loadDefaultWeights();
  const evidence = input.objectiveEvidence ?? {};
  const manual = input.manualControlStatus ?? {};
  const dispositions = input.dispositions ?? {};

  const controlStatusMap = new Map<string, ControlStatus>();
  for (const c of input.snapshot.controls) controlStatusMap.set(c.control_id, c.status);

  const weightFor = (controlId: string): number => weights[numericRef(controlId)] ?? weights[controlId] ?? 0;

  const objectives: ObjectiveDetermination[] = catalog.map(o => {
    const controlId = o.controlId;
    const weight = weightFor(controlId);
    const noPoam = weight >= 5;
    const dispo = dispositions[numericRef(controlId)] ?? dispositions[controlId];

    let status: DeterminationStatus;
    let source: DeterminationSource;
    let rationale: string;

    if (dispo) {
      // Out-of-scope / attested / inherited / CES-produced controls are not deficiencies.
      if (dispo === 'NA' || dispo === 'ATTEST' || dispo === 'INHERITED' || dispo === 'PRODUCED') {
        status = 'satisfied'; source = 'disposition'; rationale = `mission-plan disposition: ${dispo}`;
      } else { // DEFERRED
        status = 'not_assessed'; source = 'disposition'; rationale = 'in-scope deferred (channel pending)';
      }
    } else if (o.objectiveId in evidence) {
      status = evidence[o.objectiveId]; source = 'tenant-suite'; rationale = 'examined by a tenant test-suite probe';
    } else if (manual[controlId]) {
      const m = manual[controlId];
      status = m.status === 'met' ? 'satisfied' : m.status === 'not_met' ? 'other_than_satisfied' : 'not_assessed';
      source = m.source; rationale = m.rationale;
    } else if (controlStatusMap.has(controlId)) {
      status = controlStatusToObjective(controlStatusMap.get(controlId)!); source = 'digital-signal';
      rationale = `inherited from control assessment (${controlStatusMap.get(controlId)})`;
    } else {
      status = 'not_assessed'; source = 'none'; rationale = 'no source has assessed this determination';
    }

    return { objectiveId: o.objectiveId, controlId, statement: o.description, methods: o.methods ?? [], status, source, rationale, weight, noPoam, disposition: dispo };
  });

  // roll up to controls
  const byControl = new Map<string, ObjectiveDetermination[]>();
  for (const od of objectives) {
    if (!byControl.has(od.controlId)) byControl.set(od.controlId, []);
    byControl.get(od.controlId)!.push(od);
  }
  const controls: ControlRollup[] = [];
  for (const [controlId, objs] of byControl) {
    const anyOther = objs.some(o => o.status === 'other_than_satisfied');
    const allSat = objs.every(o => o.status === 'satisfied');
    const anySat = objs.some(o => o.status === 'satisfied');
    let status: ControlStatus;
    if (anyOther) status = 'not_met';
    else if (allSat) status = 'met';
    else if (anySat) status = 'partial';
    else status = 'not_assessed';
    controls.push({ controlId, status, weight: weightFor(controlId), noPoam: weightFor(controlId) >= 5, disposition: dispositions[numericRef(controlId)] ?? dispositions[controlId], objectives: objs });
  }
  controls.sort((a, b) => a.controlId.localeCompare(b.controlId, undefined, { numeric: true }));

  // deficiencies: objectives that are not satisfied and not dispositioned out-of-scope
  const deficiencies: Deficiency[] = objectives
    .filter(o => o.status !== 'satisfied' && o.source !== 'disposition')
    .map(o => ({
      key: o.objectiveId,       // deterministic, stable across runs — the reconciliation key
      objectiveId: o.objectiveId, controlId: o.controlId, statement: o.statement,
      status: o.status as 'other_than_satisfied' | 'not_assessed',
      source: o.source, weight: o.weight, noPoam: o.noPoam,
    }));

  const summary = {
    objectivesTotal: objectives.length,
    objectivesSatisfied: objectives.filter(o => o.status === 'satisfied').length,
    objectivesOther: objectives.filter(o => o.status === 'other_than_satisfied').length,
    objectivesNotAssessed: objectives.filter(o => o.status === 'not_assessed').length,
    controlsMet: controls.filter(c => c.status === 'met').length,
    controlsNotMet: controls.filter(c => c.status === 'not_met').length,
    controlsPartial: controls.filter(c => c.status === 'partial').length,
    controlsNotAssessed: controls.filter(c => c.status === 'not_assessed').length,
    deficiencies: deficiencies.length,
    certificationBlockers: deficiencies.filter(d => d.noPoam).length,
  };

  return { tenantId: input.tenantId, generatedAt: input.generatedAt, objectives, controls, deficiencies, summary };
}
