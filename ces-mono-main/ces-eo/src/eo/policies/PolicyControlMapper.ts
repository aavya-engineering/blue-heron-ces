// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import type { CmmcControl } from 'ces-shared/types/controls';
import type { PolicyDocument } from 'ces-shared/types/policy';

interface ControlsReference {
  total_controls: number;
  controls: CmmcControl[];
}

/**
 * Maps NIST 800-171 control IDs to CMMC L2 practice IDs using
 * cmmc-l2-controls.reference.json.
 *
 * Builds a reverse index Map<nist_ref, control_id> at initialization.
 * Mapping is 1:1 bidirectional.
 */
export class PolicyControlMapper {
  private readonly nistToCmmc: Map<string, string>;
  private readonly cmmcToFamily: Map<string, string>;

  constructor(controlsRefPath: string) {
    const raw = fs.readFileSync(controlsRefPath, 'utf-8');
    const ref: ControlsReference = JSON.parse(raw);

    this.nistToCmmc = new Map();
    this.cmmcToFamily = new Map();

    for (const ctrl of ref.controls) {
      this.nistToCmmc.set(ctrl.nist_ref, ctrl.control_id);
      this.cmmcToFamily.set(ctrl.control_id, ctrl.family);
    }
  }

  /**
   * Maps a NIST 800-171 control ID (e.g., "3.1.1") to its CMMC practice ID
   * (e.g., "AC.L2-3.1.1"). Returns null if no mapping exists.
   */
  mapNistToCmmc(nistRef: string): string | null {
    return this.nistToCmmc.get(nistRef) ?? null;
  }

  /**
   * Maps an array of NIST control IDs to their CMMC practice IDs.
   * Skips any NIST IDs that have no mapping.
   */
  mapNistArrayToCmmc(nistRefs: string[]): string[] {
    const result: string[] = [];
    for (const ref of nistRefs) {
      const cmmc = this.nistToCmmc.get(ref);
      if (cmmc) {
        result.push(cmmc);
      }
    }
    return result;
  }

  /**
   * Returns the CMMC family code (e.g., "AC") for a given CMMC practice ID.
   */
  getFamily(cmmcControlId: string): string | null {
    return this.cmmcToFamily.get(cmmcControlId) ?? null;
  }

  /**
   * Finds policies whose nist_controls intersect with the NIST refs mapped to the given CMMC control ID.
   * Reverse-lookups NIST refs from nistToCmmc Map entries where value equals controlId.
   */
  findPoliciesByControl(controlId: string, policies: PolicyDocument[]): PolicyDocument[] {
    const nistRefs: string[] = [];
    for (const [nistRef, cmmcId] of this.nistToCmmc.entries()) {
      if (cmmcId === controlId) {
        nistRefs.push(nistRef);
      }
    }
    if (nistRefs.length === 0) return [];
    return policies.filter(p => p.nist_controls.some(ref => nistRefs.includes(ref)));
  }
}
