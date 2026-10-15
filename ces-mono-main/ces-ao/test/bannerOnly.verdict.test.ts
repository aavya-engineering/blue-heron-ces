// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX2-AO2 (P1, integrity): output that is ONLY a session/connection banner is not data.
//
// W4-AO5 demoted an empty read to NOT_SAT, but treated any non-JSON text as data — so the
// Stamper success sentinel or a connect banner (IPPS "Organization / ConnectionUri", the EXO
// V3 notice, the Graph welcome text) kept an empty read SAT. Same harness as
// emptyRead.verdict.test.ts:
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

import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { AdminOpsEvidenceSchema } from 'ces-shared/types/adminops-evidence';
import { EMPTY_READ_RATIONALE, stripSessionBanners } from '../src/execution/EvidenceEmitter.js';
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
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-banner-read-'));
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

// D-02 on stacksim, captured verbatim from the production path (bannerOnly.stacksim.test.ts).
const D02_CAPTURED =
  '\r\nOrganization                           ConnectionUri                                                   \r\n' +
  '------------                           -------------                                                   \r\n' +
  'ao-fx2-banner.simtenant.onmicrosoft.us https://ps.compliance.protection.office365.us/powershell-liveid/\r\n' +
  '                                                                                                       \r\n' +
  'STAMPER_EXECUTION_SUCCESS\r\n\r\n\r\n';
// A-12 / C-01 / D-01 on stacksim (sim returned nothing): only the session sentinel.
const SENTINEL_ONLY = 'STAMPER_EXECUTION_SUCCESS\r\n';
const EXO_V3_NOTICE = [
  '----------------------------------------------------------------------------------------',
  "This V3 EXO PowerShell module contains new REST API backed Exchange Online cmdlets which doesn't require WinRM for Client-Server communication.",
  '',
  'For more information check https://aka.ms/exov3-module',
  '----------------------------------------------------------------------------------------',
  '',
].join('\r\n');
const GRAPH_WELCOME = [
  'Welcome to Microsoft Graph!',
  '',
  'Connected via apponly access using 00000000-0000-0000-0000-000000000001',
  'Readme: https://aka.ms/graph/sdk/powershell',
  'SDK Docs: https://aka.ms/graph/sdk/powershell/docs',
  'API Docs: https://aka.ms/graph/docs',
  '',
  'NOTE: You can use the -NoWelcome parameter to suppress this message.',
  '',
].join('\r\n');
const EXO_CONNECT_LIST = 'Organization            : sim.onmicrosoft.us\r\nExchangeEnvironmentName : O365USGovGCCHigh\r\n\r\n';
const DLP_ROWS = [
  'Name                  Mode   Enabled Priority Workload',
  '----                  ----   ------- -------- --------',
  'CUI DLP Policy        Enable True    0        Exchange, SharePoint',
  '',
].join('\r\n');

describe('FX2-AO2: banner-only output is not data', () => {
  const BANNER_ONLY: Array<[string, string]> = [
    ['D-02 captured IPPS banner', D02_CAPTURED],
    ['session sentinel only', SENTINEL_ONLY],
    ['EXO V3 notice only', EXO_V3_NOTICE + SENTINEL_ONLY],
    ['Graph welcome only', GRAPH_WELCOME],
    ['EXO connect object (list form) only', EXO_CONNECT_LIST + SENTINEL_ONLY],
    ['all banners, then an empty JSON array', GRAPH_WELCOME + EXO_V3_NOTICE + D02_CAPTURED.replace('STAMPER_EXECUTION_SUCCESS', '[]')],
  ];

  for (const [label, stdout] of BANNER_ONLY) {
    it(`${label}: NOT_SAT with the empty-read reason; rawResponse is kept verbatim`, async () => {
      const id = `BR-${label.replace(/[^a-z0-9]+/gi, '-').toUpperCase()}`;
      const { metadata, evidence } = await liveRead(id, stdout);
      expect(metadata.mode).toBe('live');
      expect(metadata.outcome).toBe('executed');
      expect(metadata.verdict).toBe('NOT_SAT');
      expect(metadata.verdictRationale).toBe(EMPTY_READ_RATIONALE);
      expect(evidence.rawResponse).toBe(stdout);
      expect(liveSatAdminOpsControls([metadata]).size).toBe(0);
    });
  }

  it('banner + real rows: evaluated on the rows (SAT)', async () => {
    const { metadata } = await liveRead('BR-BANNER-ROWS', D02_CAPTURED.replace('STAMPER_EXECUTION_SUCCESS', DLP_ROWS + 'STAMPER_EXECUTION_SUCCESS'));
    expect(metadata.verdict).toBe('SAT');
  });

  it('banner + JSON rows: evaluated on the rows (SAT)', async () => {
    const { metadata } = await liveRead('BR-BANNER-JSON', GRAPH_WELCOME + JSON.stringify({ value: [{ id: 'p1' }] }) + '\r\n' + SENTINEL_ONLY);
    expect(metadata.verdict).toBe('SAT');
  });

  it('plain non-JSON real output is unchanged (SAT), including generic Name/State/Id columns', async () => {
    const table = 'Name        State   Id\r\n----        -----   --\r\nSim Policy  enabled p-1\r\n';
    expect((await liveRead('BR-PLAIN-TABLE', table)).metadata.verdict).toBe('SAT');
    expect((await liveRead('BR-PLAIN-TEXT', 'Audit log retention: 365 days\r\n')).metadata.verdict).toBe('SAT');
    expect((await liveRead('BR-DLP-ROWS', DLP_ROWS)).metadata.verdict).toBe('SAT');
  });

  // FC-AO-2: D-02 now emits its own output (`| ConvertTo-Json` per statement). On stacksim (matrix run
  // 2026-09-28) the JSON follows the IPPS connection row with NO blank line; the banner stripper used to
  // swallow it as more "table rows", and D-02 was NOT_SAT with real DLP data in hand.
  const D02_JSON_AFTER_BANNER =
    '\r\nOrganization                          ConnectionUri                                                   \r\n' +
    '------------                          -------------                                                   \r\n' +
    'ao-w4-matrix.simtenant.onmicrosoft.us https://ps.compliance.protection.office365.us/powershell-liveid/\r\n' +
    '{"Name":"CMMC-CUI-Block","Mode":"Enable","Enabled":true,"Priority":0,"Workload":"Exchange, SharePoint, OneDriveForBusiness, Teams"}\r\n' +
    '[{"CreationDate":"2026-09-28T10:00:00.000Z","UserIds":"sim.user3@simtenant.onmicrosoft.us","Operations":"DlpRuleMatch"}]\r\n' +
    'STAMPER_EXECUTION_SUCCESS\r\n\r\n\r\n';

  it('FC-AO-2: banner immediately followed by JSON output (D-02 on stacksim): the JSON is data (SAT)', async () => {
    const stripped = stripSessionBanners(D02_JSON_AFTER_BANNER);
    expect(stripped).toContain('"Name":"CMMC-CUI-Block"');
    expect(stripped).toContain('"Operations":"DlpRuleMatch"');
    expect(stripped).not.toContain('ConnectionUri');
    const { metadata } = await liveRead('BR-D02-JSON-AFTER-BANNER', D02_JSON_AFTER_BANNER);
    expect(metadata.verdict).toBe('SAT');
  });

  it('FC-AO-2: a line wider than the connection table is not one of its rows (kept as data)', () => {
    const wide = 'Organization ConnectionUri\r\n------------ -------------\r\norg.example  https://x\r\nthis line is plainly wider than the connection table above it\r\n';
    expect(stripSessionBanners(wide)).toContain('plainly wider');
    expect(stripSessionBanners(wide)).not.toContain('ConnectionUri');
  });

  it('stripSessionBanners keeps non-banner lines and removes only the banners', () => {
    expect(stripSessionBanners(D02_CAPTURED).trim()).toBe('');
    expect(stripSessionBanners(GRAPH_WELCOME + 'real line').trim()).toBe('real line');
    expect(stripSessionBanners('Organization Name\r\n------------ ----\r\nx y\r\n').trim()).toContain('x y');
  });
});
