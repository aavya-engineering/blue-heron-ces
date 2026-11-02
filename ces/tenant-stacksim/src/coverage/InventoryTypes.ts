// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

/**
 * G-STACKSIM-2 iteration 1 — inventory types (docs/context/LOOP_STATE.md,
 * G-STACKSIM-2 Loop State / DOC-2). One InventoryItem per distinct call
 * extractable from Stamper's registries, EO's ComplianceSignalFetcher, or
 * AO's TemplateRegistry.
 */

export type InventorySource = 'stamper' | 'eo' | 'ao';

/**
 * Engine classification for a call's command text. 'spo-cmdlet' is included
 * per the task's required enum even though, as extracted, no source item
 * currently classifies into it (see IMPLEMENTATION_LOG.md iteration 1 notes).
 */
export type InventoryEngine =
  | 'graph-cmdlet'
  | 'invoke-mggraphrequest'
  | 'az-cmdlet'
  | 'exo-cmdlet'
  | 'ipps-cmdlet'
  | 'spo-cmdlet'
  | 'other';

export type InventoryClassification = 'read' | 'write';

export interface InventoryItem {
  /** Globally unique id: `${source}:${sourceRef}`. */
  id: string;
  source: InventorySource;
  /** Registry entry_id / EO fetch-method:signalId / AO template id, plus a :get|:set|:manual suffix where applicable. */
  sourceRef: string;
  engine: InventoryEngine;
  /** Verbatim command text (PowerShell) or endpoint+method description. */
  commandText: string;
  classification: InventoryClassification;
  /** Free-text extraction note - always present for excluded items, per "never silently drop". */
  notes?: string;
  /** True when the coverage harness deliberately does not execute this item. */
  excluded?: boolean;
  /** Required when excluded is true - explicit per-item justification. */
  exclusionReason?: string;
}

export interface InventoryReport {
  generatedAt: string;
  counts: Record<InventorySource, number>;
  items: InventoryItem[];
}
