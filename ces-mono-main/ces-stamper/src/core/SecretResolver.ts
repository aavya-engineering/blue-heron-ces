// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-ST-3 step 2 (REQ-ces-stamper-secret-reference-resolution, ces-shared 2.8.0).
//
// Resolves a `SecretReference` (from an Infra Manifest's `secret_references[]` or a Tenant
// Manifest's `provisioning_inputs.initial_password_ref`) to its real value. Callers never see a
// blank value: a reference that cannot be resolved always throws `SecretResolutionError` with a
// message naming the variable and why, so the task it feeds can be blocked with a clear message
// instead of silently running with nothing (or a sentinel) in place of the secret.
//
// This module never logs or persists a resolved value. Resolution results only ever leave this
// module as (a) a thrown error naming the variable but not any secret material, or (b) the plain
// string handed directly to the caller, which callers must keep out of anything written to disk.
import type { SecretReference } from 'ces-shared/types/mission-plan';

export class SecretResolutionError extends Error {
  constructor(public readonly variable: string, message: string) {
    super(message);
    this.name = 'SecretResolutionError';
  }
}

export interface SecretResolverOptions {
  /**
   * `one_time_operator_held` values the operator has supplied this session, keyed by the
   * reference's `ref` marker (SecretStore.getAll(tenant) is the production source).
   */
  operatorHeld?: Record<string, string>;
  /**
   * Reads a value from Azure Key Vault. Not implemented in this session (HONEST-OPEN — no live
   * Key Vault client exists in ces-stamper yet; see the FLOW-THROUGH report). Injectable so a
   * future implementation, or a test double, can supply one without changing call sites.
   */
  keyVaultReader?: (vault: string, name: string) => string;
}

/**
 * Resolve one `SecretReference` to its plain value. Throws `SecretResolutionError` — never
 * returns an empty string — when the reference cannot be resolved with the given options.
 */
export function resolveSecretReference(ref: SecretReference, opts: SecretResolverOptions = {}): string {
  if (ref.form === 'one_time_operator_held') {
    const value = opts.operatorHeld?.[ref.ref];
    if (!value) {
      throw new SecretResolutionError(
        ref.variable,
        `Unresolved operator-held secret reference "${ref.ref}" for variable "${ref.variable}" — ` +
          'the operator must supply it at Configure time before this task can run.'
      );
    }
    return value;
  }

  // ref.form === 'key_vault_secret'
  if (!opts.keyVaultReader) {
    throw new SecretResolutionError(
      ref.variable,
      `Key Vault reader not configured — cannot resolve "${ref.vault}/${ref.name}" for variable ` +
        `"${ref.variable}". (HONEST-OPEN: live Azure Key Vault integration is not implemented in ` +
        'ces-stamper this session.)'
    );
  }
  try {
    const value = opts.keyVaultReader(ref.vault, ref.name);
    if (!value) {
      throw new SecretResolutionError(
        ref.variable,
        `Key Vault secret "${ref.vault}/${ref.name}" for variable "${ref.variable}" resolved to an empty value.`
      );
    }
    return value;
  } catch (err) {
    if (err instanceof SecretResolutionError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new SecretResolutionError(
      ref.variable,
      `Key Vault read failed for "${ref.vault}/${ref.name}" (variable "${ref.variable}"): ${msg}`
    );
  }
}

export interface SecretOverlayBuildResult {
  /** variable -> resolved value, ready for PowerShellAdapter.setSecretOverlay(). */
  overlay: Record<string, string>;
  /** One entry per reference that could not be resolved (never thrown — collected instead). */
  errors: SecretResolutionError[];
}

/**
 * Resolve every reference in `refs`, collecting successes into an overlay and failures into
 * `errors` rather than throwing on the first failure — so one unresolved secret doesn't block
 * translate-time reporting of every other reference's status.
 */
export function buildSecretOverlay(refs: readonly SecretReference[], opts: SecretResolverOptions = {}): SecretOverlayBuildResult {
  const overlay: Record<string, string> = {};
  const errors: SecretResolutionError[] = [];
  for (const ref of refs) {
    try {
      overlay[ref.variable] = resolveSecretReference(ref, opts);
    } catch (err) {
      if (err instanceof SecretResolutionError) {
        errors.push(err);
      } else {
        errors.push(new SecretResolutionError(ref.variable, err instanceof Error ? err.message : String(err)));
      }
    }
  }
  return { overlay, errors };
}
