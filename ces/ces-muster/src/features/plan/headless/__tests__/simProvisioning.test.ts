// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// W5c3 (ruling R-4): the headless runner's sim-only initial-password reference.
// W5c4 (P-1): its sim-only terms-of-use upload from org-content.
import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import type { InterviewFact } from '@/shared/types/engagement';
import { readProvisioningInputs } from '../../provisioningInputs';
import { simInitialPasswordFact, simTouFileFact } from '../simProvisioning';
import { createSession } from '@/driver/sessionDriver';
import { db } from '@/shared/db/schema';

const AT = '2026-10-28T00:00:00.000Z';

describe('W5c3 R-4: simInitialPasswordFact', () => {
  test('a sim-only plan gets a one-time reference that the provisioning reader accepts (no value recorded)', () => {
    const f = simInitialPasswordFact([], 'sim', 's1-mach', AT)!;
    expect(f).toMatchObject({ question_id: 'TCP.MU.003', provenance: 'headless_runner', confidence: 'high', source: 'headless-runner:s1-mach' });
    expect(f.answer).toMatch(/^secretref:one-time:[0-9a-f-]{36}$/);
    const p = readProvisioningInputs([f], { provisioning_inputs: undefined });
    expect(p.initialPasswordRef).toBe(f.answer);
    expect(p.missing.some((m) => m.startsWith('TCP.MU.003'))).toBe(false);
    // Each call is a fresh reference.
    expect(simInitialPasswordFact([], 'sim', 's1-mach', AT)!.answer).not.toBe(f.answer);
  });

  test('a live (non-sim) plan, or a session that already holds a reference, gets nothing', () => {
    expect(simInitialPasswordFact([], 'live', 's1-mach', AT)).toBeNull();
    expect(simInitialPasswordFact([], undefined, 's1-mach', AT)).toBeNull();
    const held: InterviewFact = {
      question_id: 'TCP.MU.003',
      question_text: 'q',
      answer: 'secretref:one-time:00000000-0000-4000-8000-000000000000',
      provenance: 'operator_interview',
      confidence: 'high',
      recorded_at: AT,
    };
    expect(simInitialPasswordFact([held], 'sim', 's1-mach', AT)).toBeNull();
  });
});

describe('W5c4 P-1: simTouFileFact', () => {
  // The S1 org-content placeholder PDF ("%PDF-1.4" + a comment line).
  const ORG = {
    operator_values_without_register_row: {
      touFileName: 's1-mach-terms-of-use.pdf',
      touFileBase64: 'JVBERi0xLjQKJSBzaW0tb25seSB0ZXJtcyBvZiB1c2UgcGxhY2Vob2xkZXIK',
    },
  };

  test('a sim-only plan stores the org-content PDF through storeTouFile; the reader then emits the file', async () => {
    const handle = await createSession('individual_contractor');
    const f = (await simTouFileFact(handle.sessionId, [], 'sim', ORG, 's1-mach', AT))!;
    expect(f).toMatchObject({ question_id: 'TCP.MU.002', provenance: 'headless_runner', confidence: 'high', source: 'headless-runner:s1-mach' });
    expect(f.answer).toMatch(/^file:s1-mach-terms-of-use.pdf;sha256:[0-9a-f]{64}$/);
    const session = (await db.interview_sessions.get(handle.sessionId))!;
    const p = readProvisioningInputs([f], session);
    expect(p.touFile?.name).toBe('s1-mach-terms-of-use.pdf');
    expect(p.touFile?.base64).toBe(ORG.operator_values_without_register_row.touFileBase64);
    expect(p.missing.some((m) => m.startsWith('TCP.MU.002'))).toBe(false);
  });

  test('a live plan, org-content without the file, or a held TCP.MU.002 answer gets nothing', async () => {
    const handle = await createSession('individual_contractor');
    expect(await simTouFileFact(handle.sessionId, [], 'live', ORG, 's1-mach', AT)).toBeNull();
    expect(await simTouFileFact(handle.sessionId, [], 'sim', undefined, 's1-mach', AT)).toBeNull();
    expect(await simTouFileFact(handle.sessionId, [], 'sim', { operator_values_without_register_row: { touFileName: 'x.pdf' } }, 's1-mach', AT)).toBeNull();
    const held: InterviewFact = { question_id: 'TCP.MU.002', question_text: 'q', answer: 'file:a.pdf;sha256:' + '0'.repeat(64), provenance: 'operator_interview', confidence: 'high', recorded_at: AT };
    expect(await simTouFileFact(handle.sessionId, [held], 'sim', ORG, 's1-mach', AT)).toBeNull();
    expect((await db.interview_sessions.get(handle.sessionId))!.provisioning_inputs?.tou_file).toBeUndefined();
  });

  test('a file that is not a PDF fails loudly (storeTouFile refuses it)', async () => {
    const handle = await createSession('individual_contractor');
    const bad = { operator_values_without_register_row: { touFileName: 'tou.pdf', touFileBase64: btoa('hello') } };
    await expect(simTouFileFact(handle.sessionId, [], 'sim', bad, 's1-mach', AT)).rejects.toThrow(/not a PDF/);
  });
});
