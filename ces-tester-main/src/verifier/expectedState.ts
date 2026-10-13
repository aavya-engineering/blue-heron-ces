// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// expectedState.ts — G-TESTER-2 M3 task 4: the structured verifier.
// Evaluates a scenario's expected_state.checks against stacksim /resolve,
// producing PER-ASSERTION pass/fail rows; on any mismatch, diverged_commands
// is populated from a REAL /ledger query (never hand-rolled).
import { resolve as resolveHttp, queryLedger } from '../stacksim-client/http.js';
import type { ResolveRequestBody } from '../stacksim-client/types.js';
import type { ResultAssertion, DivergedCommand } from '../results/result-shape.js';

export interface ExpectedStateCheck {
  /** Human-readable label; falls back to a generated one. */
  description?: string;
  /** The /resolve request that reads the state under test. */
  request: ResolveRequestBody;
  /** For collection responses: pick the item whose [field] === equals. */
  select?: { field: string; equals: string };
  /** Dotted path into the (selected) object, e.g. "state" or "grantControls.operator". */
  path: string;
  assert: 'equals' | 'exists' | 'includes';
  value?: unknown;
  /** Ledger objectType consulted for divergence evidence on failure. */
  ledger_object_type?: string;
}

function requestLabel(req: ResolveRequestBody): string {
  return req.kind === 'uri' ? `${req.method} ${req.uri}` : req.cmdlet;
}

function getByDottedPath(obj: unknown, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** Normalize a /resolve response to the single object under test. */
function normalize(data: unknown, check: ExpectedStateCheck): { obj?: unknown; err?: string } {
  let candidate = data;
  if (candidate && typeof candidate === 'object' && Array.isArray((candidate as { value?: unknown }).value)) {
    candidate = (candidate as { value: unknown[] }).value;
  }
  if (Array.isArray(candidate)) {
    if (check.select) {
      const found = candidate.find(
        (o) => o && typeof o === 'object' && (o as Record<string, unknown>)[check.select!.field] === check.select!.equals
      );
      if (!found) return { err: `no item with ${check.select.field}="${check.select.equals}" in ${candidate.length}-item collection` };
      return { obj: found };
    }
    if (candidate.length === 1) return { obj: candidate[0] };
    return { err: `collection has ${candidate.length} items and the check has no select — ambiguous` };
  }
  return { obj: candidate };
}

export interface ExpectedStateVerdict {
  assertions: ResultAssertion[];
  diverged: DivergedCommand[];
}

export async function verifyExpectedState(
  serverUrl: string,
  checks: ExpectedStateCheck[]
): Promise<ExpectedStateVerdict> {
  const assertions: ResultAssertion[] = [];
  const diverged: DivergedCommand[] = [];

  for (const check of checks) {
    const label = check.description ?? `${requestLabel(check.request)} :: ${check.path} ${check.assert}${check.assert === 'equals' ? ` ${JSON.stringify(check.value)}` : ''}`;
    let pass = false;
    let actual: unknown;
    try {
      const data = await resolveHttp(serverUrl, check.request);
      const { obj, err } = normalize(data, check);
      if (err) {
        actual = err;
      } else {
        actual = getByDottedPath(obj, check.path);
        if (check.assert === 'exists') pass = actual !== undefined && actual !== null;
        else if (check.assert === 'equals') pass = JSON.stringify(actual) === JSON.stringify(check.value);
        else if (check.assert === 'includes')
          pass = Array.isArray(actual)
            ? actual.includes(check.value as never)
            : typeof actual === 'string' && typeof check.value === 'string' && actual.includes(check.value);
      }
    } catch (e) {
      actual = `resolve failed: ${e instanceof Error ? e.message : e}`;
    }

    assertions.push({
      stage: 'expected_state',
      check: label,
      result: pass ? 'pass' : 'fail',
      ...(check.assert === 'equals' ? { expected: check.value } : {}),
      actual: typeof actual === 'string' ? actual : JSON.stringify(actual),
    });

    if (!pass) {
      // REAL /ledger query (M3 gate: "not hand-rolled"): the mutations that
      // touched this object type are the divergence evidence — what the
      // pipeline actually did vs what the scenario expected. A ledger-query
      // failure (e.g. the stacksim serve died mid-run — observed live in the
      // gp-m1-gate-1 teams-external-baseline crash) must degrade to an honest
      // diverged row, never crash the runner out of writing result.json.
      let entries: Awaited<ReturnType<typeof queryLedger>>;
      try {
        entries = await queryLedger(serverUrl, {
          type: 'mutate',
          ...(check.ledger_object_type ? { objectType: check.ledger_object_type } : {}),
        });
      } catch (e) {
        diverged.push({
          command: `ledger query failed: ${e instanceof Error ? e.message : e} — stacksim serve unreachable at divergence-evidence time`,
          expected: { path: check.path, [check.assert]: check.assert === 'equals' ? check.value : true },
          actual,
        });
        continue;
      }
      if (entries.length > 0) {
        for (const e of entries) {
          diverged.push({
            command: `${e.source} (mutate ${e.objectType}/${e.objectId} @ ${e.ts})`,
            expected: { path: check.path, [check.assert]: check.assert === 'equals' ? check.value : true },
            actual,
          });
        }
      } else {
        diverged.push({
          command: `ledger query {type:mutate${check.ledger_object_type ? `, objectType:${check.ledger_object_type}` : ''}} returned 0 mutations — nothing ever wrote this state`,
          expected: { path: check.path, [check.assert]: check.assert === 'equals' ? check.value : true },
          actual,
        });
      }
    }
  }

  return { assertions, diverged };
}