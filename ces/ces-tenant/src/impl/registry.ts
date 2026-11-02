// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * File-backed `TenantRegistryLifecycle` implementation (design 2.1).
 *
 * Read path implements the documented back-compat order (design 2.1 point 2,
 * acceptance gate 2):
 *   (a) new registry root, kind-namespaced: `<root>/live/<slug>.json` /
 *       `<root>/sim/<slug>.json` (A9 structural fix -- physically separate
 *       namespaces);
 *   (b) `CES_PIPELINE_ROOT/Stamper/plan-data/<slug>/<slug>.json` (current
 *       Stamper convention, `ces-shared/src/storage/node.ts:53-59`);
 *   (c) legacy `~/.stamper/tenants/<slug>.json` (flat, the gate's named
 *       path), then the nested `~/.stamper/tenants/<slug>/<slug>.json`
 *       variant `resolveTenantJsonPath()` also honors.
 * First hit wins; a hit at (b) or (c) triggers a one-time forward migration
 * (copy the RAW file -- secret refs intact -- to the new root, stamped with
 * `kind`), mirroring the `migrateToTenantTree()` precedent
 * (`ces-stamper/src/server/GuiServer.ts:94-181`) at per-slug granularity.
 * Every migrated record is stamped `kind: 'live'` or `'sim'` (design 2.1
 * point 3); sim provenance is detected via tenant-stacksim's emitted marker
 * (see `detectKind()`).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { TenantKind, TenantRegistryLifecycle, TenantRegistryRecord } from '../registry.js';
import {
  defaultHomeDir,
  getCesPipelineRoot,
  getRegistryRoot,
  legacyFlatTenantJsonPath,
  legacyNestedTenantJsonPath,
  planDataTenantJsonPath,
  registryRecordPath,
} from './paths.js';
import { detectKind, parseTenantRecord, readRawTenantJson, type RawTenantJson } from './tenant-file.js';

export interface FileTenantRegistryOptions {
  /** New registry root. Default: `CES_TENANT_ROOT` env, else `~/.ces/tenants` (open decision 8.1 default -- see paths.ts). */
  registryRoot?: string;
  /** Back-compat read (b) anchor. Default: `CES_PIPELINE_ROOT` env, else the platform default (`ces-shared/src/storage/contract.ts:16-19`). */
  cesPipelineRoot?: string;
  /** Back-compat read (c) anchor. Default: `os.homedir()`. */
  homeDir?: string;
  /** Environment for secret-ref resolution / strict mode / defaults. Default: `process.env`. */
  env?: NodeJS.ProcessEnv;
  /**
   * Base URL stamped into ephemeral sim records' endpoints. Default:
   * `STACKSIM_SERVER_URL` env, else `http://localhost:4390` (mirrors
   * `buildSimTenantConfig()`'s base, `SimTenantConfig.ts:66-67`).
   */
  simServerUrl?: string;
}

export class FileTenantRegistry implements TenantRegistryLifecycle {
  private readonly registryRoot: string;
  private readonly cesPipelineRoot: string;
  private readonly homeDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly simServerUrl: string;

  constructor(options: FileTenantRegistryOptions = {}) {
    this.env = options.env ?? process.env;
    this.registryRoot = options.registryRoot ?? getRegistryRoot(this.env);
    this.cesPipelineRoot = options.cesPipelineRoot ?? getCesPipelineRoot(this.env);
    this.homeDir = options.homeDir ?? defaultHomeDir();
    this.simServerUrl =
      options.simServerUrl ?? this.env.STACKSIM_SERVER_URL ?? 'http://localhost:4390';
  }

  async get(slug: string): Promise<TenantRegistryRecord | undefined> {
    // (a) New root, both namespaces. Finding the slug in BOTH is the exact
    // A9 collision the namespaces exist to prevent -- fail loudly.
    const livePath = registryRecordPath(this.registryRoot, 'live', slug);
    const simPath = registryRecordPath(this.registryRoot, 'sim', slug);
    const inLive = fs.existsSync(livePath);
    const inSim = fs.existsSync(simPath);
    if (inLive && inSim) {
      throw new Error(
        `[FileTenantRegistry] tenant "${slug}" exists in BOTH live and sim namespaces under ${this.registryRoot} -- ` +
          `A9-class collision; refusing to guess. Remove the incorrect record.`,
      );
    }
    if (inLive || inSim) {
      const namespaceKind: TenantKind = inLive ? 'live' : 'sim';
      const raw = readRawTenantJson(inLive ? livePath : simPath);
      if (raw.kind !== namespaceKind) {
        // Design 2.1 point 3: a post-migration record missing (or
        // contradicting) `kind` is a migration bug, not a valid state.
        throw new Error(
          `[FileTenantRegistry] record for "${slug}" in the ${namespaceKind} namespace has kind=${JSON.stringify(raw.kind)} -- ` +
            `stamping bug; refusing to serve a mis-kinded record.`,
        );
      }
      return parseTenantRecord(raw, namespaceKind, this.env);
    }

    // (b) Current Stamper plan-data convention.
    const planDataPath = planDataTenantJsonPath(this.cesPipelineRoot, slug);
    if (fs.existsSync(planDataPath)) {
      return this.migrateForward(slug, planDataPath);
    }

    // (c) Legacy ~/.stamper/tenants -- flat first (the gate's named path),
    // then the nested variant resolveTenantJsonPath() also reads.
    const flatPath = legacyFlatTenantJsonPath(this.homeDir, slug);
    if (fs.existsSync(flatPath)) {
      return this.migrateForward(slug, flatPath);
    }
    const nestedPath = legacyNestedTenantJsonPath(this.homeDir, slug);
    if (fs.existsSync(nestedPath)) {
      return this.migrateForward(slug, nestedPath);
    }

    return undefined;
  }

  async listByKind(kind: TenantKind): Promise<TenantRegistryRecord[]> {
    // Strictly the stamped `kind` field of records in the new root -- never
    // naming convention, directory location alone, or legacy sweeps
    // (interface invariant, registry.ts doc). A mis-stamped file (namespace
    // and kind disagree) is excluded from BOTH kinds.
    const dir = path.join(this.registryRoot, kind);
    if (!fs.existsSync(dir)) return [];
    const records: TenantRegistryRecord[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const raw = readRawTenantJson(path.join(dir, entry.name));
      if (raw.kind !== kind) continue;
      records.push(parseTenantRecord(raw, kind, this.env));
    }
    return records;
  }

  async createEphemeralSimTenant(slug: string, seedRef: unknown): Promise<TenantRegistryRecord> {
    // Invariant guard: never shadow or touch a live tenant (the "must never
    // accidentally target a live tenant" invariant, registry.ts doc).
    const livePath = registryRecordPath(this.registryRoot, 'live', slug);
    if (fs.existsSync(livePath)) {
      throw new Error(
        `[FileTenantRegistry] refusing to create ephemeral sim tenant "${slug}": a live record with that slug exists.`,
      );
    }

    // Record field values mirror tenant-stacksim's deterministic emitted-
    // config conventions (`buildSimTenantConfig()`,
    // `tenant-stacksim/src/config/SimTenantConfig.ts:65-157`) so the record
    // is interchangeable with a stacksim-emitted one; the opaque seedRef is
    // persisted alongside (`stacksim_seed`) for the orchestrator, per the
    // interface's "reference, not shape" contract.
    const domain = `${slug}.simtenant.onmicrosoft.us`;
    const base = this.simServerUrl;
    const raw: RawTenantJson = {
      kind: 'sim',
      client: { slug, name: `Sim Tenant (${slug})`, engagement_id: `sim-engagement-${slug}` },
      tenant: { tenant_id: `sim-tenant-${slug}`, domain, environment: 'gcc-high-sim' },
      auth: {
        app_id: `sim-app-${slug}`,
        cert_path: `sim/${slug}.pfx`,
        cert_thumbprint: 'SIMTHUMBPRINT0000000000000000000000000',
      },
      endpoints: {
        graph: `${base}/graph`,
        login: `${base}/login`,
        compliance_uri: `${base}/compliance`,
        exchange_env: 'O365USGovGCCHighSim',
      },
    };
    if (seedRef !== undefined) raw.stacksim_seed = seedRef;

    const simPath = registryRecordPath(this.registryRoot, 'sim', slug);
    fs.mkdirSync(path.dirname(simPath), { recursive: true });
    fs.writeFileSync(simPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
    return parseTenantRecord(raw, 'sim', this.env);
  }

  async teardownEphemeralSimTenant(slug: string): Promise<void> {
    const simPath = registryRecordPath(this.registryRoot, 'sim', slug);
    if (!fs.existsSync(simPath)) {
      // Refuse loudly if the caller is pointing a sim teardown at a live
      // slug; a plain no-op would mask an orchestrator bug.
      if (fs.existsSync(registryRecordPath(this.registryRoot, 'live', slug))) {
        throw new Error(
          `[FileTenantRegistry] refusing to tear down "${slug}": it is a live tenant, not an ephemeral sim.`,
        );
      }
      return; // Idempotent: already gone.
    }
    fs.rmSync(simPath);
  }

  /**
   * One-time forward migration for a record found at a back-compat location:
   * copy the RAW JSON (secret refs intact -- never resolved material,
   * design 2.3) to the new root under the detected kind's namespace, stamped
   * with `kind`. The source file is left in place (back-compat READS, not
   * writes -- design 2.1 point 2); subsequent reads hit (a) directly.
   */
  private migrateForward(slug: string, sourcePath: string): TenantRegistryRecord {
    const raw = readRawTenantJson(sourcePath);
    const kind = detectKind(raw);
    const stamped: RawTenantJson = { ...raw, kind };
    const destPath = registryRecordPath(this.registryRoot, kind, slug);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, JSON.stringify(stamped, null, 2) + '\n', 'utf-8');
    return parseTenantRecord(stamped, kind, this.env);
  }
}
