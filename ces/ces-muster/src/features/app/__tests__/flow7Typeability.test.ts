// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// @vitest-environment node

// FIN-32 (FLOW-7, V125): can the watched UI run TYPE every answer in a simulator customer's
// interview-answers.json? An answer is typeable when its question is a graph node the interview
// can show, and the answer is one of the node's radio values or parses for its typed input.
// The answers files live in the run package (<PKG>\customers\<slug>); the test skips when the
// package is not beside the mono checkout. The untypeable set is pinned, so a change to the
// question data or the answers files shows up here (LOG-FIN-32 §4).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test, expect } from 'vitest';
import { QUESTION_GRAPH, type QuestionNode } from '@/features/interview/questionGraph';
import { parsePlanInputAnswer } from '@/features/interview/siPlanInputNodes';

const PKG_CANDIDATES = [
  process.env.CES_MUSTER_RUN_PKG,
  path.resolve(__dirname, '../../../../../../pkg/ces-muster-run'),
].filter((p): p is string => !!p);
const PKG = PKG_CANDIDATES.find((p) => fs.existsSync(path.join(p, 'customers')));

interface Answer { question_id: string; question_text: string; answer: string }

export type Typeability =
  | { kind: 'radio' | 'input' | 'file' | 'secret' }
  | { kind: 'no-node' | 'retired-node' | 'bad-value'; detail?: string };

export function typeability(node: QuestionNode | undefined, answer: string): Typeability {
  if (!node) return { kind: 'no-node' };
  if (node.alias_of) return { kind: 'retired-node' };
  if (node.input === 'file') return { kind: 'file' };
  if (node.input === 'secret') return { kind: 'secret' };
  if (node.input) {
    const p = parsePlanInputAnswer(node.input, answer);
    return p.ok ? { kind: 'input' } : { kind: 'bad-value', detail: p.reason };
  }
  return node.options.some((o) => o.value === answer)
    ? { kind: 'radio' }
    : { kind: 'bad-value', detail: `not one of ${node.options.map((o) => o.value).join('|')}` };
}

const byId = new Map(QUESTION_GRAPH.map((n) => [n.id, n]));
const SCENARIOS = ['s1-mach', 's2-eng', 's3-def'];

describe.skipIf(!PKG)('FLOW-7 typeability of the answers files', () => {
  for (const slug of SCENARIOS) {
    test(`${slug}: every answer is typeable (FIN-32b: the 15 policy ODPs are graph nodes now)`, () => {
      const file = path.join(PKG!, 'customers', slug, 'interview-answers.json');
      const answers = JSON.parse(fs.readFileSync(file, 'utf8')) as Answer[];
      const report: Record<string, string[]> = {};
      for (const a of answers) {
        const t = typeability(byId.get(a.question_id), a.answer);
        const key = 'detail' in t && t.detail ? `${t.kind}: ${t.detail}` : t.kind;
        (report[key] ??= []).push(a.question_id);
      }
      // Printed for the log (LOG-FIN-32 §4).
      console.log(`FLOW7_TYPEABILITY ${slug} ${JSON.stringify(report)}`);
      const untypeable = answers
        .filter((a) => !['radio', 'input'].includes(typeability(byId.get(a.question_id), a.answer).kind))
        .map((a) => a.question_id);
      // FIN-32b: PI.ODP.001-015 have nodes (policyInputNodes.ts), so nothing is left untypeable.
      expect(untypeable).toEqual([]);
      // question_text travels with each answer (EO interview records, V81). A typed answer carries the
      // graph node's text, so a file whose text differs would make the UI and the twin differ there.
      const textDiffers = answers.filter((x) => byId.get(x.question_id) && byId.get(x.question_id)!.text !== x.question_text);
      console.log(`FLOW7_TEXT_DIFFERS ${slug} ${textDiffers.length} ${JSON.stringify(textDiffers.map((x) => x.question_id))}`);
      // Pinned (LOG-FIN-32 S-B): at most the four CUI rows carry an older prompt than the graph node;
      // the run package's owner refreshes them (LOG-FIN-32b, diff for H3), after which none differ.
      // FIN-32b: the ODP nodes carry the bank prompt verbatim, so the ODP rows never differ.
      const STALE_CUI = ['CUI.CAT.001', 'CUI.USR.001', 'CUI.DEVOPS.002', 'CUI.ENF.001'];
      expect(textDiffers.map((x) => x.question_id).filter((id) => !STALE_CUI.includes(id))).toEqual([]);
    });
  }
});
