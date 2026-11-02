// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 2: Command Mapping Types
// TypeScript interfaces for AO → Stamper translation

import type { AoCommand } from './AoCommand.js';

/**
 * Mapping metadata for AO command → CommandEntry translation
 */
export interface AoToStamperMapping {
  aoId: string;
  entry_id: string;
  engine: string;
  idempotency: string;
}

/**
 * Type guard: Domain-based engine classification helpers
 */

export function isGraphCommand(aoCommand: AoCommand): boolean {
  return ['A', 'B', 'F', 'G', 'H'].includes(aoCommand.domain);
}

export function isExchangeCommand(aoCommand: AoCommand): boolean {
  return aoCommand.overview.toLowerCase().includes('exchange');
}

export function isAzureCommand(aoCommand: AoCommand): boolean {
  return ['C', 'E'].includes(aoCommand.domain);
}

export function isSharePointCommand(aoCommand: AoCommand): boolean {
  const text = aoCommand.overview.toLowerCase();
  return text.includes('sharepoint') || text.includes('onedrive');
}

export function isPurviewCommand(aoCommand: AoCommand): boolean {
  const text = aoCommand.overview.toLowerCase();
  return text.includes('purview') || text.includes('dlp');
}

export function isTeamsCommand(aoCommand: AoCommand): boolean {
  return aoCommand.overview.toLowerCase().includes('teams');
}
