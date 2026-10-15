// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-AO5 item 1 (P0, score integrity): a live read that returns no data must never be SAT.
//
// Drives the REAL persist path (executeAoCommand → EvidenceEmitter → CesRepository) against a
// throwaway temp database with a kind:'sim' loopback tenant. The ONLY mock is the PowerShell
// execution boundary, which returns exit 0 with the stdout chosen per case. Each persisted row
// is read back, parsed with the shared AdminOpsEvidenceSchema, and fed to ces-eo's production
// crediting function (liveSatAdminOpsControls, imported read-only by path — it depends only on
// ces-shared) to prove EvidenceOps would not credit an empty read.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const holder = vi.hoisted(() => ({ stdout: '' }));
vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    constructor(..._args: unknown[]) {}
    getName() {
      return 'mgraph';
    }
    async execute() {
      return { success: true, stdout: holder.stdout, stderr: '', exit_code: 0 };
    }
  }
  return { PowerShellAdapter };
});

// One synthetic SET-ONLY, non-get-then-set command (none exists in today's registry) to pin
// that a write on the single-command path is not treated as a read.
vi.mock('../src/registry/TemplateRegistry.js', async (importOriginal) => {
  const orig = await importOriginal<Record<string, any>>();
  return {
    ...orig,
    getCommandTemplates: (id: string) =>
      id === 'ER-SET-ONLY'
        ? { set_command: "Invoke-MgGraphRequest -Method PATCH -Uri '/v1.0/policies/x' -Body @{} | Out-Null", get_command: '' }
        : orig.getCommandTemplates(id),
  };
});

import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import { getCommand } from '../src/execution/invokeCommand.js';
import { EMPTY_READ_RATIONALE } from '../src/execution/EvidenceEmitter.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { AdminOpsEvidenceSchema } from 'ces-shared/types/adminops-evidence';
import { liveSatAdminOpsControls } from '../../ces-eo/src/eo/adminops/adminopsViews.js';
import { makeAoCommand } from './fixtures.js';
import type { TenantConfig } from 'ces-shared/config';
import { activateStacksimEnv, type StacksimEnvHandle } from './stacksimEnv.js';

const ENV_KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'AO_CMMC_STRICT', 'CES_AO_SIM_ONLY', 'CES_AO_ALLOW_LIVE'] as const;
const saved: Record<string, string | undefined> = {};
let root: string;
let stacksim: StacksimEnvHandle;

function simTenant(): TenantConfig {
  const certPath = path.join(root, 'er.pfx');
  fs.writeFileSync(certPath, 'dummy-cert');
  return {
    tenantSlug: 'er-sim',
    tenantId: 'er-sim-tenant',
    appId: 'er-app-id',
    certPath,
    certThumbprint: 'E0E0000000000000000000000000000000000000',
    domain: 'er.onmicrosoft.us',
    kind: 'sim',
    cmmcLevel: 'L2',
    cmmcMigrationExempt: true,
    endpoints: { graph: 'http://127.0.0.1:4390', login: 'http://127.0.0.1:4390' },
    subscriptionId: 'er-sub',
    resources: {},
  } as unknown as TenantConfig;
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-empty-read-'));
  process.env.CES_PIPELINE_ROOT = root;
  delete process.env.CES_CONFIG_PATH;
  delete process.env.AO_CMMC_STRICT;
  delete process.env.CES_AO_SIM_ONLY;
  delete process.env.CES_AO_ALLOW_LIVE;
  // AO-20 (2026-09-27): tenant here is kind:'sim' (loopback) — route this process to
  // stacksim so the executor's isStacksimModeActive() fail-closed check doesn't refuse it.
  stacksim = activateStacksimEnv();
});

afterEach(() => {
  closeAllCesRepositories();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  stacksim.restore();
  fs.rmSync(root, { recursive: true, force: true });
});

async function liveRead(id: string, stdout: string) {
  holder.stdout = stdout;
  const cmd = makeAoCommand({ id, trigger: 'EVIDENCE', idempotencyClass: 'idempotent', cmmcPractices: ['AC.L1-3.1.1'] } as any);
  await executeAoCommand(cmd, simTenant(), {}, false, { requestorUPN: 'op@er.onmicrosoft.us' });
  const rows = getCesRepository().listAll<any>('adminops_evidence').filter((r) => r.data?.metadata?.commandId === id);
  expect(rows).toHaveLength(1);
  const parsed = AdminOpsEvidenceSchema.safeParse(rows[0].data.metadata);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  return { metadata: parsed.data!, evidence: rows[0].data.evidence };
}

describe('W4-AO5: an empty read is never SAT', () => {
  const EMPTY: Array<[string, string]> = [
    ['no output', ''],
    ['whitespace only', '  \r\n\t '],
    ['JSON null', 'null'],
    ['JSON empty array', '[]'],
    ['JSON empty object', '{ }'],
    ['JSON empty string', '""'],
    ['Graph empty collection', '{"@odata.context":"x","value":[]}'],
  ];

  for (const [label, stdout] of EMPTY) {
    it(`${label}: persists a live non-SAT row that EvidenceOps does not credit`, async () => {
      const id = `ER-${label.replace(/[^a-z]+/gi, '-').toUpperCase()}`;
      const { metadata, evidence } = await liveRead(id, stdout);
      expect(metadata.mode).toBe('live');
      expect(metadata.verdict).not.toBe('SAT');
      expect(metadata.verdict).toBe('NOT_SAT');
      expect(metadata.verdictRationale).toMatch(/no data/i);
      expect(evidence.complianceVerdict).toBe('NOT_SAT');
      expect(liveSatAdminOpsControls([metadata]).size).toBe(0);
    });
  }

  it('control: a read that returns data is still SAT and credited', async () => {
    const { metadata } = await liveRead('ER-DATA', JSON.stringify({ value: [{ id: 'u1' }] }));
    expect(metadata.outcome).toBe('executed');
    expect(metadata.verdict).toBe('SAT');
    expect([...liveSatAdminOpsControls([metadata])]).toEqual(['AC.L1-3.1.1']);
  });

  // FC-AO-2 step 3 (E-06, founder decision 2026-09-27 #9): a count of 0 is an empty read.
  // Fixture shape = E-06's real stacksim stdout (matrix run 2026-09-28, count 2) with the count
  // set to 0: `Measure-Object | Select-Object Count` then a second object rendered as a blank row.
  const E06_SIM_STDOUT = (n: number) => `\r\nCount\r\n-----\r\n    ${n}\r\n     \r\nSTAMPER_EXECUTION_SUCCESS\r\n\r\n\r\n`;
  const ZERO_COUNTS: Array<[string, string]> = [
    ['E-06 count table of zero (sim shape)', E06_SIM_STDOUT(0)],
    ['count list form "Count : 0"', 'Count : 0\r\nSTAMPER_EXECUTION_SUCCESS\r\n'],
    ['two zero count tables', 'Count\n-----\n    0\n\nCount\n-----\n    0\n'],
    ['JSON {"Count":0}', '{"Count":0}'],
  ];
  for (const [label, stdout] of ZERO_COUNTS) {
    it(`E-06: ${label} is an empty read -> NOT_SAT, not credited`, async () => {
      const id = `ER-E06-${label.replace(/[^a-z0-9]+/gi, '-').toUpperCase()}`;
      const { metadata, evidence } = await liveRead(id, stdout);
      expect(metadata.verdict).toBe('NOT_SAT');
      expect(metadata.verdictRationale).toBe(EMPTY_READ_RATIONALE);
      expect(evidence.complianceVerdict).toBe('NOT_SAT');
      expect(liveSatAdminOpsControls([metadata]).size).toBe(0);
    });
  }

  it('E-06 (the real registry command) with a zero count table -> NOT_SAT with the empty-read reason', async () => {
    holder.stdout = E06_SIM_STDOUT(0);
    const cmd = getCommand('E-06')!;
    await executeAoCommand(cmd, simTenant(), {}, false, { requestorUPN: 'op@er.onmicrosoft.us' });
    const rows = getCesRepository().listAll<any>('adminops_evidence').filter((r) => r.data?.metadata?.commandId === 'E-06');
    expect(rows).toHaveLength(1);
    expect(rows[0].data.metadata.mode).toBe('live');
    expect(rows[0].data.metadata.verdict).toBe('NOT_SAT');
    expect(rows[0].data.metadata.verdictRationale).toBe(EMPTY_READ_RATIONALE);
  });

  const NONZERO: Array<[string, string]> = [
    ['E-06 count table of 2 (the sim today)', E06_SIM_STDOUT(2)],
    ['count list form "Count : 17"', 'Count : 17'],
    ['a zero count table followed by other data', 'Count\n-----\n    0\n\nUnifiedAuditLogIngestionEnabled : True\n'],
    ['a multi-column table with a Count column', 'Name   Count\n----   -----\nAlpha      0\n'],
    ['JSON {"Count":3}', '{"Count":3}'],
  ];
  for (const [label, stdout] of NONZERO) {
    it(`E-06 control: ${label} is data -> SAT (unchanged)`, async () => {
      const id = `ER-E06-DATA-${label.replace(/[^a-z0-9]+/gi, '-').toUpperCase()}`;
      const { metadata } = await liveRead(id, stdout);
      expect(metadata.verdict).toBe('SAT');
    });
  }

  it('a set-only write on the single-command path with empty output is not treated as a read (stays SAT)', async () => {
    const { metadata } = await liveRead('ER-SET-ONLY', '');
    expect(metadata.outcome).toBe('executed');
    expect(metadata.verdict).toBe('SAT');
  });
});
