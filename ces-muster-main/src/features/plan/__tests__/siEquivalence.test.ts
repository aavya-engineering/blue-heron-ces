// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-PLAN-3 M1 gate (c): the SI Baseline Muster's adapter produces from
// the VFS reference engagement's answers equals Planner's stored one,
// field-for-field except generated_on.
//
// The raw SIT answers VFS entered are not on disk — only the resulting
// si_baseline.* field values (Planner's stored baseline). So this reverse-maps
// those field values back into SITAnswers via the bank's sets_its_fields (the
// generator writes raw_answer VERBATIM to each path — baselineGenerator.buildFieldMap),
// feeds them through the vendored generateSIBaseline, and asserts the output
// equals the stored baseline. This proves the bank + adapter + generator
// faithfully reproduce Planner's baseline from equal inputs.
//
// The yardstick is pinned BY CONTENT (generated_on 2026-04-22) so a later file
// cannot silently shift it.
import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { generateSIBaseline } from '@/vendored/ces-planner/services/baselineGenerator';
import type { SITAnswer } from '@/vendored/ces-planner/types/siBaseline';

const REF_DIR = '../ces-planner/customers/VFS GCC High G5 M365 + Foundation + Sentinel/inputs';
const YARDSTICK = 'si-baseline_si_baseline_mo9gr1pv_9l6bpx5.json'; // 2026-04-22, date-matched to the reference plan

function loadBankQuestions(): Array<{ id: string; sets_its_fields?: string[] }> {
  const raw = fs.readFileSync(path.resolve('public/knowledge', 'primed SI Question Bank.yaml'), 'utf8');
  const d = load(raw) as { ces?: { question_bank?: { questions?: unknown[] } } };
  return (d.ces?.question_bank?.questions ?? []) as Array<{ id: string; sets_its_fields?: string[] }>;
}

/** value at a dotted path within an object, undefined if any segment missing. */
function at(obj: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

/** Reconstruct the answer_type the generator's helpers expect for a value. */
function answerTypeFor(value: unknown): SITAnswer['answer_type'] {
  if (Array.isArray(value)) return 'multi_select';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value && typeof value === 'object') return 'structured_object';
  return 'enum';
}

describe('M1 gate (c): SI Baseline reproduces Planner\'s VFS reference', () => {
  const refPath = path.resolve(REF_DIR, YARDSTICK);
  const refExists = fs.existsSync(refPath);

  test('yardstick is the date-matched VFS reference (pinned by content)', () => {
    if (!refExists) {
      console.warn('[M1] VFS SI reference not on disk — equivalence gate skipped');
      return;
    }
    const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));
    expect(ref.ces.generated_on).toBe('2026-04-22');
  });

  test('reverse-mapped VFS answers reproduce the stored baseline (except generated_on)', () => {
    if (!refExists) return;
    const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));
    const questions = loadBankQuestions();

    // Build SITAnswers: for each question, read the VFS baseline value at each
    // of its sets_its_fields and set raw_answer to it verbatim.
    const answers: Record<string, SITAnswer> = {};
    const coveredPaths: string[] = [];
    for (const q of questions) {
      for (const fieldPath of q.sets_its_fields ?? []) {
        const value = at(ref, fieldPath);
        if (value === undefined) continue;
        coveredPaths.push(fieldPath);
        answers[q.id] = {
          question_id: q.id,
          answer_type: answerTypeFor(value),
          raw_answer: value as SITAnswer['raw_answer'],
          captured_at: '1970-01-01T00:00:00.000Z',
          provenance_class: 'client_assertion',
        };
      }
    }

    const produced = generateSIBaseline(answers, { ces: { question_bank: { questions } } }, 0);

    // Compare si_baseline.* deep-equal; report diverging paths legibly.
    const diverging: string[] = [];
    const walk = (a: unknown, b: unknown, p: string) => {
      if (JSON.stringify(a) === JSON.stringify(b)) return;
      if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
        const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
        for (const k of keys) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], p ? `${p}.${k}` : k);
      } else {
        diverging.push(`${p}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
      }
    };
    walk(produced.si_baseline, ref.si_baseline, 'si_baseline');

    if (diverging.length) console.error('DIVERGING FIELDS:\n' + diverging.join('\n'));
    expect(diverging).toEqual([]);
  });
});
