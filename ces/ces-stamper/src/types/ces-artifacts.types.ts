// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { z } from 'zod';
import {
  ManualMissionPlanSchema as SharedManualMissionPlanSchema,
  TenantManifestSchema as SharedTenantManifestSchema,
  TenantManifestBodySchema as SharedTenantManifestBodySchema,
  InfraManifestSchema as SharedInfraManifestSchema,
  StamperDirective as SharedStamperDirective,
  SUPPORTED_PLAN_VERSIONS,
} from 'ces-shared/types/mission-plan';
import type {
  HumanReadableMissionPlan,
  ManualStep,
  TenantManifestBody,
  TenantManifest,
  InfraManifest,
  InfrastructureBody,
  ControlDirective,
  ControlDisposition,
  ScopeExclusion,
  StamperDirectiveType,
} from 'ces-shared/types/mission-plan';

// ════════════════════════════════════════════════════════════════
// MS-R1 / N-12 / N-14 (T4): mission-plan body validation is delegated to
// ces-shared (`ces-shared/types/mission-plan`). Stamper no longer defines its
// own Manual Mission Plan, Tenant Manifest, Infrastructure Manifest or
// directive schemas. The exported CES*Schema names below ARE the shared
// schemas, with Stamper-only refinements layered on via `.superRefine` —
// never a fork. The canonical infra envelope key is `infrastructure`; the
// deprecated `infrastructure_manifest` alias is normalized by ces-shared.
// ════════════════════════════════════════════════════════════════

// ─── Enums still owned by Stamper (Tech Ref guide, not a mission-plan body) ──

export const CESLevelEnum = z.enum(['L1', 'L2', 'L3']);
export const CESStatusEnum = z.enum(['MET', 'PARTIAL', 'NOT_MET', 'UNKNOWN']);
export const CESStrengthEnum = z.enum(['strong', 'adequate', 'weak']);
export const CESAssessorMethodEnum = z.enum(['examine', 'interview', 'test']);

// Stamper-only refinement: infra-plan steps carry one of these seven sections.
export const CESInfraSectionEnum = z.enum([
  'identity', 'logging', 'security', 'storage', 'network', 'automation', 'diagnostics'
]);

// Backward-compat meta schema (used by the Tech Ref guide only).
export const CESMetaSchema = z.object({
  artifact: z.string().min(1),
  version: z.string().min(1),
  generated_on: z.string().min(1),
  intent: z.string().min(1)
});

// ─── Tech Ref Implementation Guide Types ────────────────────────

export const CESPostureSummarySchema = z.object({
  met: z.number().int().min(0),
  partial: z.number().int().min(0),
  not_met: z.number().int().min(0),
  unknown: z.number().int().min(0)
});

export const CESAssessmentObjectiveSchema = z.object({
  id: z.string(),
  text: z.string()
});

export const CESDocLinkSchema = z.object({
  text: z.string(),
  url: z.string()
});

export const CESParagraphSchema = z.object({
  text: z.string(),
  text_with_links: z.string(),
  links: z.array(CESDocLinkSchema)
});

export const CESServiceImplementationSchema = z.object({
  service_name: z.string().min(1),
  paragraphs: z.array(CESParagraphSchema)
});

export const CESGCCHResponsibilitySchema = z.object({
  text: z.string(),
  text_with_links: z.string()
});

export const CESStrengthExampleSchema = z.object({
  strength: CESStrengthEnum,
  description: z.string()
});

export const CESEvidenceArchetypeSchema = z.object({
  archetype_id: z.string(),
  name: z.string(),
  description: z.string(),
  strength: CESStrengthEnum,
  strength_examples: z.array(CESStrengthExampleSchema),
  acceptable_forms: z.array(z.string()),
  collection_notes: z.string(),
  retention_notes: z.string()
});

export const CESEvidenceBlockSchema = z.object({
  assessor_methods: z.array(CESAssessorMethodEnum),
  archetypes: z.array(CESEvidenceArchetypeSchema),
  anti_patterns: z.array(z.string())
});

export const CESTechRefControlSchema = z.object({
  control_id: z.string(),
  cmmc_level: z.number().int(),
  practice: z.string(),
  nist_mapping: z.string(),
  status: CESStatusEnum,
  assessment_objectives: z.array(CESAssessmentObjectiveSchema),
  primary_services: z.array(z.string()),
  secondary_services: z.array(z.string()),
  implementation_by_service: z.array(CESServiceImplementationSchema),
  gcch_responsibilities: z.array(CESGCCHResponsibilitySchema),
  evidence: CESEvidenceBlockSchema
});

export const CESTechRefControlFamilySchema = z.object({
  abbreviation: z.string().min(1),
  name: z.string().min(1),
  controls: z.array(CESTechRefControlSchema)
});

export const CESTechRefImplementationGuideSchema = z.object({
  ces: CESMetaSchema,
  target_level: CESLevelEnum,
  posture_summary: CESPostureSummarySchema,
  control_families: z.array(CESTechRefControlFamilySchema)
});

// ─── Step-level Tech Ref (Stamper-only refinement of step.tech_ref) ──
// ces-shared types `tech_ref` as an open record; Stamper requires this shape.

export const CESStepTechRefSchema = z.object({
  assessment_objectives: z.array(CESAssessmentObjectiveSchema),
  nist_mapping: z.string(),
  implementation_by_service: z.array(CESServiceImplementationSchema),
  gcch_responsibilities: z.array(CESGCCHResponsibilitySchema),
  evidence_guidance: z.object({
    assessor_methods: z.array(z.string()),
    archetypes: z.array(z.object({
      archetype_id: z.string(),
      name: z.string(),
      strength: z.string(),
      strength_examples: z.array(z.object({
        strength: z.string(),
        description: z.string(),
      })),
    })),
    anti_patterns: z.array(z.string()),
  }).optional(),
});

// ════════════════════════════════════════════════════════════════
// Stamper-only refinements (stricter than the shared contract).
// Each rule re-checks a value the shared schema already accepted, using a
// small zod schema so error messages stay zod-shaped, with the full path.
// ════════════════════════════════════════════════════════════════

type Path = (string | number)[];

function refineWith(schema: z.ZodTypeAny, value: unknown, ctx: z.RefinementCtx, path: Path): void {
  if (value === undefined) return;
  const r = schema.safeParse(value);
  if (!r.success) {
    for (const issue of r.error.issues) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue.message, path: [...path, ...issue.path] });
    }
  }
}

const NonEmptyStringArray = z.array(z.string().min(1));
const NonEmptyStringArrayMin1 = z.array(z.string().min(1)).min(1);

function refineManualStep(step: Record<string, unknown>, ctx: z.RefinementCtx, path: Path): void {
  refineWith(CESInfraSectionEnum, step.section, ctx, [...path, 'section']);
  refineWith(CESStepTechRefSchema, step.tech_ref, ctx, [...path, 'tech_ref']);
  refineWith(NonEmptyStringArray, step.dependencies, ctx, [...path, 'dependencies']);
}

function refineTenantManifestBody(body: Record<string, unknown>, ctx: z.RefinementCtx, path: Path): void {
  const assets = Array.isArray(body.assets) ? body.assets : [];
  assets.forEach((a: any, i: number) => refineWith(NonEmptyStringArray, a?.tags, ctx, [...path, 'assets', i, 'tags']));
}

function refineHumanPlan(plan: Record<string, any>, ctx: z.RefinementCtx, path: Path): void {
  refineWith(z.array(z.any()).min(1), plan.milestones, ctx, [...path, 'milestones']);
  (Array.isArray(plan.milestones) ? plan.milestones : []).forEach((m: any, i: number) =>
    refineWith(NonEmptyStringArrayMin1, m?.exit_criteria, ctx, [...path, 'milestones', i, 'exit_criteria']));
  // FX-ST1 / MS-R11: an all-met plan from Muster's real generator has `steps: []`
  // and carries its work in control_directives[] (validate/manual). ces-shared
  // accepts it, so Stamper does too. Only a plan with NO directives (legacy
  // step mode — nothing else to translate) must still carry at least one step.
  const hasDirectives = Array.isArray(plan.control_directives) && plan.control_directives.length > 0;
  if (!hasDirectives) refineWith(z.array(z.any()).min(1), plan.steps, ctx, [...path, 'steps']);
  (Array.isArray(plan.steps) ? plan.steps : []).forEach((s: any, i: number) =>
    refineManualStep(s ?? {}, ctx, [...path, 'steps', i]));
}

// ─── Manual Mission Plan ────────────────────────────────────────
// ces-shared types ManualMissionPlanSchema's output as Record<string, unknown>
// (see docs/requirements/REQ-ces-shared-mission-plan-typed-output.md), so the
// parsed-output shape is declared here as a TYPE over the shared body types.

export interface CESPlanMeta {
  artifact: 'manual_mission_plan';
  version: (typeof SUPPORTED_PLAN_VERSIONS)[number];
  generated_on: string;
  intent: string;
  cesId?: string;
  customerId?: number;
  siBaselineId?: number;
  customerName?: string;
  [k: string]: unknown;
}

export interface CESManualMissionPlan {
  ces: CESPlanMeta;
  inputs?: unknown;
  outputs: {
    human_readable_mission_plan: HumanReadableMissionPlan;
    cost_proposal_sow?: unknown;
    tenant_manifest?: TenantManifestBody;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export const CESManualMissionPlanSchema = SharedManualMissionPlanSchema.superRefine((raw, ctx) => {
  const outputs = (raw as any)?.outputs ?? {};
  refineHumanPlan(outputs.human_readable_mission_plan ?? {}, ctx, ['outputs', 'human_readable_mission_plan']);
  if (outputs.tenant_manifest) refineTenantManifestBody(outputs.tenant_manifest, ctx, ['outputs', 'tenant_manifest']);
}) as unknown as z.ZodType<CESManualMissionPlan, z.ZodTypeDef, unknown>;

// ─── Tenant Manifest ────────────────────────────────────────────

export const CESTenantManifestBodySchema = SharedTenantManifestBodySchema.superRefine((body, ctx) =>
  refineTenantManifestBody(body, ctx, []));

export const CESTenantManifestSchema = SharedTenantManifestSchema.superRefine((m, ctx) =>
  refineTenantManifestBody(m.tenant_manifest, ctx, ['tenant_manifest']));

// ─── Infrastructure Manifest ────────────────────────────────────
// Read the canonical `infrastructure` key; ces-shared maps the deprecated
// `infrastructure_manifest` alias onto it. Stamper-only: generated_on must be
// an ISO 8601 date-time (shared accepts any non-empty string).

export const CESInfrastructureManifestSchema = SharedInfraManifestSchema.superRefine((m, ctx) =>
  refineWith(z.string().datetime(), m.ces.generated_on, ctx, ['ces', 'generated_on']));

// ─── Directives ─────────────────────────────────────────────────

export const StamperDirectiveEnum = SharedStamperDirective;
export type StamperDirective = StamperDirectiveType;

export interface EnrichedScopeExclusion {
  requirement_id: string;
  justification: string;
  si_field: string;
  si_value: string;
  nist_ref: string;
  sprs_weight: 1 | 3 | 5;
}

// ─── Per-Control Execution Results ──────────────────────────────

export const ControlExecutionResultSchema = z.object({
  controlId: z.string(),
  directive: z.enum(['automated', 'validation', 'manual_gate', 'document-absence', 'document-prohibition', 'document-renderable', 'inherit-fedramp', 'eo-tooled', 'nonstack', 'skip']),
  verdict: z.enum(['SAT', 'NOT_SAT', 'PROVISIONAL', 'N/A']),
  outcome: z.string(),
  evidencePath: z.string().optional(),
  timestampUtc: z.string(),
});

export type ControlExecutionResult = z.infer<typeof ControlExecutionResultSchema>;

export const ExecutionResultsManifestSchema = z.object({
  contractVersion: z.string(),
  runId: z.string(),
  planId: z.string(),
  cesId: z.string().optional(),
  tenantSlug: z.string(),
  completedAt: z.string(),
  totalControls: z.number(),
  results: z.array(ControlExecutionResultSchema),
});

export type ExecutionResultsManifest = z.infer<typeof ExecutionResultsManifestSchema>;

// ─── Stamper Action Directive Normalization ──────────────────────

export type StamperActionDirective = 'automated' | 'document-absence' | 'document-prohibition' | 'document-renderable' | 'inherit-fedramp' | 'eo-tooled' | 'nonstack';

export function normalizeStamperAction(raw: string): StamperActionDirective {
  if (raw === 'exclude') {
    throw new Error('Legacy exclude directive received — Planner/Stamper version mismatch');
  }
  const key = raw.toLowerCase().replace(/-/g, '');
  switch (key) {
    case 'automated':
    case 'implement':
    case 'manual_gate':
    case 'manualgate':
      return 'automated';
    case 'documentabsence':
    case 'nacapabilityabsent':
      return 'document-absence';
    case 'documentprohibition':
    case 'metbyprohibition':
      return 'document-prohibition';
    case 'documentrenderable':
      return 'document-renderable';
    case 'nonstack':
      return 'nonstack';
    case 'inheritfedramp':
    case 'inheritedfedramp':
      return 'inherit-fedramp';
    case 'eotooled':
      return 'eo-tooled';
    default:
      throw new Error(`Unknown stamper_action "${raw}" — update normalizeStamperAction or fix the upstream emitter`);
  }
}

// ─── Type Exports (aliases over the shared contract types) ──────

export type MPControl = ControlDisposition;
export type CESHumanPlan = HumanReadableMissionPlan;
export type CESManualStep = ManualStep;
export type CESControlDirective = ControlDirective;
export type CESScopeExclusion = ScopeExclusion;
export type CESScopeExclusionInferred = ScopeExclusion;
export type CESTenantManifestBody = TenantManifestBody;
export type CESTenantManifest = TenantManifest;
export type CESNormativeControl = TenantManifestBody['normative_controls'][number];
export type CESConfigIntent = TenantManifestBody['config_intents'][number];
export type CESEvidenceMonitor = TenantManifestBody['evidence_monitors'][number];
export type CESDriftPolicy = TenantManifestBody['drift_policies'][number];
export type CESInfrastructureManifest = InfraManifest;
export type CESInfrastructureManifestBody = InfrastructureBody;

export type CESMeta = z.infer<typeof CESMetaSchema>;
export type CESTechRefControl = z.infer<typeof CESTechRefControlSchema>;
export type CESTechRefImplementationGuide = z.infer<typeof CESTechRefImplementationGuideSchema>;
export type CESEvidenceArchetype = z.infer<typeof CESEvidenceArchetypeSchema>;
export type CESEvidenceBlock = z.infer<typeof CESEvidenceBlockSchema>;
export type CESGCCHResponsibility = z.infer<typeof CESGCCHResponsibilitySchema>;
export type CESStepTechRef = z.infer<typeof CESStepTechRefSchema>;
