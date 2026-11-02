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
// MG-03 (2C-0): the posture is the session's ONE posture (sessionPosture.ts:
// scoreFacts over the compiled SI Baseline + preamble + routed scorable facts).
// The Result screen, the Readiness tab, the readiness-result export and the
// headless runner's trace read the same computation, so the plan's
// per-requirement statuses equal theirs.
//
// D2 discipline carried through: the posture is scored over
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
import type { InterviewFact } from '@/shared/types/engagement';
import { loadQuestionGraph } from '@/features/interview/questionGraphService';
import { scorableFacts } from '@/features/scoring/draftSemantics';
import type { ReadinessPosture as SpinePosture } from '@/features/scoring/scoringService';
import { loadCompilerBanks } from './compilerBanks';
import type { ReadinessPosture } from '@/features/plan/engine/shared/types/artifacts';
import {
  computeSessionPosture,
  derivationContextFor,
  postureRequirementRows,
  type SiFieldSource,
} from './sessionPosture';
import { checkMissionPlanCore, checkTenantManifestCore } from './missionPlanContract';
import {
  buildHandoffArtifacts,
  buildPolicyHandoffArtifacts,
  referenceHandoffArtifacts,
  type HandoffArtifacts,
} from './artifactRefs';
import { loadPolicyBank, policyFileBase, renderPolicySet } from './policy/policyDocuments';
import { buildTenantConfigProfile, hasTcpInput, type TcpBuildResult } from './tcpAdapter';
import { readProvisioningInputs } from './provisioningInputs';
import type { SIBaseline } from '@/features/plan/engine/shared/types/artifacts';
import { buildCuiBoundary, type CuiBoundaryBuild } from './cuiBoundaryAdapter';
import { derivePlanMode, deferredModeMessage, type PlanModeDecision } from './planModeDerivation';
import { buildSuppliedOperatorValues } from './derive/operatorValues';
import { buildRecurringCostNotice, noticeWarnings, type RecurringCostNotice } from './recurringCostNotice';
import {
  checkDiscoveryStaleness,
  checkInputSchemas,
  checkOperatorValues,
  schemaValidatorsFor,
  validatePlanAlignment,
  type PlanValidation,
  type SchemaCheckResult,
} from './planValidation';
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
   * generator's own default applies (also listed in defaultedInputs). MG-21:
   * `archetype` is the selected archetype's prior, used only when neither a
   * derivation nor an answer supplied the field.
   */
  siFieldSources: Record<string, SiFieldSource>;
  /**
   * MG-08: how the CUI boundary was built — skipped (no_cui / presence not
   * established) or, per CUI bank question, answered / derived / defaulted /
   * unresolved. The boundary itself is artifacts.cuiBoundary.
   */
  cuiBoundaryBuild: Pick<CuiBoundaryBuild, 'skipped' | 'sources'>;
  /** MG-10: the plan mode used, why, and any deferred (migrate/hybrid) flag. */
  planModeDecision: PlanModeDecision;
  /** MG-15: the push gate's verdict (blocking errors + warnings) and the input schema check. */
  validation: PlanValidation;
  /** MG-03: the session's one posture — the object the compile read and the MP embeds. */
  posture: SpinePosture;
  /**
   * MG-12: the SI Baseline, TCP and Readiness Posture the compile read, as
   * hand-off envelopes (cesId + SHA-256); the MP references each by id and hash.
   * W7-MX2: plus the CUI Boundary (when one was built), and, after
   * attachPolicyHandoff (the Plan tab), the two policy envelopes.
   */
  handoff: HandoffArtifacts;
  /**
   * CG-8: every recurring-cost item that is part of this plan, with its monthly estimate
   * (also written onto the Mission Plan as recurring_cost_notice). Never blocks.
   */
  recurringCostNotice: RecurringCostNotice;
}

export type { SiFieldSource };

/** Read the generator's own validation_warnings off an artifact (if any). */
function warningsOf(artifact: unknown): string[] {
  const w = (artifact as { validation_warnings?: unknown })?.validation_warnings;
  return Array.isArray(w) ? (w as string[]) : [];
}

export { derivationContextFor };

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
  const banks = await loadCompilerBanks();

  // MG-03 (2C-0): the session's one posture (sessionPosture.ts) — the same
  // scoreFacts call the Result screen, the readiness export and the runner's
  // trace read. The compile reads it, the MP embeds it, and requirementResults
  // is that posture's per-requirement statuses.
  const { posture, sitAnswers, defaultedInputs, siFieldSources, discoveryEvidence } = await computeSessionPosture(
    session,
    engagement,
    graph,
    banks
  );
  const requirementResults: MusterRequirementResult[] = postureRequirementRows(posture);

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

  // MG-10: the plan mode, derived from discovery unless the operator confirmed
  // one; migrate/hybrid signals only set the deferred flag (D6).
  const targetModel = sitAnswers['S-20']?.raw_answer;
  const planModeDecision = derivePlanMode({
    facts: scorable,
    hasTenantManifest: Boolean(session.readiness_manifest),
    targetTenantModel: typeof targetModel === 'string' ? targetModel : null,
  });

  // MG-08: the CUI boundary from the confirmed answers, plan mode and SI defaults.
  let cuiBuild: CuiBoundaryBuild = { boundary: null, skipped: null, sources: {}, defaulted: [] };
  const resolveCuiBoundary = (si: SIBaseline) => {
    if (!banks.cuiQuestionBank) return null;
    cuiBuild = buildCuiBoundary({ facts: scorable, siBaseline: si, bank: banks.cuiQuestionBank, planMode: planModeDecision.planMode });
    return cuiBuild.boundary;
  };

  // MG-15: schema-check the compile inputs before the compile runs.
  const schemaValidators = banks.inputSchemas ? schemaValidatorsFor(banks.inputSchemas) : null;
  let schema: SchemaCheckResult = { warnings: [], accepted: [] };
  const checkInputs: TenantManifestInputs['checkInputs'] = (i) => {
    if (!schemaValidators) return;
    schema = checkInputSchemas(schemaValidators, {
      'si-baseline': i.siBaseline,
      'tenant-config-profile': i.tenantConfig,
      'readiness-posture': i.posture,
    });
  };

  // FC-MU-2 (MS-5): approver UPN, ToU file, initial-password reference.
  const provisioning = readProvisioningInputs(scorable, session);
  const input: TenantManifestInputs = {
    sitAnswers,
    requirementResults,
    posture: posture as unknown as ReadinessPosture,
    planMode: planModeDecision.planMode,
    resolveTenantConfig,
    resolveCuiBoundary,
    checkInputs,
    cesId: engagement.id,
    provisioning,
    simOnly: session.readiness_manifest?.tenant_kind === 'sim',
    // W1: the further Stamper values (approver, admin, ToU, subscription, template, role ids).
    facts: scorable,
    // MG-09: BTC-lite from the discovery captures and the asked BTC answers.
    // MG-09 hand-off (e): the Plan tab's capture reviews of the evidenced BTC questions.
    btc: { evidence: discoveryEvidence, facts: scorable, reviews: session.btc_capture_reviews },
  };
  const artifacts = buildPlanArtifacts(input, banks);
  defaultedInputs.push(...cuiBuild.defaulted);
  const tcpBuilt = tcp as TcpBuildResult | null;
  if (tcpBuilt) {
    defaultedInputs.push(...tcpBuilt.defaulted);
    // W1: a further Stamper value nothing supplies is left out of the TM and listed here.
    defaultedInputs.push(...buildSuppliedOperatorValues(scorable).unresolved.map((v) => `Operator value ${v}: unresolved`));
  }
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

  // MG-12: the three compile inputs as hash-referenced hand-off artifacts —
  // the very objects the MG-15 schema check validated — referenced from the MP
  // before the contract gate and the push gate see it. W7-MX2: and the CUI
  // Boundary the compile used (its BTC risk flags already attached).
  const handoff = await buildHandoffArtifacts(
    {
      siBaseline: artifacts.siBaseline,
      tenantConfig: artifacts.tenantConfig,
      posture,
      cuiBoundary: artifacts.cuiBoundary,
    },
    engagement.id
  );
  referenceHandoffArtifacts(artifacts.missionPlan, handoff);

  // CG-8: the recurring-cost notice is written into the plan (CONTRACT CHANGE, additive, optional).
  const recurringCostNotice = await buildRecurringCostNotice(artifacts);
  (artifacts.missionPlan as unknown as { recurring_cost_notice?: RecurringCostNotice }).recurring_cost_notice = recurringCostNotice;

  // MS-R1 gate: validate artifacts against the shared contract before they leave Muster.
  const mpCheck = checkMissionPlanCore(artifacts.missionPlan);
  if (!mpCheck.ok) {
    throw new Error(`Mission Plan contract violation: ${mpCheck.missing.join('; ')}`);
  }
  const tmCheck = checkTenantManifestCore(artifacts.tenantManifest);
  if (!tmCheck.ok) {
    throw new Error(`Tenant Manifest contract violation: ${tmCheck.missing.join('; ')}`);
  }

  // MG-15: the push gate's verdict on this plan (blocking + warnings).
  const alignment = validatePlanAlignment(
    artifacts.missionPlan,
    artifacts.tenantManifest,
    artifacts.cuiBoundary,
    artifacts.tenantConfig,
    artifacts.btcConfirmation // MG-09 hand-off (d)
  );
  // MG-22 hand-off (b): the CUI-vs-discovery staleness check joins the compile's
  // warnings, so the headless runner (and every compile consumer) sees it.
  alignment.warnings.push(...checkDiscoveryStaleness(session.facts));
  // FX-11: defaulted operator values block unless the plan is sim-only; always listed.
  const operatorValues = checkOperatorValues(artifacts.tenantManifest);
  alignment.blocking.push(...operatorValues.blocking);
  const mpDoc = docs.find((d) => d.kind === 'mission-plan')!;
  // A new array: warningsOf() may return the artifact's own array, which must stay untouched.
  mpDoc.validationWarnings = [
    ...mpDoc.validationWarnings,
    ...(planModeDecision.deferred ? [deferredModeMessage(planModeDecision.deferred)] : []),
    ...alignment.blocking,
    ...alignment.warnings,
    ...(operatorValues.simOnly
      ? operatorValues.defaulted.map((d) => `Operator value defaulted (sim-only plan, not blocked): ${d}`)
      : []),
    ...noticeWarnings(recurringCostNotice),
  ];
  const infraDoc = docs.find((d) => d.kind === 'infra-manifest');
  if (infraDoc) infraDoc.validationWarnings = [...infraDoc.validationWarnings, ...noticeWarnings(recurringCostNotice)];

  return {
    artifacts,
    docs,
    tenantSlug: session.readiness_manifest?.tenant_slug ?? 'tenant',
    defaultedInputs,
    siFieldSources,
    cuiBoundaryBuild: { skipped: cuiBuild.skipped, sources: cuiBuild.sources },
    planModeDecision,
    validation: { ...alignment, schema, operatorValues },
    posture,
    handoff,
    recurringCostNotice,
  };
}

/**
 * W7-MX2 (GOAL item 1): the Plan tab's policy-inputs profile and policy-set
 * manifest envelopes, as the headless runner builds them (headless/
 * planOutputFiles.ts writePolicyHandoffOutputs): the policy set rendered over
 * this compile and the session (as PolicyDocumentsPanel renders it), its two
 * envelopes referenced from the MP (in place, no file_name: muster-api sets it
 * on the stored copy) and added to result.handoff, so the push carries them.
 */
export async function attachPolicyHandoff(result: PlanCompileResult, sessionId: string): Promise<void> {
  const session = await db.interview_sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  const party = await db.assessed_parties.get(session.party_id);
  if (!party) throw new Error(`Party not found: ${session.party_id}`);
  const set = await renderPolicySet({ compile: result, facts: session.facts, party, bank: await loadPolicyBank() });
  const documents: Record<string, string> = {};
  for (const doc of set.documents) documents[policyFileBase(doc)] = doc.markdown;
  const policy = await buildPolicyHandoffArtifacts(
    { profileOutput: set.profile.output, documents },
    result.handoff.si_baseline?.cesId ?? party.engagement_id
  );
  referenceHandoffArtifacts(result.artifacts.missionPlan, policy);
  result.handoff = { ...result.handoff, ...policy };
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
