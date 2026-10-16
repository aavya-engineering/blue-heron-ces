// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { z } from 'zod';
import { EngineEnum, SubCommandIdempotencyEnum, CaptureSpecSchema, VerificationCriteriaSchema } from '../types/schema.types.js';

// Re-export for consumers that import from here
export type { VerificationCriteria } from '../types/schema.types.js';

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
