// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Shared types for the stacksim client. Mirrors tenant-stacksim's own
 * ScenarioEngine/LedgerTypes shapes (read, never imported directly across
 * the repo boundary — PLAN.md "two-entities model").
 */

export type TenantStance = 'm365_only' | 'm365_sentinel' | 'm365_azure';

export interface StacksimSeedStep {
  kind: 'uri';
  method: string;
  uri: string;
  body?: unknown;
  note?: string;
}

/** The wrapper's `stacksim_seed` block (PLAN.md Scenario Schema Skeleton). Passed through
 * to stacksim's own ScenarioFile schema untouched except for the spliced-in `name`. */
export interface StacksimSeedBlock {
  stance: TenantStance;
  countOverrides?: Record<string, number>;
  steps?: StacksimSeedStep[];
  expectedFacts?: Record<string, string>;
}

/** The materialized file written to `<tempdir>/<scenario_id>.json` before invoking
 * `stacksim scenario <scenario_id> --scenarios-dir <tempdir>`. */
export interface MaterializedScenarioFile extends StacksimSeedBlock {
  name: string;
  description?: string;
}

export interface RunScenarioResult {
  scenarioId: string;
  tenantRoot: string;
  stdout: string;
  exitCode: number;
}

export type LedgerEntryType = 'create' | 'mutate' | 'read-serve';
export type LedgerActor = 'stamper' | 'ao' | 'eo' | 'probe';

export interface LedgerEntry {
  ts: string;
  type: LedgerEntryType;
  objectType: string;
  objectId: string;
  actor: LedgerActor;
  source: string;
  milestone: string;
  sessionType: string;
  requestId: string;
}

export interface LedgerQuery {
  type?: LedgerEntryType;
  objectType?: string;
  id?: string;
  from?: string;
  to?: string;
  actor?: LedgerActor;
}

export interface ResolveUriRequestBody {
  kind: 'uri';
  method: string;
  uri: string;
  body?: unknown;
}

export interface ResolveCmdletRequestBody {
  kind: 'cmdlet';
  cmdlet: string;
  args?: unknown;
}

export type ResolveRequestBody = ResolveUriRequestBody | ResolveCmdletRequestBody;
