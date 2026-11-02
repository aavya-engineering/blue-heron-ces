// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Types for the Bring to Baseline feature.
 * Defines posture levels, resource definitions, discovery progress, and gap summary interfaces.
 */

export type PostureLevel = 'm365_only' | 'm365_foundation' | 'm365_full_infra';

export interface AzureResourceDefinition {
  resourceType: string;
  resourceName: string;
  dependsOn: string[];
  provisionCommand: string;
  discoveryCommand: string;
  captureKeys: string[];
}

export interface ResourceDiscoveryResult {
  resourceName: string;
  resourceType: string;
  exists: boolean;
  resourceId?: string;
  error?: string;
}

export interface BaselineStatus {
  posture: PostureLevel;
  phase: 'discovery' | 'gap_analysis' | 'execution' | 'complete' | 'error';
  progress: {
    discovered: number;
    total: number;
    existing: number;
    missing: number;
    succeeded: number;
    failed: number;
    skipped: number;
  };
}

export interface DiscoveryProgress {
  resourceName: string;
  resourceType: string;
  exists: boolean;
  resourceId?: string;
  error?: string;
  durationMs: number;
}

export interface GapSummary {
  total: number;
  missing: number;
  existing: number;
  byResourceType: Record<string, number>;
}

export interface DiscoveryResult {
  entryId: string;
  exists: boolean;
  captures: Record<string, string>;
  rawOutput: string;
  error?: string;
  exitCode: number;
}
