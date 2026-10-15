// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 8: SOD Gate
// Detects Tier 3 commands requiring manual approval gates

import type { AoCommand } from '../types/AoCommand.js';
import type { CommandEntry } from 'ces-shared/types/registry';

/**
 * Tenant posture consulted by the M4 additive floor. Optional — callers without
 * tenant context (listing/inspection paths) get the static-tier behavior only.
 */
export interface SodTenantContext {
  cmmcLevel?: 'L1' | 'L2';
  kind?: string;
  /** Command resolves to a real mutation (get-then-set with a set_command, or a CONFIG trigger). */
  writeShaped?: boolean;
}

/**
 * Check if command requires manual approval gate.
 * Returns true for Tier 3 commands.
 *
 * G-AO-CMMC-BOUND-1 M4 — the SINGLE additive floor (scope boundary: no other
 * tenant attribute may drive SoD tier): against a hardened LIVE L2 tenant
 * (`cmmcLevel === 'L2' && kind === 'live'`), a write-shaped Tier 2 command is
 * floored up to the manual gate — a mutation that wouldn't normally require
 * two-person approval does on that tenant. Read/evidence commands and sim
 * tenants are unaffected (sim-transparency: gate behavior vs stacksim differs
 * only by the record's declared kind, never by how the command executes).
 */
export function requiresManualGate(aoCommand: AoCommand, tenant?: SodTenantContext): boolean {
  if (aoCommand.sodTier === 'Tier 3') return true;
  if (
    tenant?.cmmcLevel === 'L2' &&
    tenant?.kind === 'live' &&
    tenant?.writeShaped === true &&
    aoCommand.sodTier === 'Tier 2'
  ) {
    return true;
  }
  return false;
}

/**
 * Wrap CommandEntry with manual_gate engine for Tier 3 commands.
 * Sets engine to 'manual_gate' for commands requiring approval.
 * Out of scope: ManualGateAdapter execution (throws error in CommandExecutor).
 */
export function wrapWithManualGate(commandEntry: CommandEntry): CommandEntry {
  return {
    ...commandEntry,
    engine: 'manual_gate',
  };
}
