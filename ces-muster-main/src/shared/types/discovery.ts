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
}