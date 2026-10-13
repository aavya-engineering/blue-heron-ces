// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

/**
 * live.azTranslate.test.ts — FC-MU-5 step 2 (founder decision 2026-09-28,
 * round 4): the 7 Azure CLI reads in Stamper's registries are rewritten to
 * Azure PowerShell inside Muster's LIVE discovery only (Stamper's registry is
 * read, never changed). Each translation must perform the same ARM read and
 * produce the same output shape.
 *
 * Proofs:
 *   1. Coverage — against the real registries, every get_command the command
 *      gate refuses as "az CLI" has an exact-text translation (7 today).
 *   2. Same read (structural, always runs) — the same method + URL/path.
 *   3. Same output shape (PowerShell, when a local shell exists) — the
 *      registry's own command runs with a stub `az` printing what the CLI
 *      prints, the translation runs with a stub `Invoke-AzRestMethod`
 *      returning the ARM body; both outputs parse to the same JSON. An HTTP
 *      error makes the translation exit non-zero, like az rest. Stubs only:
 *      no Az module, no network.
 *   4. Routing — live discovery hands the Azure session the translated text;
 *      the sim path never translates.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ADVISOR_LIST_PATH,
  AZ_CLI_TRANSLATIONS,
  SENTINEL_CONNECTORS_PATH,
  azRestUrl,
  translateAzCliRead,
} from '../src/services/liveAzTranslate.js';
import { readOnlyAreaSession, writeCommandReason, liveAreaConnectLines } from '../src/services/liveDiscoveryRun.js';
import { defaultRegistryRoot } from '../src/services/simDiscoveryRun.js';
import type { DiscoverySession, RegistryGetEntry } from '../src/services/discoveryService.js';
import { createMockDb, type MockDb } from './helpers/mockDb.js';
import { OPERATOR, buildHarness, consentFor, tokenFor, waitJob, type Harness } from './helpers/liveAreasHarness.js';

type RawEntry = { entry_id: string; engine: string; get_command?: string; control_ids?: string[] };

function registryEntries(): RawEntry[] {
  const root = defaultRegistryRoot();
  const all: RawEntry[] = [];
  for (const f of ['cmmc-l2-commands.registry.json', 'infra-cmmc-l2-commands.registry.json']) {
    all.push(...(JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')).entries ?? []));
  }
  return all;
}
const refusedAzCli = () =>
  registryEntries().filter((e) => e.get_command?.trim() && /az CLI/.test(writeCommandReason(e.get_command, e.engine) ?? ''));

describe('FC-MU-5 step 2 — coverage against the real Stamper registries', () => {
  it('every Azure CLI read the gate refuses has an exact-text translation (7), and nothing else is translated', () => {
    const refused = refusedAzCli();
    expect(refused.map((e) => e.entry_id).sort()).toEqual(AZ_CLI_TRANSLATIONS.map((t) => t.entry_id).sort());
    expect(refused).toHaveLength(7);
    for (const e of refused) {
      const t = AZ_CLI_TRANSLATIONS.find((x) => x.entry_id === e.entry_id)!;
      expect(t.from, e.entry_id).toBe(e.get_command);
      expect(translateAzCliRead(e.get_command!), e.entry_id).toBe(t.to);
    }
    // Only these seven: no other registry get_command is rewritten.
    const refusedIds = new Set(refused.map((e) => e.entry_id));
    const others = registryEntries().filter((e) => e.get_command && !refusedIds.has(e.entry_id));
    expect(others.filter((e) => translateAzCliRead(e.get_command!) !== null)).toEqual([]);
  });

  it('a changed registry text is not translated (drift guard): it stays refused as az CLI', () => {
    const t = AZ_CLI_TRANSLATIONS[0];
    expect(translateAzCliRead(`${t.from} `)).toBeNull();
    expect(translateAzCliRead(t.from.replace('2024-03-01', '2025-01-01'))).toBeNull();
  });
});

describe('FC-MU-5 step 2 — each translation is the same read', () => {
  for (const t of AZ_CLI_TRANSLATIONS) {
    it(`${t.entry_id}: GET, same ARM target, passes the read-only gate, no az CLI left`, () => {
      expect(writeCommandReason(t.to, 'az'), t.to).toBeNull();
      expect(t.to).not.toMatch(/(?:^|[\s|;({])az\s+[a-z]/);
      expect(t.to).not.toMatch(/-Method\s+['"]?(?!GET)[A-Za-z]+/);
      expect(t.to).not.toMatch(/-(Body|Payload)\b/);
      if (t.read.url) {
        // az rest: the exact URL, now as Invoke-AzRestMethod -Uri.
        expect(azRestUrl(t.from)).toBe(t.read.url);
        expect(t.from).toMatch(/--method GET/);
        const u = t.read.url;
        expect(t.to.includes(`Invoke-AzRestMethod -Method GET -Uri '${u}'`) || t.to.includes(`Invoke-AzRestMethod -Method GET -Uri "${u}"`), t.to).toBe(true);
      } else {
        expect(t.to).toContain(`Invoke-AzRestMethod -Method GET -Path "/subscriptions/$__sub${t.read.path}"`);
      }
    });
  }

  it('advisor and sentinel read the paths the CLI commands read', () => {
    expect(ADVISOR_LIST_PATH).toMatch(/^\/providers\/Microsoft\.Advisor\/recommendations\?api-version=/);
    expect(SENTINEL_CONNECTORS_PATH).toMatch(
      /^\/resourceGroups\/\{resourceGroup\}\/providers\/Microsoft\.OperationalInsights\/workspaces\/\{lawWorkspaceName\}\/providers\/Microsoft\.SecurityInsights\/dataConnectors\?api-version=/
    );
  });
});

// ── Output shape, in a real (local, stubbed) PowerShell ─────────────────────

const SHELL = ['pwsh', 'powershell.exe'].find((s) => {
  try {
    return spawnSync(s, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8', timeout: 20000 }).status === 0;
  } catch {
    return false;
  }
});

interface Fixture {
  /** What the Azure CLI prints for the registry command. */
  cli: unknown;
  /** ARM response pages (first, then by nextLink). */
  arm: unknown[];
}

const DIAG = {
  value: [{ id: '/providers/microsoft.aadiam/diagnosticSettings/ds1', name: 'ds1', properties: { workspaceId: '/w', logs: [{ category: 'AuditLogs', enabled: true }] } }],
};
const ONBOARD = { id: '/x/onboardingStates/default', name: 'default', properties: { customerManagedKey: false } };
const O365 = { id: '/x/dataConnectors/office365', name: 'office365', kind: 'Office365', properties: { dataTypes: { exchange: { state: 'Enabled' } } } };
const PACKS = {
  value: [
    { id: '/p/1', properties: { displayName: 'CMMC 2.0', version: '3.0.1', contentId: 'cmmc' } },
    { id: '/p/2', properties: { displayName: 'Zero Trust', version: '1.0.0', contentId: 'zt' } },
  ],
};
const REC = (n: number) => ({
  id: `/subscriptions/s/providers/Microsoft.Advisor/recommendations/r${n}`,
  name: `r${n}`,
  type: 'Microsoft.Advisor/recommendations',
  properties: { category: 'Security', impact: 'High', shortDescription: { problem: `p${n}`, solution: `s${n}` } },
});
const flat = (r: ReturnType<typeof REC>) => ({ id: r.id, name: r.name, type: r.type, ...r.properties });
const TI = { id: '/c/ti', name: 'ti', type: 'Microsoft.SecurityInsights/dataConnectors', kind: 'ThreatIntelligence', properties: { tenantId: 't' } };
const AAD = { id: '/c/aad', name: 'aad', type: 'Microsoft.SecurityInsights/dataConnectors', kind: 'AzureActiveDirectory', properties: { tenantId: 't' } };

const FIXTURES: Record<string, Fixture> = {
  'AU.L2-3.3.3.sentinel-connector': { cli: O365, arm: [O365] },
  'AZ-SEN-001': { cli: ONBOARD, arm: [ONBOARD] },
  'AZ-DIAG-007': { cli: DIAG, arm: [DIAG] },
  'AZ-DIAG-008': { cli: DIAG, arm: [DIAG] },
  'AZ-SEN-009': { cli: PACKS, arm: [PACKS] },
  // Two pages: the translation follows nextLink like the CLI does.
  'SC.L2-3.13.2.advisor': { cli: [flat(REC(1)), flat(REC(2)), flat(REC(3))], arm: [{ value: [REC(1), REC(2)], nextLink: 'https://arm.invalid/next' }, { value: [REC(3)] }] },
  'SI.L2-3.14.7.threat-intel': { cli: [TI], arm: [{ value: [AAD, TI] }] },
};

/** Stubs: `az` prints the CLI fixture; Invoke-AzRestMethod serves ARM pages and records each call. */
const STUBS = [
  '$ErrorActionPreference = "Stop"',
  '$global:__calls = @()',
  'function az { $env:FX_CLI }',
  'function Get-AzContext { [pscustomobject]@{ Subscription = [pscustomobject]@{ Id = "sub-1" } } }',
  'function Invoke-AzRestMethod { param($Method, $Uri, $Path) $global:__calls += "$Method $Uri$Path"; $i = [Math]::Min($global:__calls.Count - 1, 1); if ($env:FX_STATUS) { return [pscustomobject]@{ StatusCode = [int]$env:FX_STATUS; Content = \'{"error":{"code":"AuthorizationFailed"}}\' } }; [pscustomobject]@{ StatusCode = 200; Content = ($env:FX_ARM_PAGES.Split([char]30)[$i]) } }',
].join('\n');

function runPs(command: string, fx: Fixture, status?: number) {
  const script = `${STUBS}\n${command}\n[Console]::Error.WriteLine("CALLS=" + ($global:__calls -join "|"))`;
  const r = spawnSync(SHELL!, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      FX_CLI: JSON.stringify(fx.cli, null, 2),
      FX_ARM_PAGES: fx.arm.map((p) => JSON.stringify(p)).join(String.fromCharCode(30)),
      FX_STATUS: status ? String(status) : '',
    },
  });
  const calls = /CALLS=(.*)/.exec(r.stderr ?? '')?.[1]?.trim() ?? '';
  return { status: r.status, stdout: (r.stdout ?? '').trim(), stderr: r.stderr ?? '', calls: calls ? calls.split('|') : [] };
}

describe.skipIf(!SHELL)('FC-MU-5 step 2 — same output shape (stubbed local PowerShell; no network)', () => {
  for (const t of AZ_CLI_TRANSLATIONS) {
    it(`${t.entry_id}: the translation prints what the CLI command prints`, () => {
      const fx = FIXTURES[t.entry_id];
      expect(fx, `fixture for ${t.entry_id}`).toBeDefined();
      const cli = runPs(t.from, fx);
      const ps = runPs(t.to, fx);
      expect(cli.status, cli.stderr).toBe(0);
      expect(ps.status, ps.stderr).toBe(0);
      expect(JSON.parse(ps.stdout)).toEqual(JSON.parse(cli.stdout));
      // The translation made GET calls only, to the declared target.
      expect(ps.calls.length).toBe(fx.arm.length);
      expect(ps.calls.every((c) => c.startsWith('GET '))).toBe(true);
      expect(ps.calls[0]).toBe(t.read.url ? `GET ${t.read.url}` : `GET /subscriptions/sub-1${t.read.path}`);
    }, 120000);

    it(`${t.entry_id}: an HTTP error exits non-zero (as az rest does)`, () => {
      const r = runPs(t.to, FIXTURES[t.entry_id], 403);
      expect(r.status).not.toBe(0);
    }, 60000);
  }
});

// ── Routing: live only ───────────────────────────────────────────────────────

describe('FC-MU-5 step 2 — live discovery runs the translated reads in the Azure session', () => {
  let db: MockDb;
  let h: Harness;
  let engagementId: string;
  let workRoot: string;

  beforeEach(async () => {
    db = createMockDb();
    const e = await db.engagement.create({ data: { tenant_id: 't-live', engagement_kind: 'prime_and_subs' } });
    engagementId = e.id as string;
    workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-mu5-az-'));
    const entries: RegistryGetEntry[] = refusedAzCli().map((e) => ({
      entry_id: e.entry_id,
      control_ids: e.control_ids ?? [],
      engine: e.engine,
      get_command: e.get_command!,
    }));
    h = buildHarness(db, workRoot, { entries });
    await h.call('PUT', `/api/live/engagements/${engagementId}/access`, OPERATOR, { enabled: true });
  });
  afterEach(() => {
    h?.server.close();
    fs.rmSync(workRoot, { recursive: true, force: true });
  });

  it('all 7 reads reach the Azure session as Azure PowerShell, with the Azure token; none is left unavailable', async () => {
    const a = await consentFor(h, engagementId, 'azure');
    expect(a.poll.status, JSON.stringify(a.poll)).toBe('granted');
    const start = await h.call('POST', '/api/discovery/run', OPERATOR, { live: true, engagement_id: engagementId, consent_ids: [a.id] });
    const job = await waitJob(h, start.body.job_id);
    expect(job.status, JSON.stringify(job.outcome ?? job)).toBe('done');
    expect(h.sessionCalls.map((c) => c.command).sort()).toEqual(AZ_CLI_TRANSLATIONS.map((t) => t.to).sort());
    for (const c of h.sessionCalls) {
      expect(c.area).toBe('azure');
      expect(c.token).toBe(tokenFor('azure'));
      expect(c.command).not.toMatch(/(?:^|[\s|;({])az\s+[a-z]/);
    }
    const unknown = job.envelope.observations.filter((o: any) => o.derived_posture === 'unknown');
    expect(unknown).toEqual([]);
  });

  it('readOnlyAreaSession translates; a session outside it (the sim path) gets the registry text unchanged', async () => {
    const seen: string[] = [];
    const inner: DiscoverySession = {
      async execute(_e, command) {
        seen.push(command);
        return { stdout: '[]', stderr: '', exitCode: 0, durationMs: 1 };
      },
    };
    const t = AZ_CLI_TRANSLATIONS[0];
    await readOnlyAreaSession({ azure: inner }).execute('az', t.from);
    await inner.execute('az', t.from); // the sim executor's session: no wrapper, no translation
    expect(seen).toEqual([t.to, t.from]);
  });

  it('the Azure session connects to the consented subscription, so Get-AzContext is that subscription', () => {
    const consent = { consented_by: 'a@b.example', consented_at: 'x', scopes: ['openid'], tenant_id: 't', auth_tier: 'device-code' as const, client_id: 'c', area: 'azure' as const };
    const withSub = liveAreaConnectLines('azure', { ...consent, subscription_id: '99999999-8888-7777-6666-555555555555' }).join(' ');
    expect(withSub).toMatch(/Connect-AzAccount -AccessToken \$env:MUSTER_LIVE_AREA_TOKEN .* -Subscription '99999999-8888-7777-6666-555555555555'/);
    expect(liveAreaConnectLines('azure', consent).join(' ')).not.toMatch(/-Subscription/);
  });
});
