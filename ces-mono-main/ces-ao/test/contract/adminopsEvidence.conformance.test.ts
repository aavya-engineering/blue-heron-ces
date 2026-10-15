// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// A4 (AE-R2): persisted-row contract conformance + golden drift test.
//
// The golden (test/fixtures/contract/adminops-evidence-rows.golden.json) is the exact
// persisted `data` JSON of 9 execution paths, produced by the REAL persist path
// (see ./evidenceGoldenGenerator.ts). ces-eo and ces-tester consume it read-only.
//
//  1. Every golden row's `metadata` parses with the shared AdminOpsEvidenceSchema and
//     carries the expected outcome/mode/dryRun (and never SAT unless it truly executed).
//  2. `metadata` is a pure contract row — no keys outside the shared schema.
//  3. Drift: the rows are regenerated in memory against a fresh temp DB and must equal
//     the golden after normalizeForDrift() (rules documented in the generator).
//
// Regenerate the golden: `npx tsx scripts/write-evidence-golden.ts`
// (runs this file with AO_WRITE_EVIDENCE_GOLDEN=1).
//
// Mock boundary: ONLY the PowerShell execution boundary — sim only, no network.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const adapterState = vi.hoisted(() => ({ fail: false }));
vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() {
      return 'mgraph';
    }
    async execute(_task: any, _variables: Record<string, any>, _dryRun: boolean) {
      return adapterState.fail
        ? { success: false, stdout: '', stderr: 'Forbidden: insufficient privileges (golden)', exit_code: 1 }
        : { success: true, stdout: JSON.stringify({ ok: true, sample: 'golden' }), stderr: '', exit_code: 0 };
    }
  }
  return { PowerShellAdapter };
});

import {
  AdminOpsEvidenceSchema,
  ADMINOPS_EVIDENCE_CONTRACT_VERSION,
} from 'ces-shared/types/adminops-evidence';
import {
  GOLDEN_PATHS,
  GOLDEN_EXPECTATIONS,
  generateGoldenRows,
  normalizeForDrift,
} from './evidenceGoldenGenerator.js';
import { loadCmmcControlCodes } from '../../src/registry/RegistryBridge.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_FILE = path.resolve(HERE, '../fixtures/contract/adminops-evidence-rows.golden.json');
const adapter = { setFailure: (f: boolean) => { adapterState.fail = f; } };

// Schema object keys (the superRefine wrapper exposes the inner object via innerType()).
const CONTRACT_KEYS = new Set(Object.keys(((AdminOpsEvidenceSchema as any).innerType?.() ?? AdminOpsEvidenceSchema).shape));

if (process.env.AO_WRITE_EVIDENCE_GOLDEN === '1') {
  describe('golden writer (AO_WRITE_EVIDENCE_GOLDEN=1)', () => {
    it('writes the golden from the real persist path', async () => {
      const rows = await generateGoldenRows(adapter);
      fs.mkdirSync(path.dirname(GOLDEN_FILE), { recursive: true });
      fs.writeFileSync(GOLDEN_FILE, JSON.stringify(rows, null, 2) + '\n', 'utf8');
      expect(Object.keys(rows)).toEqual([...GOLDEN_PATHS]);
    });
  });
}

describe('AdminOps persisted evidence — golden conformance (A4)', () => {
  // Read lazily so the writer suite (above, same file) can create/refresh it first.
  let golden: Record<string, any> = {};
  beforeAll(() => {
    golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
  });

  it('the golden holds exactly the 9 required paths', () => {
    expect(Object.keys(golden).sort()).toEqual([...GOLDEN_PATHS].sort());
  });

  for (const p of GOLDEN_PATHS) {
    describe(p, () => {
      it('metadata parses with AdminOpsEvidenceSchema', () => {
        const parsed = AdminOpsEvidenceSchema.safeParse(golden[p].metadata);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      });

      it(`carries the expected contract outcome/mode (${GOLDEN_EXPECTATIONS[p].outcome}, ${GOLDEN_EXPECTATIONS[p].mode})`, () => {
        const m = golden[p].metadata;
        // FX-AO6: asserted against the live contract constant (1.3.0 at ces-shared 03a6d0a), not a
        // pinned literal — a contract bump turns this red until the golden is regenerated.
        expect(m.contractVersion).toBe(ADMINOPS_EVIDENCE_CONTRACT_VERSION);
        // FX-AO6 / contract 1.3.0: target identity exactly as the path's request supplied it
        // (absent when the command declares no target parameter).
        expect(m.targetUPN).toBe(GOLDEN_EXPECTATIONS[p].targetUPN);
        expect(m.targetObjectId).toBeUndefined();
        expect(m.outcome).toBe(GOLDEN_EXPECTATIONS[p].outcome);
        expect(m.mode).toBe(GOLDEN_EXPECTATIONS[p].mode);
        expect(m.dryRun).toBe(GOLDEN_EXPECTATIONS[p].dryRun);
        if (m.outcome !== 'executed') expect(m.verdict).not.toBe('SAT');
        expect(m.controlIds.length).toBeGreaterThan(0);
      });

      it('metadata is a pure contract row (no keys outside the shared schema)', () => {
        const extra = Object.keys(golden[p].metadata).filter((k) => !CONTRACT_KEYS.has(k));
        expect(extra).toEqual([]);
      });

      it('keeps data.evidence and the data.ces sibling', () => {
        expect(golden[p].evidence).toBeTruthy();
        expect(golden[p].evidence.outcome).toBeTruthy();
        expect(golden[p].ces).toMatchObject({ tenantId: golden[p].metadata.tenantId });
      });
    });
  }

  it('success is the only SAT-bearing row', () => {
    expect(golden.success.metadata.verdict).toBe('SAT');
    for (const p of GOLDEN_PATHS.filter((x) => x !== 'success')) {
      expect(golden[p].metadata.verdict, p).not.toBe('SAT');
    }
  });

  // W4-AO5 (REQ-ces-ao-evidence-control-ids-reference-form, filed by ces-eo): every control id
  // on every golden row is spelled exactly as in ces-shared's cmmc-l2-controls.reference.json
  // (e.g. AC.L1-3.1.1, never AC.L2-3.1.1), so EO's exact-id CRM credit join can match it.
  it('every controlId on every golden row is a ces-shared reference control id', () => {
    const reference = loadCmmcControlCodes();
    expect(reference.size).toBe(110);
    const bad: string[] = [];
    for (const p of GOLDEN_PATHS) {
      for (const id of [...golden[p].metadata.controlIds, ...golden[p].evidence.metadata.controlIds]) {
        if (!reference.has(id)) bad.push(`${p}:${id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('rejected row carries approver + approvalId (F-4 live row)', () => {
    const m = golden.rejected.metadata;
    expect(m.approverUPN).toBe('approver@golden.onmicrosoft.us');
    expect(m.approvalId).toBeTruthy();
    expect(m.requestorUPN).toBe('requestor@golden.onmicrosoft.us');
  });

  it('drift: regenerating through the real persist path reproduces the golden', async () => {
    const regenerated = await generateGoldenRows(adapter);
    expect(normalizeForDrift(regenerated)).toEqual(normalizeForDrift(golden));
  });
});
