// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 4: Evidence Registry (PATTERN-BASED)
// Maps AO commands to evidence collection PowerShell commands

import * as path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import type { AoCommand } from '../types/AoCommand.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/ao-commands.registry.json');

/**
 * AO-1 (gap plan G-AO, V76): the assessment objective ids a command's output evidences —
 * the registry entry's `evidence_objectives` (ids from ces-shared
 * assessment-objectives.reference.json, each belonging to one of the command's cmmcPractices).
 * Replaces the per-domain stub as the source of what a command evidences. Display only:
 * no verdict, status or SPRS reads it (AR5).
 */
export function getEvidenceObjectivesForAoCommand(aoCommand: AoCommand): string[] {
  return [...(aoCommand.evidence_objectives ?? [])];
}

let objectivesByCommandId: Map<string, string[]> | undefined;

/**
 * AO-1: objective ids for a command id, read from the registry on disk (cached). Used where
 * only the id is at hand (evidence persistence). Unknown ids return [].
 */
export function getEvidenceObjectivesForCommandId(commandId: string): string[] {
  if (!objectivesByCommandId) {
    const commands = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as AoCommand[];
    objectivesByCommandId = new Map(commands.map((c) => [c.id, getEvidenceObjectivesForAoCommand(c)]));
  }
  return [...(objectivesByCommandId.get(commandId) ?? [])];
}

/**
 * Get evidence commands for an AO command.
 * Pattern-based heuristic (NOT exhaustive).
 *
 * Domain-based defaults:
 * - A (Identity & Access) → Get-MgUser, Get-MgGroup
 * - B (Device Security) → Get-MgDeviceManagementManagedDevice
 * - C (Credential Management) → Get-AzKeyVault
 * - D (Data Protection) → Get-SPOSite
 * - E (Audit & Accountability) → Search-UnifiedAuditLog
 * - F (System Protection) → Get-MgDeviceManagementIntent
 * - G (Personnel Security) → Get-MgUser
 * - H (Incident Response) → Get-MgSecurityIncident
 *
 * Returns array of 1-2 PowerShell commands (stubs).
 * Per-command refinement is out of scope.
 */
export function getEvidenceCommandsForAoCommand(aoCommand: AoCommand): string[] {
  const domainEvidenceMap: Record<string, string[]> = {
    'A': ['Get-MgUser', 'Get-MgGroup'],
    'B': ['Get-MgDeviceManagementManagedDevice'],
    'C': ['Get-AzKeyVault'],
    'D': ['Get-SPOSite'],
    'E': ['Search-UnifiedAuditLog'],
    'F': ['Get-MgDeviceManagementIntent'],
    'G': ['Get-MgUser'],
    'H': ['Get-MgSecurityIncident'],
  };

  return domainEvidenceMap[aoCommand.domain] || ['Get-MgUser'];
}
