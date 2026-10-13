// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// planCompileService.ts — G-MUSTER-PLAN-3 M0+M1: turn a completed Muster
// session into the in-scope Planner artifacts, through the ONE vendored compile.
//
// Load path mirrors readinessResultService.executeReadinessExport (Dexie ->
// route -> the same requirementStatuses aggregation) so the Plan tab reads the
// SAME requirement posture the Readiness tab and the readiness-result export
// read — screen, file, and plan can never disagree.
//
// D2 discipline carried through: requirement_results come from
// routeFacts(scorableFacts(session.facts)) — unconfirmed drafts are excluded
// BEFORE anything reaches the compile, so "unconfirmed drafts never become
// fact" holds without any extra code.
//
// M1 SI inputs: siDerivation.deriveSitFacts derives what Muster observes
// (target level, deployment posture, tenant model, infra model, license tier)
// with provenance; the interview-answered SIT residue joins them; everything
// still un-answered is honestly listed as defaultedInputs. All go through the
// real SI bank (sitAnswersFromFacts + buildSiBaselineFromAnswers).
import { db } from '@/shared/db/schema';
import type { InterviewFact, InterviewSession } from '@/shared/types/engagement';
import { loadQuestionGraph } from '@/features/interview/questionGraphService';
import { routeFacts } from '@/features/scoring/factRouter';
import { scorableFacts } from '@/features/scoring/draftSemantics';
import { requirementStatuses } from '@/features/export/readinessResultService';
import { loadCompilerBanks } from './compilerBanks';
import { deriveSitFacts, residueIds, type DerivationContext } from './siDerivation';
import { sitAnswersFromFacts } from './siBaselineAdapter';
import { SI_FIELD_LABELS } from './siResidue';
import { checkMissionPlanCore, checkTenantManifestCore } from './missionPlanContract';
import { buildTenantConfigProfile, hasTcpInput, type TcpBuildResult } from './tcpAdapter';
import { readProvisioningInputs } from './provisioningInputs';
import type { SIBaseline } from '@/vendored/ces-planner/shared/types/artifacts';
import {
  buildPlanArtifacts,
  type MusterRequirementResult,
  type PlanArtifacts,
  type TenantManifestInputs,
} from './tenantManifestAdapter';

/** A generated document as the Plan tab lists it. `kind` is the REQ §4 slug. */
export type PlanDocKind =
  | 'si-baseline'
  | 'tenant-config'
  | 'tenant-manifest'
  | 'infra-manifest'
  | 'mission-plan';

export interface PlanDoc {
  kind: PlanDocKind;
  label: string;
  /** The artifact object (downloaded verbatim). */
  artifact: unknown;
  /** Generator-reported defaults/warnings for this artifact — shown honestly. */
  validationWarnings: string[];
}

export interface PlanCompileResult {
  artifacts: PlanArtifacts;
  docs: PlanDoc[];
  /** For download filenames: manual-mission-plan-<slug>-<ts>.json. */
  tenantSlug: string;
  /**
   * The SI-input contract fields M0 left to the generator's own defaults
   * because Muster did not (yet) supply them — surfaced honestly on the Plan
   * tab. Muster knows these from its own derivation, independent of the
   * generator's validation_warnings (which are empty for thin input — see
   * G-MUSTER-PLAN-3-FINDINGS F4). M1's full SI derivation + interview link-back
   * shrinks this list to the genuine residue.
   */
  defaultedInputs: string[];
  /**
   * FC-MU (MU-10): where each of the SI bank's questions got its value — one
   * entry per bank question id. `derived` carries the derivation's source
   * pointer (`derived:si:<kind>:<source>`); `answered` is an explicit operator
   * answer (which always beats a derivation); `defaulted` means neither, so the
   * generator's own default applies (also listed in defaultedInputs).
   */
  siFieldSources: Record<string, SiFieldSource>;
}

export type SiFieldSource =
  | { source: 'derived'; provenance: string; answer: string }
  | { source: 'answered'; answer: string }
  | { source: 'defaulted' };

/** Read the generator's own validation_warnings off an artifact (if any). */
function warningsOf(artifact: unknown): string[] {
  const w = (artifact as { validation_warnings?: unknown })?.validation_warnings;
  return Array.isArray(w) ? (w as string[]) : [];
}

/** The derivation context for a session — the Muster sources siDerivation reads. */
export function derivationContextFor(
  session: InterviewSession,
  engagementKind?: string | null
): DerivationContext {
  return {
    selectedStacks: session.selected_stacks ?? [],
    // FC-MU (MU-10): the same scorable facts the interview derives from.
    facts: scorableFacts(session.facts),
    preamble: session.preamble ?? null,
    manifest: session.readiness_manifest
      ? {
          mode: session.readiness_manifest.mode,
          tenant_kind: session.readiness_manifest.tenant_kind,
          tenant_slug: session.readiness_manifest.tenant_slug,
        }
      : null,
    engagementKind: engagementKind ?? null,
  };
}

/**
 * Dexie -> requirement posture + SI derivation -> the one compile -> the
 * in-scope artifacts and their document list. Banks (incl. the tech-ref index,
 * FedRAMP table, and SI question bank) are fetched from Vite static assets;
 * zero network beyond that.
 */
export async function compilePlanForSession(sessionId: string): Promise<PlanCompileResult> {
  const session = await db.interview_sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  const party = await db.assessed_parties.get(session.party_id);
  if (!party) throw new Error(`Party not found: ${session.party_id}`);
  const engagement = await db.engagements.get(party.engagement_id);
  if (!engagement) throw new Error(`Engagement not found: ${party.engagement_id}`);

  const graph = await loadQuestionGraph(session.selected_stacks ?? []);
  const rows = requirementStatuses(routeFacts(scorableFacts(session.facts)), graph);
  const requirementResults: MusterRequirementResult[] = rows.map((r) => ({
    requirement_id: r.requirement_id,
    status: r.status as MusterRequirementResult['status'],
  }));

  const banks = await loadCompilerBanks();

  // M1: derive the SIT answers Muster observes; add any residue answered in the
  // interview; the still-unanswered residue is the honest defaulted list.
  const derived = deriveSitFacts(derivationContextFor(session, engagement.engagement_kind));
  const allBankIds = (banks.siQuestionBank?.ces?.question_bank?.questions ?? []).map((q) => q.id);
  const bankIds = new Set(allBankIds);
  const derivedIdSet = new Set(derived.derivedIds);
  // FC-MU (MU-10) precedence, founder default 2026-09-27: an EXPLICIT operator
  // answer always beats a derivation. A SIT fact the session holds for a bank
  // question wins over the derived value for that question; an "I'm not sure"
  // (confidence unknown) is not an explicit answer and never overrides one.
  const answeredFacts: InterviewFact[] = scorableFacts(session.facts).filter(
    (f) =>
      bankIds.has(f.question_id) &&
      !f.provenance.startsWith('derived:si:') &&
      (!derivedIdSet.has(f.question_id) || f.confidence !== 'unknown')
  );
  const answeredIds = new Set(answeredFacts.map((f) => f.question_id));
  const derivedKept = derived.facts.filter((f) => !answeredIds.has(f.question_id));
  const sitAnswers = sitAnswersFromFacts([...derivedKept, ...answeredFacts], banks.siQuestionBank ?? {});

  // Honest residue: every bank question neither derived nor answered.
  const defaultedInputs = residueIds(allBankIds, derived.derivedIds)
    .filter((id) => !answeredIds.has(id))
    .map((id) => SI_FIELD_LABELS[id] ?? id);

  // FC-MU (MU-10): the per-question source report (same inputs as sitAnswers).
  const siFieldSources: Record<string, SiFieldSource> = {};
  const lastAnswer = new Map(answeredFacts.map((f) => [f.question_id, f.answer]));
  const derivedById = new Map(derivedKept.map((f) => [f.question_id, f]));
  for (const id of allBankIds) {
    const answered = lastAnswer.get(id);
    const d = derivedById.get(id);
    siFieldSources[id] =
      answered !== undefined
        ? { source: 'answered', answer: answered }
        : d
          ? { source: 'derived', provenance: d.provenance, answer: d.answer }
          : { source: 'defaulted' };
  }

  // W4-MU1 (PLAN-3 M3): the Tenant Config Profile. Built when the operator
  // answered any TCP plan input, or the SI Baseline selects an infrastructure
  // model that needs Azure/Sentinel resources (m365_sentinel / m365_azure).
  // m365_only sessions without TCP input keep the pre-M3 plan byte-for-byte.
  const scorable = scorableFacts(session.facts);
  let tcp: TcpBuildResult | null = null;
  const resolveTenantConfig = (si: SIBaseline) => {
    const tcpBank = banks.tcpQuestionBank;
    if (!tcpBank) return null;
    if (!tcpWanted(si, scorable)) return null;
    tcp = buildTenantConfigProfile(
      scorable,
      tcpBank,
      si,
      { orgName: party.name, tenantSlug: session.readiness_manifest?.tenant_slug ?? null },
      engagement.id
    );
    return tcp.tenantConfig;
  };

  // FC-MU-2 (MS-5): approver UPN, ToU file, initial-password reference.
  const provisioning = readProvisioningInputs(scorable, session);
  const input: TenantManifestInputs = {
    sitAnswers,
    requirementResults,
    resolveTenantConfig,
    cesId: engagement.id,
    provisioning,
  };
  const artifacts = buildPlanArtifacts(input, banks);
  const tcpBuilt = tcp as TcpBuildResult | null;
  if (tcpBuilt) defaultedInputs.push(...tcpBuilt.defaulted);
  if (artifacts.infrastructureManifest) {
    defaultedInputs.push(...provisioning.missing.map((m) => `Infra Manifest ${m}`));
  }

  const docs: PlanDoc[] = [
    {
      kind: 'si-baseline',
      label: 'SI Baseline',
      artifact: artifacts.siBaseline,
      validationWarnings: warningsOf(artifacts.siBaseline),
    },
    {
      kind: 'tenant-manifest',
      label: 'Tenant Manifest',
      artifact: artifacts.tenantManifest,
      validationWarnings: warningsOf(artifacts.tenantManifest),
    },
    {
      kind: 'mission-plan',
      label: 'Manual Mission Plan',
      artifact: artifacts.missionPlan,
      validationWarnings: warningsOf(artifacts.missionPlan),
    },
  ];
  if (artifacts.tenantConfig) {
    docs.splice(1, 0, {
      kind: 'tenant-config',
      label: 'Tenant Config Profile',
      artifact: artifacts.tenantConfig,
      validationWarnings: [],
    });
  }
  // Infrastructure Manifest only when it was actually produced (non-m365_only).
  // Absent, not stubbed (REQ-TESTER-MUSTER-SHOW-MP §4).
  if (artifacts.infrastructureManifest) {
    docs.splice(docs.length - 1, 0, {
      kind: 'infra-manifest',
      label: 'Infrastructure Manifest',
      artifact: artifacts.infrastructureManifest,
      validationWarnings: warningsOf(artifacts.infrastructureManifest),
    });
  }

  // MS-R1 gate: validate artifacts against the shared contract before they leave Muster.
  const mpCheck = checkMissionPlanCore(artifacts.missionPlan);
  if (!mpCheck.ok) {
    throw new Error(`Mission Plan contract violation: ${mpCheck.missing.join('; ')}`);
  }
  const tmCheck = checkTenantManifestCore(artifacts.tenantManifest);
  if (!tmCheck.ok) {
    throw new Error(`Tenant Manifest contract violation: ${tmCheck.missing.join('; ')}`);
  }

  return {
    artifacts,
    docs,
    tenantSlug: session.readiness_manifest?.tenant_slug ?? 'tenant',
    defaultedInputs,
    siFieldSources,
  };
}

/** W4-MU1: does this session get a Tenant Config Profile (and so, for a
 * non-m365_only model, an Infrastructure Manifest)? */
export function tcpWanted(si: SIBaseline, facts: InterviewFact[]): boolean {
  if (hasTcpInput(facts)) return true;
  const model = (si.si_baseline as { dependencies?: { infrastructure_model?: string } } | undefined)
    ?.dependencies?.infrastructure_model;
  return model === 'm365_sentinel' || model === 'm365_azure';
}

/** The mission-plan directives the viewer renders — one row per control. */
export interface MissionPlanDirectiveRow {
  control_id: string;
  directive: string;
  step_ids: string[];
  justification?: string;
}

/**
 * Pull the human-readable directives off a Manual Mission Plan for the viewer.
 * The generator emits outputs.human_readable_mission_plan.control_directives[]
 * (control_id · directive · step_ids · justification) — read, never re-derived.
 */
export function missionPlanDirectives(missionPlan: unknown): MissionPlanDirectiveRow[] {
  const mp = missionPlan as {
    outputs?: {
      human_readable_mission_plan?: {
        control_directives?: Array<{
          control_id: string;
          directive: string;
          step_ids?: string[];
          justification?: string;
        }>;
      };
    };
  };
  const directives = mp?.outputs?.human_readable_mission_plan?.control_directives ?? [];
  return directives.map((d) => ({
    control_id: d.control_id,
    directive: d.directive,
    step_ids: d.step_ids ?? [],
    justification: d.justification,
  }));
}

/** Download an artifact as pretty JSON — the same blob/anchor seam as the
 * readiness-result and status-payload exports. */
export function downloadArtifact(filename: string, artifact: unknown): void {
  const json = JSON.stringify(artifact, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
