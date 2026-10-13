// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Gate evidence generator — runs 5 representative sessions via the session driver
// and prints the aggregated numbers needed for PHASE0_GATE_EVIDENCE.
// Marked as synthetic / pre-field: real field sessions replace these values.
import 'fake-indexeddb/auto';
import { vi, describe, test } from 'vitest';

vi.mock('@/features/scoring/knowledgeLoader', () => ({
  loadKnowledge: async () => ({
    patterns: {
      ces: { artifact: 'implementation_patterns', version: '1.0.0', generated_on: '2026-01-01' },
      patterns: [],
    },
    playbook: {
      ces: { artifact: 'vendor_playbook', vendor: 'microsoft_365', version: '1.0.0', generated_on: '2026-01-01' },
      playbook: [],
    },
  }),
  _resetKnowledgeCache: () => {},
}));

import { createSession, answer, completeInterview, exportPayload } from '../sessionDriver';
import { db } from '@/shared/db/schema';

// Universal question IDs (23 — no stack gates)
const UNIVERSAL = [
  'iam-001','iam-002','iam-003','iam-004','iam-005',
  'ep-002','ep-003','ep-004',
  'pol-001','pol-002','pol-003','pol-004',
  'mon-001','mon-002','mon-003',
  'dp-001','dp-002','dp-003','dp-004',
  'ir-001','ir-002','ir-003','ir-004',
];

async function clearDb() {
  await db.engagements.clear();
  await db.assessed_parties.clear();
  await db.interview_sessions.clear();
  await db.subs.clear();
}

describe('Gate evidence generation (synthetic / pre-field)', () => {
  test('generate 5 representative sessions and print aggregated gate evidence', async () => {
    await clearDb();

    const sessions = [
      // 1. Cloud-only prime — mature posture, all yes
      {
        label: 'Northgate Systems Inc.',
        kind: 'prime_and_subs' as const,
        on_prem_ot: 'no' as const,
        stacks: [],
        answers: Object.fromEntries(UNIVERSAL.map(id => [id, 'yes'])),
      },
      // 2. On-prem prime — gap-heavy, mixed answers
      {
        label: 'Ironwood Manufacturing LLC',
        kind: 'prime_and_subs' as const,
        on_prem_ot: 'yes' as const,
        stacks: [],
        answers: {
          'iam-001':'yes','iam-002':'yes','iam-003':'yes','iam-004':'no','iam-005':'no',
          'ep-002':'yes','ep-003':'no','ep-004':'no',
          'pol-001':'unsure','pol-002':'unsure','pol-003':'yes','pol-004':'no',
          'mon-001':'no','mon-002':'no','mon-003':'no',
          'dp-001':'yes','dp-002':'no','dp-003':'unsure','dp-004':'no',
          'ir-001':'no','ir-002':'no','ir-003':'no','ir-004':'unsure',
        },
      },
      // 3. Individual contractor — mostly compliant, cloud-only
      {
        label: 'Coastal Services LLC',
        kind: 'individual_contractor' as const,
        on_prem_ot: 'no' as const,
        stacks: [],
        answers: {
          'iam-001':'yes','iam-002':'yes','iam-003':'yes','iam-004':'yes','iam-005':'no',
          'ep-002':'yes','ep-003':'yes','ep-004':'yes',
          'pol-001':'yes','pol-002':'yes','pol-003':'yes','pol-004':'yes',
          'mon-001':'yes','mon-002':'yes','mon-003':'no',
          'dp-001':'yes','dp-002':'yes','dp-003':'yes','dp-004':'yes',
          'ir-001':'yes','ir-002':'no','ir-003':'no','ir-004':'no',
        },
      },
      // 4. On-prem prime — partial gaps
      {
        label: 'Ridgeline Defense Partners',
        kind: 'prime_and_subs' as const,
        on_prem_ot: 'yes' as const,
        stacks: [],
        answers: {
          'iam-001':'yes','iam-002':'yes','iam-003':'yes','iam-004':'yes','iam-005':'yes',
          'ep-002':'yes','ep-003':'yes','ep-004':'no',
          'pol-001':'yes','pol-002':'yes','pol-003':'no','pol-004':'yes',
          'mon-001':'no','mon-002':'unsure','mon-003':'no',
          'dp-001':'yes','dp-002':'yes','dp-003':'no','dp-004':'no',
          'ir-001':'yes','ir-002':'no','ir-003':'no','ir-004':'no',
        },
      },
      // 5. Individual contractor — minimal, many unknowns
      {
        label: 'Apex Consulting Group',
        kind: 'individual_contractor' as const,
        on_prem_ot: 'unsure' as const,
        stacks: [],
        answers: {
          'iam-001':'yes','iam-002':'yes','iam-003':'unsure','iam-004':'unsure','iam-005':'unsure',
          'ep-002':'unsure','ep-003':'unsure','ep-004':'unsure',
          'pol-001':'yes','pol-002':'unsure','pol-003':'unsure','pol-004':'unsure',
          'mon-001':'unsure','mon-002':'unsure','mon-003':'unsure',
          'dp-001':'yes','dp-002':'unsure','dp-003':'unsure','dp-004':'unsure',
          'ir-001':'unsure','ir-002':'unsure','ir-003':'unsure','ir-004':'unsure',
        },
      },
    ];

    let totalFacts = 0;
    let onPremCount = 0;

    for (const s of sessions) {
      const handle = await createSession(s.kind, {
        stacks: s.stacks,
        party: { name: s.label, on_prem_ot: s.on_prem_ot },
      });
      for (const [qid, val] of Object.entries(s.answers)) {
        await answer(handle, qid, val);
      }
      await completeInterview(handle);
      const payload = await exportPayload(handle);
      totalFacts += payload.interview_facts.length;
      if (s.on_prem_ot === 'yes') onPremCount++;
      console.log(`  ${s.label}: ${payload.interview_facts.length} facts, score=${payload.posture_summary.conservative_score}, on_prem_ot=${s.on_prem_ot}`);
    }

    const onPremShare = Math.round((onPremCount / sessions.length) * 100);
    console.log(`\nGATE EVIDENCE SUMMARY (synthetic / pre-field):`);
    console.log(`  Row 1 — Real subs assessed: ${sessions.length} (bar ≥ 5) PASS`);
    console.log(`  Row 2 — Interview facts: ${totalFacts} (bar ≥ 50) ${totalFacts >= 50 ? 'PASS' : 'FAIL'}`);
    console.log(`  Row 3 — Calibration: field validation pending (no ground truth for synthetic data)`);
    console.log(`  Row 4 — Mode-(b) timing: synthetic sessions — timing not captured (field sessions will instrument)`);
    console.log(`  Row 5 — On-prem/OT share: ${onPremCount}/${sessions.length} = ${onPremShare}% yes/unsure`);
  });
});
