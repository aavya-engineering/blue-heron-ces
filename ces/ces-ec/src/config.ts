// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EC runtime configuration. Every value is read from the environment AT CALL TIME
// (never cached at module load) so tests and operators can flip env per run.
// FIN-42 (SP-4): the two secrets read through secretEnv(), the module-secret view (a DPAPI store
// value wins per name; with no store it IS process.env).
import { secretEnv } from 'ces-shared/secrets';

export const DEFAULT_EC_PORT = 4001;
/**
 * PH7-SEC (founder rule 10-30, no loopback-only defaults): EC listens on every interface unless
 * EC_HOST names one address. Network callers are gated by the bearer token (auth.ts), not the bind.
 */
export const EC_BIND_ALL = 'all';
export const DEFAULT_EC_HOST = EC_BIND_ALL;
export const DEFAULT_STALE_DAYS = 90;
export const DEFAULT_INDEX_INTERVAL_MIN = 15;
/** Decoded upload cap for POST /api/ingest (plan M2: max 10 MB). */
export const MAX_INGEST_BYTES = 10 * 1024 * 1024;
/** JSON body cap for the ingest route only: base64 inflates ~33%, plus envelope. */
export const INGEST_JSON_LIMIT = '15mb';

/** Env var names — the operator-facing surface (recorded in docs/EC-REPORT-2026-09.md). */
export const ENV = {
  port: 'EC_PORT',
  host: 'EC_HOST',
  simOnly: 'CES_EC_SIM_ONLY',
  secret: 'EVIDENCE_OPS_SECRET',
  staleDays: 'EC_STALE_DAYS',
  indexIntervalMin: 'EC_INDEX_INTERVAL_MIN',
  principalSecret: 'CES_EC_PRINCIPAL_SECRET',
  principalIssuer: 'CES_EC_PRINCIPAL_ISSUER',
  principalAudience: 'CES_EC_PRINCIPAL_AUDIENCE',
} as const;

type Env = Record<string, string | undefined>;

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getPort(env: Env = process.env): number {
  const n = positiveNumber(env[ENV.port], DEFAULT_EC_PORT);
  return Number.isInteger(n) && n < 65536 ? n : DEFAULT_EC_PORT;
}

export function getHost(env: Env = process.env): string {
  return env[ENV.host]?.trim() || DEFAULT_EC_HOST;
}

/**
 * Sim rail. ON unless CES_EC_SIM_ONLY is exactly '0' — any other value (unset,
 * '1', 'true', typo) keeps the rail on. Fail closed.
 */
export function isSimOnly(env: Env = process.env): boolean {
  return env[ENV.simOnly] !== '0';
}

export function getSecret(env: Env = secretEnv()): string | undefined {
  const s = env[ENV.secret];
  return s && s.length > 0 ? s : undefined;
}

/** NS-0: HS256 settings for the uploader's x-ces-principal token. Secret unset => undefined. */
export function getPrincipalConfig(env: Env = secretEnv()): { secret: string; issuer?: string; audience?: string } | undefined {
  const secret = env[ENV.principalSecret];
  if (!secret) return undefined;
  const issuer = env[ENV.principalIssuer];
  const audience = env[ENV.principalAudience];
  return { secret, ...(issuer ? { issuer } : {}), ...(audience ? { audience } : {}) };
}

export function getStaleDays(env: Env = process.env): number {
  return positiveNumber(env[ENV.staleDays], DEFAULT_STALE_DAYS);
}

export function getIndexIntervalMin(env: Env = process.env): number {
  return positiveNumber(env[ENV.indexIntervalMin], DEFAULT_INDEX_INTERVAL_MIN);
}
