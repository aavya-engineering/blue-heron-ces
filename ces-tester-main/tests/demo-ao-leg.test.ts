// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-3 M3 — Beat 5's gate and its verdict-to-result mapping.
//
// Pure parse/predicate tests only, per the plan: `runAoLeg` is never called
// here — it spawns a GUI server and binds a port. What is pinned is the part
// that decides what the demo SHOWS: a self-gated environment must degrade to
// "AO detail pending" rather than crash, and an unsatisfied artifact verdict
// must never surface as a silent pass just because the drive returned cleanly
// (finding #6 — a dry run also writes a row, and the exit code proves nothing).
import { describe, it, expect } from 'vitest';
import {
  gateAoLeg,
  buildAoLegResult,
  aoDbPath,
  AO_DEMO_COMMAND_ID,
  type AoLegGate,
} from '../src/demo/ao-leg.js';
import { evaluateAoEvidence, parseAoEvidenceRow, simTenantId, type AoEvidenceRow } from '../src/demo/ao-evidence.js';
import type { LedgerEntry } from '../src/stacksim-client/types.js';

const WIN = { platform: 'win32', aoCliExists: true, shimExists: true };
const OPEN_GATE: AoLegGate = { available: true };
const TENANT = simTenantId('demo-dib-small');

function mutation(): LedgerEntry {
  return {
    ts: '2026-08-29T21:19:55.000Z',
    type: 'mutate',
    objectType: 'authorizationPolicy',
    objectId: 'authorizationPolicy',
    actor: 'ao',
    source: 'test',
    milestone: 'M3',
    sessionType: 'sim',
    requestId: 'req-1',
  };
}

function row(stateChanged: boolean): AoEvidenceRow {
  return parseAoEvidenceRow({
    collection: 'adminops_evidence',
    id: 'A-18:A-18-1788038395123',
    tenant_id: TENANT,
    tenant_slug: null,
    created_at: '2026-08-29T21:19:55.123Z',
    data: JSON.stringify({
      evidence: {
        outcome: 'automated_success',
        complianceVerdict: 'SAT',
        metadata: {
          stateChanged,
          commandExecuted: "Invoke-MgGraphRequest -Method PATCH -Uri '/v1.0/policies/authorizationPolicy'",
          sha256Hash: '0190614b68378817340dec14fad65f836c4630d410c7a712123f88bf0e6498a5',
          preStateOutput: '[dry-run] PowerShell commands validated',
        },
      },
    }),
  })!;
}

const LIVE_VERDICT = evaluateAoEvidence({
  rowsBefore: [],
  rowsAfter: [row(true)],
  ledgerBefore: [],
  ledgerAfter: [mutation()],
});
const DRY_VERDICT = evaluateAoEvidence({
  rowsBefore: [],
  rowsAfter: [row(false)],
  ledgerBefore: [],
  ledgerAfter: [],
});

describe('gateAoLeg', () => {
  it('opens on a built, Windows environment with the shim present', () => {
    expect(gateAoLeg(WIN)).toEqual({ available: true });
  });

  it('self-gates off Windows — every AO path spawns powershell.exe', () => {
    const g = gateAoLeg({ ...WIN, platform: 'linux' });
    expect(g.available).toBe(false);
    expect(g.reason).toMatch(/Windows/);
  });

  it('self-gates when ces-ao is not built', () => {
    expect(gateAoLeg({ ...WIN, aoCliExists: false })).toEqual({
      available: false,
      reason: 'ces-ao is not built (dist/cli/index.js absent)',
    });
  });

  it('self-gates when the Microsoft.Graph shim manifest is missing', () => {
    expect(gateAoLeg({ ...WIN, shimExists: false }).reason).toMatch(/shim manifest missing/);
  });
});

describe('buildAoLegResult', () => {
  it('reports a live, proven beat as executed with a satisfied verdict and no error', () => {
    const r = buildAoLegResult({
      gate: OPEN_GATE,
      tenantId: TENANT,
      commandId: AO_DEMO_COMMAND_ID,
      executed: true,
      verdict: LIVE_VERDICT,
      ui: { statusBadge: 'SUCCESS', outcomeBadge: 'automated_success' },
    });
    expect(r).toMatchObject({ available: true, executed: true, tenantId: TENANT, commandId: 'A-18' });
    expect(r.verdict?.satisfied).toBe(true);
    expect(r.error).toBeUndefined();
  });

  it('surfaces a reason when the artifacts do not prove the write, even on a clean drive', () => {
    const r = buildAoLegResult({
      gate: OPEN_GATE,
      tenantId: TENANT,
      commandId: AO_DEMO_COMMAND_ID,
      executed: true,
      verdict: DRY_VERDICT,
      ui: { statusBadge: 'SUCCESS', outcomeBadge: 'automated_success' }, // green badges, unproven write
    });
    expect(r.executed).toBe(true);
    expect(r.verdict?.satisfied).toBe(false);
    expect(r.error).toMatch(/AO evidence not proven/);
    expect(r.error).toMatch(/stateChanged=false/);
    expect(r.error).toMatch(/no mutate entry/);
  });

  it('keeps a live failure’s own message rather than overwriting it with the verdict text', () => {
    const r = buildAoLegResult({
      gate: OPEN_GATE,
      tenantId: TENANT,
      commandId: AO_DEMO_COMMAND_ID,
      executed: false,
      error: 'GUI server never became ready at http://127.0.0.1:3001/api/commands (90000ms)',
    });
    expect(r.available).toBe(true);
    expect(r.executed).toBe(false);
    expect(r.error).toMatch(/never became ready/);
  });

  it('renders a self-gated env as unavailable with the gate’s reason, never as a pass', () => {
    const r = buildAoLegResult({
      gate: { available: false, reason: 'ces-ao is not built (dist/cli/index.js absent)' },
      tenantId: TENANT,
      commandId: AO_DEMO_COMMAND_ID,
      executed: false,
    });
    expect(r).toEqual({
      available: false,
      executed: false,
      tenantId: TENANT,
      commandId: 'A-18',
      error: 'ces-ao is not built (dist/cli/index.js absent)',
    });
  });
});

describe('aoDbPath', () => {
  it('defaults to the run-scoped pipeline root’s ces.db (never the shared C:\\CES_Pipeline)', () => {
    expect(aoDbPath('C:\\run\\pipeline').replace(/\\/g, '/')).toBe('C:/run/pipeline/ces.db');
  });

  it('honours an explicit override', () => {
    expect(aoDbPath('C:\\run\\pipeline', 'D:\\other.db')).toBe('D:\\other.db');
  });
});
