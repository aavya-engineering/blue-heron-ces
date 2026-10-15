// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// AssessorViewComposer — composes ONE unified payload a C3PAO can pivot through and click into.
//
// Joins everything EO already knows about a determination into a single view: the DeterminationLedger
// (status + provenance + weight + methods), the SSP (implementation narrative + evidence refs), the
// POA&M lifecycle (open / auto-closed + history), the mission plan (the "approach"/steps), SPRS (points
// at risk), the persona map (ownership), and WORM evidence references. Pure: all inputs injected.

import type { DeterminationLedger, ObjectiveDetermination } from '../assessment/DeterminationLedger.js';
import type { PoamLedger, PoamLedgerItem } from '../poam/PoamLifecycle.js';
import type { Persona } from 'ces-shared/types/persona';
import type { AdminOpsEvidence } from 'ces-shared/types/adminops-evidence';

/**
 * W4-EO1 (AE-R5): how an AdminOps row is shown to the assessor. Only `executed` (live, executed,
 * verdict SAT) counts as evidence. A dry run is ALWAYS a `preview`, whatever its outcome (a dry
 * run that was denied is still only a preview). Denials, pending and rejected approvals and
 * failures are labelled as such and never count as evidence.
 */
export type AdminOpsRowKind = 'executed' | 'executed_not_sat' | 'failed' | 'denied' | 'pending' | 'rejected' | 'preview';

export interface AdminOpsViewRow {
  kind: AdminOpsRowKind;
  label: string;                 // human label for the kind
  isEvidence: boolean;           // true only for live executed SAT rows
  commandId: string;
  outcome: string;
  mode: string;
  controlIds: string[];
  correlationId?: string;
  timestamp: string;
  approverUPN?: string;
  approvalId?: string;
  verdict: string;
}

export interface AdminOpsSection {
  rows: AdminOpsViewRow[];
  counts: Record<AdminOpsRowKind, number>;
  excludedOtherTenant: number;   // rows dropped because they belonged to another tenant
}

export const ADMINOPS_KIND_LABEL: Record<AdminOpsRowKind, string> = {
  executed: 'Executed (live) — evidence',
  executed_not_sat: 'Executed (live) — not satisfied',
  failed: 'Failed (live) — not evidence',
  denied: 'Denied — not evidence',
  pending: 'Pending approval — not evidence',
  rejected: 'Approval rejected — not evidence',
  preview: 'Dry run — preview only, not evidence',
};

/** Classify one contract row. Order matters: dry run first (sticky), then outcome. */
export function classifyAdminOpsRow(ev: AdminOpsEvidence): AdminOpsRowKind {
  if (ev.dryRun || ev.mode === 'dry_run' || ev.outcome === 'dry_run') return 'preview';
  switch (ev.outcome) {
    case 'denied_cmmc': case 'denied_cui': case 'denied_sim_only': return 'denied';
    case 'blocked_pending_approval': return 'pending';
    case 'approval_rejected': return 'rejected';
    case 'failed': return 'failed';
    case 'executed': return ev.verdict === 'SAT' ? 'executed' : 'executed_not_sat';
    default: return 'failed';
  }
}

/**
 * Build the AdminOps section for ONE tenant. Rows whose tenantId is not `tenantId` are dropped
 * (defence in depth: the reader already queries by tenant). Newest first.
 */
export function composeAdminOpsSection(rows: AdminOpsEvidence[], tenantId: string): AdminOpsSection {
  const counts = { executed: 0, executed_not_sat: 0, failed: 0, denied: 0, pending: 0, rejected: 0, preview: 0 } as Record<AdminOpsRowKind, number>;
  let excludedOtherTenant = 0;
  const out: AdminOpsViewRow[] = [];
  for (const ev of rows) {
    if (ev.tenantId !== tenantId) { excludedOtherTenant++; continue; }
    const kind = classifyAdminOpsRow(ev);
    counts[kind]++;
    out.push({
      kind, label: ADMINOPS_KIND_LABEL[kind], isEvidence: kind === 'executed',
      commandId: ev.commandId, outcome: ev.outcome, mode: ev.mode, controlIds: [...ev.controlIds],
      correlationId: ev.correlationId, timestamp: ev.executionTimestamp ?? ev.timestamp,
      approverUPN: ev.approverUPN, approvalId: ev.approvalId, verdict: ev.verdict,
    });
  }
  out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return { rows: out, counts, excludedOtherTenant };
}

export interface EvidenceRef {
  label: string;                 // the raw reference as stored in the SSP
  runId?: string;
  artifactId?: string;
  href?: string;                 // /api/evidence/artifacts/:runId/:artifactId when parseable
  verifyHref?: string;           // /api/evidence/verify/:runId/:artifactId (WORM integrity)
  wormVerifiable: boolean;
}

export interface PoamView {
  status: 'open' | 'closed';
  openedAt: string;
  closedAt?: string;
  lastSeenAt: string;
  historyDepth: number;
  autoClosed: boolean;
}

export interface AssessorObjective {
  objectiveId: string;
  controlId: string;
  family: string;
  statement: string;
  methods: string[];
  status: ObjectiveDetermination['status'];
  source: string;                // provenance
  rationale: string;
  weight: number;
  certificationBlocker: boolean;
  disposition?: string;
  poam?: PoamView;               // lifecycle if this determination is/was a deficiency
}

export interface AssessorControl {
  controlId: string;
  family: string;
  status: string;
  weight: number;
  certificationBlocker: boolean;
  disposition?: string;
  pointsAtRisk: number;          // SPRS weight lost while not met (0 when met)
  narrative?: string;            // SSP implementation narrative
  evidence: EvidenceRef[];
  missionSteps: Array<{ what: string; owner?: string }>;
  personas: string[];            // owning personas (P-ids)
  objectiveIds: string[];
  adminOps?: AdminOpsViewRow[];  // W4-EO1: AdminOps rows naming this control (tenant-scoped)
}

export interface AssessorView {
  tenantId: string;
  generatedAt: string;
  sprs: { score: number; controlsMet: number; controlsNotMet: number; controlsPartial: number; controlsNotAssessed: number; pointsAtRisk: number };
  objectives: AssessorObjective[];
  controls: AssessorControl[];
  adminOps?: AdminOpsSection;    // W4-EO1: absent when no AdminOps rows were supplied
  summary: {
    objectivesTotal: number;
    objectivesSatisfied: number;
    objectivesOther: number;
    objectivesNotAssessed: number;
    deficiencies: number;
    certificationBlockers: number;
    openPoamItems: number;
    autoClosedPoamItems: number;
    evidenceRefs: number;
  };
}

const familyOf = (controlId: string): string => controlId.split('.')[0];
/** "AC.L2-3.1.1" and "AC.L1-3.1.1" -> "AC-3.1.1" (level-insensitive practice key). */
export const practiceKey = (controlId: string): string => controlId.replace(/^([A-Z]{2})\.L[12]-/, '$1-');

/**
 * Parse an SSP evidence reference into a WORM run/artifact link when it looks like "runId/artifactId".
 * FX-EO7: the evidence routes require `?tenant=`, so the links carry the tenant the view was built for.
 */
export function parseEvidenceRef(ref: string, tenantSlug?: string): EvidenceRef {
  const m = /^([A-Za-z0-9._-]+)[\\/]([A-Za-z0-9._-]+)$/.exec(String(ref).trim());
  if (m) {
    const [, runId, artifactId] = m;
    const q = tenantSlug ? `?tenant=${encodeURIComponent(tenantSlug)}` : '';
    return {
      label: ref, runId, artifactId,
      href: `/api/evidence/artifacts/${encodeURIComponent(runId)}/${encodeURIComponent(artifactId)}${q}`,
      verifyHref: `/api/evidence/verify/${encodeURIComponent(runId)}/${encodeURIComponent(artifactId)}${q}`,
      wormVerifiable: true,
    };
  }
  return { label: String(ref), wormVerifiable: false };
}

interface SspLike {
  controlImplementations?: Array<{ control_id: string; implementationNarrative?: string; evidenceReferences?: string[] }>;
}

/** Mission-plan step lookup (mirrors SspGenerator.buildMpLookup): control_id -> steps. */
function missionStepsByControl(missionPlan: Record<string, unknown> | null | undefined): Map<string, Array<{ what: string; owner?: string }>> {
  const map = new Map<string, Array<{ what: string; owner?: string }>>();
  if (!missionPlan) return map;
  const plan = missionPlan.plan as Record<string, unknown> | undefined;
  const steps = (missionPlan.steps ?? plan?.steps ?? []) as Array<Record<string, unknown>>;
  for (const step of steps) {
    const coverage = (step.control_coverage ?? []) as Array<{ control_id: string }>;
    for (const cc of coverage) {
      if (!map.has(cc.control_id)) map.set(cc.control_id, []);
      map.get(cc.control_id)!.push({ what: String(step.what_to_do ?? ''), owner: step.owner_role as string | undefined });
    }
  }
  return map;
}

export interface ComposeInput {
  ledger: DeterminationLedger;
  ssp?: SspLike | null;
  poamLedger?: PoamLedger | null;
  missionPlan?: Record<string, unknown> | null;
  personas?: Persona[];
  /** FX-EO7: tenant the view is for — carried into evidence links (routes require ?tenant=). */
  tenantSlug?: string;
  /** W4-EO1: parsed AdminOps contract rows (AdminOpsEvidenceReader.read().parsed) for this tenant. */
  adminOps?: AdminOpsEvidence[] | null;
  /** W4-EO1: the tenant key AO rows carry (tenant GUID). Defaults to ledger.tenantId. */
  adminOpsTenantId?: string;
}

export function composeAssessorView(input: ComposeInput): AssessorView {
  const { ledger } = input;
  const ssp = input.ssp ?? null;
  const personas = input.personas ?? [];

  // SSP per-control narrative + evidence
  const narrativeByControl = new Map<string, string>();
  const evidenceByControl = new Map<string, EvidenceRef[]>();
  for (const ci of ssp?.controlImplementations ?? []) {
    if (ci.implementationNarrative) narrativeByControl.set(ci.control_id, ci.implementationNarrative);
    const refs = (ci.evidenceReferences ?? []).map(r => parseEvidenceRef(r, input.tenantSlug));
    if (refs.length) evidenceByControl.set(ci.control_id, refs);
  }

  // POA&M lifecycle per objective key
  const poamByObjective = new Map<string, PoamLedgerItem>();
  for (const it of input.poamLedger?.items ?? []) poamByObjective.set(it.key, it);

  const mission = missionStepsByControl(input.missionPlan);

  // reverse persona map: control -> owning persona ids
  const personasByControl = new Map<string, string[]>();
  for (const p of personas) for (const cid of p.controls) {
    if (!personasByControl.has(cid)) personasByControl.set(cid, []);
    personasByControl.get(cid)!.push(p.id);
  }

  const toPoamView = (it: PoamLedgerItem | undefined): PoamView | undefined => it && ({
    status: it.status, openedAt: it.openedAt, closedAt: it.closedAt, lastSeenAt: it.lastSeenAt,
    historyDepth: it.history.length, autoClosed: it.history.some(h => h.event === 'auto-closed') && it.status === 'closed',
  });

  const objectives: AssessorObjective[] = ledger.objectives.map(o => ({
    objectiveId: o.objectiveId, controlId: o.controlId, family: familyOf(o.controlId),
    statement: o.statement, methods: o.methods, status: o.status, source: o.source, rationale: o.rationale,
    weight: o.weight, certificationBlocker: o.noPoam, disposition: o.disposition,
    poam: toPoamView(poamByObjective.get(o.objectiveId)),
  }));

  const adminOps = input.adminOps ? composeAdminOpsSection(input.adminOps, input.adminOpsTenantId ?? ledger.tenantId) : undefined;
  // Joined by practice number: AO rows say AC.L2-3.1.1 where the ledger may say AC.L1-3.1.1.
  const aoByControl = new Map<string, AdminOpsViewRow[]>();
  for (const r of adminOps?.rows ?? []) for (const cid of new Set(r.controlIds.map(practiceKey))) {
    if (!aoByControl.has(cid)) aoByControl.set(cid, []);
    aoByControl.get(cid)!.push(r);
  }

  const controls: AssessorControl[] = ledger.controls.map(c => ({
    controlId: c.controlId, family: familyOf(c.controlId), status: c.status, weight: c.weight,
    certificationBlocker: c.noPoam, disposition: c.disposition,
    pointsAtRisk: c.status === 'met' ? 0 : c.weight,
    narrative: narrativeByControl.get(c.controlId),
    evidence: evidenceByControl.get(c.controlId) ?? [],
    missionSteps: mission.get(c.controlId) ?? [],
    personas: personasByControl.get(c.controlId) ?? [],
    objectiveIds: c.objectives.map(o => o.objectiveId),
    ...(adminOps ? { adminOps: aoByControl.get(practiceKey(c.controlId)) ?? [] } : {}),
  }));

  const pointsAtRisk = controls.reduce((s, c) => s + (c.disposition ? 0 : c.pointsAtRisk), 0);
  const evidenceRefs = controls.reduce((s, c) => s + c.evidence.length, 0);

  return {
    tenantId: ledger.tenantId, generatedAt: ledger.generatedAt,
    sprs: {
      score: Math.max(-203, 110 - pointsAtRisk),
      controlsMet: ledger.summary.controlsMet, controlsNotMet: ledger.summary.controlsNotMet,
      controlsPartial: ledger.summary.controlsPartial, controlsNotAssessed: ledger.summary.controlsNotAssessed,
      pointsAtRisk,
    },
    objectives, controls,
    ...(adminOps ? { adminOps } : {}),
    summary: {
      objectivesTotal: ledger.summary.objectivesTotal,
      objectivesSatisfied: ledger.summary.objectivesSatisfied,
      objectivesOther: ledger.summary.objectivesOther,
      objectivesNotAssessed: ledger.summary.objectivesNotAssessed,
      deficiencies: ledger.summary.deficiencies,
      certificationBlockers: ledger.summary.certificationBlockers,
      openPoamItems: (input.poamLedger?.items ?? []).filter(i => i.status === 'open').length,
      autoClosedPoamItems: (input.poamLedger?.items ?? []).filter(i => i.status === 'closed' && i.history.some(h => h.event === 'auto-closed')).length,
      evidenceRefs,
    },
  };
}
