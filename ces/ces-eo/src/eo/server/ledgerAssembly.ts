// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { AssessmentSnapshot, ControlStatus } from 'ces-shared/types/controls';
import type { AssessmentStore } from '../assessment/AssessmentStore.js';
import { evidenceRefsLookup } from '../evidence/store/EvidenceStore.js';
import { loadPolicyEnvelopes } from '../config/EoConfig.js';
import { buildDeterminationLedger, type ManualControlStatus, type DeterminationLedger } from '../assessment/DeterminationLedger.js';
import type { PersonnelStore } from '../personnel/PersonnelStore.js';
import { catalogDecidesControl, type TrainingStore } from '../personnel/TrainingStore.js';
import type { ScreeningElementStore } from '../personnel/ScreeningElementStore.js';
import {
  loadObjectiveEvidenceFromSuite,
  loadDispositionsFromProfile,
  type TenantScope,
} from './eo-router-utils.js';

type ResolvedTenant = Extract<TenantScope, { ok: true }>;

export interface LedgerAssemblyDeps {
  assessmentStore: AssessmentStore;
  personnelStore: PersonnelStore;
  screeningElementStore: ScreeningElementStore;
  trainingStore: TrainingStore;
  /** EO-collection W1: EvidenceOps storage root; when set, objectives carry evidence-store refs. */
  storageRoot?: string;
  /** W5: the Mission Plan path; its hash-verified policy-set manifest is cited in objective rationales. */
  missionPlanPath?: string;
}

export const AT_CONTROLS = ['AT.L2-3.2.1', 'AT.L2-3.2.2', 'AT.L2-3.2.3'] as const;

/** The non-digital readiness stores' opinion per control (NS-3b: one source for the ledger and the snapshot). */
export interface StoreControlStatus {
  /** What the ledger takes as the store's status (its precedence: disposition, tenant-suite, then this). */
  status: Record<string, ManualControlStatus>;
  /**
   * The controls the store decides in the snapshot too: PS when it holds records for that part
   * (the organisation's uploaded records, or personnel records), AT when an active person exists and a
   * course required of every active person satisfies the control (TrainingStore.catalogDecidesControl).
   */
  decided: string[];
}

export function storeControlStatus(
  deps: Pick<LedgerAssemblyDeps, 'personnelStore' | 'screeningElementStore' | 'trainingStore'>,
  slug: string | undefined,
): StoreControlStatus {
  const { personnelStore, screeningElementStore, trainingStore } = deps;
  const status: Record<string, ManualControlStatus> = {};
  const decided: string[] = [];
  if (!slug) return { status, decided };
  const readiness = personnelStore.getReadiness(slug, screeningElementStore);
  // W5 cycle 7: when the organisation's uploaded personnel records decided a control, their basis is the rationale.
  status['PS.L2-3.9.1'] = { status: readiness.ps_3_9_1, source: 'personnel', rationale: readiness.ps_3_9_1_basis ?? 'personnel screening readiness (all active personnel cleared)' };
  status['PS.L2-3.9.2'] = { status: readiness.ps_3_9_2, source: 'personnel', rationale: readiness.ps_3_9_2_basis ?? 'offboarding/termination readiness' };
  const records = personnelStore.load(slug);
  const active = records.filter(r => r.screeningState !== 'offboarded').map(r => ({ id: r.id, role: r.role, screeningState: r.screeningState }));
  if (readiness.ps_3_9_1_basis !== undefined || active.length > 0) decided.push('PS.L2-3.9.1');
  if (readiness.ps_3_9_2_basis !== undefined || records.length > 0) decided.push('PS.L2-3.9.2');
  if (active.length > 0) {
    const catalog = trainingStore.loadCatalog(slug);
    for (const at of AT_CONTROLS) {
      // NS-3b: a control covered only by courses scoped to a record's job titles is not the store's to decide.
      if (!catalogDecidesControl(catalog, at)) continue;
      const c = trainingStore.controlCompliance(slug, at, active);
      // FIN-26b (FD-9): a population-scoped count says so; every other control keeps its wording.
      const rationale = c.population
        ? `role-based training completion across the defined population (${c.population.roles.join('; ')}) (${c.compliant + c.exempt}/${c.total} compliant)`
        : `awareness-training completion across active personnel (${c.compliant + c.exempt}/${c.total} compliant)`;
      status[at] = { status: c.met ? 'met' : 'not_met', source: 'training', rationale };
      decided.push(at);
    }
  }
  return { status, decided };
}

/** Prefix of a snapshot statusRationale the store decided (NS-3b). */
export const STORE_RATIONALE_PREFIX = 'Store precedence';

/**
 * NS-3b: the readiness stores set the snapshot status of the controls they decide, under the ledger's
 * precedence. Each decided control takes the ledger's rolled-up status, built on this snapshot (a mission-plan
 * disposition and a tenant-suite probe still outrank the store per objective). A control none of whose
 * objectives the store decides in the ledger is left as it is. Returns the controls whose status changed.
 */
export function applyStoreControlStatus(
  snapshot: AssessmentSnapshot,
  ledger: DeterminationLedger,
  store: StoreControlStatus,
): Array<{ controlId: string; from: ControlStatus; to: ControlStatus }> {
  const moved: Array<{ controlId: string; from: ControlStatus; to: ControlStatus }> = [];
  for (const controlId of store.decided) {
    const m = store.status[controlId];
    const rollup = ledger.controls.find(c => c.controlId === controlId);
    const ctrl = snapshot.controls.find(c => c.control_id === controlId) as (AssessmentSnapshot['controls'][number] & { statusRationale?: string; assessmentFinding?: string }) | undefined;
    if (!m || !rollup || !ctrl || !rollup.objectives.some(o => o.source === m.source)) continue;
    const from = ctrl.status;
    // The store agreeing with the deciding tier keeps that tier's rationale first, with the store's note after it.
    if (from === rollup.status && ctrl.statusRationale) {
      ctrl.statusRationale = `${ctrl.statusRationale}; ${STORE_RATIONALE_PREFIX.toLowerCase()} (${m.source} store) agrees: ${m.rationale}`;
    } else {
      ctrl.statusRationale = `${STORE_RATIONALE_PREFIX} (${m.source} store, ledger precedence): ${m.rationale}; was ${from}${ctrl.statusRationale ? ` (${ctrl.statusRationale})` : ''}`;
    }
    ctrl.status = rollup.status;
    if (!ctrl.assessmentFinding) ctrl.assessmentFinding = m.rationale;
    if (from !== rollup.status) moved.push({ controlId, from, to: rollup.status });
  }
  if (moved.length > 0) {
    snapshot.controls_met = snapshot.controls.filter(c => c.status === 'met').length;
    snapshot.controls_not_met = snapshot.controls.filter(c => c.status === 'not_met').length;
    snapshot.controls_partial = snapshot.controls.filter(c => c.status === 'partial').length;
    snapshot.controls_not_assessed = snapshot.controls.filter(c => c.status === 'not_assessed').length;
  }
  return moved;
}

/**
 * Assemble the unified determination ledger for a tenant from a snapshot + suite evidence +
 * non-digital PS/AT readiness + mission-plan dispositions. Shared by /api/ledger,
 * /api/poam/reconcile, the persona and assessor views, and (W2.4) the SSP route, so all project
 * from the same source of truth.
 * FX-EO8: built from the REQUESTED tenant (scope = resolved ?tenant=). `snapshot` defaults to the
 * tenant's latest; the SSP route passes the snapshot it is generating from.
 */
export function assembleLedger(
  deps: LedgerAssemblyDeps,
  scope: ResolvedTenant,
  snapshot?: AssessmentSnapshot,
): DeterminationLedger | null {
  const { assessmentStore } = deps;
  const slug = scope.slug;
  const latest = snapshot ?? assessmentStore.loadLatestForTenant(scope.tenantId);
  if (!latest) return null;
  const manualControlStatus = storeControlStatus(deps, slug).status;
  return buildDeterminationLedger({
    tenantId: latest.tenantId,
    generatedAt: latest.generatedAt,
    snapshot: latest,
    // W0.1: only this tenant's own, in-age test-suite run file (keyed by its `tenant` slug).
    objectiveEvidence: loadObjectiveEvidenceFromSuite(slug, scope.tenantId),
    manualControlStatus,
    dispositions: loadDispositionsFromProfile(slug),
    evidenceRefsLookup: deps.storageRoot ? evidenceRefsLookup(deps.storageRoot, latest.tenantId) : undefined,
    policyManifest: deps.missionPlanPath ? loadPolicyEnvelopes(deps.missionPlanPath).manifest as { documents?: Array<{ name: string; sha256: string }> } | undefined : undefined,
  });
}
