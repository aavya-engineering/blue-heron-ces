// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { BTCEvidenceRef } from '@/shared/types/artifacts';
import type { EvidenceItem } from '../types';

/**
 * Convert BTC evidence references into RRT EvidenceItem format.
 */
export function adaptBTCEvidence(refs: BTCEvidenceRef[]): EvidenceItem[] {
  return refs.map((ref) => ({
    evidence_id: ref.evidence_id,
    source_system: ref.source_system,
    location: ref.location,
    hash_sha256: ref.hash_sha256,
    captured_at: ref.captured_at,
    archetype_id: 'btc_evidence',
    supporting_question_ids: [ref.question_id],
    notes: ref.notes ? `From BTC: ${ref.notes}` : 'From BTC',
  }));
}
