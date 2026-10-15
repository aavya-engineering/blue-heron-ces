// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-ST-3 step 2 (REQ-ces-stamper-secret-reference-resolution): an in-memory-only holding area
 * for `one_time_operator_held` secret values the operator supplies at Configure time.
 *
 * Deliberately has no persistence: no file write, no database row, no log statement anywhere in
 * this module. A value set here survives only for the life of the server process and is gone on
 * restart — the operator must re-supply it. This is the intended behavior for a value that must
 * never be written to disk.
 */
export class SecretStore {
  private static readonly data = new Map<string, Map<string, string>>();

  /** Store a resolved operator-held value for `tenant`/`variable`. Never logs the value. */
  static set(tenant: string, variable: string, value: string): void {
    if (!tenant || !variable) {
      throw new Error('SecretStore.set requires both tenant and variable');
    }
    let byVariable = this.data.get(tenant);
    if (!byVariable) {
      byVariable = new Map<string, string>();
      this.data.set(tenant, byVariable);
    }
    byVariable.set(variable, value);
  }

  /** Look up a single stored value, or undefined if never set (or cleared). */
  static get(tenant: string, variable: string): string | undefined {
    return this.data.get(tenant)?.get(variable);
  }

  /** All stored variables for a tenant, as a plain object (used to build an execution overlay). */
  static getAll(tenant: string): Record<string, string> {
    const byVariable = this.data.get(tenant);
    if (!byVariable) return {};
    return Object.fromEntries(byVariable.entries());
  }

  /** Clear one variable (or, with no `variable`, every variable) for a tenant. */
  static clear(tenant: string, variable?: string): void {
    if (variable === undefined) {
      this.data.delete(tenant);
      return;
    }
    this.data.get(tenant)?.delete(variable);
  }

  /** Test-only: drop everything for every tenant. Never called from production code. */
  static clearAll(): void {
    this.data.clear();
  }
}
