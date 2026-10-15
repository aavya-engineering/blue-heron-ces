// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FE-safe mission-plan contract (MS-R1 + MS-R4). Zero node:* imports.
// Shared Zod schema for the Manual Mission Plan, Tenant Manifest, and
// Infrastructure Manifest that cross the Muster → Stamper boundary.

import { z } from 'zod';
import {
  ManualStepSchema,
  TenantManifestBodySchema,
  InfrastructureBodySchema,
  INFRA_VARIABLE_ALIASES,
  normalizeInfraVariableMap,
  SECRET_VARIABLE_NAMES,
} from './mission-plan.bodies.js';

export { ManualStepSchema, TenantManifestBodySchema, InfrastructureBodySchema };
export type { ManualStep, TenantManifestBody, InfrastructureBody } from './mission-plan.bodies.js';
// FX-SH2: make every body sub-schema (CheckSchema, NormativeControlSchema, …)
// reachable through the ./types/mission-plan package export.
export * from './mission-plan.bodies.js';

export const MISSION_PLAN_CONTRACT_VERSION = '1.0.0';
export const SUPPORTED_PLAN_VERSIONS = ['1.0.0'] as const;

// ─── Stamper Action (Muster's 5 disposition values) ──────────────

export const StamperAction = z.enum([
  'Automated',
  'Non-Stack',
  'N-A-Capability-Absent',
  'Met-By-Prohibition',
  'Inherited-FedRAMP',
]);
export type StamperActionType = z.infer<typeof StamperAction>;

// ─── Stamper Directive (9-value superset consumed by Stamper) ────

export const StamperDirective = z.enum([
  'implement',
  'validate',
  'manual',
  'document-absence',
  'document-prohibition',
  'document-renderable',
  'inherit-fedramp',
  'eo-tooled',
  'skip',
]);
export type StamperDirectiveType = z.infer<typeof StamperDirective>;

// ─── Plan Mode ───────────────────────────────────────────────────

export const PlanMode = z.enum(['build_new', 'harden_existing', 'migrate', 'hybrid']);
export type PlanModeType = z.infer<typeof PlanMode>;

// ─── CMMC Level ──────────────────────────────────────────────────

export const CmmcLevel = z.enum(['L1', 'L2', 'L3']);
export type CmmcLevelType = z.infer<typeof CmmcLevel>;

// ─── CES Metadata envelope ───────────────────────────────────────
// MP uses date-only generated_on; TM uses ISO 8601 datetime.

export const CesPlanMetaSchema = z.object({
  artifact: z.literal('manual_mission_plan'),
  version: z.enum(SUPPORTED_PLAN_VERSIONS),
  generated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  intent: z.string().min(1),
  // MS-R4: identity propagation
  cesId: z.string().optional(),
  customerId: z.number().int().optional(),
  siBaselineId: z.number().int().optional(),
  customerName: z.string().optional(),
}).passthrough();
export type CesPlanMeta = z.infer<typeof CesPlanMetaSchema>;
/** @deprecated internal alias kept for readability; use CesPlanMetaSchema. */
const CesPlanMeta = CesPlanMetaSchema;

export const CesManifestMetaSchema = z.object({
  artifact: z.literal('tenant_manifest'),
  version: z.enum(SUPPORTED_PLAN_VERSIONS),
  generated_on: z.string().datetime(),
  intent: z.string().min(1),
  inputs: z.record(z.any()).optional(),
  cesId: z.string().optional(),
  customerId: z.number().int().optional(),
  siBaselineId: z.number().int().optional(),
  customerName: z.string().optional(),
}).passthrough();
export type CesManifestMeta = z.infer<typeof CesManifestMetaSchema>;
const CesManifestMeta = CesManifestMetaSchema;

export const CesInfraMetaSchema = z.object({
  artifact: z.literal('infrastructure_manifest'),
  version: z.enum(SUPPORTED_PLAN_VERSIONS),
  generated_on: z.string().min(1),
  intent: z.string().min(1),
  cesId: z.string().optional(),
  customerId: z.number().int().optional(),
}).passthrough();
export type CesInfraMeta = z.infer<typeof CesInfraMetaSchema>;
const CesInfraMeta = CesInfraMetaSchema;

// ─── Control Disposition (Muster's controls[]) ──────────────────

export const ControlDispositionSchema = z.object({
  requirement_id: z.string().min(1),
  title: z.string(),
  domain: z.string(),
  level: z.string(),
  scope_status: z.enum(['in_scope', 'scoped_out']),
  scope_justification: z.string().optional(),
  si_decision: z.object({ field: z.string(), value: z.string() }).optional(),
  readiness_status: z.enum(['met', 'partial', 'not_met', 'unknown']).optional(),
  stamper_action: StamperAction,
  task_ids: z.array(z.string()),
  estimated_effort_hours: z.number().min(0),
  gap_classifications: z.array(z.string()),
  // MS-R4: inheritance metadata
  inheritance_rationale: z.string().optional(),
  fedramp_package_id: z.string().optional(),
  requires_stamper_verification: z.boolean().optional(),
}).passthrough();
export type ControlDisposition = z.infer<typeof ControlDispositionSchema>;

// ─── Control Directive (per-control intent for Stamper) ──────────

export const ControlDirectiveSchema = z.object({
  control_id: z.string().min(1),
  directive: StamperDirective,
  justification: z.string().optional(),
  step_ids: z.array(z.string()).optional(),
  // MS-R4: inheritance metadata
  inheritance_rationale: z.string().optional(),
  fedramp_package_id: z.string().optional(),
  tenant_variant: z.string().optional(),
  requires_stamper_verification: z.boolean().optional(),
}).passthrough();
export type ControlDirective = z.infer<typeof ControlDirectiveSchema>;

// ─── Scope Exclusion ─────────────────────────────────────────────

export const ScopeExclusionSchema = z.object({
  requirement_id: z.string().min(1),
  justification: z.string().min(1),
  si_field: z.string().min(1),
  si_value: z.string().min(1),
  kind: z.enum(['capability-absent', 'prohibition']).optional(),
  requires_rr_validation: z.boolean().optional(),
}).passthrough();
export type ScopeExclusion = z.infer<typeof ScopeExclusionSchema>;

// ─── Milestone ───────────────────────────────────────────────────

export const MilestoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  objective: z.string().min(1),
  exit_criteria: z.array(z.string()),
  target_date: z.string().min(1),
  phase_tasks: z.array(z.string()).optional(),
}).passthrough();
export type Milestone = z.infer<typeof MilestoneSchema>;

// ─── Human-Readable Mission Plan body ────────────────────────────

export const HumanReadableMissionPlanSchema = z.object({
  plan_id: z.string().min(1),
  plan_mode: PlanMode,
  target_level: CmmcLevel,
  disposition_summary: z.record(z.any()).optional(),
  milestones: z.array(MilestoneSchema),
  steps: z.array(ManualStepSchema).optional(),
  assessor_alignment_notes: z.array(z.string()),
  boundary_context: z.record(z.any()).optional(),
  scope_exclusions: z.array(ScopeExclusionSchema).optional(),
  scope_exclusion_warnings: z.array(z.string()).optional(),
  controls: z.array(ControlDispositionSchema).optional(),
  control_directives: z.array(ControlDirectiveSchema).optional(),
  advisories: z.array(z.any()).optional(),
  license_tier_matrix: z.any().optional(),
}).passthrough();
export type HumanReadableMissionPlan = z.infer<typeof HumanReadableMissionPlanSchema>;

// ─── Outputs block ───────────────────────────────────────────────

export const OutputsBlockSchema = z.object({
  human_readable_mission_plan: HumanReadableMissionPlanSchema,
  cost_proposal_sow: z.any().optional(),
  tenant_manifest: TenantManifestBodySchema.optional(),
}).passthrough();
export type OutputsBlock = z.infer<typeof OutputsBlockSchema>;
export type OutputsBlockInput = z.input<typeof OutputsBlockSchema>;

// ─── Manual Mission Plan (full envelope) ─────────────────────────
// FX-SH2 (REQ-ces-shared-mission-plan-typed-output): the inferred ZodObject type
// is too long for declaration emit (TS7056), so the schema is annotated with
// NAMED interfaces for its output and input. Consumers get a typed parse result
// (ces.cesId, outputs.human_readable_mission_plan.steps, outputs.tenant_manifest)
// without casting. Unknown keys pass through at every level.

/** Parsed (output) shape of ManualMissionPlanSchema. */
export interface ManualMissionPlanParsed {
  ces: CesPlanMeta;
  inputs?: any;
  outputs: OutputsBlock;
  [k: string]: unknown;
}

/** Input shape accepted by ManualMissionPlanSchema. */
export interface ManualMissionPlanInput {
  ces: z.input<typeof CesPlanMetaSchema>;
  inputs?: any;
  outputs: OutputsBlockInput;
  [k: string]: unknown;
}

export const ManualMissionPlanSchema: z.ZodType<ManualMissionPlanParsed, z.ZodTypeDef, ManualMissionPlanInput> = z.object({
  ces: CesPlanMeta,
  inputs: z.any(),
  outputs: OutputsBlockSchema,
}).passthrough();
/** Input shape (kept as z.input for backward compatibility of the name). */
export type ManualMissionPlan = z.input<typeof ManualMissionPlanSchema>;

// ─── Tenant Manifest ─────────────────────────────────────────────
// The manifest body is large and varies by tech stack.
// We validate the envelope and let the body pass through.

export const TenantManifestSchema = z.object({
  ces: CesManifestMeta,
  tenant_manifest: TenantManifestBodySchema,
}).passthrough();
export type TenantManifest = z.infer<typeof TenantManifestSchema>;

// ─── Infrastructure Manifest (optional, not yet produced) ────────
// Canonical key is `infrastructure`. Stamper uses `infrastructure_manifest`
// (N-12); accept it as a deprecated alias, normalized onto `infrastructure`.

export const InfraManifestSchema = z.object({
  ces: CesInfraMeta,
  infrastructure: InfrastructureBodySchema.optional(),
  infrastructure_manifest: InfrastructureBodySchema.optional(),
}).passthrough().superRefine((val, ctx) => {
  if (!val.infrastructure && !val.infrastructure_manifest) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either infrastructure or infrastructure_manifest is required',
      path: ['infrastructure'],
    });
  }
  if (val.infrastructure && val.infrastructure_manifest) {
    if (JSON.stringify(val.infrastructure) !== JSON.stringify(val.infrastructure_manifest)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Both infrastructure and infrastructure_manifest are present with different values',
        path: ['infrastructure_manifest'],
      });
    }
  }
  // W4-SH2: an alias variable (e.g. Muster's fwSubnetCidr) must not contradict its canonical name.
  const body = val.infrastructure ?? val.infrastructure_manifest;
  const vm = body?.stamper_variable_map as Record<string, unknown> | undefined;
  const infraKey = val.infrastructure ? 'infrastructure' : 'infrastructure_manifest';
  if (vm) {
    for (const [alias, canonical] of Object.entries(INFRA_VARIABLE_ALIASES)) {
      const a = vm[alias]; const c = vm[canonical];
      if (typeof a === 'string' && a !== '' && typeof c === 'string' && c !== '' && a !== c) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `stamper_variable_map.${alias} (deprecated alias) conflicts with ${canonical}`,
          path: [infraKey, 'stamper_variable_map', alias],
        });
      }
    }
    // FC-SH step 1 (REQ-ces-shared-im-secret-values): a secret variable (e.g. initialPassword) must
    // never carry a plain value in stamper_variable_map — only a SecretReference in
    // secret_references[] resolves it. Catches both the always-forbidden names and any variable
    // this manifest itself declares as secret via secret_references[].variable.
    const secretRefVars = new Set<string>(SECRET_VARIABLE_NAMES);
    for (const ref of (body?.secret_references ?? [])) {
      if (ref && typeof ref.variable === 'string') secretRefVars.add(ref.variable);
    }
    for (const name of secretRefVars) {
      const v = vm[name];
      if (typeof v === 'string' && v !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `stamper_variable_map.${name} must not hold a plain value — it is a secret variable and must be resolved via secret_references`,
          path: [infraKey, 'stamper_variable_map', name],
        });
      }
    }
  }
}).transform(({ infrastructure_manifest, ...rest }) => {
  const body = rest.infrastructure ?? infrastructure_manifest!;
  return {
    ...rest,
    infrastructure: { ...body, stamper_variable_map: normalizeInfraVariableMap(body.stamper_variable_map) },
  };
});
export type InfraManifest = z.output<typeof InfraManifestSchema>;
