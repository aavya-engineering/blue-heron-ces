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
import { compileGapSet } from '@/vendored/ces-planner/mpt/services/gapCompiler';
import { compileTaskCatalog } from '@/vendored/ces-planner/mpt/services/taskCompiler';
import { generateTenantManifest } from '@/vendored/ces-planner/mpt/services/manifestGenerator';
import { generateInfrastructureManifest } from '@/vendored/ces-planner/mpt/services/infraManifestGenerator';
import { generateManualPlan } from '@/vendored/ces-planner/mpt/services/manualPlanGenerator';
import { buildTechRefIndex, type TechRefIndex } from '@/vendored/ces-planner/shared/services/techRefIndex';
import type { TechRefCMMCL2 } from '@/vendored/ces-planner/shared/types/domain';
import type { FedRAMPInheritanceTable } from '@/vendored/ces-planner/mpt/services/fedrampInheritance';
import type { PlanMode, TaskCatalog, GapSet } from '@/vendored/ces-planner/mpt/types';
import type {
  ReadinessPosture,
  SIBaseline,
  TenantManifest,
  ManualMissionPlan,
  TenantConfigProfileOutput,
} from '@/vendored/ces-planner/shared/types/artifacts';
import { buildSiBaselineFromAnswers, type SiBaselineInputs, type SiQuestionBank } from './siBaselineAdapter';
import {
  decorateInfraManifest,
  provisioningInputsForTenantManifest,
  type EmittedInfraManifest,
  type TcpQuestionBank,
} from './tcpAdapter';
import type { SITAnswer } from '@/vendored/ces-planner/types/siBaseline';

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
  cesId?: string;
  /** FC-MU-2 (MS-5): the Tenant Config intake's provisioning inputs (Infra Manifest only). */
  provisioning?: import('./provisioningInputs').ProvisioningInputs;
}

/**
 * Bridge Muster's requirement_results into the ces-planner ReadinessPosture
 * shape the gap compiler reads. gapCompiler only consumes
 * `ces.requirement_results[].{requirement_id, status}` and evidence_refs, so a
 * minimal envelope is faithful; the rest of the posture is metadata the
 * compiler does not read.
 */
function bridgePosture(results: MusterRequirementResult[], siBaselineRefHash: string): ReadinessPosture {
  return {
    ces: {
      artifact: 'CES_READINESS_POSTURE',
      version: '1.0.0',
      generated_on: '1970-01-01',
      snapshot_id: 'muster-plan-mode',
      as_of_date: '1970-01-01',
      si_baseline_ref: { artifact_id: siBaselineRefHash, hash: siBaselineRefHash },
      rr_question_set_ref: { artifact_id: 'n/a', hash: 'n/a' },
      control_status_summary: {} as never,
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
}

function compilePlan(input: TenantManifestInputs, banks: CompilerBanks): CompiledPlan {
  if (!banks.siQuestionBank) {
    throw new Error(
      'compilePlan requires banks.siQuestionBank (the primed SI Question Bank) — the SI answers map to si_baseline.* through its sets_its_fields.'
    );
  }
  const siBaseline = buildSiBaselineFromAnswers(input.sitAnswers, banks.siQuestionBank, input.cesId);
  const tenantConfig =
    input.tenantConfig ?? (input.resolveTenantConfig ? input.resolveTenantConfig(siBaseline) : null);
  const vendorCapabilities = { patterns: banks.patterns, playbook: banks.playbook };
  const posture = bridgePosture(input.requirementResults, siBaseline.ces.cesId ?? 'muster');

  // M0: the TechRefIndex is built here, on the single compile path, so every
  // output that reads the catalog sees the same index and it is never rebuilt
  // per artifact. Absent techRef -> undefined arg (pre-M0 behaviour).
  const techRefIndex: TechRefIndex | undefined = banks.techRef
    ? buildTechRefIndex(banks.techRef)
    : undefined;

  const gapSet = compileGapSet(
    siBaseline,
    posture,
    banks.cmmcRequirements,
    banks.evidenceMatrix,
    vendorCapabilities,
    null, // btcConfirmation (M2)
    null, // cuiBoundary (M2)
    banks.inheritanceTable ?? null // M0 wire: FedRAMP inheritance table (arg 8)
  );

  const taskCatalog = compileTaskCatalog(
    gapSet,
    siBaseline,
    vendorCapabilities,
    banks.assessorKB,
    banks.cmmcRequirements,
    banks.evidenceArchetypeCatalog,
    techRefIndex, // M0 wire: GCC-High G5 tech-ref index (arg 7)
    null, // btcConfirmation
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
  taskCount: number;
}

export function buildPlanArtifacts(input: TenantManifestInputs, banks: CompilerBanks): PlanArtifacts {
  const c = compilePlan(input, banks);

  const tenantManifest = generateTenantManifest(
    c.siBaseline,
    c.planMode,
    c.taskCatalog,
    banks.assessorKB,
    null, // cuiBoundary (M2)
    null, // btcConfirmation (M2)
    c.tenantConfig,
    input.cesId
  );

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
    null, // cuiBoundary (M2)
    null, // btcConfirmation (M2)
    c.tenantConfig,
    c.gapSet.scopeExclusions,
    c.gapSet.controlDispositions,
    c.gapSet.warnings,
    input.cesId
  );

  return {
    siBaseline: c.siBaseline,
    tenantManifest,
    infrastructureManifest,
    missionPlan,
    tenantConfig: c.tenantConfig,
    taskCount: c.taskCatalog.tasks.length,
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
