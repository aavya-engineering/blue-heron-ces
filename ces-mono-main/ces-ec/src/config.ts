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

export const DEFAULT_EC_PORT = 4001;
export const DEFAULT_EC_HOST = '127.0.0.1';
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

export function getSecret(env: Env = process.env): string | undefined {
  const s = env[ENV.secret];
  return s && s.length > 0 ? s : undefined;
}

export function getStaleDays(env: Env = process.env): number {
  return positiveNumber(env[ENV.staleDays], DEFAULT_STALE_DAYS);
}

export function getIndexIntervalMin(env: Env = process.env): number {
  return positiveNumber(env[ENV.indexIntervalMin], DEFAULT_INDEX_INTERVAL_MIN);
}
