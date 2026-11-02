// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// discoveryEvidence.ts — MG-09 (BTC-lite): a discovery observation's
// raw_capture_ref (muster-api discoveryService writes one per read that
// returned output) becomes an evidence item.
//
// One item per captured registry entry (the executor pushes one observation
// per covered control, all carrying the same capture), so:
//   evidence_id          `disc:<entry_id>`
//   location             the raw_capture_ref (raw output is never inlined)
//   mapped_requirements  every control_id the entry's captured observations cover
//                        (the posture's requirement ids; postureGenerator reads them)
//   btc_question_id      the BTC bank question the capture evidences (btcEvidenceMap.json)
// Observations without a raw_capture_ref (manual-only, failed, empty, degraded)
// are not evidence.
import type { ReadinessObservation } from '@/shared/types/readinessResult';
import evidenceMap from './btcEvidenceMap.json';

export interface DiscoveryEvidenceItem {
  evidence_id: string;
  entry_id: string;
  source_system: string;
  location: string;
  /** The capture lives off-line behind raw_capture_ref; the session holds no hash of it. */
  hash_sha256: string;
  captured_at: string;
  mapped_requirements: string[];
  /** The executor's verdict on the read (MG-02). */
  verdict: ReadinessObservation['derived_posture'];
  btc_question_id?: string;
  /** The BTC answer the verdict reads as, when the map says the predicate reads the question's fact. */
  btc_answer?: string;
}

interface EvidenceMapRow {
  question: string;
  basis: string;
  answer_on_verdict?: { met?: string; not_met?: string };
}

const MAP = (evidenceMap as { entries: Record<string, EvidenceMapRow> }).entries;

export const DISCOVERY_EVIDENCE_SOURCE = 'muster-discovery';

/** The map row for a ran entry id ("tenant:<id>" scoped ids resolve to <id>). */
function mapRow(entryId: string): EvidenceMapRow | undefined {
  return MAP[entryId] ?? MAP[entryId.slice(entryId.indexOf(':') + 1)];
}

/** Captured observations -> one evidence item per captured entry, in first-seen order. */
export function discoveryEvidenceItems(
  observations: ReadinessObservation[] | undefined,
  capturedAt: string
): DiscoveryEvidenceItem[] {
  const byEntry = new Map<string, DiscoveryEvidenceItem>();
  for (const o of observations ?? []) {
    if (!o.raw_capture_ref) continue;
    for (const entryId of o.ran_entry_ids) {
      let item = byEntry.get(entryId);
      if (!item) {
        const row = mapRow(entryId);
        const answer =
          o.derived_posture === 'met' || o.derived_posture === 'not_met'
            ? row?.answer_on_verdict?.[o.derived_posture]
            : undefined;
        item = {
          evidence_id: `disc:${entryId}`,
          entry_id: entryId,
          source_system: DISCOVERY_EVIDENCE_SOURCE,
          location: o.raw_capture_ref,
          hash_sha256: '',
          captured_at: capturedAt,
          mapped_requirements: [],
          verdict: o.derived_posture,
          ...(row ? { btc_question_id: row.question } : {}),
          ...(answer ? { btc_answer: answer } : {}),
        };
        byEntry.set(entryId, item);
      }
      if (!item.mapped_requirements.includes(o.control_id)) item.mapped_requirements.push(o.control_id);
    }
  }
  return [...byEntry.values()];
}

/** The BTC question ids the map can evidence (the register's "not asked" set). */
export function btcEvidencedQuestionIds(): string[] {
  return [...new Set(Object.values(MAP).map((r) => r.question))];
}
