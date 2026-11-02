// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { CESDriftPolicy } from '../types/ces-artifacts.types.js';

/**
 * Phase 3.2 — Drift Exception Registry
 *
 * Indexes approved drift_policies by control_id + config_key.
 * When a task targets a config key covered by an approved exception,
 * TaskRunner routes it to manual_gate rather than executing it directly.
 *
 * Source: REVIEW.md P1 — "won't overwrite custom intentional exceptions."
 */
export class DriftExceptionRegistry {
  // Composite key: `${control_id}::${config_key}` → policy
  private index: Map<string, CESDriftPolicy>;
  // Scope-level policies indexed by control_id alone
  private controlIndex: Map<string, CESDriftPolicy[]>;

  constructor(driftPolicies: CESDriftPolicy[]) {
    this.index = new Map();
    this.controlIndex = new Map();
    this.buildIndex(driftPolicies);
  }

  private buildIndex(policies: CESDriftPolicy[]): void {
    for (const policy of policies) {
      if (policy.control_id && policy.config_key) {
        const key = this.compositeKey(policy.control_id, policy.config_key);
        this.index.set(key, policy);
      }

      if (policy.control_id) {
        const existing = this.controlIndex.get(policy.control_id) ?? [];
        existing.push(policy);
        this.controlIndex.set(policy.control_id, existing);
      }
    }
  }

  private compositeKey(controlId: string, configKey: string): string {
    return `${controlId}::${configKey}`;
  }

  /**
   * Returns true when an approved exception exists for this controlId + configKey pair.
   * A task matching an approved exception must be routed to manual_gate.
   */
  isExcepted(controlId: string, configKey: string): boolean {
    const exact = this.index.get(this.compositeKey(controlId, configKey));
    if (exact) {
      return exact.approval_status === 'approved';
    }

    // Fall back to control-level scope policies
    const controlPolicies = this.controlIndex.get(controlId) ?? [];
    return controlPolicies.some(p => p.approval_status === 'approved');
  }

  /**
   * Returns the matching approved drift policy, or undefined if none.
   */
  getException(controlId: string, configKey: string): CESDriftPolicy | undefined {
    const exact = this.index.get(this.compositeKey(controlId, configKey));
    if (exact?.approval_status === 'approved') {
      return exact;
    }

    const controlPolicies = this.controlIndex.get(controlId) ?? [];
    return controlPolicies.find(p => p.approval_status === 'approved');
  }
}
