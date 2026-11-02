// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * Secret-reference resolution -- behavior-preserving port of
 * `ces-shared/src/config/secretRef.ts` (the subset `loadTenantConfig()`
 * consumes: `resolveSecretRef`, `isSecretRef`, `assertNoInlineSecrets`).
 * Ported rather than imported because `ces-tenant` is a standalone sibling
 * package (design 4) and moving code OUT of `ces-shared` is out of scope
 * (goal must-NOTs); semantics are identical: literals pass through, a
 * declared reference that cannot resolve throws (fail closed).
 */

/** Matches `env:NAME` or `${NAME}` where NAME is an env-var-style identifier. Port of `secretRef.ts:12`. */
const SECRET_REF_RE = /^(?:env:([A-Za-z_][A-Za-z0-9_]*)|\$\{([A-Za-z_][A-Za-z0-9_]*)\})$/;

export class SecretRefError extends Error {
  constructor(message: string) {
    super(`secret ref: ${message}`);
    this.name = 'SecretRefError';
  }
}

/** The env var name a value references, or null if the value is a literal. Port of `secretRef.ts:22-25`. */
export function secretRefName(value: string): string | null {
  const m = SECRET_REF_RE.exec(value);
  return m ? (m[1] ?? m[2]) : null;
}

export function isSecretRef(value: unknown): boolean {
  return typeof value === 'string' && secretRefName(value) !== null;
}

/**
 * Resolve a possibly-referenced secret. Literals return unchanged;
 * references resolve from `env`; unset/empty referenced vars throw.
 * Port of `secretRef.ts:41-52`.
 */
export function resolveSecretRef(
  value: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const name = secretRefName(value);
  if (name === null) return value;
  const resolved = env[name];
  if (resolved === undefined || resolved === '') {
    throw new SecretRefError(`environment variable "${name}" is not set`);
  }
  return resolved;
}

/**
 * Strict guard (opt-in via CES_STRICT_SECRETS): throws if any designated
 * secret field holds an inline literal rather than a reference.
 * Port of `secretRef.ts:77-91`.
 */
export function assertNoInlineSecrets(
  record: Record<string, unknown>,
  fields: ReadonlyArray<string>,
): void {
  const offenders: string[] = [];
  for (const f of fields) {
    const v = record[f];
    if (typeof v === 'string' && v.length > 0 && !isSecretRef(v)) {
      offenders.push(f);
    }
  }
  if (offenders.length > 0) {
    throw new SecretRefError(`inline secret(s) not permitted in: ${offenders.join(', ')}`);
  }
}
