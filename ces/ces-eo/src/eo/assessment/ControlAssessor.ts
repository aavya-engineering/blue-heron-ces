// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';
import type { CmmcControl, ControlAssessment, ControlClassification, AssessmentSource, AssessmentSnapshot } from 'ces-shared/types/controls';
import type { DirectiveMetadata } from 'ces-shared/types/evidence';
import type { PolicyDocument } from 'ces-shared/types/policy';
import type { CommandEntry, CommandRegistryFile } from 'ces-shared/types/registry';
import type { EcEvidenceItem } from 'ces-shared/types/evidence-collector';
import { resolveCesIdentity } from 'ces-shared/config/ces';
import { loadCesConfig } from 'ces-shared/config/ces/node';
import { ecItemsToSources } from '../evidence/EcEvidenceReader.js';
import { isStamperExecutionFailure } from '../evidence/StamperExecutionResultsLoader.js';
import { isGatePendingReviewSource, isStamperNotSatSource, isStateNotVerifiedSource, isUnassignedObjectSource, NON_STACK_CONTROL_IDS, STATE_NOT_VERIFIED } from '../evidence/StamperEvidenceLoader.js';
import { isPresenceOnlySource, presenceReadFromSource, withoutPresenceLabel, PRESENCE_ONLY_LABEL } from '../mapping/StatusTranslator.js';

interface ControlsReference {
  total_controls: number;
  controls: CmmcControl[];
}

/** Blob artifact captured to Azure Blob Storage by EO's own signal-capture service (EvidenceCaptureService). */
export interface BlobArtifact {
  artifactId: string;
  runId: string;
  capturedAt: string;
  source: string;
  checkId: string;
  controlIds: string[];
  sha256: string;
}

/** W1.1: the verdict and the sentence that says which precedence tier decided it. */
export interface StatusDecision {
  status: ControlAssessment['status'];
  rationale: string;
  /** Founder decision 2026-10-27: set when a presence-only live read decided `met`; what it read. */
  presenceRead?: string;
  /** W5 cycle 2: the deciding sources' own sentences (see `findingOf`). Omitted when nothing decided. */
  finding?: string;
  /** W7-EO2: the history sentence when a later confirmed AdminOps write and a passing live read superseded a Tier 1 Stamper NOT_SAT. */
  stamperNotSatSuperseded?: string;
}

/** W5 cycle 2: a Stamper NOT_SAT entry behind a Tier 1 finding. */
export interface FindingStamperEntry {
  entryId: string;
  label: string;
  outcomeRationale: string;
}

/** W1.1: EO-local view of a control assessment carrying its verdict rationale. */
export interface EoControlAssessment extends ControlAssessment {
  statusRationale: string;
  /** Founder decision 2026-10-27: met on a presence-only evaluator's verdict (counted, labelled). */
  presenceOnly?: true;
  /** What the presence-only evaluator read (set with `presenceOnly`). */
  presenceRead?: string;
  /** W5 cycle 2: the deciding evaluator's evidence sentence (Tier 2) or the deciding Stamper / AdminOps
   *  record text (Tiers 1, 3, 4), verbatim. Omitted when no source decided. */
  assessmentFinding?: string;
  /** W5 cycle 2: the Stamper NOT_SAT entries behind a Tier 1 finding. Omitted otherwise. */
  findingStamperEntries?: FindingStamperEntry[];
  /** W7-EO2: set when a Tier 1 Stamper NOT_SAT was superseded (see `StatusDecision`). Omitted otherwise. */
  stamperNotSatSuperseded?: string;
}

/** controlId -> objectiveId -> sources that evidence that one assessment objective. */
export type ObjectiveSourceMap = Map<string, Map<string, AssessmentSource[]>>;

/**
 * NS-1 (GD-b): one WORM `document_review` row (collection `eo_document_reviews`, written by
 * review-router.ts). A reviewer holding a minted approver token records a verdict on one
 * assessment objective, citing the EC artifact's sha256.
 */
export interface DocumentReview {
  reviewId: string;
  tenantSlug: string;
  controlId: string;
  objectiveId: string;
  artifactHash: string;
  verdict: 'met' | 'not_met';
  notes?: string;
  reviewer: { upn: string; subjectId: string; tokenId: string; displayName?: string };
  /** The EC item uploader at review time (snapshot; the assessor re-checks against live EC items). */
  uploader: { upn: string; subjectId: string } | null;
  ecItemIds: string[];
  reviewedAt: string;
}

let objectiveIdsCache: Map<string, string[]> | undefined;

/** NS-1: controlId -> its assessment objective ids, from ces-shared assessment-objectives reference data. */
export function objectiveIdsByControl(): Map<string, string[]> {
  if (!objectiveIdsCache) {
    const _require = createRequire(import.meta.url);
    const raw = JSON.parse(fs.readFileSync(_require.resolve('ces-shared/data/assessment-objectives'), 'utf-8').replace(/^﻿/, ''));
    const map = new Map<string, string[]>();
    for (const o of (raw.objectives ?? []) as Array<{ objectiveId: string; controlId: string }>) {
      if (!map.has(o.controlId)) map.set(o.controlId, []);
      map.get(o.controlId)!.push(o.objectiveId);
    }
    objectiveIdsCache = map;
  }
  return objectiveIdsCache;
}

/**
 * DEPTH-11: the 12 non-tenant practices (depth plan §4 DEPTH-11). No tenant setting evidences them; they are
 * documents and attestation, decided only by GD-b reviews through the EO review route (CA.L2-3.12.2 by EO's own
 * POA&M ledger, FIN-27; PS.L2-3.9.1 by the personnel store, NS-3b). All 12 are in NON_STACK_CONTROL_IDS.
 */
export const NON_TENANT_PRACTICES: ReadonlySet<string> = new Set([
  'IR.L2-3.6.3', 'MA.L2-3.7.3', 'MA.L2-3.7.6',
  'PE.L1-3.10.1', 'PE.L2-3.10.2', 'PE.L1-3.10.3', 'PE.L1-3.10.4', 'PE.L1-3.10.5',
  'PS.L2-3.9.1', 'RA.L2-3.11.1', 'CA.L2-3.12.2', 'CA.L2-3.12.4',
]);

/** DEPTH-11: the EO document-review route that decides a non-stack objective (NS-1, GD-b). */
export const NON_STACK_REVIEW_ROUTE = 'EC upload, then POST /api/reviews by a reviewer who is not the uploader (GD-b)';

/** DEPTH-11 (F-8): the suffix on a Stamper record shown on a non-stack control whose entry names no tenant-evidenced objective of it. */
export const NON_STACK_PROXY_UNCOUNTED = 'display only; the Stamper entry names no tenant-evidenced objective of this non-stack control (DEPTH-11)';

/**
 * PH7-EO (V59, S3-D09): the finding of a non-stack control left not_assessed while Stamper records on it are display only
 * (NON_STACK_PROXY_UNCOUNTED). It names the records and the route that decides the control; the status is unchanged.
 * SspGenerator carries a not_assessed finding only when it starts with this prefix; PoamGenerator appends it to the item.
 */
export const NON_STACK_NOT_DECIDED_FINDING = 'Not decided: no tenant setting can prove this non-stack control (FD-2)';

/** PH7-EO: the NON_STACK_NOT_DECIDED_FINDING sentence for the display-only Stamper sources on a non-stack control. */
export function nonStackNotDecidedFinding(shown: AssessmentSource[]): string {
  const labels = [...new Set(shown.map(s => s.detail.slice(0, s.detail.length - NON_STACK_PROXY_UNCOUNTED.length - 3).replace(/\s*\[executor [^\]]*\]/, '')))];
  return `${NON_STACK_NOT_DECIDED_FINDING}: ${labels.length} Stamper record(s) on it are display only, their entries name no tenant-evidenced objective of it (DEPTH-11): ${labels.map(l => `"${l}"`).join('; ')}; decided only by ${NON_STACK_REVIEW_ROUTE}`;
}

/** DEPTH-11 (F-8): the not_assessed rationale prefix of a non-stack control whose counted proxies do not cover every objective. */
export const NON_STACK_PROXY_PARTIAL = 'not_assessed: Stamper entries evidence only part of this non-stack control (DEPTH-11)';

let tenantEvidencedCache: Map<string, Set<string>> | undefined;

/**
 * DEPTH-11 (F-8): controlId -> the objectives KB-1 (`assessor-evidence-matrix`) marks with a `stack_signal`
 * evidence row, i.e. the objectives a tenant setting really evidences. The 25 non-stack controls without any
 * such row (FIN-10) map to nothing; AT.L2-3.2.1 [c][d], AT.L2-3.2.3 [b] and PS.L2-3.9.2 [b][c] are the rest.
 */
export function tenantEvidencedObjectivesByControl(): Map<string, Set<string>> {
  if (!tenantEvidencedCache) {
    const _require = createRequire(import.meta.url);
    const raw = JSON.parse(fs.readFileSync(_require.resolve('ces-shared/data/assessor-evidence-matrix'), 'utf-8').replace(/^﻿/, ''));
    const map = new Map<string, Set<string>>();
    for (const o of (raw.objectives ?? []) as Array<{ id: string; practice_id: string; evidence?: Array<{ ces_source?: string }> }>) {
      if (!(o.evidence ?? []).some(e => e.ces_source === 'stack_signal')) continue;
      if (!map.has(o.practice_id)) map.set(o.practice_id, new Set());
      map.get(o.practice_id)!.add(o.id);
    }
    tenantEvidencedCache = map;
  }
  return tenantEvidencedCache;
}

/** DEPTH-11: one non-stack objective's route (what DEPTH-6's `objective_coverage[]` can take as `document` / `manual`). */
export interface NonStackObjectiveRoute {
  controlId: string;
  objectiveId: string;
  /** `tenant`: a stack source may count (KB-1 stack_signal); `document`: KB-1 names a document or upload; `manual`: attestation only. */
  coverage: 'tenant' | 'document' | 'manual';
  nonTenantPractice: boolean;
  route: string;
}

/**
 * DEPTH-11: the route of every objective of the 28 non-stack controls (73 objectives). `document` when KB-1 lists
 * an `ec_upload` or `stamper_evidence` (policy document) row, else `manual`; both are decided only by GD-b reviews.
 */
let routesCache: NonStackObjectiveRoute[] | undefined;

export function nonStackObjectiveRoutes(): NonStackObjectiveRoute[] {
  if (routesCache) return routesCache.map(r => ({ ...r }));
  const _require = createRequire(import.meta.url);
  const raw = JSON.parse(fs.readFileSync(_require.resolve('ces-shared/data/assessor-evidence-matrix'), 'utf-8').replace(/^﻿/, ''));
  const tenant = tenantEvidencedObjectivesByControl();
  const out: NonStackObjectiveRoute[] = [];
  for (const o of (raw.objectives ?? []) as Array<{ id: string; practice_id: string; evidence?: Array<{ ces_source?: string }> }>) {
    if (!NON_STACK_CONTROL_IDS.has(o.practice_id)) continue;
    const kinds = new Set((o.evidence ?? []).map(e => e.ces_source));
    const coverage = tenant.get(o.practice_id)?.has(o.id) ? 'tenant' : kinds.has('ec_upload') || kinds.has('stamper_evidence') ? 'document' : 'manual';
    out.push({ controlId: o.practice_id, objectiveId: o.id, coverage, nonTenantPractice: NON_TENANT_PRACTICES.has(o.practice_id), route: coverage === 'tenant' ? `stack source, or ${NON_STACK_REVIEW_ROUTE}` : NON_STACK_REVIEW_ROUTE });
  }
  routesCache = out;
  return out.map(r => ({ ...r }));
}

const sameUpn = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * NS-1 (GD-b): does this review count for `controlId`? The cited hash must match at least one EC
 * item for the control; every matching item must have a known uploader (`uploadedBy` absent or null
 * = unknown = unsatisfiable), and the reviewer must not be any matching item's uploader (by UPN).
 */
export function isCountableReview(review: DocumentReview, controlId: string, ecItems: EcEvidenceItem[], objectiveIds: string[]): boolean {
  if (review.controlId !== controlId || !objectiveIds.includes(review.objectiveId)) return false;
  if (review.verdict !== 'met' && review.verdict !== 'not_met') return false;
  if (!review.reviewer?.upn || !review.artifactHash) return false;
  const hash = review.artifactHash.toLowerCase();
  const matching = ecItems.filter(i => i.controlIds.includes(controlId) && i.sha256.toLowerCase() === hash);
  if (matching.length === 0) return false;
  return matching.every(i => !!i.uploadedBy?.upn && !sameUpn(i.uploadedBy.upn, review.reviewer.upn));
}

/**
 * W2 (AD-6, B27): an AdminOps row without a confirming read after the apply, or a read-only op
 * (AdminOpsEvidenceReader marks both "state not verified"). It ranks Tier 4 whatever its result,
 * so it never decides above a live read or a state-verified verdict.
 */
export function isUnconfirmedAdminOpsSource(s: AssessmentSource): boolean {
  return s.type === 'adminops_execution' && s.detail.endsWith(`(${STATE_NOT_VERIFIED})`);
}

/**
 * W7-EO2: a live AdminOps write whose confirming read after the apply succeeded (AdminOpsEvidenceReader
 * kind `apply_confirmed`, SAT). Dry runs, denials and failures never become sources; an unconfirmed
 * apply or a read-only op carries the "state not verified" suffix and is excluded here.
 */
export function isConfirmedAdminOpsWrite(s: AssessmentSource): boolean {
  return s.type === 'adminops_execution' && s.result === 'imported' && !isUnconfirmedAdminOpsSource(s);
}

/**
 * FIN-10 (FD-2): the rationale of a non-stack control that is still not_assessed after GD-b while a
 * manual-gate approval names it. The gate record is pending_review and never decides (V110 probe).
 */
export const GATE_PENDING_REVIEW_RATIONALE =
  'pending_review: a manual-gate approval names this non-stack control, but a gate approval never credits it (FD-2); only GD-b document reviews or the records stores decide';

/**
 * FIN-27 (FD-4, NS-audit F-4): CA.L2-3.12.1 (periodic assessment), CA.L2-3.12.2 (POA&M) and CA.L2-3.12.3
 * (ongoing monitoring) are credited by EO's own assessment and POA&M records, never by a stack source.
 * Before FIN-27 Compliance Manager reads decided them (Stamper `CA.L2-3.12.1.compliance-assess`, a Tier 4
 * evidence-only SAT, for 3.12.1 / 3.12.3; `CA.L2-3.12.2.poam` for 3.12.2). Those sources stay on the
 * control for display; they never set its status.
 */
export const CA_SELF_RECORD_CONTROLS: ReadonlySet<string> = new Set(['CA.L2-3.12.1', 'CA.L2-3.12.2', 'CA.L2-3.12.3']);

/** FIN-27: CES's defined assessment frequency for CA.L2-3.12.1[a]: at least one EO assessment per period. */
export const CA_ASSESSMENT_PERIOD_DAYS = 365;
/** FIN-27: CA.L2-3.12.3 ongoing monitoring: the newest prior EO assessment and POA&M reconcile are this recent. */
export const CA_MONITORING_WINDOW_DAYS = 30;
/** FIN-27: CA.L2-3.12.3 needs at least this many prior non-forced EO assessments (repeated, not one-off). */
export const CA_MONITORING_MIN_ASSESSMENTS = 2;

/** FIN-27: the exact rationale prefix of a CA control decided by EO's own records (DeterminationLedger / DriftDetector parse "Tier 3 (...)"). */
export const CA_SELF_RECORD_TIER = "Tier 3 (EO's own assessment and POA&M records)";

/**
 * FIN-27: EO's own records, read by the caller before this assessment is saved. `assessments` are this
 * tenant's stored snapshots (the one being built is not among them); `poamLedger` is the latest POA&M
 * lifecycle ledger (`PoamLedgerStore.loadLatest`), or null. `asOf` defaults to the merge time.
 */
export interface CaSelfRecords {
  assessments: Array<{ snapshotId: string; generatedAt: string; forced?: boolean }>;
  poamLedger: { poamId: string; generatedAt: string } | null;
  asOf?: string;
}

/** FIN-27: the not_assessed rationale of a CA self-record control whose EO records do not satisfy the rule. */
export const CA_SELF_RECORD_UNMET = 'not_assessed: EO\'s own assessment and POA&M records do not yet show';

/** FIN-27: the suffix on a Stamper record shown on a CA self-record control (display only, uncounted). */
export const CA_STACK_DISPLAY_ONLY = 'display only; a Stamper record never credits this control (FD-4)';

const DAY_MS = 86_400_000;

/**
 * FIN-27: decide CA.L2-3.12.1 / 3.12.2 / 3.12.3 from EO's own records. met when the rule holds; otherwise
 * undefined with the reason (no opinion: EO cannot say an assessment did not happen outside CES).
 *   3.12.1: >= 1 prior non-forced EO assessment within CA_ASSESSMENT_PERIOD_DAYS, and a POA&M ledger
 *           within the same period.
 *   3.12.2: a POA&M ledger EO generated within CA_ASSESSMENT_PERIOD_DAYS from its own deficiencies (the
 *           lifecycle reconcile after each assess), and >= 1 prior non-forced EO assessment it came from
 *           within the same period. The same thresholds as 3.12.1; the finding names the POA&M.
 *   3.12.3: >= CA_MONITORING_MIN_ASSESSMENTS prior non-forced EO assessments, the newest within
 *           CA_MONITORING_WINDOW_DAYS, and a POA&M ledger reconciled within that window.
 */
export function decideCaBySelfRecords(controlId: string, records: CaSelfRecords | undefined, mergeTime: string): { decision?: StatusDecision; reason: string } {
  if (!records) return { reason: 'the records were not supplied to the assessor' };
  const asOf = Date.parse(records.asOf ?? mergeTime);
  const ageDays = (iso: string) => (asOf - Date.parse(iso)) / DAY_MS;
  const valid = records.assessments
    .filter(a => !a.forced && Number.isFinite(Date.parse(a.generatedAt)) && ageDays(a.generatedAt) >= 0)
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
  const ledger = records.poamLedger && Number.isFinite(Date.parse(records.poamLedger.generatedAt)) && ageDays(records.poamLedger.generatedAt) >= 0
    ? records.poamLedger : null;
  const monitoring = controlId === 'CA.L2-3.12.3';
  const windowDays = monitoring ? CA_MONITORING_WINDOW_DAYS : CA_ASSESSMENT_PERIOD_DAYS;
  const inWindow = valid.filter(a => ageDays(a.generatedAt) <= windowDays);
  const needed = monitoring ? CA_MONITORING_MIN_ASSESSMENTS : 1;
  const missing: string[] = [];
  if (monitoring ? valid.length < needed || inWindow.length === 0 : inWindow.length < needed) {
    missing.push(monitoring
      ? `${needed} prior non-forced EO assessments with the newest within ${windowDays} days (found ${valid.length}, ${inWindow.length} within the window)`
      : `a prior non-forced EO assessment within ${windowDays} days (found ${inWindow.length})`);
  }
  if (!ledger || ageDays(ledger.generatedAt) > windowDays) {
    missing.push(`a POA&M ledger ${monitoring ? 'reconciled' : 'generated'} within ${windowDays} days (${ledger ? `newest ${ledger.poamId} at ${ledger.generatedAt}` : 'none'})`);
  }
  if (missing.length > 0) return { reason: missing.join('; ') };
  const newest = valid[0];
  const poam = controlId === 'CA.L2-3.12.2';
  const finding = poam
    ? `POA&M ledger ${ledger!.poamId} generated by EO at ${ledger!.generatedAt} from its own assessment deficiencies (newest prior assessment ${newest.snapshotId} at ${newest.generatedAt}; ${inWindow.length} within the ${windowDays}-day assessment period)`
    : monitoring
    ? `EO assessed this tenant ${valid.length} time(s) before this assessment (newest ${newest.snapshotId} at ${newest.generatedAt}; ${inWindow.length} within ${windowDays} days); POA&M ledger ${ledger!.poamId} reconciled at ${ledger!.generatedAt}`
    : `EO assessed this tenant at ${newest.generatedAt} (snapshot ${newest.snapshotId}; ${inWindow.length} assessment(s) within the ${windowDays}-day assessment period); POA&M ledger ${ledger!.poamId} generated at ${ledger!.generatedAt}`;
  return { decision: { status: 'met', rationale: `${CA_SELF_RECORD_TIER} decides: ${poam ? 'eo_poam' : 'eo_assessment'}/exists: ${finding}`, finding }, reason: '' };
}

const isTier4Source = (s: AssessmentSource): boolean => isStateNotVerifiedSource(s) || isUnconfirmedAdminOpsSource(s);

const describeSources = (sources: AssessmentSource[]): string =>
  sources.map(s => `${s.type}/${s.result}: ${s.detail}`).join('; ');

const EXECUTOR_LABEL_RE = /\s*\[executor [^\]]*\]/;

/**
 * W5 cycle 2: the finding is the deciding sources' own text, verbatim: the evaluator's evidence
 * sentence for a live read, the record text for a Stamper or AdminOps source (executor label and
 * presence-only label removed; they are stated elsewhere). A Stamper NOT_SAT names its entry id and
 * outcomeRationale.
 */
export function findingOf(deciding: AssessmentSource[]): string {
  return deciding.map(s => {
    const text = withoutPresenceLabel(s.detail).replace(EXECUTOR_LABEL_RE, '');
    if (isStamperNotSatSource(s)) {
      return `Stamper entry ${s.entryId} (${text}) NOT_SAT${s.outcomeRationale ? `: ${s.outcomeRationale}` : ''}`;
    }
    return text;
  }).join('; ');
}

/** W5 cycle 2: the Stamper NOT_SAT entries among the deciding sources. */
export function findingStamperEntriesOf(deciding: AssessmentSource[]): FindingStamperEntry[] {
  return deciding.filter(isStamperNotSatSource).map(s => ({
    entryId: s.entryId,
    label: s.detail.replace(EXECUTOR_LABEL_RE, ''),
    outcomeRationale: s.outcomeRationale,
  }));
}

export class ControlAssessor {
  private readonly controls: CmmcControl[];
  private readonly controlsRefPath: string;
  private readonly entriesByControl: Map<string, CommandEntry[]>;
  private readonly entriesById: Map<string, CommandEntry>;

  constructor(controlsRefPath: string, registries: CommandRegistryFile[] = []) {
    this.controlsRefPath = controlsRefPath;
    const raw = fs.readFileSync(controlsRefPath, 'utf-8');
    const ref: ControlsReference = JSON.parse(raw);
    this.controls = ref.controls;

    // Build per-control entry lookup from command registries (same source as Stamper)
    this.entriesByControl = new Map();
    this.entriesById = new Map();
    for (const reg of registries) {
      for (const entry of reg.entries) {
        if (!this.entriesById.has(entry.entry_id)) this.entriesById.set(entry.entry_id, entry);
        for (const cid of entry.control_ids) {
          if (!this.entriesByControl.has(cid)) {
            this.entriesByControl.set(cid, []);
          }
          this.entriesByControl.get(cid)!.push(entry);
        }
      }
    }
  }

  /**
   * Classify a control using command registry entries (matches Stamper's classifyAutomation).
   * - All entries have set_command and are not manual_gate/manual_only → 'automated'
   * - All entries are manual_gate or manual_only or lack set_command → 'nonstack'
   * - No entries at all → 'manual' (excluded from registry)
   * - Mix of automated and manual → 'automated'
   */
  private classify(controlId: string): ControlClassification {
    const entries = this.entriesByControl.get(controlId);
    if (!entries || entries.length === 0) return 'manual';

    let automatedCount = 0;
    let manualCount = 0;

    for (const entry of entries) {
      if (entry.engine === 'manual_gate' || entry.manual_only || !entry.set_command) {
        manualCount++;
      } else {
        automatedCount++;
      }
    }

    if (manualCount === 0) return 'automated';
    if (automatedCount === 0) return 'nonstack';
    return 'automated';
  }

  merge(
    tenantId: string,
    discoveryResults: never[],
    blobArtifacts: BlobArtifact[],
    ecFindings: unknown[],
    policies: PolicyDocument[] = [],
    stamperEvidenceSources?: Map<string, AssessmentSource[]>,
    signalAssessments?: Map<string, ControlAssessment>,
    directiveMetadataMap?: Map<string, DirectiveMetadata>,
    /** M4a: EC evidence items (manual uploads / attestations) fed by EcEvidenceReader. */
    ecItems: EcEvidenceItem[] = [],
    /** W1.1 (B7 (d)): per-objective sources; a control listed here is scored per objective. */
    objectiveSources?: ObjectiveSourceMap,
    /** NS-1 (GD-b): this tenant's WORM document reviews; they decide only where no stack source has an opinion. */
    documentReviews: DocumentReview[] = [],
    /** FIN-27 (FD-4): EO's own prior assessments and latest POA&M ledger; they decide CA.L2-3.12.1 / 3.12.2 / 3.12.3. */
    caSelfRecords?: CaSelfRecords
  ): AssessmentSnapshot {
    const now = new Date().toISOString();
    const sourcesMerged: string[] = [];
    const ecItemSources = ecItemsToSources(ecItems);

    // Build per-control source map
    const controlSources = new Map<string, AssessmentSource[]>();
    const controlArtifacts = new Map<string, string[]>();
    const controlHasBlobArtifact = new Map<string, boolean>();
    const controlHasEvidenceImport = new Map<string, boolean>();

    // Initialize all controls
    for (const ctrl of this.controls) {
      controlSources.set(ctrl.control_id, []);
      controlArtifacts.set(ctrl.control_id, []);
      controlHasBlobArtifact.set(ctrl.control_id, false);
      controlHasEvidenceImport.set(ctrl.control_id, false);
    }

    // Phase 1.5: Stamper manual gate evidence
    if (stamperEvidenceSources && stamperEvidenceSources.size > 0) {
      sourcesMerged.push('evidence_import');
      for (const [controlId, sources] of stamperEvidenceSources) {
        const existing = controlSources.get(controlId);
        if (existing) {
          existing.push(...sources);
          const hasImported = sources.some(s => s.result === 'imported');
          if (hasImported) {
            controlHasEvidenceImport.set(controlId, true);
          }
        }
      }
    }

    // Phase 2: Blob artifacts from Azure Blob Storage
    if (blobArtifacts.length > 0) {
      sourcesMerged.push('blob_artifact');

      for (const artifact of blobArtifacts) {
        const source: AssessmentSource = {
          type: 'blob_artifact',
          timestamp: artifact.capturedAt || now,
          detail: `${artifact.checkId} (${artifact.source})`,
          result: 'exists',
        };

        for (const controlId of artifact.controlIds) {
          const sources = controlSources.get(controlId);
          if (sources) {
            sources.push(source);
            controlHasBlobArtifact.set(controlId, true);
          }
          // Track artifact IDs per control
          const arts = controlArtifacts.get(controlId);
          if (arts) {
            arts.push(artifact.artifactId);
          }
        }
      }
    }

    // Phase 2.5 (W1.1, F7): policies are documentation, never status. They are no longer merged
    // into control sources, so the assessment is identical with and without a policy store.
    void policies;

    // Phase 3: EC evidence items (manual uploads / attestations, M4a). `ecFindings` (EC's
    // integrity-ledger findings, /api/findings) is not yet wired into per-control merging —
    // it is accepted here for forward compatibility but unused; the label below now reflects
    // real EC evidence-item data instead of always being pushed on an empty array.
    if (ecItems.length > 0) {
      sourcesMerged.push('ec_capture');
    }
    void ecFindings;

    // Phase 4: Signal evaluations
    if (signalAssessments && signalAssessments.size > 0) {
      sourcesMerged.push('signal_evaluation');
    }

    // Build control assessments
    const assessments: EoControlAssessment[] = this.controls.map(ctrl => {
      const sources = controlSources.get(ctrl.control_id) || [];
      const artifacts = controlArtifacts.get(ctrl.control_id) || [];
      const hasBlobArtifact = controlHasBlobArtifact.get(ctrl.control_id) || false;
      const hasEvidenceImport = controlHasEvidenceImport.get(ctrl.control_id) || false;

      // W0.2b (PE-5): Stamper sources are no longer dropped when a blob exists; blobs rank last.

      // Merge signal assessment data when available
      const signalAssessment = signalAssessments?.get(ctrl.control_id);
      let controlSignals: ControlAssessment['signals'] = [];
      if (signalAssessment) {
        controlSignals = signalAssessment.signals;
        // Add the evaluator's evidence as a discovery source
        for (const sigSource of signalAssessment.sources) {
          sources.push(sigSource);
        }
      }

      // Status is computed BEFORE EC evidence items are appended (structural guarantee, not
      // just a convention of result:'no_query'): a manual upload can never flip a verdict.
      // W0.2b (PE-5): an EO blob capture ranks below every Stamper verdict and never outvotes a
      // live read. The verdict is taken without blob sources; a blob decides only when nothing
      // else has an opinion.
      // FIN-27 (FD-4): CA.L2-3.12.1 / 3.12.2 / 3.12.3 are decided by EO's own records first; no stack source
      // (the presence-only Compliance Manager read included, positive or negative) sets their status.
      const caSelf = CA_SELF_RECORD_CONTROLS.has(ctrl.control_id) ? decideCaBySelfRecords(ctrl.control_id, caSelfRecords, now) : undefined;
      // DEPTH-11 (F-8): on a non-stack control a Stamper record counts only for the objectives its entry names
      // that KB-1 marks tenant-evidenced; a record naming none is display only (it decides neither met nor not_met).
      const nonStack = !caSelf && NON_STACK_CONTROL_IDS.has(ctrl.control_id) && this.entriesById.size > 0;
      const proxy = nonStack ? this.nonStackProxies(ctrl.control_id, sources) : undefined;
      const effSources = proxy ? proxy.sources : sources;
      const blobSources = effSources.filter(s => s.type === 'blob_artifact');
      const verdictSources = blobSources.length > 0 ? effSources.filter(s => s.type !== 'blob_artifact') : effSources;
      let decision: StatusDecision = caSelf
        ? caSelf.decision ?? { status: 'not_assessed', rationale: `${CA_SELF_RECORD_UNMET} ${caSelf.reason}; a stack source never credits this control (FD-4)` }
        : this.decide(verdictSources, objectiveSources?.get(ctrl.control_id));
      if (proxy) decision = this.requireProxyCoverage(ctrl.control_id, decision, verdictSources, proxy.objectivesOf, documentReviews, ecItems);
      if (!caSelf && decision.status === 'not_assessed' && blobSources.some(s => s.result === 'exists')) {
        decision = {
          status: 'met',
          rationale: `Tier 5 (EO blob capture; ranks below every Stamper verdict and live read) decides: ${describeSources(blobSources.filter(s => s.result === 'exists'))}`,
          finding: findingOf(blobSources.filter(s => s.result === 'exists')),
        };
      }
      // NS-1 (GD-b): reviews rank below every stack source (Tiers 1-5); they decide only a control
      // that is still not_assessed. EC items stay display only (determineStatus filter unchanged).
      // FIN-27: for a CA self-record control GD-b is the fallback when EO's records do not decide.
      // CA.L2-3.12.4 (the SSP) reaches met here: a reviewed upload of the signed SSP, every objective.
      if (decision.status === 'not_assessed' && documentReviews.length > 0) {
        decision = this.decideByReviews(ctrl.control_id, documentReviews, ecItems) ?? decision;
      }
      // FIN-10 (FD-2): a gate approval on a non-stack control is pending_review, below GD-b. When
      // nothing else decided, the rationale says so; the status stays not_assessed.
      const pendingGates = verdictSources.filter(isGatePendingReviewSource);
      if (decision.status === 'not_assessed' && pendingGates.length > 0) {
        decision = { status: 'not_assessed', rationale: `${GATE_PENDING_REVIEW_RATIONALE}: ${describeSources(pendingGates)}${caSelf || decision.rationale.startsWith(NON_STACK_PROXY_PARTIAL) ? `; ${decision.rationale}` : ''}` };
      }
      // PH7-EO (V59, S3-D09): a non-stack control still not_assessed with display-only Stamper records on it gets a
      // finding naming them (GAPS and the POA&M show what was done and why it does not decide). Status unchanged.
      if (proxy && decision.status === 'not_assessed' && !decision.finding) {
        const shown = verdictSources.filter(s => s.type === 'evidence_import' && s.result === 'no_query' && s.detail.endsWith(` (${NON_STACK_PROXY_UNCOUNTED})`));
        if (shown.length > 0) decision = { ...decision, finding: nonStackNotDecidedFinding(shown) };
      }

      // Append EC evidence items to `sources` only, for control-detail display — NEVER into
      // `evidenceArtifactIds`. That array also feeds SspGenerator's directive-SPRS "verified
      // artifact" check (DirectiveSprsCalculator, via SspGenerator.ts's `verifiedArtifactIds`)
      // and its narrative "Evidence:" line (SnippetTemplateEngine.ts): both would read an EC
      // upload as a *verified* artifact, a claim EO can't back for evidence nobody has
      // reviewed. `sources` is a strictly display-only structure with no SPRS/SSP consumer, so
      // it's the only place an EC item is safe to appear outside `ControlAssessor` itself; the
      // evidence package takes EC items directly (ecEvidenceItems on EvidencePackager.build),
      // not through this array either.
      const ecSourcesForControl = ecItemSources.get(ctrl.control_id) ?? [];
      // FIN-27: on a CA self-record control a Stamper record is display only; it is shown uncounted
      // (the ledger counts an `imported` evidence_import), never as the credit.
      const shownSources = caSelf
        ? sources.map(s => s.type === 'evidence_import' && s.result !== 'no_query' ? { ...s, result: 'no_query' as const, detail: `${s.detail} (${CA_STACK_DISPLAY_ONLY})` } : s)
        : effSources;
      const allSources = ecSourcesForControl.length > 0 ? [...shownSources, ...ecSourcesForControl] : shownSources;

      return {
        control_id: ctrl.control_id,
        nist_ref: ctrl.nist_ref,
        family: ctrl.family,
        practice: ctrl.practice,
        status: decision.status,
        statusRationale: decision.rationale,
        ...(decision.presenceRead !== undefined ? { presenceOnly: true as const, presenceRead: decision.presenceRead } : {}),
        ...(decision.finding ? { assessmentFinding: decision.finding } : {}),
        ...(decision.finding && decision.rationale.startsWith('Tier 1') && findingStamperEntriesOf(verdictSources).length > 0
          ? { findingStamperEntries: findingStamperEntriesOf(verdictSources) } : {}),
        ...(decision.stamperNotSatSuperseded ? { stamperNotSatSuperseded: decision.stamperNotSatSuperseded } : {}),
        classification: this.classify(ctrl.control_id),
        sources: allSources,
        implementation_narrative: signalAssessment?.implementation_narrative,
        last_assessed: now,
        signals: controlSignals,
        evidenceArtifactIds: artifacts,
        automationSource: signalAssessment ? 'graph' as const :
                          hasBlobArtifact || hasEvidenceImport ? 'imported' as const :
                          'manual' as const,
        lastFetchedAt: now,
        directiveMetadata: directiveMetadataMap?.get(ctrl.control_id),
      };
    });

    // Compute counts
    let met = 0, notMet = 0, partial = 0, notAssessed = 0;
    for (const a of assessments) {
      switch (a.status) {
        case 'met': met++; break;
        case 'not_met': notMet++; break;
        case 'partial': partial++; break;
        case 'not_assessed': notAssessed++; break;
      }
    }

    const liveAssessmentCount = assessments.filter(
      a => a.automationSource === 'graph'
    ).length;

    return {
      snapshotId: uuidv4(),
      tenantId,
      ces: resolveCesIdentity(loadCesConfig(), { tenantId }),
      generatedAt: now,
      controls: assessments,
      sources_merged: sourcesMerged,
      sprs_score: 0, // Calculated by SprsCalculator
      controls_met: met,
      controls_not_met: notMet,
      controls_partial: partial,
      controls_not_assessed: notAssessed,
      liveAssessmentCount,
    };
  }

  /**
   * DEPTH-11 (F-8): the registry entry behind a Stamper `evidence_import` source on `controlId`: by `entryId`
   * (NOT_SAT sources carry it), else by label among that control's entries (the source detail is the entry
   * label, then an optional executor label and parenthetical suffixes). Undefined when nothing matches.
   */
  private entriesOfSource(controlId: string, s: AssessmentSource): CommandEntry[] {
    const id = (s as { entryId?: unknown }).entryId;
    if (typeof id === 'string') {
      const e = this.entriesById.get(id);
      return e ? [e] : [];
    }
    const text = s.detail.replace(EXECUTOR_LABEL_RE, '');
    return (this.entriesByControl.get(controlId) ?? []).filter(e => !!e.label && (text === e.label || text.startsWith(`${e.label} (`)));
  }

  /**
   * DEPTH-11 (F-8): the proxy rule for a non-stack control (NON_STACK_CONTROL_IDS, CA self-record controls
   * excluded). Each counted Stamper `evidence_import` source (imported or missing) is attributed to the
   * objectives its entry names (`objective_ids`) that KB-1 marks tenant-evidenced (`stack_signal`). A source
   * with no such objective, or whose entry cannot be found in the loaded registry, becomes `no_query` with
   * NON_STACK_PROXY_UNCOUNTED. Unchanged: other source types (live reads, AdminOps rows, task results) and
   * manual-gate / manual-only entries (operator records, FIN-10's rule; a rejected gate stays a negative).
   * The rule needs the registry: an assessor built without one (EO's assess route always passes it) skips it.
   */
  private nonStackProxies(controlId: string, sources: AssessmentSource[]): { sources: AssessmentSource[]; objectivesOf: Map<AssessmentSource, string[]> } {
    const tenant = tenantEvidencedObjectivesByControl().get(controlId) ?? new Set<string>();
    const objectivesOf = new Map<AssessmentSource, string[]>();
    const out = sources.map(s => {
      if (s.type !== 'evidence_import' || s.result === 'no_query') return s;
      const entries = this.entriesOfSource(controlId, s);
      if (entries.length > 0 && entries.every(e => e.engine === 'manual_gate' || e.manual_only)) return s;
      const named = new Set(entries.flatMap(e => (e as CommandEntry & { objective_ids?: string[] }).objective_ids ?? []));
      const counted = [...named].filter(o => tenant.has(o)).sort();
      if (counted.length === 0) return { ...s, result: 'no_query' as const, detail: `${s.detail} (${NON_STACK_PROXY_UNCOUNTED})` };
      objectivesOf.set(s, counted);
      return s;
    });
    return { sources: out, objectivesOf };
  }

  /**
   * DEPTH-11 (F-8): a counted proxy credits only its own objectives. When a non-stack control is met at Tier 3
   * or Tier 4 and every positive in that tier is a counted Stamper proxy, it stays met only if each objective is
   * covered by a proxy or by a countable GD-b met review; otherwise not_assessed (NON_STACK_PROXY_PARTIAL), and
   * the GD-b step that follows can still decide it. Negatives, live reads and other decisions are unchanged.
   */
  private requireProxyCoverage(controlId: string, decision: StatusDecision, verdictSources: AssessmentSource[],
    objectivesOf: Map<AssessmentSource, string[]>, reviews: DocumentReview[], ecItems: EcEvidenceItem[]): StatusDecision {
    if (decision.status !== 'met' || !/^Tier [34] /.test(decision.rationale)) return decision;
    const considered = verdictSources.filter(s => s.type !== 'policy_doc' && s.type !== 'ec_capture' && s.result !== 'no_query');
    const tier4 = decision.rationale.startsWith('Tier 4');
    const tierSources = considered.filter(s => tier4
      ? isTier4Source(s)
      : s.type !== 'discovery' && s.type !== 'blob_artifact' && s.type !== 'stamper_execution' && !isTier4Source(s));
    const positives = tierSources.filter(s => s.result === 'exists' || s.result === 'imported' || s.result === 'enforced');
    if (positives.length === 0 || !positives.every(s => objectivesOf.has(s))) return decision;
    const objectiveIds = objectiveIdsByControl().get(controlId) ?? [];
    const byProxy = new Set(positives.flatMap(s => objectivesOf.get(s)!));
    const byReview = new Set(reviews.filter(r => r.verdict === 'met' && isCountableReview(r, controlId, ecItems, objectiveIds)).map(r => r.objectiveId));
    const uncovered = objectiveIds.filter(o => !byProxy.has(o) && !byReview.has(o));
    const coverage = `objectives by Stamper entry: ${[...byProxy].sort().join(', ') || 'none'}; by GD-b review: ${objectiveIds.filter(o => !byProxy.has(o) && byReview.has(o)).join(', ') || 'none'}`;
    if (objectiveIds.length > 0 && uncovered.length === 0) {
      return { ...decision, rationale: `${decision.rationale}; per objective (DEPTH-11): ${coverage}` };
    }
    return {
      status: 'not_assessed',
      rationale: `${NON_STACK_PROXY_PARTIAL}: ${coverage}; not evidenced: ${uncovered.join(', ') || 'no reference objectives'}; route: ${NON_STACK_REVIEW_ROUTE}; would have been: ${decision.rationale}`,
    };
  }

  /**
   * NS-1 (GD-b): any countable not_met review -> not_met; met only if EVERY assessment objective of
   * the control has a countable met review; otherwise undefined (the control stays not_assessed).
   * A control with no reference objectives can never be met by reviews.
   */
  private decideByReviews(controlId: string, reviews: DocumentReview[], ecItems: EcEvidenceItem[]): StatusDecision | undefined {
    const objectiveIds = objectiveIdsByControl().get(controlId) ?? [];
    if (objectiveIds.length === 0) return undefined;
    const countable = reviews.filter(r => isCountableReview(r, controlId, ecItems, objectiveIds));
    if (countable.length === 0) return undefined;
    const describe = (rs: DocumentReview[]) =>
      rs.map(r => `${r.objectiveId} ${r.verdict} by ${r.reviewer.upn} (review ${r.reviewId}, sha256 ${r.artifactHash.slice(0, 12)})`).join('; ');
    const negatives = countable.filter(r => r.verdict === 'not_met');
    if (negatives.length > 0) {
      return { status: 'not_met', rationale: `GD-b (document review; no stack source has an opinion) decides: ${describe(negatives)}`, finding: describe(negatives) };
    }
    const metByObjective = new Map<string, DocumentReview>();
    for (const r of countable) if (!metByObjective.has(r.objectiveId)) metByObjective.set(r.objectiveId, r);
    if (!objectiveIds.every(o => metByObjective.has(o))) return undefined;
    const deciding = objectiveIds.map(o => metByObjective.get(o)!);
    return { status: 'met', rationale: `GD-b (document review of every objective; no stack source has an opinion) decides: ${describe(deciding)}`, finding: describe(deciding) };
  }

  /**
   * W1.1 (B7 (d)): score per objective where objective sources exist, else per control.
   * A current-run Stamper NOT_SAT on the control itself (tier 1) still decides the control.
   * Per objective: any objective not met -> not_met; every objective met -> met; some met ->
   * partial; none -> not_assessed (the DeterminationLedger roll-up rule).
   */
  private decide(controlSources: AssessmentSource[], objectives?: Map<string, AssessmentSource[]>): StatusDecision {
    const controlDecision = this.determineStatus(controlSources);
    if (!objectives || objectives.size === 0) return controlDecision;
    if (controlDecision.status === 'not_met' && controlDecision.rationale.startsWith('Tier 1')) return controlDecision;

    const per = [...objectives].map(([objectiveId, srcs]) => ({ objectiveId, ...this.determineStatus(srcs) }));
    const line = per.map(o => `${o.objectiveId} ${o.status} (${o.rationale})`).join(' | ');
    let status: ControlAssessment['status'];
    if (per.some(o => o.status === 'not_met')) status = 'not_met';
    else if (per.every(o => o.status === 'met')) status = 'met';
    else if (per.some(o => o.status === 'met')) status = 'partial';
    else status = 'not_assessed';
    const presenceRead = status === 'met' ? per.find(o => o.presenceRead !== undefined)?.presenceRead : undefined;
    return { status, rationale: `Scored per objective (${per.length}); met only if every objective is met: ${line}`, ...(presenceRead !== undefined ? { presenceRead } : {}) };
  }

  /**
   * W1.1 status precedence for one set of sources (top tier with an opinion wins; within a
   * tier a negative beats a positive):
   *   Tier 1  current-run Stamper NOT_SAT: a failed/blocked Stamper task (FX-12) or a NOT_SAT
   *           evidence file -> not_met
   *   Tier 2  live read (discovery signal evaluation, EO's own blob capture)
   *   Tier 3  state-verified execution verdict (Stamper SAT file, AdminOps write with a confirming read)
   *   Tier 4  evidence-only Stamper SAT -> met, labelled "state not verified" (B8); also AdminOps
   *           read-only or unconfirmed rows, positive or negative (W2, AD-6 / B27)
   * `policy_doc` and `ec_capture` sources never set status (F7; EC is display-only).
   * `no_query` is no opinion (W1.0: unread is not absent). No opinion at all -> not_assessed.
   */
  private determineStatus(sources: AssessmentSource[]): StatusDecision {
    const considered = sources.filter(s => s.type !== 'policy_doc' && s.type !== 'ec_capture' && s.result !== 'no_query');
    if (considered.length === 0) {
      return { status: 'not_assessed', rationale: sources.length === 0 ? 'No source has assessed this control' : 'No source has an opinion (every source is unread or display-only)' };
    }

    // W5 cycle 3: a SAT on an unassigned Intune object is a Tier 3 negative, not a failed Stamper task.
    const tier1 = considered.filter(s => isStamperExecutionFailure(s) || (s.type === 'evidence_import' && s.result === 'missing' && !isUnassignedObjectSource(s)));
    if (tier1.length > 0) {
      return this.supersedeTier1(considered, tier1)
        ?? { status: 'not_met', rationale: `Tier 1 (current-run Stamper NOT_SAT) decides: ${describeSources(tier1)}`, finding: findingOf(tier1) };
    }

    const isNegative = (s: AssessmentSource) => s.result === 'missing' || s.result === 'error';
    const isPositive = (s: AssessmentSource) => s.result === 'exists' || s.result === 'imported' || s.result === 'enforced';

    const tiers: Array<{ name: string; sources: AssessmentSource[]; label?: string }> = [
      {
        name: 'Tier 2 (live read)',
        sources: considered.filter(s => (s.type === 'discovery' || s.type === 'blob_artifact') && s.result !== 'error'),
      },
      {
        name: 'Tier 3 (state-verified execution verdict)',
        sources: considered.filter(s => s.type !== 'discovery' && s.type !== 'blob_artifact' && s.type !== 'stamper_execution' && !isTier4Source(s)),
      },
      {
        name: 'Tier 4 (evidence-only Stamper SAT)',
        sources: considered.filter(isTier4Source),
        label: '; state not verified',
      },
    ];

    // W2 (AD-6): a Tier 4 decided by an unconfirmed AdminOps row is named as such.
    const tierName = (tier: { name: string }, deciding: AssessmentSource[]): string =>
      tier.name.startsWith('Tier 4') && deciding.some(isUnconfirmedAdminOpsSource)
        ? 'Tier 4 (evidence-only Stamper SAT or unconfirmed AdminOps row)'
        : tier.name;

    for (const t of tiers) {
      const negatives = t.sources.filter(isNegative);
      if (negatives.length > 0) {
        return { status: 'not_met', rationale: `${tierName(t, negatives)} decides: ${describeSources(negatives)}`, finding: findingOf(negatives) };
      }
      const positives = t.sources.filter(isPositive);
      const tier = { ...t, name: tierName(t, positives) };
      if (positives.length > 0) {
        // Founder decision 2026-10-27: a presence-only live read still decides, labelled.
        const presence = positives.filter(isPresenceOnlySource);
        if (presence.length > 0) {
          const presenceRead = presence.map(presenceReadFromSource).join('; ');
          const plain = positives.map(s => ({ ...s, detail: withoutPresenceLabel(s.detail) }));
          return { status: 'met', presenceRead, rationale: `${tier.name} decides met (${PRESENCE_ONLY_LABEL}: ${presenceRead}): ${describeSources(plain)}`, finding: findingOf(positives) };
        }
        return { status: 'met', rationale: `${tier.name} decides${tier.label ?? ''}: ${describeSources(positives)}`, finding: findingOf(positives) };
      }
    }

    return { status: 'not_assessed', rationale: `No source has an opinion: ${describeSources(considered)}` };
  }

  /**
   * W7-EO2 (orchestrator build-level ruling 2026-10-29, reversible): the Tier 1 Stamper NOT_SAT
   * sources are superseded when an AdminOps evidence row for this control records a confirmed write
   * (`isConfirmedAdminOpsWrite`) timed strictly after every one of them, and the remaining sources
   * then decide met at Tier 2 (live read). Ordering is by source timestamps only (Stamper record /
   * task time vs the AdminOps row time); an unparseable time on a Stamper source keeps it standing.
   * Otherwise undefined: the Tier 1 NOT_SAT stands.
   */
  private supersedeTier1(considered: AssessmentSource[], tier1: AssessmentSource[]): StatusDecision | undefined {
    const tier1Times = tier1.map(s => Date.parse(s.timestamp));
    if (tier1Times.some(t => !Number.isFinite(t))) return undefined;
    const latestTier1 = Math.max(...tier1Times);
    const writes = considered.filter(s => isConfirmedAdminOpsWrite(s) && Date.parse(s.timestamp) > latestTier1);
    if (writes.length === 0) return undefined;
    const rest = this.determineStatus(considered.filter(s => !tier1.includes(s)));
    if (rest.status !== 'met' || !rest.rationale.startsWith('Tier 2')) return undefined;
    const stamperLabel = (s: AssessmentSource): string => isStamperNotSatSource(s)
      ? `Stamper ${s.entryId}`
      : `Stamper ${s.detail.replace(EXECUTOR_LABEL_RE, '').replace(/^Stamper /, '')}`;
    const history = [
      ...tier1.map(s => `${stamperLabel(s)} NOT_SAT at ${s.timestamp}`),
      ...writes.map(s => `AdminOps ${s.detail} ${s.timestamp} confirmed`),
      'live read now satisfies',
    ].join('; ');
    return {
      ...rest,
      rationale: `${rest.rationale}; supersedes Tier 1 (current-run Stamper NOT_SAT): ${describeSources(tier1)}`,
      finding: rest.finding ? `${history}: ${rest.finding}` : history,
      stamperNotSatSuperseded: history,
    };
  }
}
