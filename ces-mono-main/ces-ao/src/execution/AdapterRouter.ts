// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 3: Adapter Router
// Determines execution engine from AO command metadata

import type { AoCommand } from '../types/AoCommand.js';

/**
 * Determine execution engine for an AO command.
 * Uses static domain-to-engine map with per-command overrides.
 *
 * Domain defaults:
 * - A (Identity & Access) → mgraph
 * - B (Device Security) → mgraph
 * - C (Credential Management) → az (Key Vault)
 * - D (Data Protection) → spo (SharePoint)
 * - E (Audit & Accountability) → az (Sentinel)
 * - F (System Protection) → mgraph (Intune/Defender)
 * - G (Personnel Security) → mgraph (User management)
 * - H (Incident Response) → mgraph (Security Incident)
 *
 * Per-command overrides (keyword detection in overview):
 * - Exchange → exchange
 * - Purview/DLP → ipps
 * - SharePoint/OneDrive → spo
 * - Teams → teams
 * - Azure Firewall → az (F-domain firewall commands use Az PowerShell, not mgraph)
 *
 * Tier 3 commands → manual_gate (final override)
 */
export function determineEngine(aoCommand: AoCommand): string {
  // Static domain-to-engine map
  const domainEngineMap: Record<string, string> = {
    'A': 'mgraph',
    'B': 'mgraph',
    'C': 'az',
    'D': 'spo',
    'E': 'az',
    'F': 'mgraph',
    'G': 'mgraph',
    'H': 'mgraph',
  };

  // Start with domain default
  let engine = domainEngineMap[aoCommand.domain] || 'mgraph';

  // Per-command overrides based on overview keywords
  const overviewLower = aoCommand.overview.toLowerCase();

  if (overviewLower.includes('exchange')) {
    engine = 'exchange';
  } else if (overviewLower.includes('purview') || overviewLower.includes('dlp')) {
    engine = 'ipps';
  } else if (overviewLower.includes('sharepoint') || overviewLower.includes('onedrive')) {
    engine = 'spo';
  } else if (overviewLower.includes('teams')) {
    engine = 'teams';
  } else if (overviewLower.includes('azure firewall')) {
    engine = 'az';
  }

  // Tier 3 commands always use manual_gate
  if (aoCommand.sodTier === 'Tier 3') {
    engine = 'manual_gate';
  }

  return engine;
}
