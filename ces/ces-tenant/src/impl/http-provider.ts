// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * `TenantHttpKeyProvider` implementation -- behavior-preserving port of
 * muster-api's `tenantKeysService.resolveTenantKeys()`
 * (`ces-muster/muster-api/src/services/tenantKeysService.ts:50-107`,
 * design 2.4 point 2).
 *
 * Non-Windows-safe by construction: this module imports NO
 * `child_process`/PowerShell code path (design 7) -- keep it that way.
 *
 * Endpoint fallback: the source falls back per-field to
 * `getActiveStackProvider(config).capabilities.cloudEndpoints`. The default
 * (and, for every tenant researched, only) active provider is the
 * Microsoft/GCC High reference stack, whose literals are ported here
 * (`ces-shared/src/stack/providers/microsoftGccHigh.ts:13-19`). Porting the
 * full multi-stack provider registry would exceed this package's scope fence
 * (tenant CONNECTION only; the sovereign endpoint table is named new work,
 * design 2.2) -- logged as a deviation in docs/M1-RECORD.md.
 */

import type { ConsumerIdentity } from '../consumer.js';
import type { TenantHttpKeyProvider, TenantKeys, TenantKeysErrorCode } from '../http-surface.js';
import type { TenantActivityRecorder } from '../status-surface.js';
import { getCesPipelineRoot, planDataTenantJsonPath, legacyNestedTenantJsonPath, defaultHomeDir } from './paths.js';
import { detectKind, parseTenantRecord, readRawTenantJson } from './tenant-file.js';

import * as fs from 'node:fs';

/** Error carrying the `TenantKeysErrorCode` discriminator -- port of `TenantKeysError` (`tenantKeysService.ts:26-34`). */
export class TenantKeysError extends Error {
  constructor(
    public readonly code: TenantKeysErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'TenantKeysError';
  }
}

/** GCC High reference-stack endpoint literals, verbatim from `microsoftGccHigh.ts:13-19` (the fields `TenantKeys.endpoints` consumes). */
const GCC_HIGH_CLOUD_ENDPOINTS = {
  graph: 'https://graph.microsoft.us',
  login: 'https://login.microsoftonline.us',
  arm: 'https://management.usgovcloudapi.net',
} as const;

export interface PlanDataTenantHttpKeyProviderOptions {
  /** Pipeline root anchoring `Stamper/plan-data`. Default: `CES_PIPELINE_ROOT` env, else platform default. */
  cesPipelineRoot?: string;
  /** Home dir for the legacy nested fallback `resolveTenantJsonPath()` honors (`TenantConfig.ts:148`). Default: `os.homedir()`. */
  homeDir?: string;
  /** Environment for env-fallback keys, secret refs, strict mode. Default: `process.env`. */
  env?: NodeJS.ProcessEnv;

  // ---- RATIFIED AMENDMENT (founder, 2026-07-10) — caller identity + status surface ----

  /**
   * Construction-time caller identity, used for every token request that
   * does not carry a per-request `consumer` override. INVARIANT
   * (`consumer.ts`): missing both is logged in library mode (warned through
   * `logger`, recorded as `consumer: null`); service mode rejects.
   */
  consumer?: ConsumerIdentity;

  /** Activity recorder (append-only ledger) — e.g. `InProcessTenantStatus`. When absent, no activity is recorded. */
  activity?: TenantActivityRecorder;

  /** Log sink for the missing-consumer library-mode warning. Default: `console`. */
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export class PlanDataTenantHttpKeyProvider implements TenantHttpKeyProvider {
  private readonly env: NodeJS.ProcessEnv;
  private readonly cesPipelineRoot: string;
  private readonly homeDir: string;
  private readonly defaultConsumer?: ConsumerIdentity;
  private readonly activity?: TenantActivityRecorder;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;

  constructor(options: PlanDataTenantHttpKeyProviderOptions = {}) {
    this.env = options.env ?? process.env;
    this.cesPipelineRoot = options.cesPipelineRoot ?? getCesPipelineRoot(this.env);
    this.homeDir = options.homeDir ?? defaultHomeDir();
    this.defaultConsumer = options.consumer;
    this.activity = options.activity;
    this.logger = options.logger ?? console;
  }

  /**
   * Port of `resolveTenantKeys()` (`tenantKeysService.ts:50-107`), same
   * error codes and fallback order; amended 2026-07-10 to carry caller
   * identity and record an append-only activity entry per token request;
   * amended 2026-07-11 (ratified, founder) to return a Promise so the
   * service transport implements the same signature — the in-process work
   * here is still synchronous and resolves immediately.
   */
  async resolveTenantKeys(slug: string | undefined, consumer?: ConsumerIdentity): Promise<TenantKeys> {
    const identity = consumer ?? this.defaultConsumer ?? null;
    if (identity === null) {
      this.logger.warn(
        '[TenantHttpKeyProvider] resolveTenantKeys request without consumer identity (module/purpose) -- logged in library mode; service mode rejects (ratified amendment 2026-07-10).',
      );
    }
    const record = (outcome: 'ok' | 'error', detail?: string): void => {
      this.activity?.recordActivity({
        consumer: identity,
        operation: 'resolveTenantKeys',
        ...(slug !== undefined ? { tenantSlug: slug } : {}),
        outcome,
        ...(detail !== undefined ? { detail } : {}),
      });
    };
    try {
      const keys = this.resolveTenantKeysCore(slug);
      record('ok', `source: ${keys.source}`);
      return keys;
    } catch (err) {
      record('error', (err instanceof Error ? err.message : String(err)).substring(0, 300));
      throw err;
    }
  }

  /** The unamended `resolveTenantKeys` behavior (verbatim M1 port). */
  private resolveTenantKeysCore(slug: string | undefined): TenantKeys {
    if (slug !== undefined) {
      // `resolveTenantJsonPath(slug, {root}/Stamper)`: plan-data first, then
      // the legacy nested ~/.stamper path (`TenantConfig.ts:143-155`).
      let filePath = planDataTenantJsonPath(this.cesPipelineRoot, slug);
      if (!fs.existsSync(filePath)) {
        const legacy = legacyNestedTenantJsonPath(this.homeDir, slug);
        if (fs.existsSync(legacy)) filePath = legacy;
      }

      let record;
      try {
        const raw = readRawTenantJson(filePath);
        record = parseTenantRecord(raw, detectKind(raw), this.env);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('not found')) {
          throw new TenantKeysError('tenant_not_found', `Tenant config not found for slug: ${slug}`);
        }
        throw err; // SecretRef errors propagate uncaught (fail closed).
      }

      return {
        source: 'tenant-config',
        tenantId: record.tenantId,
        appId: record.appId,
        certThumbprint: record.certThumbprint,
        endpoints: {
          graph: record.endpoints.graph || GCC_HIGH_CLOUD_ENDPOINTS.graph,
          login: record.endpoints.login || GCC_HIGH_CLOUD_ENDPOINTS.login,
          arm: record.endpoints.arm || GCC_HIGH_CLOUD_ENDPOINTS.arm,
        },
      };
    }

    // No slug -- legacy env fallback (`tenantKeysService.ts:82-106`).
    const tenantId = this.env.GRAPH_TENANT_ID;
    const appId = this.env.GRAPH_CLIENT_ID;

    if (!tenantId || !appId) {
      throw new TenantKeysError(
        'degraded',
        'No tenant slug provided and GRAPH_TENANT_ID/GRAPH_CLIENT_ID env vars not set',
      );
    }

    const graphBase = this.env.GRAPH_BASE_URL || GCC_HIGH_CLOUD_ENDPOINTS.graph;

    return {
      source: 'env',
      tenantId,
      appId,
      endpoints: {
        graph: graphBase,
        login: GCC_HIGH_CLOUD_ENDPOINTS.login,
        arm: GCC_HIGH_CLOUD_ENDPOINTS.arm,
      },
    };
  }
}
