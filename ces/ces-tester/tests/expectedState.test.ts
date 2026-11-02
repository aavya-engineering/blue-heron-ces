// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// G-TESTER-2 M3: structured verifier unit tests. fetch is stubbed to emulate
// stacksim /resolve + /ledger — the divergence path must issue a REAL ledger
// query (asserted via the stub) and map its entries, never hand-roll.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { verifyExpectedState, type ExpectedStateCheck } from '../src/verifier/expectedState.js';

const SERVER = 'http://127.0.0.1:9999';

function stubFetch(resolveData: unknown, ledgerData: unknown[]): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (url: unknown, init?: { body?: string }) => {
    const u = String(url);
    if (u.endsWith('/resolve')) {
      return { ok: true, json: async () => ({ data: resolveData }) } as Response;
    }
    if (u.endsWith('/ledger')) {
      return { ok: true, json: async () => ({ data: ledgerData }), _body: init?.body } as unknown as Response;
    }
    throw new Error(`unexpected fetch ${u}`);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

const CHECK: ExpectedStateCheck = {
  request: { kind: 'cmdlet', cmdlet: 'Get-AtpPolicyForO365' },
  path: 'EnableATPForSPOTeamsODB',
  assert: 'equals',
  value: true,
  ledger_object_type: 'atpPolicyForO365',
};

describe('verifyExpectedState', () => {
  it('passes on a matching single-object collection (auto-unwrap) and issues NO ledger query', async () => {
    const spy = stubFetch([{ id: 'atpPolicyForO365', EnableATPForSPOTeamsODB: true }], []);
    const v = await verifyExpectedState(SERVER, [CHECK]);
    expect(v.assertions).toEqual([
      expect.objectContaining({ stage: 'expected_state', result: 'pass' }),
    ]);
    expect(v.diverged).toEqual([]);
    expect(spy.mock.calls.filter(([u]) => String(u).endsWith('/ledger'))).toHaveLength(0);
  });

  it('fails honestly and populates diverged_commands FROM the ledger query', async () => {
    const spy = stubFetch(
      [{ id: 'atpPolicyForO365', EnableATPForSPOTeamsODB: false }],
      [
        {
          ts: '2026-07-12T10:00:00Z', type: 'mutate', objectType: 'atpPolicyForO365',
          objectId: 'atpPolicyForO365', actor: 'ao', source: 'Set-AtpPolicyForO365', requestId: 'r1',
        },
      ]
    );
    const v = await verifyExpectedState(SERVER, [CHECK]);
    expect(v.assertions[0].result).toBe('fail');
    expect(v.diverged.length).toBe(1);
    expect(v.diverged[0].command).toContain('Set-AtpPolicyForO365');
    // The ledger endpoint was genuinely queried with the objectType filter.
    const ledgerCalls = spy.mock.calls.filter(([u]) => String(u).endsWith('/ledger'));
    expect(ledgerCalls).toHaveLength(1);
    expect(String((ledgerCalls[0][1] as { body?: string })?.body)).toContain('atpPolicyForO365');
  });

  it('zero mutations still yields a non-empty, ledger-sourced divergence entry', async () => {
    stubFetch([{ id: 'atpPolicyForO365', EnableATPForSPOTeamsODB: false }], []);
    const v = await verifyExpectedState(SERVER, [CHECK]);
    expect(v.diverged.length).toBe(1);
    expect(v.diverged[0].command).toContain('0 mutations');
  });

  it('select picks an item from a multi-object collection; unselected ambiguity fails clearly', async () => {
    const data = [
      { id: 'caPolicy-1', state: 'enabled' },
      { id: 'caPolicy-2', state: 'disabled' },
    ];
    stubFetch(data, []);
    const withSelect = await verifyExpectedState(SERVER, [
      {
        request: { kind: 'uri', method: 'GET', uri: '/v1.0/identity/conditionalAccess/policies' },
        select: { field: 'id', equals: 'caPolicy-2' },
        path: 'state',
        assert: 'equals',
        value: 'disabled',
      },
    ]);
    expect(withSelect.assertions[0].result).toBe('pass');

    stubFetch(data, []);
    const ambiguous = await verifyExpectedState(SERVER, [
      {
        request: { kind: 'uri', method: 'GET', uri: '/v1.0/identity/conditionalAccess/policies' },
        path: 'state',
        assert: 'equals',
        value: 'enabled',
      },
    ]);
    expect(ambiguous.assertions[0].result).toBe('fail');
    expect(String(ambiguous.assertions[0].actual)).toContain('ambiguous');
  });

  it('a failing ledger query degrades to an honest diverged row — never a crash (gp-m1 teams finding)', async () => {
    const spy = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('/resolve')) {
        return { ok: true, json: async () => ({ data: [{ id: 'atpPolicyForO365', EnableATPForSPOTeamsODB: false }] }) } as Response;
      }
      if (u.endsWith('/ledger')) {
        throw new TypeError('fetch failed'); // undici's message when the serve has died
      }
      throw new Error(`unexpected fetch ${u}`);
    });
    vi.stubGlobal('fetch', spy);

    const v = await verifyExpectedState(SERVER, [CHECK]);
    expect(v.assertions[0].result).toBe('fail');
    expect(v.diverged.length).toBe(1);
    expect(v.diverged[0].command).toContain('ledger query failed');
    expect(v.diverged[0].command).toContain('fetch failed');
  });

  it('exists and includes asserts work over dotted paths', async () => {
    stubFetch({ value: [{ id: 'p1', grantControls: { builtInControls: ['mfa'] } }] }, []);
    const v = await verifyExpectedState(SERVER, [
      {
        request: { kind: 'uri', method: 'GET', uri: '/v1.0/x' },
        path: 'grantControls.builtInControls',
        assert: 'includes',
        value: 'mfa',
      },
      {
        request: { kind: 'uri', method: 'GET', uri: '/v1.0/x' },
        path: 'grantControls.operator',
        assert: 'exists',
      },
    ]);
    expect(v.assertions[0].result).toBe('pass');
    expect(v.assertions[1].result).toBe('fail'); // operator absent
  });
});