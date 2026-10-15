// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * ODP (Organization-Defined Parameter) Value Provider
 *
 * Loads and provides ODP values from tenant manifest for injection
 * into Handlebars control narrative templates.
 *
 * Phase 08: ODP Value Pipeline
 */

export interface OdpValue {
  controlId: string;
  odpId: string;
  description: string;
  value: string;
  rationale?: string;
  enforcementMechanism: string;
  source?: string;
}

/**
 * Provides ODP values for control narrative templates.
 *
 * Usage:
 *   const provider = new OdpValueProvider(manifest.odpValues);
 *   const odp = provider.getByControlId('AC.L2-3.1.8');
 *   // Use odp.value, odp.enforcementMechanism in templates
 */
export class OdpValueProvider {
  private odpMap: Map<string, OdpValue> = new Map();

  constructor(odpValues?: Record<string, OdpValue>) {
    if (odpValues) {
      for (const [controlId, odp] of Object.entries(odpValues)) {
        this.odpMap.set(controlId, odp);
      }
    }
  }

  /**
   * Get ODP values for a given control ID.
   * Returns null if no ODP defined for the control.
   *
   * @param controlId - CMMC control ID (e.g., "AC.L2-3.1.8")
   * @returns Object with value, enforcementMechanism, rationale, description, source fields
   */
  getByControlId(controlId: string): {
    value: string;
    enforcementMechanism: string;
    rationale: string;
    description: string;
    source: string;
  } | null {
    const odp = this.odpMap.get(controlId);
    if (!odp) return null;

    return {
      value: odp.value,
      enforcementMechanism: odp.enforcementMechanism,
      rationale: odp.rationale || '',
      description: odp.description,
      source: odp.source || '',
    };
  }

  /**
   * Get count of loaded ODP values (for diagnostics).
   */
  getLoadedCount(): number {
    return this.odpMap.size;
  }

  /**
   * Check if an ODP value is defined for a control.
   */
  hasOdp(controlId: string): boolean {
    return this.odpMap.has(controlId);
  }
}
