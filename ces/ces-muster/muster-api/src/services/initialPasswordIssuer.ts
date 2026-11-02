// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// initialPasswordIssuer.ts — gap closure FLOW-5 (a): muster-api issues the
// initial password (TCP.MU.003) as a one-time secret reference.
//
// POST /api/plan/compile asks for one reference per compile. The value is
// generated here, held in this process's memory only (never a file, a log line,
// a response other than the resolve route's, or a plan artifact), and bound to
// the issuing caller's tenant_id and tenant slug. The plan carries only the
// reference (`secretref:one-time:<uuid>`, the shape Muster's Plan tab uses);
// Stamper resolves it at execute time through POST /api/plan/secrets/resolve.
// A restart forgets every value: the operator recompiles (a new reference).
import * as crypto from 'node:crypto';

/** The variable the reference stands for (ces-shared SECRET_VARIABLE_NAMES). */
export const INITIAL_PASSWORD_VARIABLE = 'initialPassword';

/**
 * 24 characters over A-Z a-z 0-9 and `-_.`, at least one of each class (CSPRNG).
 * The alphabet is the one the harness used before FLOW-5 (safe inside any quoting
 * Stamper's templates use), so the commands Stamper runs are unchanged.
 */
export const PASSWORD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.';

export function generateInitialPasswordValue(length = 24): string {
  for (;;) {
    let pw = '';
    for (let i = 0; i < length; i++) pw += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw) && /[-_.]/.test(pw)) return pw;
  }
}

// SP-7 (SECRETS-PLAN.md §SP-7, FIN-17): each reference has a read budget and an expiry. The
// compile asks for max_reads 1..3 (default 1; the harness asks for 2, because Stamper resolves at
// E6 and again at E8F); the default expiry is 2 hours from issue. In a release build
// (CES_RELEASE_BUILD=1, the interim marker until SP-6/FIN-44 defines the release switch) the budget
// is capped at 1. When the budget is used up or the expiry passes, the value is deleted from memory,
// and the reference then answers exactly as an unknown one (null -> the route's same 404). Each
// successful read increments a counter that holds no value; the counter is reported in Muster's
// call record (routes/plan.ts muster-eo-calls.jsonl), never through a probe route.

/** Env marker for a release build (interim; SP-6 owns the final release switch). */
export const RELEASE_BUILD_ENV = 'CES_RELEASE_BUILD';
export const DEFAULT_MAX_READS = 1;
export const MAX_MAX_READS = 3;
export const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

interface HeldSecret {
  tenantId: string;
  tenantSlug: string;
  variable: string;
  value: string;
  maxReads: number;
  reads: number;
  expiresAt: number;
}

const held = new Map<string, HeldSecret>();

export interface IssueOptions {
  /** 1..3 (default 1); capped at 1 in a release build. */
  maxReads?: number;
  /** Lifetime in ms (default 2 h). */
  ttlMs?: number;
  /** Clock (tests). */
  now?: number;
  env?: NodeJS.ProcessEnv;
}

/** The read budget a compile request gets: an integer 1..3, default 1, 1 in a release build. */
export function effectiveMaxReads(requested: number | undefined, env: NodeJS.ProcessEnv = process.env): number {
  const n = requested === undefined ? DEFAULT_MAX_READS : Math.trunc(requested);
  const bounded = Math.min(MAX_MAX_READS, Math.max(1, Number.isFinite(n) ? n : DEFAULT_MAX_READS));
  return env[RELEASE_BUILD_ENV] === '1' ? 1 : bounded;
}

/** Issue a new reference for `tenantSlug`, owned by `tenantId`. Returns the reference only. */
export function issueInitialPassword(tenantSlug: string, tenantId: string, opts: IssueOptions = {}): string {
  const ref = `secretref:one-time:${crypto.randomUUID()}`;
  const now = opts.now ?? Date.now();
  held.set(ref, {
    tenantId,
    tenantSlug,
    variable: INITIAL_PASSWORD_VARIABLE,
    value: generateInitialPasswordValue(),
    maxReads: effectiveMaxReads(opts.maxReads, opts.env),
    reads: 0,
    expiresAt: now + (opts.ttlMs ?? DEFAULT_TTL_MS),
  });
  return ref;
}

/** The budget and expiry of a live reference (no value, no read count), for the compile response. */
export function issuedSecretTerms(ref: string): { max_reads: number; expires_at: string } | null {
  const h = held.get(ref);
  return h ? { max_reads: h.maxReads, expires_at: new Date(h.expiresAt).toISOString() } : null;
}

/**
 * The held value for `ref`, only for the tenant and slug it was issued to, while it has reads left
 * and has not expired; null otherwise (unknown, consumed and expired all look the same). A read
 * that uses the last of the budget deletes the value.
 */
export function resolveIssuedSecret(
  ref: string,
  tenantSlug: string,
  tenantId: string,
  now: number = Date.now(),
): { variable: string; value: string; read: number; max_reads: number } | null {
  const h = held.get(ref);
  if (!h) return null;
  if (now >= h.expiresAt || h.reads >= h.maxReads) {
    held.delete(ref);
    return null;
  }
  if (h.tenantId !== tenantId || h.tenantSlug !== tenantSlug) return null;
  h.reads += 1;
  const out = { variable: h.variable, value: h.value, read: h.reads, max_reads: h.maxReads };
  if (h.reads >= h.maxReads) held.delete(ref);
  return out;
}

/** Forget a reference (a compile that failed or did not use it). */
export function revokeIssuedSecret(ref: string): void {
  held.delete(ref);
}

/** Test-only: forget every reference. */
export function clearIssuedSecrets(): void {
  held.clear();
}
