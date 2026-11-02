// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { z } from 'zod';
import { EngineEnum, SubCommandIdempotencyEnum, CaptureSpecSchema, VerificationCriteriaSchema, DestructiveGuardSchema, LookupBlockSchema } from '../types/schema.types.js';

// Re-export for consumers that import from here
export type { VerificationCriteria, LookupBlock, LookupCondition, LookupEffect } from '../types/schema.types.js';

// synthetic-customer W5 cycle 2: a numeric value the SET hard-codes that the organisation can set
// through a TM verification row's `expected_value` (same `path`, `op` lte/gte) on one of the entry's
// controls. `token` is the hashtable key in set_command, `default` the registry value it carries.
// W5c7: op 'equals' binds a string the SET assigns to a PowerShell variable (`$<token>='<default>'`,
// the time-sync NTP server); the organisation's answered value replaces it as given (orgValues.ts).
export const OrgValueBindingSchema = z.object({
  path: z.string().min(1),
  token: z.string().min(1),
  op: z.enum(['lte', 'gte', 'equals']),
  default: z.union([z.number(), z.string()]),
  // Run 50 fixes: the TM row path when it differs from this entry's read path (the compliance policy's
  // passwordMinutesOfInactivityBeforeLock takes the screen-lock row's ...BeforeScreenTimeout value).
  tm_path: z.string().min(1).optional(),
  // Run 50 fixes: 'registry' = the exists path checks the registry default, not the organisation value.
  exists_bound: z.literal('registry').optional(),
});

export type OrgValueBinding = z.infer<typeof OrgValueBindingSchema>;

// FIN-15: the registry's cost_gate block (COST-GATE-SPEC §3.3). A local mirror of ces-shared's
// CostGateBlockSchema (types/cost-gate.types.ts): ces-shared's dist/types is not built, so it is not
// imported here. Free reasons are the closed list (per_call_only is gone: per-use billing is recurring).
export const CostGateFreeReasonSchema = z.enum(['no_meter', 'free_source', 'in_licence', 'cost_reducing', 'read_only']);
export const CostGateBlockSchema = z.object({
  recurring: z.boolean(),
  cost_key: z.string().min(1).nullable().optional(),
  estimate_basis: z.string().optional(),
  two_person: z.boolean().optional(),
  irreversible: z.boolean().optional(),
  last_resort: z.boolean().optional(),
  standard_alternative: z.array(z.string().min(1)).optional(),
  free_reason: CostGateFreeReasonSchema.nullable().optional(),
  licence_dependency: z.object({ licence: z.string().min(1), cost_key: z.string().min(1) }).nullable().optional(),
}).passthrough();
export type CostGateBlockEntry = z.infer<typeof CostGateBlockSchema>;

// Single command entry in the registry
export const CommandEntrySchema = z.object({
  entry_id: z.string().min(1),                                       // e.g. "AC.L2-3.1.1.group-create"
  control_ids: z.array(z.string().min(1)).min(1),                    // CMMC control IDs this entry satisfies
  label: z.string().min(1),                                          // human-readable label
  engine: EngineEnum,                                                // mgraph|exchange|ipps|az|spo|teams|manual_gate
  set_command: z.string(),                                           // PowerShell/CLI template with {variable} placeholders (empty for manual_only)
  get_command: z.string(),                                           // Idempotency check / evidence query template
  idempotency: SubCommandIdempotencyEnum,
  variables_required: z.array(z.string()),                           // manifest-provided, validated at translate-time
  variables_runtime: z.array(z.string()),                            // produced by prior commands, validated at execute-time
  captures: z.array(CaptureSpecSchema).default([]),                  // variables this command emits
  layer_hint: z.number().int().min(0).max(8),                        // execution layer 0-8
  sequence_hint: z.number().int().min(0),                            // ordering within a step (lower = first)
  manual_only: z.boolean(),                                          // true = no set_command; evidence/manual gate only
  evidence_commands: z.array(z.string()),                            // GET commands for evidence collection
  on_failure: z.enum(['abort_step', 'abort_plan', 'warn_continue']),
  azure_tier: z.enum(['none', 'foundation', 'sentinel', 'full']).optional().default('none'),
  notes: z.string().optional(),
  verification: VerificationCriteriaSchema.optional(),
  destructive: z.boolean().optional(),                               // FX-01: disables, deletes or removes
  destructive_guard: DestructiveGuardSchema.optional(),              // FX-01: required preconditions when destructive
  org_value_bindings: z.array(OrgValueBindingSchema).optional(),     // W5c2: values the TM's expected_value can set
  // W5c3 part 2: the equivalence lookup. get_command is generated from it (src/registry/lookup.ts,
  // lookupGetCommand) and must equal the generated text. source = PowerShell emitting the candidate
  // objects; by_name = CES's own object ({ path, equals }); by_effect = conditions ({ path, op, value },
  // op one of equals | not_equals | in | contains | all_in | lte | gte | not_empty | empty, or { any_of: [...] };
  // odata_type pins '@odata.type')
  // that all hold for a tenant's equivalent (an Intune object's effect includes $.assignments not_empty:
  // an unassigned policy changes no device). Muster discovery reads this block too.
  lookup: LookupBlockSchema.optional(),
  // W5c3 part 2 follow-up: a read-only (idempotency safe) entry with a lookup and no SET that verifies an object
  // another entry creates (the merged update ring): found -> verified as on the exists path; absent ->
  // a failed record naming the creator. It never creates. Order it after the creator with a capture.
  verify_only: z.boolean().optional(),
  // PH-13 (P13-ST, founder Q3: an empty read is never evidence): an evidence read that reads an object another entry
  // creates later in the plan names that entry here; the translator orders the read's task after the creator's task
  // (captureDependencies.ts orderByReadAfter), so the read is not empty by ordering alone.
  read_after: z.array(z.string().min(1)).optional(),
  // DEPTH-1: the assessment objectives this entry configures or evidences, as ids in
  // ces-shared assessment-objectives.reference.json (e.g. 'AC.L1-3.1.1[d]'); each belongs to one of
  // control_ids. source = the Microsoft Learn page for the cmdlet or Graph resource. Optional for now.
  objective_ids: z.array(z.string().min(1)).optional(),
  // FIN-15 (CG-2 remainder): the entry's cost classification (COST-GATE-SPEC §3.3). Declared so a
  // registry load keeps it instead of stripping it; the run-time gate still reads the ces-shared
  // catalogue (CostGate.ts). Mirrors ces-shared types/cost-gate.types.ts CostGateBlockSchema;
  // passthrough so a field added to the block later is kept, not dropped.
  cost_gate: CostGateBlockSchema.optional(),
  // PH-13 P13-LV (DD-h): a feature the target licence (G5) lacks. The translator leaves the entry out unless the
  // tenant record opts in (TenantConfig.licence_opt_ins contains opt_in), and says so in a LICENCE_GATED_OFF warning.
  licence_gate: z.object({ licence: z.string().min(1), opt_in: z.string().min(1), reason: z.string().optional() }).optional(),
  // FIN-15: an entry Microsoft retired (e.g. NSG flow logs); kept for history, with the reason.
  retired: z.boolean().optional(),
  retired_reason: z.string().optional(),
  source: z.string().optional(),
});

// The full registry file schema
export const CommandRegistrySchema = z.object({
  version: z.string().min(1),
  generated_on: z.string().min(1),
  description: z.string().optional(),
  entries: z.array(CommandEntrySchema).min(1),
});

// Type exports
export type CommandEntry = z.infer<typeof CommandEntrySchema>;
export type CommandRegistryData = z.infer<typeof CommandRegistrySchema>;
