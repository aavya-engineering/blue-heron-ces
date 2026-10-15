// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 3: Multi-Adapter Sequencer (STUB ONLY)
// Builds command sequences for multi-engine workflows

import type { AoCommand } from '../types/AoCommand.js';
import type { CommandEntry } from 'ces-shared/types/registry';
import { translateAoCommandToCommandEntry } from '../registry/RegistryBridge.js';

/**
 * Build command sequence for an AO command.
 * For this phase, returns single-item array (no multi-step sequences).
 *
 * Out of scope: Multi-engine sequences (e.g., Graph → Exchange → Graph).
 * Future work: Parse aoCommand.overview to detect multi-step patterns.
 */
export function buildCommandSequence(aoCommand: AoCommand): CommandEntry[] {
  // Stub: return single CommandEntry
  return [translateAoCommandToCommandEntry(aoCommand)];
}
