// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 2: Registry Bridge
// Translates AoCommand to Stamper CommandEntry format

import * as path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import type { AoCommand } from '../types/AoCommand.js';
import type { CommandEntry } from 'ces-shared/types/registry';
import { determineEngine } from '../execution/AdapterRouter.js';
import { classifyIdempotency } from '../execution/IdempotencyClassifier.js';
import { extractVariablesRequired } from '../execution/VariableResolver.js';
import { getEvidenceCommandsForAoCommand } from '../execution/EvidenceRegistry.js';
import { getCommandTemplates } from './TemplateRegistry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Sibling root: ces-ao/src/registry/ -> ces-ao/ (..,..) -> ces/ parent (..) -> ces-shared/src/data/...
// Read by direct path (not the ces-shared package export) — see G-AO-CMMC-BOUND-1 M2 deviation log:
// avoids a hidden dependency on ces-shared's dist/ being pre-built for a standalone `npm test -w ces-ao` run.
const CMMC_REFERENCE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'ces-shared',
  'src',
  'data',
  'cmmc-l2-controls.reference.json',
);

/**
 * Translate AoCommand to Stamper CommandEntry shape.
 * Maps AO registry metadata to Stamper execution format.
 *
 * Per-command templates (set_command/get_command) are stubbed as empty strings.
 * Per-command implementation is out of scope for this phase.
 */
export function translateAoCommandToCommandEntry(aoCommand: AoCommand): CommandEntry {
  const engine = determineEngine(aoCommand);
  // Explicit registry idempotencyClass wins; fall back to the heuristic classifier.
  const idempotency = aoCommand.idempotencyClass ?? classifyIdempotency(aoCommand);
  const variables_required = extractVariablesRequired(aoCommand);
  const evidence_commands = getEvidenceCommandsForAoCommand(aoCommand);

  // Build entry_id: simplified format (domain.id)
  const entry_id = `${aoCommand.domain}.${aoCommand.id}`;

  // Extract user-provided parameters (no source field)
  const variables_runtime = aoCommand.parameters
    .filter(p => !p.source)
    .map(p => p.name);

  // on_failure: abort_plan for P1 Critical, warn_continue otherwise
  const on_failure = aoCommand.priority === 'P1 Critical' ? 'abort_plan' : 'warn_continue';

  // Get templates from TemplateRegistry, fall back to empty strings if not found
  const templates = getCommandTemplates(aoCommand.id);

  return {
    entry_id,
    control_ids: aoCommand.cmmcPractices,
    label: aoCommand.title,
    engine,
    idempotency,
    variables_required,
    variables_runtime,
    set_command: templates?.set_command || '',
    get_command: templates?.get_command || '',
    evidence_commands,
    on_failure,
    layer_hint: 0,
    sequence_hint: 0,
    manual_only: false,
    captures: [],
  };
}

/**
 * Load the set of valid CMMC L2 control_ids from the ces-shared reference JSON.
 * Reads by direct file path (not the `ces-shared` package export) — see
 * G-AO-CMMC-BOUND-1 M2 deviation log: avoids a hidden dependency on ces-shared's
 * dist/ being pre-built for a standalone `npm test -w ces-ao` run.
 */
export function loadCmmcControlCodes(referencePath: string = CMMC_REFERENCE_PATH): Set<string> {
  let raw: string;
  try {
    raw = readFileSync(referencePath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[RegistryBridge] Could not read CMMC reference JSON at "${referencePath}": ${msg}`,
    );
  }
  const parsed = JSON.parse(raw) as { controls?: { control_id: string }[] };
  const codes = new Set<string>();
  for (const control of parsed.controls || []) {
    codes.add(control.control_id);
  }
  return codes;
}

/**
 * Pure function: for each command's cmmcPractices entries not present in validCodes,
 * record a violation. Caller decides whether to throw or log — this function has no I/O
 * and never throws on data content (only structurally required fields are assumed present).
 */
export function validateRegistryCmmcPractices(
  commands: AoCommand[],
  validCodes: Set<string>,
): { valid: boolean; violations: { commandId: string; practiceCode: string }[] } {
  const violations: { commandId: string; practiceCode: string }[] = [];
  for (const command of commands) {
    for (const practiceCode of command.cmmcPractices || []) {
      if (!validCodes.has(practiceCode)) {
        violations.push({ commandId: command.id, practiceCode });
      }
    }
  }
  return { valid: violations.length === 0, violations };
}

/**
 * Validate the registry's cmmcPractices codes against the ces-shared CMMC reference at load
 * time. Logs a structured warning (does NOT throw) when violations are found — matching
 * AoServer.ts's console.warn convention for registry-shape problems. See G-AO-CMMC-BOUND-1 M2
 * deviation log: the real registry has ~33 pre-existing unmapped practice codes today; a hard
 * throw here would break app startup. Not wired into AoServer.ts/invokeCommand.ts's boot
 * sequence in this milestone — both files are outside M2's file inventory.
 */
export function validateRegistryAtLoad(commands: AoCommand[]): void {
  const validCodes = loadCmmcControlCodes();
  const { valid, violations } = validateRegistryCmmcPractices(commands, validCodes);
  if (!valid) {
    const lines = violations.map((v) => `  - ${v.commandId}: ${v.practiceCode}`);
    // GP-AO-BOUND-1 M2 (founder-confirmed 2026-07-25): STRICT — a mislabeled
    // practice code fails startup instead of warning, so label debt can never
    // re-accumulate. The registry was brought to 0 violations in the same goal.
    throw new Error(
      `[RegistryBridge] ${violations.length} cmmcPractices code(s) do not resolve against the CMMC reference set:\n${lines.join('\n')}`,
    );
  }
}
