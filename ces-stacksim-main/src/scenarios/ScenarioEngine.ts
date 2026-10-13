// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { loadProfile, resolveProfilePath } from '../profiles/ProfileLoader.js';
import { ObjectStore } from '../store/ObjectStore.js';
import { Ledger } from '../ledger/Ledger.js';
import { StackShapeGate, type TenantStance } from '../gating/StackShapeGate.js';
import { ResolverTable } from '../resolvers/ResolverTable.js';
import { DirectoryAuditWriter } from '../audit/DirectoryAuditWriter.js';
import { EvidenceHold } from '../evidence/EvidenceHold.js';
import { SeedEngine } from '../seed/SeedEngine.js';
import { SEED_SET_NAMES } from '../seed/sets/gccHighG5.js';
import { acquireTenantLock, TENANT_LOCK_FILENAME } from '../store/TenantLock.js';
import { validateFaultRules, type FaultRule } from '../http/FaultInjector.js';

/**
 * G-STACKSIM-3: scenario mechanism — named partially-configured tenant
 * states for testing state-detection tools (scre-muster's Graph harvest is
 * the first consumer).
 *
 * A scenario = baseline seed (profile counts, optionally overridden) + a
 * sequence of mutation steps applied through the SAME ResolverTable path
 * real callers use, so every configured control is a genuine store mutation
 * with a ledger entry — the ledger remains the machine-readable ground
 * truth of exactly what was "already done" in this tenant. Seeding stays
 * deliberately pre-Stamper (G-STACKSIM-2 iteration 3 decision); partial
 * configuration is expressed as steps, not as fabricated seed objects.
 *
 * `expectedFacts` is the scenario's assertion manifest: what a correct
 * state-detector should conclude (e.g. Muster question_id -> yes/no).
 * The sim does not interpret it — tests do.
 */

export interface ScenarioUriStep {
  kind: 'uri';
  method: string;
  uri: string;
  body?: unknown;
  /** Human note recorded in the run summary (e.g. which control this configures). */
  note?: string;
}

export interface ScenarioFile {
  name: string;
  description: string;
  stance: TenantStance;
  /** Merged over the stance profile's seed counts (e.g. managedDevices: 0). */
  countOverrides?: Record<string, number>;
  /**
   * SIMFIX FIX-S2: seed sets this scenario builds on (e.g. ["gcc-high-g5"]).
   * Scenarios opt IN explicitly - a profile's own seedSets are NOT inherited,
   * so pre-existing scenarios (demo-dib-small, muster-*) build exactly the
   * state they always did.
   */
  seedSets?: string[];
  steps?: ScenarioUriStep[];
  /** Assertion manifest for state-detection tests: question/control id -> expected answer. */
  expectedFacts?: Record<string, string>;
  /**
   * backlog-S5: deterministic fault rules persisted to
   * `<tenantRoot>/faults.json` — `stacksim serve` loads them at startup, so
   * a fault scenario is fully declared in one file.
   */
  faultInjection?: FaultRule[];
}

export interface ApplyScenarioOptions {
  profilesDir: string;
  tenantRoot: string;
}

export interface ApplyScenarioResult {
  scenario: ScenarioFile;
  seedCounts: Record<string, number>;
  stepsApplied: number;
}

export async function loadScenario(scenarioPath: string): Promise<ScenarioFile> {
  const raw = await fs.readFile(scenarioPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<ScenarioFile>;
  if (!parsed.name || !parsed.stance) {
    throw new Error(`ScenarioEngine: ${scenarioPath} must declare "name" and "stance"`);
  }
  for (const n of parsed.seedSets ?? []) {
    if (!(SEED_SET_NAMES as readonly string[]).includes(n)) {
      throw new Error(`ScenarioEngine: ${scenarioPath} names unknown seed set "${n}"`);
    }
  }
  for (const step of parsed.steps ?? []) {
    if (step.kind !== 'uri' || !step.method || !step.uri) {
      throw new Error(
        `ScenarioEngine: ${scenarioPath} step must be {kind:"uri", method, uri, body?} — got ${JSON.stringify(step)}`,
      );
    }
  }
  return parsed as ScenarioFile;
}

/**
 * Builds the scenario tenant from scratch: WIPES tenantRoot (scenario runs
 * must be deterministic — re-running a scenario always yields the same
 * state), seeds the stance profile with countOverrides merged, then applies
 * every step through a fully-wired ResolverTable (ledger + directory audit +
 * evidence hold — identical wiring to `stacksim serve`).
 */
export async function applyScenario(
  scenario: ScenarioFile,
  opts: ApplyScenarioOptions,
): Promise<ApplyScenarioResult> {
  const profilePath = resolveProfilePath(scenario.stance, opts.profilesDir);
  const profile = await loadProfile(profilePath);
  const seedCounts: Record<string, number> = { ...profile.counts, ...(scenario.countOverrides ?? {}) };
  for (const [objectType, count] of Object.entries(scenario.countOverrides ?? {})) {
    if (!(objectType in profile.counts)) {
      throw new Error(
        `ScenarioEngine: countOverrides key "${objectType}" (=${count}) is not a seed collection in the ${scenario.stance} profile`,
      );
    }
  }

  // backlog-S1: take the exclusive tenant lock BEFORE wiping — a scenario
  // rebuild against a tenant a live serve process owns must fail loudly, not
  // delete the server's files out from under it. The wipe then clears the
  // tenant CONTENTS but keeps the lock file we just created.
  const lock = await acquireTenantLock(opts.tenantRoot, 'scenario');
  try {
    for (const entry of await fs.readdir(opts.tenantRoot)) {
      if (entry === TENANT_LOCK_FILENAME) continue;
      await fs.rm(path.join(opts.tenantRoot, entry), { recursive: true, force: true });
    }

    const store = new ObjectStore(path.join(opts.tenantRoot, 'store.json'));
    const ledger = new Ledger(path.join(opts.tenantRoot, 'ledger.jsonl'));

    const seedEngine = new SeedEngine(store, ledger);
    await seedEngine.seed({ tenantStance: profile.tenantStance, slug: profile.slug, counts: seedCounts, seedSets: scenario.seedSets ?? [] });

    const gate = new StackShapeGate(profile.tenantStance);
    const auditWriter = new DirectoryAuditWriter(store, ledger);
    const evidenceHold = new EvidenceHold(path.join(opts.tenantRoot, 'evidence'), ledger);
    const resolverTable = new ResolverTable(store, gate, undefined, auditWriter, evidenceHold);

    let stepsApplied = 0;
    for (const step of scenario.steps ?? []) {
      await resolverTable.resolveUri(step.method, step.uri, step.body);
      stepsApplied++;
    }

    // backlog-S5: persist declared fault rules so `stacksim serve` picks
    // them up — validated here so a broken scenario fails at build time,
    // not at first faulted call.
    if (scenario.faultInjection) {
      const rules = validateFaultRules(scenario.faultInjection);
      await fs.writeFile(path.join(opts.tenantRoot, 'faults.json'), JSON.stringify(rules, null, 2), 'utf8');
    }

    return { scenario, seedCounts, stepsApplied };
  } finally {
    await lock.release();
  }
}
