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
import { ecCatalogRefsFromSources, type EcCatalogRef } from '../evidence/EcEvidenceReader.js';
import { executorIdentityOf } from '../evidence/StamperEvidenceLoader.js';
import type { EvidenceRef } from '../evidence/store/types.js';
import { evidenceFreshness, formatAge, type DatedEvidence, type EvidenceAge, type Freshness } from './EvidenceFreshness.js';
import { methodForObjective, type AssessmentMethod } from '../packager/MethodLabeler.js';
import { FAMILY_POLICY_BASES } from '../ssp/OdpValueProvider.js';

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
  noPoam: boolean;          // R-POAM: true when not CMMC POA&M-eligible (3- or 5-point, or POA&M-prohibited)
  disposition?: Disposition;
  /** W0.2c: Stamper executor identities (stamper/<version>@<ClientId>) behind a digital-signal
   *  objective's control, read from its evidence_import sources. Omitted when there are none. */
  executorIdentities?: string[];
  /** Founder decision 2026-10-27: a digital-signal objective inherited from a control that is met on
   *  a presence-only evaluator's verdict (counted, labelled). Omitted otherwise. */
  presenceOnly?: true;
  /** EO-collection W1: evidence-store records (hash, source, window) behind a digital-signal objective. Omitted when none. */
  evidenceRefs?: EvidenceRef[];
  /** EO-collection W3 (B19): freshness of the newest dated evidence (store record or Stamper file)
   *  behind a digital-signal objective, against its family cadence. Omitted when none is dated. */
  freshness?: Freshness;
  evidenceAge?: EvidenceAge;
  /** EO-collection W3 (B19): set when a satisfied verdict was not counted because all its dated evidence is stale. */
  staleDemoted?: true;
  /** EO-collection W4.1: the 800-171A method the evidence behind this objective supports (MethodLabeler).
   *  Omitted when nothing stands behind it. */
  method?: AssessmentMethod;
}

export interface ControlRollup {
  controlId: string;
  status: ControlStatus;
  weight: number;
  noPoam: boolean;
  disposition?: Disposition;
  objectives: ObjectiveDetermination[];
  /** EVC.5: EC manual evidence items for this control with their catalog ids (form_id,
   *  emx_ids). Listing only: never feeds `status` (DEC-7). Omitted when there are none. */
  evidence?: EcCatalogRef[];
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
  noPoam: boolean;          // R-POAM: not CMMC POA&M-eligible => certification blocker, not a POA&M item
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
  /** EO-collection W1: resolves an objective id to its evidence-store records (see EvidenceStore.evidenceRefsLookup). */
  evidenceRefsLookup?: (objectiveId: string) => EvidenceRef[];
  /** W5: the MG-12 policy-set manifest (hash verified); a family's policy is cited in the rationale of its objectives. */
  policyManifest?: { documents?: Array<{ name: string; sha256: string }> };
}

const STATUS_WORDS: Record<DeterminationStatus, string> = {
  satisfied: 'is satisfied',
  other_than_satisfied: 'is other than satisfied',
  not_assessed: 'is not assessed',
};
const CONTROL_STATUS_WORDS: Record<string, string> = { met: 'met', not_met: 'not met', partial: 'partially met', not_assessed: 'not assessed' };
/** Objective statements about a defined / documented / established requirement cite the family policy. */
const POLICY_STATEMENT = /polic|procedur|\bplan\b|defined|documented|specified|identified|established|designated/i;
const MAX_REFS = 3;
/** W5 cycle 2: the StamperEvidenceLoader suffixes of an unread (no_query) Stamper record. */
const UNREAD_STAMPER_SUFFIX = / \((?:SAT on an empty payload|NOT_SAT on an empty payload|Stamper command got HTTP 404|SAT on an Intune object read without assignment information|manual-gate run record; display only)/;

/**
 * W5 (SC-2 row 8): one sentence per digital-signal objective naming what stands behind it: the
 * deciding tier of its control (with the presence-only reads), its own evidence-store records, the
 * control's Stamper records, and the family policy for a statement that is about a defined or
 * documented requirement. Status is not touched.
 */
export function composeObjectiveRationale(a: {
  objectiveId: string;
  statement: string;
  status: DeterminationStatus;
  controlId: string;
  controlStatus: ControlStatus;
  statusRationale?: string;
  presenceRead?: string;
  /** W5 cycle 2: the deciding evaluator's evidence sentence (ControlAssessor `assessmentFinding`), verbatim. */
  finding?: string;
  refs: EvidenceRef[];
  stamper: Array<{ label: string; counted: boolean; uncountedReason?: string }>;
  policy?: { name: string; sha256: string };
}): string {
  const tier = /^Tier \d \([^)]*\)/.exec(a.statusRationale ?? '')?.[0];
  const word = CONTROL_STATUS_WORDS[a.controlStatus] ?? a.controlStatus;
  const parts: string[] = [];
  parts.push(tier
    ? `${a.controlId} is ${word} at ${tier}${a.presenceRead !== undefined ? ` (presence only: ${a.presenceRead})` : ''}${a.finding ? `: "${a.finding}"` : ''}`
    : `no source decides ${a.controlId} (${word})`);
  const refs = a.refs.filter(r => r.status === undefined || r.status === 'success' || r.status === 'empty');
  if (refs.length > 0) {
    const shown = refs.slice(0, MAX_REFS).map(r => `${r.sourceId}${r.status === 'empty' ? ' (empty read)' : ''} at ${r.collectedAt}${r.endpoint ? ` from ${r.endpoint}` : ''}, sha256 ${r.sha256.slice(0, 12)}`);
    parts.push(`evidence-store records for this objective: ${shown.join('; ')}${refs.length > MAX_REFS ? `; and ${refs.length - MAX_REFS} more` : ''}`);
  }
  const counted = a.stamper.filter(s => s.counted);
  if (counted.length > 0) {
    const named = [...new Set(counted.map(s => s.label).filter(Boolean))];
    const labels = named.slice(0, 2).map(l => `"${l}"`).join(', ');
    parts.push(`${counted.length} counted Stamper record(s) for the control${labels ? ` (${labels}${named.length > 2 ? ', ...' : ''})` : ''}`);
  }
  const uncounted = a.stamper.length - counted.length;
  // W5 cycle 2: an uncounted record that was not read says why (the loader's suffix, e.g. "empty read, uncounted").
  const unread = a.stamper.filter(s => !s.counted && s.uncountedReason);
  const why = unread.slice(0, 2).map(s => `"${s.label}" (${s.uncountedReason})`).join('; ');
  if (uncounted > 0) parts.push(`${uncounted} Stamper record(s) not counted${why ? `: ${why}${unread.length > 2 ? '; ...' : ''}` : ''}`);
  const cited = !!a.policy && POLICY_STATEMENT.test(a.statement);
  if (cited) parts.push(`policy reference ${a.policy!.name} (sha256 ${a.policy!.sha256.slice(0, 12)}); a policy documents the requirement and does not decide it`);
  if (refs.length === 0 && a.stamper.length === 0 && !tier) parts.push(cited ? 'no live read or Stamper record stands behind this determination' : 'no live read, Stamper record or policy stands behind this determination');
  return `${a.objectiveId} (${a.statement}) ${STATUS_WORDS[a.status]}: ${parts.join('; ')}.`;
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

/**
 * R-POAM: the POA&M-prohibited nist_refs (`poam_prohibited` in ces-shared `sprs-weights`). With the
 * weight rule (3- and 5-point) this is every `poam_allowed: false` control in that file.
 */
function loadPoamProhibitedRefs(): Set<string> {
  const _require = createRequire(import.meta.url);
  const raw = JSON.parse(fs.readFileSync(_require.resolve('ces-shared/data/sprs-weights'), 'utf-8').replace(/^﻿/, ''));
  const out = new Set<string>((raw.poam_prohibited ?? []).map(String));
  return out;
}

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
  // EVC.5: catalog-tagged EC items per control, read from the snapshot's ec_capture sources.
  const ecRefsByControl = new Map<string, EcCatalogRef[]>();
  for (const c of input.snapshot.controls) {
    const refs = ecCatalogRefsFromSources(c.sources);
    if (refs.length > 0) ecRefsByControl.set(numericRef(c.control_id), refs);
  }
  // W0.2c: who executed the Stamper evidence behind each control (ledger provenance).
  const executorsByControl = new Map<string, string[]>();
  for (const c of input.snapshot.controls) {
    const ids = [...new Set(c.sources.map(executorIdentityOf).filter((x): x is string => !!x))].sort();
    if (ids.length > 0) executorsByControl.set(c.control_id, ids);
  }

  // Founder decision 2026-10-27: controls met on a presence-only verdict (ControlAssessor's label).
  const presenceReadByControl = new Map<string, string>();
  for (const c of input.snapshot.controls) {
    const p = c as { presenceOnly?: true; presenceRead?: string };
    if (p.presenceOnly && c.status === 'met') presenceReadByControl.set(c.control_id, p.presenceRead ?? 'read not recorded');
  }

  // EO-collection W3 (B19): the Stamper evidence files behind each control (their write times).
  const stamperTimesByControl = new Map<string, string[]>();
  for (const c of input.snapshot.controls) {
    const times = c.sources
      .filter(s => s.type === 'evidence_import' && (s.result === 'imported' || s.result === 'missing') && typeof s.timestamp === 'string')
      .map(s => s.timestamp);
    if (times.length > 0) stamperTimesByControl.set(c.control_id, times);
  }
  // EO-collection W4.1: the deciding tier per control, for the method label.
  const rationaleByControl = new Map<string, string | undefined>();
  for (const c of input.snapshot.controls) rationaleByControl.set(c.control_id, (c as { statusRationale?: string }).statusRationale);
  // W5 cycle 2: the deciding evaluator's evidence sentence per control.
  const findingByControl = new Map<string, string>();
  for (const c of input.snapshot.controls) {
    const f = (c as { assessmentFinding?: string }).assessmentFinding;
    if (f) findingByControl.set(c.control_id, f);
  }

  const weightFor = (controlId: string): number => weights[numericRef(controlId)] ?? weights[controlId] ?? 0;
  // R-POAM: a deficiency cannot be a CMMC POA&M item (32 CFR 170.21) when its control is 3- or 5-point,
  // or POA&M-prohibited; the same rule PoamGenerator applies to not_met controls.
  const poamProhibited = loadPoamProhibitedRefs();
  const noPoamFor = (controlId: string): boolean => weightFor(controlId) >= 3 || poamProhibited.has(numericRef(controlId));

  // W5: the control's Stamper records (label and whether counted), and the family policy from the manifest.
  const stamperSourcesByControl = new Map<string, Array<{ label: string; counted: boolean; uncountedReason?: string }>>();
  for (const c of input.snapshot.controls) {
    const recs = c.sources
      .filter(s => s.type === 'evidence_import')
      .map(s => {
        const text = String(s.detail ?? '').replace(/\s*\[executor [^\]]*\]/, '').split(/\r?\n/)[0].trim();
        // W5 cycle 2: an unread record (no_query) carries its reason as the loader's trailing parenthetical.
        const open = s.result === 'no_query' && text.endsWith(')') ? text.search(UNREAD_STAMPER_SUFFIX) : -1;
        return open > 0
          ? { label: text.slice(0, open), counted: false, uncountedReason: text.slice(open + 2, -1) }
          : { label: text, counted: s.result === 'imported' };
      });
    if (recs.length > 0) stamperSourcesByControl.set(c.control_id, recs);
  }
  const policyByFamily = new Map<string, { name: string; sha256: string }>();
  for (const d of input.policyManifest?.documents ?? []) {
    const base = /^policies\/(.+)\.md$/.exec(d.name)?.[1];
    for (const [family, bases] of Object.entries(FAMILY_POLICY_BASES)) {
      if (base && bases[0] === base && !policyByFamily.has(family)) policyByFamily.set(family, d);
    }
  }

  const objectives: ObjectiveDetermination[] = catalog.map(o => {
    const controlId = o.controlId;
    const weight = weightFor(controlId);
    const noPoam = noPoamFor(controlId);
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
      // W5 (SC-2 row 8): the objective's own rationale, from the evidence behind it (its store records,
      // the control's Stamper records and deciding tier, the family policy), not "inherited from control assessment".
      rationale = composeObjectiveRationale({
        objectiveId: o.objectiveId,
        statement: o.description,
        status,
        controlId,
        controlStatus: controlStatusMap.get(controlId)!,
        statusRationale: rationaleByControl.get(controlId),
        presenceRead: presenceReadByControl.get(controlId),
        finding: findingByControl.get(controlId),
        refs: input.evidenceRefsLookup ? input.evidenceRefsLookup(o.objectiveId) : [],
        stamper: stamperSourcesByControl.get(controlId) ?? [],
        policy: policyByFamily.get(controlId.split('.')[0]),
      });
    } else {
      status = 'not_assessed'; source = 'none'; rationale = 'no source has assessed this determination';
    }

    const executors = source === 'digital-signal' ? executorsByControl.get(controlId) : undefined;
    const presenceOnly = source === 'digital-signal' && presenceReadByControl.has(controlId);
    const evidenceRefs = source === 'digital-signal' && input.evidenceRefsLookup ? input.evidenceRefsLookup(o.objectiveId) : [];

    // EO-collection W3 (B19): freshness of the newest dated evidence behind a digital-signal
    // objective; a satisfied verdict resting only on stale evidence is not counted.
    let fresh: { freshness: Freshness; evidenceAge: EvidenceAge } | null = null;
    let staleDemoted = false;
    if (source === 'digital-signal') {
      const dated: DatedEvidence[] = [
        ...evidenceRefs
          .filter(r => r.status === undefined || r.status === 'success' || r.status === 'empty')
          .map(r => ({ at: r.collectedAt, basis: 'evidence-store' as const })),
        ...(stamperTimesByControl.get(controlId) ?? []).map(at => ({ at, basis: 'stamper-file' as const })),
      ];
      fresh = evidenceFreshness(o.objectiveId, dated, input.generatedAt);
      if (fresh && fresh.freshness === 'stale' && status === 'satisfied') {
        const a = fresh.evidenceAge;
        status = 'not_assessed';
        staleDemoted = true;
        rationale = `stale evidence not counted (B19): the newest ${a.basis === 'stamper-file' ? 'Stamper evidence file' : 'evidence-store record'} ` +
          `behind this objective is ${a.text} old (${a.newestAt}), older than 2 x the ${a.family} cadence of ${formatAge(a.cadenceMinutes)}; was: ${rationale}`;
      }
    }
    const method = methodForObjective({
      source,
      statusRationale: source === 'digital-signal' ? rationaleByControl.get(controlId) : undefined,
      storeSourceIds: evidenceRefs.map(r => r.sourceId),
      hasStamperFiles: source === 'digital-signal' && stamperTimesByControl.has(controlId),
    });
    return { objectiveId: o.objectiveId, controlId, statement: o.description, methods: o.methods ?? [], status, source, rationale, weight, noPoam, disposition: dispo, ...(executors ? { executorIdentities: executors } : {}), ...(presenceOnly ? { presenceOnly: true as const } : {}), ...(evidenceRefs.length ? { evidenceRefs } : {}), ...(fresh ? { freshness: fresh.freshness, evidenceAge: fresh.evidenceAge } : {}), ...(staleDemoted ? { staleDemoted: true as const } : {}), ...(method ? { method } : {}) };
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
    const ecRefs = ecRefsByControl.get(numericRef(controlId));
    controls.push({ controlId, status, weight: weightFor(controlId), noPoam: noPoamFor(controlId), disposition: dispositions[numericRef(controlId)] ?? dispositions[controlId], objectives: objs, ...(ecRefs ? { evidence: ecRefs } : {}) });
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
