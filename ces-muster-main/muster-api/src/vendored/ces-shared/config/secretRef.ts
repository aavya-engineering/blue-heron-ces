// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Secret-reference resolution — G1 T6 security/auth foundation.
//
// Lets config externalize secrets instead of storing them inline. A secret-bearing field may hold
// either a literal (legacy, discouraged) or a REFERENCE that resolves from the environment:
//   "env:VFS_CERT_THUMBPRINT"   or   "${VFS_CERT_THUMBPRINT}"
// Literals pass through unchanged (back-compat); a declared reference that can't resolve is a hard
// error (fail closed — never silently fall back to empty). See docs/security/auth-secrets.md.
//
// Dependency-free (no node:* imports); the environment is injected so it is unit-testable.

/** Matches `env:NAME` or `${NAME}` where NAME is an env-var-style identifier. */
const SECRET_REF_RE = /^(?:env:([A-Za-z_][A-Za-z0-9_]*)|\$\{([A-Za-z_][A-Za-z0-9_]*)\})$/;

export class SecretRefError extends Error {
  constructor(message: string) {
    super(`secret ref: ${message}`);
    this.name = 'SecretRefError';
  }
}

/** The env var name a value references, or null if the value is a literal (not a reference). */
export function secretRefName(value: string): string | null {
  const m = SECRET_REF_RE.exec(value);
  return m ? (m[1] ?? m[2]) : null;
}

export function isSecretRef(value: unknown): boolean {
  return typeof value === 'string' && secretRefName(value) !== null;
}

export interface ResolvedSecret {
  value: string;
  /** True if the input was a reference (vs a literal). */
  wasRef: boolean;
}

/**
 * Resolve a possibly-referenced secret. Literals return unchanged (wasRef=false). References
 * resolve from `env`; a reference whose env var is unset/empty throws (fail closed).
 */
export function resolveSecretRef(
  value: string,
  env: Record<string, string | undefined> = process.env,
): ResolvedSecret {
  const name = secretRefName(value);
  if (name === null) return { value, wasRef: false };
  const resolved = env[name];
  if (resolved === undefined || resolved === '') {
    throw new SecretRefError(`environment variable "${name}" is not set`);
  }
  return { value: resolved, wasRef: true };
}

/**
 * Resolve any referenced secret fields on a record in place-free fashion (returns a shallow copy).
 * Non-string / absent fields are left untouched. Throws if a referenced field can't resolve.
 */
export function resolveSecretFields<T extends Record<string, unknown>>(
  record: T,
  fields: ReadonlyArray<keyof T>,
  env: Record<string, string | undefined> = process.env,
): T {
  const out = { ...record };
  for (const f of fields) {
    const v = out[f];
    if (typeof v === 'string') {
      out[f] = resolveSecretRef(v, env).value as T[keyof T];
    }
  }
  return out;
}

/**
 * Strict guard (opt-in): throws if any designated secret field holds an inline literal rather than
 * a reference. Use in hardened deployments that forbid inline secrets entirely.
 */
export function assertNoInlineSecrets<T extends Record<string, unknown>>(
  record: T,
  fields: ReadonlyArray<keyof T>,
): void {
  const offenders: string[] = [];
  for (const f of fields) {
    const v = record[f];
    if (typeof v === 'string' && v.length > 0 && !isSecretRef(v)) {
      offenders.push(String(f));
    }
  }
  if (offenders.length > 0) {
    throw new SecretRefError(`inline secret(s) not permitted in: ${offenders.join(', ')}`);
  }
}
