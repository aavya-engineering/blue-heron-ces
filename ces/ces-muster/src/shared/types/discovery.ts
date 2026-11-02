// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// discovery.ts — THE DiscoveryResult row shape (GO-1 open-decision-3: "a future
// real engine's output format is decided once"). Moved here from
// src/__fixtures__/discoveryResults.ts in READINESS-1 M2 so the session record
// and the readiness exporter can reference it without depending on a fixtures
// file; the fixture re-exports this type, so there is still exactly ONE model.
export interface DiscoveryResult {
  control_id: string;
  objective_ids: string[];
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  /** MX mx-01 (MG-01): the executor's verdict, when the row came from a readiness
   * payload. Absent on bare fixture / results-file rows. */
  derived_posture?: 'met' | 'not_met' | 'partial' | 'unknown';
  /** MG-23: the registry entry ids the discovery job ran for this row, when the
   * row came from a readiness payload (the job's observations). Absent on bare
   * fixture / results-file rows, where nothing ran. */
  ran_entry_ids?: string[];
}