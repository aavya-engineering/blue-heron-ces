// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// liveDiscoveryRun.ts — FC-MU-2 (MU-03 live, founder decision 2026-09-27): the
// live (non-sim) read-only discovery walk. Built, OFF by default: the only
// caller is POST /api/discovery/run { live: true, … }, which first passes
// liveAccess.authorizeLive (engagement flag ON + a granted device-code consent).
//
// Same executor as the sim run (discoveryService.runDiscovery: get_command
// only — there is no set_command path), same envelope builder. What differs:
//   - the session is a delegated-Graph session built from the consent's
//     in-memory access token (injectable; tests always inject a fake);
//   - no sim ledger exists on a live tenant, so the zero-writes ledger check is
//     replaced by readOnlySession: a write-verb denylist applied to every
//     command BEFORE it reaches the session (defence in depth on top of the
//     get-only executor and the read-only token scopes);
//   - a delegated Graph token serves only Graph engines — every other engine
//     is refused per command and recorded "unavailable at this auth tier";
//   - the envelope says tenant.kind 'live', auth_tier 'device-code', and
//     carries the customer's consent (manifest.consent).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  runDiscovery,
  type RegistryGetEntry,
  type DiscoverySession,
  type DiscoveryExecResult,
  type CaptureSink,
} from './discoveryService.js';
import { loadRegistryGetEntries } from './discoveryWiring.js';
import { buildDiscoveryReadinessResult, fileCaptureSink } from './discoveryEnvelope.js';
import { defaultRegistryRoot, readRegistryVersions, postureCounts, type SimDiscoveryOutcome } from './simDiscoveryRun.js';
import { assertNotLiveUnderTest, type LiveArea, type LiveConsentRecord, type LiveGrant } from './liveAccess.js';
import { translateAzCliRead } from './liveAzTranslate.js';

/** Registry engines a delegated Microsoft Graph token can serve. */
export const GRAPH_ENGINES = new Set(['mgraph', 'powershell']);

/**
 * FC-MU-3 step 5: the live area (and so the consent + token) that serves each
 * registry engine. Mirrors ces-tenant ENGINE_SESSION_MAP for the areas the
 * founder decision covers (#14). FC-MU-5 step 3: `teams` is the fifth area.
 * `spo` has no live area: those entries record "unavailable at this auth tier".
 */
export const ENGINE_AREA: Record<string, LiveArea> = {
  mgraph: 'graph',
  powershell: 'graph',
  exchange: 'exchange',
  ipps: 'purview',
  az: 'azure',
  cli: 'azure',
  teams: 'teams',
};

/** PowerShell verbs that change state. A live command using one is refused. */
const WRITE_VERBS = [
  'Set', 'New', 'Remove', 'Update', 'Add', 'Clear', 'Reset', 'Enable', 'Disable', 'Grant', 'Revoke',
  'Register', 'Unregister', 'Install', 'Uninstall', 'Move', 'Rename', 'Restore', 'Publish', 'Unpublish',
  'Start', 'Stop', 'Restart', 'Suspend', 'Resume', 'Send', 'Submit', 'Approve', 'Deny', 'Block', 'Unblock',
  'Lock', 'Unlock', 'Push', 'Sync', 'Write', 'Import', 'Initialize', 'Edit', 'Merge', 'Mount', 'Dismount',
  'Protect', 'Unprotect', 'Save', 'Copy', 'Join', 'Invoke',
];
const WRITE_VERB_RE = new RegExp(`(?:^|[\\s|;({])(?:${WRITE_VERBS.join('|')})-[A-Za-z]`, 'i');
/** Invoke-MgGraphRequest / Invoke-RestMethod are allowed ONLY as a plain GET (no -Method other than GET, no -Body). */
const INVOKE_SRC = String.raw`(?:^|[\s|;({])Invoke-(?:MgGraphRequest|AzRestMethod|RestMethod|WebRequest)\b`;
const INVOKE_RE = new RegExp(INVOKE_SRC, 'i');
/** An Azure CLI invocation (`az …`) anywhere in the command. */
const AZ_CLI_RE = /(?:^|[\s|;({])az\s+[a-z]/;

/**
 * Why a command is not read-only (or not runnable live), or null when it is.
 * FC-MU-3: `Invoke-AzRestMethod` is a read only as a plain GET (no -Payload);
 * an Azure CLI command is refused on the az engine — the CLI cannot take the
 * delegated device-code token, so it would need a sign-in of its own.
 * FC-MU-5: the registry's 7 Azure CLI reads are translated to Azure
 * PowerShell before this check (readOnlyAreaSession); any other `az …` text
 * (including a registry read Stamper has since changed) is still refused here.
 */
export function writeCommandReason(command: string, engine?: string): string | null {
  if ((engine === 'az' || engine === 'cli') && AZ_CLI_RE.test(command)) {
    return 'az CLI cannot use the delegated device-code token (unavailable at this auth tier)';
  }
  const stripped = command.replace(new RegExp(INVOKE_SRC, 'gi'), ' __READ_INVOKE__');
  if (WRITE_VERB_RE.test(stripped)) return 'state-changing cmdlet verb';
  if (INVOKE_RE.test(command)) {
    if (/-(?:Body|Payload)\b/i.test(command)) return 'request body on an Invoke call';
    const m = /-Method\s+['"]?([A-Za-z]+)/i.exec(command);
    if (m && m[1].toUpperCase() !== 'GET') return `HTTP ${m[1].toUpperCase()} on an Invoke call`;
  }
  return null;
}

export class LiveWriteRefused extends Error {
  constructor(readonly reason: string) {
    super(`live discovery is read-only: refused (${reason})`);
    this.name = 'LiveWriteRefused';
  }
}

/**
 * Wrap a session so only read-only Graph commands reach it. A refused command
 * throws — the executor records it as "unavailable at this auth tier" and the
 * walk goes on. The inner session never sees a write or a non-Graph engine.
 */
export function readOnlySession(inner: DiscoverySession): DiscoverySession {
  return readOnlyAreaSession({ graph: inner });
}

/**
 * FC-MU-3: route each command to the session of its engine's area (one
 * consent + token per area). An engine with no area, or whose area has no
 * granted consent, is refused; so is any command the read-only gate rejects.
 * The inner sessions never see a write, an unserved engine, or an az CLI call.
 *
 * FC-MU-5 step 2: a registry Azure CLI read is first rewritten to its Azure
 * PowerShell equivalent (liveAzTranslate.ts, exact-text match only) and the
 * rewritten text then passes the same gate. Live only — the sim path never
 * goes through this wrapper.
 */
export function readOnlyAreaSession(sessions: Partial<Record<LiveArea, DiscoverySession>>): DiscoverySession {
  return {
    async execute(engine: string, command: string): Promise<DiscoveryExecResult> {
      const area = ENGINE_AREA[engine];
      if (!area) throw new LiveWriteRefused(`engine '${engine}' is not served by any live consent area`);
      const inner = sessions[area];
      if (!inner) {
        throw new LiveWriteRefused(
          area === 'graph'
            ? `engine '${engine}' is not served by a delegated Graph token`
            : `engine '${engine}' needs the ${area} consent, which this run does not hold`
        );
      }
      const run = (area === 'azure' && translateAzCliRead(command)) || command;
      const why = writeCommandReason(run, engine);
      if (why) throw new LiveWriteRefused(why);
      return inner.execute(engine, run);
    },
  };
}

/** Microsoft Graph PowerShell environment for the target cloud (GCC High = USGov). */
export function liveGraphEnvironment(): string {
  return process.env.MUSTER_LIVE_GRAPH_ENVIRONMENT ?? 'USGov';
}

/** Run one PowerShell script per command, the token only in the child's environment. */
function powershellSession(
  connect: string[],
  tokenEnv: string,
  accessToken: string,
  extraEnv: Record<string, string> = {}
): DiscoverySession {
  return {
    execute(_engine: string, command: string): Promise<DiscoveryExecResult> {
      return new Promise((resolve) => {
        const started = Date.now();
        const script = [...connect, command].join('\n');
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
          env: { ...process.env, ...extraEnv, [tokenEnv]: accessToken },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
        child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
        child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 0, durationMs: Date.now() - started }));
        child.on('error', () => resolve({ stdout: '', stderr: 'spawn error', exitCode: 1, durationMs: Date.now() - started }));
      });
    },
  };
}

/** Strip anything that could break out of a single-quoted PowerShell literal. */
function psLiteral(v: string): string {
  return v.replace(/['`$\r\n]/g, '');
}

/**
 * The production live session: one powershell.exe per command, the installed
 * Microsoft.Graph modules, Connect-MgGraph with the consent's delegated token.
 * The token is handed over in the child's environment (never in the script
 * text, never on disk). Refused under vitest — tests inject a fake session.
 */
export function buildLiveGraphSession(accessToken: string, environment: string = liveGraphEnvironment()): DiscoverySession {
  assertNotLiveUnderTest('live Graph PowerShell session');
  return powershellSession(
    [
      '$tok = ConvertTo-SecureString $env:MUSTER_LIVE_GRAPH_TOKEN -AsPlainText -Force',
      `Connect-MgGraph -AccessToken $tok -Environment '${psLiteral(environment)}' -NoWelcome -ErrorAction Stop | Out-Null`,
    ],
    'MUSTER_LIVE_GRAPH_TOKEN',
    accessToken
  );
}

/**
 * FC-MU-3 step 5: the production session for one live area, connected with
 * that area's delegated device-code token as the signed-in customer admin.
 * GCC High defaults mirror ces-tenant buildConnectCommand; each is
 * overridable per deployment. The exact module flags for a delegated
 * -AccessToken connection are UNCONFIRMED until the founder smoke run.
 * Refused under vitest (tests inject fakes).
 */
export function buildLiveAreaSession(
  area: LiveArea,
  accessToken: string,
  consent: LiveConsentRecord,
  opts: { graphAccessToken?: string } = {}
): DiscoverySession {
  if (area === 'graph') return buildLiveGraphSession(accessToken);
  assertNotLiveUnderTest(`live ${area} PowerShell session`);
  if (area === 'teams') {
    if (!opts.graphAccessToken) throw new Error('a live Teams session needs the Graph consent token too');
    return powershellSession(liveAreaConnectLines('teams', consent), 'MUSTER_LIVE_AREA_TOKEN', accessToken, {
      MUSTER_LIVE_GRAPH_TOKEN: opts.graphAccessToken,
    });
  }
  return powershellSession(liveAreaConnectLines(area, consent), 'MUSTER_LIVE_AREA_TOKEN', accessToken);
}

/**
 * The PowerShell connect lines for one non-Graph area (pure; no token in the
 * text — the token is read from the child's environment).
 *   - teams (FC-MU-5 step 3): Connect-MicrosoftTeams -AccessTokens takes the
 *     Graph token first, then the Teams admin-API token. GCC High flags for a
 *     delegated -AccessTokens connection are UNCONFIRMED until the smoke run.
 *   - azure (FC-MU-5 step 2): connects to the consented subscription (the one
 *     the reader check covered), so the translated Azure CLI reads'
 *     Get-AzContext is that subscription — like the CLI's current one.
 */
export function liveAreaConnectLines(area: Exclude<LiveArea, 'graph'>, consent: LiveConsentRecord): string[] {
  const upn = psLiteral(consent.consented_by);
  const tid = psLiteral(consent.tenant_id);
  const env = process.env;
  switch (area) {
    case 'exchange':
      return [
        `Connect-ExchangeOnline -AccessToken $env:MUSTER_LIVE_AREA_TOKEN -UserPrincipalName '${upn}' -ExchangeEnvironmentName '${psLiteral(env.MUSTER_LIVE_EXO_ENVIRONMENT ?? 'O365USGovGCCHigh')}' -ShowBanner:$false -ErrorAction Stop | Out-Null`,
      ];
    case 'purview':
      return [
        `Connect-IPPSSession -AccessToken $env:MUSTER_LIVE_AREA_TOKEN -UserPrincipalName '${upn}' -ConnectionUri '${psLiteral(env.MUSTER_LIVE_IPPS_CONNECTION_URI ?? 'https://ps.compliance.protection.office365.us/powershell-liveid/')}' -AzureADAuthorizationEndpointUri '${psLiteral(env.MUSTER_LIVE_IPPS_AUTH_URI ?? `https://login.microsoftonline.us/${tid}`)}' -ShowBanner:$false -ErrorAction Stop | Out-Null`,
      ];
    case 'azure': {
      const sub = consent.subscription_id ? ` -Subscription '${psLiteral(consent.subscription_id)}'` : '';
      return [
        `Connect-AzAccount -AccessToken $env:MUSTER_LIVE_AREA_TOKEN -AccountId '${upn}' -TenantId '${tid}' -Environment '${psLiteral(env.MUSTER_LIVE_AZ_ENVIRONMENT ?? 'AzureUSGovernment')}'${sub} -ErrorAction Stop | Out-Null`,
      ];
    }
    case 'teams':
      return ['Connect-MicrosoftTeams -AccessTokens @($env:MUSTER_LIVE_GRAPH_TOKEN, $env:MUSTER_LIVE_AREA_TOKEN) -ErrorAction Stop | Out-Null'];
  }
}

/** What a live area session is built from (FC-MU-5: + the Graph token, for Teams). */
export interface LiveSessionContext {
  area: LiveArea;
  consent: LiveConsentRecord;
  /** The run's Graph consent token, when it holds one (the Teams module needs it). */
  graphAccessToken?: string;
}

export interface LiveDiscoveryDeps {
  loadEntries?: () => RegistryGetEntry[];
  /**
   * Build one area's live session from that consent's token (default
   * buildLiveAreaSession). FC-MU-2 callers that take only the token still fit.
   */
  makeSession?: (accessToken: string, ctx: LiveSessionContext) => DiscoverySession;
  makeCapture?: (outDir: string) => CaptureSink;
  mkdir?: (path: string) => void;
  now?: () => Date;
  registryRoot?: string;
}

/**
 * Walk the Stamper registry read-only against a consented live tenant and
 * build the readiness-result envelope (tenant.kind 'live', consents recorded).
 * FC-MU-3: `grants` holds one granted consent per area; each engine runs in
 * its area's session, and an area without a grant stays unavailable.
 */
export async function runLiveDiscovery(
  input: { slug: string; outDir: string; engagementId: string; grants: LiveGrant[] },
  deps: LiveDiscoveryDeps = {}
): Promise<SimDiscoveryOutcome> {
  const loadEntries = deps.loadEntries ?? loadRegistryGetEntries;
  const now = deps.now ?? (() => new Date());
  const mkdir = deps.mkdir ?? ((p: string) => mkdirSync(p, { recursive: true }));
  const registryRoot = deps.registryRoot ?? defaultRegistryRoot();

  if (input.grants.length === 0) return { ok: false, code: 'envelope_invalid', message: 'no live consent granted' };
  const entries = loadEntries();
  if (entries.length === 0) {
    return { ok: false, code: 'no_entries', message: 'no Stamper registry get-entries loaded' };
  }

  const make =
    deps.makeSession ??
    ((t: string, ctx: LiveSessionContext) =>
      buildLiveAreaSession(ctx.area, t, ctx.consent, ctx.graphAccessToken ? { graphAccessToken: ctx.graphAccessToken } : {}));
  const graphGrant = input.grants.find((g) => (g.consent.area ?? 'graph') === 'graph');
  const sessions: Partial<Record<LiveArea, DiscoverySession>> = {};
  for (const g of input.grants) {
    const area = g.consent.area ?? 'graph';
    if (sessions[area]) continue;
    // FC-MU-5 step 3: the Teams module signs in with the Graph AND the Teams
    // token. Without the Graph consent the Teams area gets no session, so its
    // checks record "unavailable at this auth tier".
    if (area === 'teams' && !graphGrant) continue;
    sessions[area] = make(g.accessToken, {
      area,
      consent: g.consent,
      ...(area === 'teams' && graphGrant ? { graphAccessToken: graphGrant.accessToken } : {}),
    });
  }
  const session = readOnlyAreaSession(sessions);
  mkdir(join(input.outDir, 'captures'));
  const capture = (deps.makeCapture ?? fileCaptureSink)(input.outDir);

  const startedAt = now().toISOString();
  const result = await runDiscovery(entries, session, capture, { restrictedTier: true });
  const completedAt = now().toISOString();

  const consents = input.grants.map((g) => ({ ...g.consent, area: g.consent.area ?? 'graph' }));
  const primary = consents.find((c) => c.area === 'graph') ?? consents[0];
  let envelope: unknown;
  try {
    envelope = buildDiscoveryReadinessResult({
      observations: result.observations,
      slug: input.slug,
      startedAt,
      completedAt,
      registryVersions: readRegistryVersions(registryRoot),
      live: { engagementId: input.engagementId, consent: primary, consents },
    });
  } catch (e) {
    return { ok: false, code: 'envelope_invalid', message: String(e instanceof Error ? e.message : e) };
  }
  return { ok: true, envelope, stats: result.stats, postures: postureCounts(result.observations) };
}
