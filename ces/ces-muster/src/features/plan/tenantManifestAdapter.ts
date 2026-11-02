// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// tenantManifestAdapter.ts — G-MUSTER-PLAN-2 M2 slice 3: produce the Planner
// Tenant Manifest (and Infrastructure Manifest) from Muster's own inputs using
// the VENDORED, unforked ces-planner compiler chain.
//
// Pipeline (all vendored, drift-checked):
//   SI Baseline (slice-1 generator)
//     + Muster readiness posture (requirement_results)
//     + knowledge banks (already vendored in public/knowledge/)
//   -> compileGapSet -> compileTaskCatalog -> generateTenantManifest
//                                          -> generateInfrastructureManifest
//
// The banks are INJECTED (dependency injection) so this core is pure and
// Node-testable; loadCompilerBanks() is the SPA/fetch convenience wrapper.
import { compileGapSet } from '@/features/gaps/gapCompiler';
import { vendoredEvidenceCatalog } from './evidenceCatalogBank';
import { compileTaskCatalog } from '@/features/plan/engine/mpt/services/taskCompiler';
import { generateTenantManifest } from '@/features/plan/engine/mpt/services/manifestGenerator';
import { generateInfrastructureManifest } from '@/features/plan/engine/mpt/services/infraManifestGenerator';
import { generateManualPlan } from '@/features/plan/engine/mpt/services/manualPlanGenerator';
import { buildTechRefIndex, type TechRefIndex } from '@/features/plan/engine/shared/services/techRefIndex';
import type { TechRefCMMCL2 } from '@/features/plan/engine/shared/types/domain';
import type { FedRAMPInheritanceTable } from '@/features/plan/engine/mpt/services/fedrampInheritance';
import type { PlanMode, TaskCatalog, GapSet } from '@/features/plan/engine/mpt/types';
import type {
  ReadinessPosture,
  SIBaseline,
  TenantManifest,
  ManualMissionPlan,
  TenantConfigProfileOutput,
  CUIBoundaryOutput,
  BTCConfirmationOutput,
} from '@/features/plan/engine/shared/types/artifacts';
import type { InterviewFact } from '@/shared/types/engagement';
import type { DiscoveryEvidenceItem } from '@/features/discovery/discoveryEvidence';
import { buildBtcLite } from './btc/btcLite';
import { buildSiBaselineFromAnswers, siGovernanceFromFacts, type SiBaselineInputs, type SiQuestionBank } from './siBaselineAdapter';
import {
  decorateInfraManifest,
  operatorValuesFor,
  provisioningInputsForTenantManifest,
  type EmittedInfraManifest,
  type TcpQuestionBank,
} from './tcpAdapter';
import type { SITAnswer } from '@/features/plan/engine/types/siBaseline';
import {
  OPERATOR_PROVENANCE_KEY,
  buildSuppliedOperatorValues,
  operatorStamperVariables,
  operatorValueProvenance,
} from './derive/operatorValues';
import { annotateVerificationRows } from './derive/verificationExpectations';
import { promoteConfigurableManualDirectives, type DirectivePromotion } from './derive/directivePromotion';
import { resolveDefaultedPolicyValues } from './policy/policyInputsProfile';

/** The knowledge banks the compiler chain consumes (all already vendored). */
export interface CompilerBanks {
  cmmcRequirements: unknown;
  evidenceMatrix: unknown;
  assessorKB: unknown;
  evidenceArchetypeCatalog: unknown;
  /** vendorCapabilities = { patterns, playbook } (nested, per the compiler). */
  patterns: unknown;
  playbook: unknown;
  /**
   * G-MUSTER-PLAN-3 M0: the GCC-High G5 tech reference (raw, parsed from
   * gcc-high-g5-cmmc-2-tech-ref-structured.json). Optional on the type so the
   * pre-M0 Node tests that omit it keep compiling; the SPA loader
   * (compilerBanks.loadCompilerBanks) always supplies it. compilePlan builds
   * the TechRefIndex from it on the ONE compile path (never re-indexed per
   * output). Absent -> compileTaskCatalog's techRefIndex arg is undefined,
   * exactly the pre-M0 behaviour.
   */
  techRef?: TechRefCMMCL2 | null;
  /**
   * G-MUSTER-PLAN-3 M0: the FedRAMP CSP inheritance table (from
   * fedramp-inheritance-table.yaml), compileGapSet arg 8. Optional (see
   * techRef); absent -> null, the pre-M0 behaviour. Only ever changes the gap
   * set for a cloud_only SI baseline with valid fedramp_package_ids.
   */
  inheritanceTable?: FedRAMPInheritanceTable | null;
  /**
   * G-MUSTER-PLAN-3 M1: the real primed SI Question Bank (its sets_its_fields
   * map SITAnswers to si_baseline.* paths). Optional on the TYPE for construction
   * ergonomics, but compilePlan requires it (throws if absent) — the SPA loader
   * and every test always supply it.
   */
  siQuestionBank?: SiQuestionBank;
  /** W4-MU1 (PLAN-3 M3): the primed TCP Question Bank. Optional: absent ->
   * no TCP is built from session facts (pre-M3 behaviour). */
  tcpQuestionBank?: TcpQuestionBank;
  /** MG-08: the primed CUI Boundary Question Bank (bindings.manifest/policy). */
  cuiQuestionBank?: import('./cuiBoundaryAdapter').CuiQuestionBank;
  /** MG-15: the copied Planner schemas the compile inputs are checked against (planValidation.SCHEMA_FILES). */
  inputSchemas?: Record<import('./planValidation').SchemaArtifact, object>;
  /**
   * W3 (MG-27): the raw primed Policy Inputs Question Bank. Its ODP values
   * (answered or bank-recommended) become verification expected values.
   * Absent -> no ODP expected values.
   */
  policyInputsBank?: unknown;
  /** MG-09: the primed BTC Question Bank and the BTC Activation Package (raw YAML). Absent -> no BTC. */
  btcQuestionBank?: unknown;
  btcActivationPackage?: unknown;
}

/** A minimal Muster requirement result — the join key the gap compiler reads. */
export interface MusterRequirementResult {
  requirement_id: string;
  status: 'met' | 'partial' | 'not_met' | 'unknown';
}

export interface TenantManifestInputs {
  /**
   * SITAnswers keyed by real SIT question id (from siDerivation-derived facts +
   * interview-answered residue, via siBaselineAdapter.sitAnswersFromFacts). The
   * single SI-answer source for the plan surface (M1). buildSiBaselineFromAnswers
   * maps them to si_baseline.* through the real bank.
   */
  sitAnswers: Record<string, SITAnswer>;
  /** Muster's scored posture, reduced to requirement_results. */
  requirementResults: MusterRequirementResult[];
  /**
   * MG-07: the full readiness posture (scoreFacts over the compiled SI
   * Baseline). When present it is the posture the gap compile reads and the MP
   * embeds, as Planner's is; absent -> requirementResults bridged (bridgePosture).
   */
  posture?: ReadinessPosture;
  planMode?: PlanMode;
  /** Optional Azure tenant config — only needed for the infra manifest's
   * non-m365_only path; absent -> infra manifest is null. */
  tenantConfig?: TenantConfigProfileOutput | null;
  /**
   * W4-MU1 (PLAN-3 M3): resolve the TCP from the SI Baseline this compile
   * builds (the SI -> TCP derivation needs it). Used only when `tenantConfig`
   * is not supplied directly; returning null keeps the pre-M3 behaviour.
   */
  resolveTenantConfig?: (siBaseline: SIBaseline) => TenantConfigProfileOutput | null;
  /**
   * MG-08: resolve the CUI boundary from the SI Baseline this compile builds
   * (the SI defaults need it). Absent or returning null -> no boundary (the
   * pre-MG-08 behaviour, and the no-CUI skip).
   */
  resolveCuiBoundary?: (siBaseline: SIBaseline) => CUIBoundaryOutput | null;
  /**
   * MG-15: called with the compile's inputs (SI Baseline, TCP, the bridged
   * posture) BEFORE compileGapSet runs — the schema check hook.
   */
  checkInputs?: (inputs: {
    siBaseline: SIBaseline;
    tenantConfig: TenantConfigProfileOutput | null;
    posture: ReadinessPosture;
  }) => void;
  cesId?: string;
  /** FC-MU-2 (MS-5): the Tenant Config intake's provisioning inputs (Infra Manifest only). */
  provisioning?: import('./provisioningInputs').ProvisioningInputs;
  /** FX-11 / MG-15: the plan is for a sim tenant (defaulted operator values are flagged, not blocked). */
  simOnly?: boolean;
  /**
   * W1 (synthetic customers): the session's scorable facts, read for the
   * further Stamper values Muster supplies (derive/operatorValues
   * buildSuppliedOperatorValues). Absent -> none are added.
   */
  facts?: InterviewFact[];
  /**
   * MG-09 (BTC-lite): the session's discovery captures (sessionPosture
   * discoveryEvidence) and its facts (the asked BTC answers). A BTC
   * Confirmation is built only when there is at least one capture, a CUI
   * boundary and the BTC banks; it then feeds the gap set, the task catalog,
   * the Tenant Manifest and the Mission Plan, as Planner's does.
   */
  btc?: {
    evidence: DiscoveryEvidenceItem[];
    facts: InterviewFact[];
    /** MG-09 hand-off (e): the Plan tab's capture reviews. */
    reviews?: Record<string, import('@/shared/types/engagement').BtcCaptureReview>;
  };
}

/**
 * Bridge Muster's requirement_results into the ces-planner ReadinessPosture
 * shape the gap compiler reads. gapCompiler only consumes
 * `ces.requirement_results[].{requirement_id, status}` and evidence_refs, so a
 * minimal envelope is faithful; the rest of the posture is metadata the
 * compiler does not read.
 */
function bridgePosture(results: MusterRequirementResult[], siBaselineRefHash: string): ReadinessPosture {
  // MX mx-02 (MG-03): the posture the MP embeds is built from the real results —
  // real counts and the compile date, not an empty summary and 1970 dates.
  const today = new Date().toISOString().split('T')[0];
  const count = (s: MusterRequirementResult['status']) => results.filter((r) => r.status === s).length;
  return {
    ces: {
      artifact: 'CES_READINESS_POSTURE',
      version: '1.0.0',
      generated_on: today,
      snapshot_id: 'muster-plan-mode',
      as_of_date: today,
      si_baseline_ref: { artifact_id: siBaselineRefHash, hash: siBaselineRefHash },
      rr_question_set_ref: { artifact_id: 'n/a', hash: 'n/a' },
      control_status_summary: {
        met: count('met'),
        partial: count('partial'),
        not_met: count('not_met'),
        unknown: count('unknown'),
      } as never,
      key_findings: [],
      constraints: [],
      requirement_results: results.map((r) => ({
        requirement_id: r.requirement_id,
        status: r.status,
        evidence_refs: [],
      })),
      evidence_index: [],
    },
  } as unknown as ReadinessPosture;
}

export interface TenantManifestResult {
  siBaseline: SIBaseline;
  tenantManifest: TenantManifest;
  /** null for m365_only tenants (the common Muster case). */
  infrastructureManifest: EmittedInfraManifest | null;
  taskCount: number;
}

/**
 * The shared compile pass every plan-mode artifact consumes: SI Baseline +
 * bridged posture -> GapSet -> TaskCatalog. Extracted so the Tenant Manifest,
 * the Manual Mission Plan, and the Infra Manifest all run ONE compile, not
 * three (and can never diverge on the intermediates).
 */
interface CompiledPlan {
  siBaseline: SIBaseline;
  posture: ReadinessPosture;
  gapSet: GapSet;
  taskCatalog: TaskCatalog;
  planMode: PlanMode;
  vendorCapabilities: { patterns: unknown; playbook: unknown };
  /** The TCP every generator in this compile receives (null = none). */
  tenantConfig: TenantConfigProfileOutput | null;
  /** MG-08: the CUI boundary every generator in this compile receives (null = none). */
  cuiBoundary: CUIBoundaryOutput | null;
  /** MG-09: the BTC Confirmation every generator in this compile receives (null = none). */
  btcConfirmation: BTCConfirmationOutput | null;
  /** MG-09: runlist questions nothing answered (gate failures "not answered"). */
  btcUnanswered: string[];
}

function compilePlan(input: TenantManifestInputs, banks: CompilerBanks): CompiledPlan {
  if (!banks.siQuestionBank) {
    throw new Error(
      'compilePlan requires banks.siQuestionBank (the primed SI Question Bank) — the SI answers map to si_baseline.* through its sets_its_fields.'
    );
  }
  // W5c2: SI governance owners derived from the personnel answers (input.facts).
  const siBaseline = buildSiBaselineFromAnswers(
    input.sitAnswers,
    banks.siQuestionBank,
    input.cesId,
    siGovernanceFromFacts(input.facts ?? [])
  );
  const tenantConfig =
    input.tenantConfig ?? (input.resolveTenantConfig ? input.resolveTenantConfig(siBaseline) : null);
  const cuiBoundary = input.resolveCuiBoundary ? input.resolveCuiBoundary(siBaseline) : null;
  const vendorCapabilities = { patterns: banks.patterns, playbook: banks.playbook };
  const posture = input.posture ?? bridgePosture(input.requirementResults, siBaseline.ces.cesId ?? 'muster');

  // M0: the TechRefIndex is built here, on the single compile path, so every
  // output that reads the catalog sees the same index and it is never rebuilt
  // per artifact. Absent techRef -> undefined arg (pre-M0 behaviour).
  const techRefIndex: TechRefIndex | undefined = banks.techRef
    ? buildTechRefIndex(banks.techRef)
    : undefined;

  input.checkInputs?.({ siBaseline, tenantConfig, posture });

  // MG-09: BTC-lite from discovery (btc/btcLite.ts).
  const btcLite =
    input.btc && input.btc.evidence.length > 0 && banks.btcQuestionBank && banks.btcActivationPackage
      ? buildBtcLite({
          siBaseline,
          cuiBoundary,
          evidence: input.btc.evidence,
          facts: input.btc.facts,
          reviews: input.btc.reviews,
          banks: { btcQuestionBank: banks.btcQuestionBank, btcActivationPackage: banks.btcActivationPackage },
        })
      : null;
  const btcConfirmation = btcLite?.confirmation ?? null;
  // W6 (run 56): the BTC risk flags are boundary findings. They ride the CUI
  // boundary as `boundary_risk_flags` (the record is free-form), so the CUI
  // boundary envelope carries them and the vendored manifest generator turns them
  // into a TM boundary_zones definition, which EvidenceOps prints with the other
  // boundary facts. No ces-shared schema change (BoundaryZonesSchema passthrough).
  if (cuiBoundary && btcConfirmation) attachBoundaryRiskFlags(cuiBoundary, btcConfirmation);

  const gapSet = compileGapSet(
    siBaseline,
    posture,
    banks.cmmcRequirements,
    banks.evidenceMatrix,
    vendorCapabilities,
    btcConfirmation, // MG-09
    cuiBoundary, // MG-08
    banks.inheritanceTable ?? null, // M0 wire: FedRAMP inheritance table (arg 8)
    vendoredEvidenceCatalog() // EVC.3: released evidence catalog (arg 9)
  );

  const taskCatalog = compileTaskCatalog(
    gapSet,
    siBaseline,
    vendorCapabilities,
    banks.assessorKB,
    banks.cmmcRequirements,
    banks.evidenceArchetypeCatalog,
    techRefIndex, // M0 wire: GCC-High G5 tech-ref index (arg 7)
    btcConfirmation, // MG-09
    banks.evidenceMatrix,
    tenantConfig,
    gapSet.controlDispositions
  );

  return {
    siBaseline,
    posture,
    gapSet,
    taskCatalog,
    planMode: input.planMode ?? 'harden_existing',
    vendorCapabilities,
    tenantConfig,
    cuiBoundary,
    btcConfirmation,
    btcUnanswered: btcLite?.unanswered ?? [],
  };
}

export interface ManualPlanResult {
  siBaseline: SIBaseline;
  missionPlan: ManualMissionPlan;
  taskCount: number;
}

/**
 * G-MUSTER-PLAN-3 M0: the ONE-compile builder every plan surface consumes.
 * Runs compilePlan exactly once, then every in-scope generator over the shared
 * SI Baseline / GapSet / TaskCatalog. This is the single GapSet -> TaskCatalog
 * pass the engineering note mandates: the Plan tab calls THIS (never
 * buildTenantManifest AND buildManualPlan, which would compile twice). The two
 * narrower builders below delegate here so there is only one compile path in
 * the codebase.
 */
export interface PlanArtifacts {
  siBaseline: SIBaseline;
  tenantManifest: TenantManifest;
  /** null for m365_only tenants (no tenantConfig) — the common Muster case.
   * W4-MU1: the canonical shared-contract shape (`infrastructure` key). */
  infrastructureManifest: EmittedInfraManifest | null;
  missionPlan: ManualMissionPlan;
  /** W4-MU1: the TCP the compile used (null when none). */
  tenantConfig: TenantConfigProfileOutput | null;
  /** MG-08: the CUI boundary the compile used (null when none or skipped). */
  cuiBoundary: CUIBoundaryOutput | null;
  /** MG-09: the BTC-lite Confirmation the compile used (null when none). */
  btcConfirmation: BTCConfirmationOutput | null;
  /** MG-09: BTC runlist questions nothing answered. */
  btcUnanswered: string[];
  /**
   * MG-11 hand-off (a): the compile's own GapSet and TaskCatalog, so the
   * assessor reports read the intermediates the MP was generated from (their
   * task ids are the MP's step ids) instead of re-compiling.
   */
  gapSet: GapSet;
  taskCatalog: TaskCatalog;
  taskCount: number;
  /** W5c3: the manual directives promoted to implement (a configuring registry entry exists). */
  directivePromotions: DirectivePromotion[];
}

export function buildPlanArtifacts(input: TenantManifestInputs, banks: CompilerBanks): PlanArtifacts {
  const c = compilePlan(input, banks);

  const tenantManifest = generateTenantManifest(
    c.siBaseline,
    c.planMode,
    c.taskCatalog,
    banks.assessorKB,
    c.cuiBoundary, // MG-08
    c.btcConfirmation, // MG-09
    c.tenantConfig,
    input.cesId
  );

  // FX-11: the operator values Stamper's commands need, under the camelCase
  // variable names its ManifestReader copies from tenant_identity verbatim
  // (operatorUPN, breakGlassUPN, breakGlassUserId, cuiGroupName, wifiSsid,
  // securityEmail, and W5c6 cisoEmail = securityEmail's value; unresolved ones are
  // left out), plus their provenance.
  const operatorValues = operatorValuesFor(c.tenantConfig);
  if (operatorValues) {
    const body = (tenantManifest as unknown as { tenant_manifest: Record<string, unknown> }).tenant_manifest;
    body.tenant_identity = {
      ...((body.tenant_identity as Record<string, unknown> | undefined) ?? {}),
      ...operatorStamperVariables(operatorValues),
      [OPERATOR_PROVENANCE_KEY]: operatorValueProvenance(operatorValues, input.simOnly === true),
    };
    // W1: the further values (approver, admin, IP range, ToU file, subscription,
    // baseline template, role ids), each with its provenance in the same block.
    if (input.facts) {
      const ti = body.tenant_identity as Record<string, unknown> & { [OPERATOR_PROVENANCE_KEY]: { values: Record<string, string> } };
      for (const s of buildSuppliedOperatorValues(input.facts).values) {
        ti[s.stamperVar] = s.value;
        ti[OPERATOR_PROVENANCE_KEY].values[s.stamperVar] = s.provenance;
      }
    }
  }

  // W3 (CONTRACT CHANGE, MG-27): the values Muster derived go onto the
  // verification rows as expected_value (machine rows without one are marked
  // presence_only); no row is added or removed.
  {
    const body = (tenantManifest as unknown as { tenant_manifest: Record<string, unknown> }).tenant_manifest;
    annotateVerificationRows(body.normative_controls as Parameters<typeof annotateVerificationRows>[0], {
      tenantIdentity: body.tenant_identity as Record<string, unknown> | undefined,
      policyValues: banks.policyInputsBank ? resolveDefaultedPolicyValues(input.facts ?? [], banks.policyInputsBank) : {},
      sitAnswers: input.sitAnswers,
    });
  }

  // W4-MU1: the vendored generator returns null for m365_only; the decoration
  // adds the body's infrastructure_model (+ cesId) for the shared contract.
  const rawInfra = c.tenantConfig ? generateInfrastructureManifest(c.siBaseline, c.tenantConfig) : null;
  const infrastructureManifest = rawInfra
    ? decorateInfraManifest(rawInfra, c.siBaseline, c.tenantConfig, input.cesId, input.provisioning)
    : null;

  // FC-MU-4 step 2 (founder decision 2026-09-28 #11): m365-only sessions build
  // no Infra Manifest, so the approver UPN, ToU file and initial-password
  // reference travel on the Tenant Manifest's provisioning_inputs instead
  // (ces-shared 2.8.0 TenantManifestBodySchema.provisioning_inputs). Never both:
  // when an Infra Manifest exists, it is the sole carrier (unchanged MS-5 path).
  if (!infrastructureManifest) {
    const provisioningInputs = provisioningInputsForTenantManifest(input.provisioning);
    if (provisioningInputs) {
      (tenantManifest as unknown as { tenant_manifest: Record<string, unknown> }).tenant_manifest.provisioning_inputs =
        provisioningInputs;
    }
  }

  const missionPlan = generateManualPlan(
    c.siBaseline,
    c.posture,
    c.taskCatalog,
    c.planMode,
    banks.assessorKB,
    c.vendorCapabilities,
    c.cuiBoundary, // MG-08
    c.btcConfirmation, // MG-09
    c.tenantConfig,
    c.gapSet.scopeExclusions,
    c.gapSet.controlDispositions,
    c.gapSet.warnings,
    input.cesId
  );
  // W5c3: a Non-Stack control Stamper can configure is an implement directive.
  const directivePromotions = promoteConfigurableManualDirectives(missionPlan);

  return {
    siBaseline: c.siBaseline,
    tenantManifest,
    infrastructureManifest,
    missionPlan,
    tenantConfig: c.tenantConfig,
    cuiBoundary: c.cuiBoundary,
    btcConfirmation: c.btcConfirmation,
    btcUnanswered: c.btcUnanswered,
    gapSet: c.gapSet,
    taskCatalog: c.taskCatalog,
    taskCount: c.taskCatalog.tasks.length,
    directivePromotions,
  };
}

/**
 * Produce the Planner Tenant + Infrastructure manifests from Muster inputs via
 * the vendored compiler chain. Pure: banks injected, no fetch. Delegates to
 * buildPlanArtifacts (one compile) — kept as a narrower entry point for the
 * PLAN-2 tests.
 */
export function buildTenantManifest(
  input: TenantManifestInputs,
  banks: CompilerBanks
): TenantManifestResult {
  const a = buildPlanArtifacts(input, banks);
  return {
    siBaseline: a.siBaseline,
    tenantManifest: a.tenantManifest,
    infrastructureManifest: a.infrastructureManifest,
    taskCount: a.taskCount,
  };
}

/**
 * G-MUSTER-PLAN-2 M2 slice 4: the Manual Mission Plan — Planner's headline
 * artifact (the one ces-tester drives Stamper with). Delegates to
 * buildPlanArtifacts (one compile). Scope exclusions and control dispositions
 * come from the gap set (the compiler's own decisions), never re-derived.
 */
export function buildManualPlan(input: TenantManifestInputs, banks: CompilerBanks): ManualPlanResult {
  const a = buildPlanArtifacts(input, banks);
  return { siBaseline: a.siBaseline, missionPlan: a.missionPlan, taskCount: a.taskCount };
}

export type { SiBaselineInputs };

/**
 * W6 (run 56): copy the BTC Confirmation's risk flags onto the CUI boundary as
 * `boundary_risk_flags` (one line each: `<flag> (<severity>, <domain>; <rule>):
 * <description>`). No flags: the boundary is left as it is.
 */
export function attachBoundaryRiskFlags(cuiBoundary: CUIBoundaryOutput, btc: BTCConfirmationOutput): string[] {
  const flags = btc.btc_confirmation?.risk_flags ?? [];
  if (flags.length === 0) return [];
  const lines = flags.map((f) => `${f.flag_id} (${f.severity}, ${f.domain}; ${f.source_rule_id}): ${f.description}`);
  cuiBoundary.cui_boundary.boundary_risk_flags = lines;
  return lines;
}
