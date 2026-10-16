// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * `TenantSessionFactory` implementation -- behavior-preserving port of
 * Stamper's `SessionManager` TS orchestration layer
 * (`ces-stamper/src/core/SessionManager.ts`, design 2.4 point 1). The
 * underlying `session-host.ps1` stays in `ces-shared/scripts/` (already
 * shared); this class owns the persistent-process lifecycle, the
 * marker-based stdio protocol, queueing, stale-connection/respawn retry, and
 * the (still hardcoded, per the scope fence) GCC High/USGov connect
 * commands.
 *
 * M1 mock-seam (acceptance gate 3): the process spawn point is injected via
 * `options.spawnFn`, so the connect/execute path is testable without a live
 * `powershell.exe` round-trip -- the exact seam the M0 record's
 * untestable-without-source-change note asked for.
 *
 * Windows-only surface (design 7): nothing outside this module (and
 * stacksim.ts) imports `node:child_process`; the HTTP surface stays clean.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SessionType } from '../connection.js';
import type { ConsumerIdentity } from '../consumer.js';
import type { PSResult, SessionState, TenantSessionFactory } from '../session-surface.js';
import type { TenantActivityRecorder } from '../status-surface.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Credential/config inputs `buildConnectCommand()` consumes -- the exact
 * `ClientConfig` fields Stamper's implementation reads
 * (`SessionManager.ts:392-432`). A `TenantRegistryRecord` satisfies this
 * structurally.
 */
export interface SessionCredentials {
  tenantId: string;
  appId: string;
  certThumbprint: string;
  targetTenantDomain?: string;
  subscriptionId?: string;
}

/** Structural stand-ins for the `child_process` surface the factory uses, so a test double can be injected (gate 3 seam). */
export interface SpawnedStdio {
  on(event: 'data', listener: (data: Buffer) => void): unknown;
  removeListener(event: 'data', listener: (data: Buffer) => void): unknown;
}
export interface SpawnedStdin {
  write(chunk: string): unknown;
  end(): unknown;
}
export interface SpawnedProcessLike {
  stdin: SpawnedStdin | null;
  stdout: SpawnedStdio | null;
  stderr: SpawnedStdio | null;
  killed: boolean;
  exitCode: number | null;
  kill(): unknown;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
}
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { stdio: ['pipe', 'pipe', 'pipe']; windowsHide: boolean },
) => SpawnedProcessLike;

export interface PersistentSessionFactoryOptions {
  /** Mirrors `SessionManager`'s `dryRun` constructor flag (`SessionManager.ts:93-95`). */
  dryRun?: boolean;
  /** Process-spawn seam. Default: real `child_process.spawn`. */
  spawnFn?: SpawnFn;
  /**
   * Path to session-host.ps1. Default mirrors `SessionManager.ts:81`:
   * `ces-shared/scripts/session-host.ps1` resolved three levels above this
   * file (the sibling-repo layout both Stamper and ces-tenant share).
   */
  sessionHostScript?: string;
  /** Log sink; default `console` (Stamper logs through console verbatim). */
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;

  // ---- RATIFIED AMENDMENT (founder, 2026-07-10) — caller identity + status surface ----

  /**
   * Construction-time caller identity, used for every request that does not
   * carry a per-request `consumer` override. INVARIANT (`consumer.ts`):
   * requests with neither are logged in library mode (this class warns
   * through `logger` and records `consumer: null`); service mode rejects.
   */
  consumer?: ConsumerIdentity;

  /** Activity recorder (append-only ledger) — e.g. `InProcessTenantStatus`. When absent, no activity is recorded. */
  activity?: TenantActivityRecorder;

  /** Tenant slug this factory connects (a factory is constructed per tenant) — the activity/status tenant dimension. */
  tenantSlug?: string;
}

// Constants -- verbatim from `SessionManager.ts:31-41`.
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const HOST_READY_TIMEOUT_MS = 30_000;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

// Unique markers -- must match session-host.ps1 (`SessionManager.ts:36-41`).
const CMD_END_MARKER = 'STAMPER_CMD_END';
const STDOUT_END_MARKER = 'STAMPER_STDOUT_END';
const STDERR_END_MARKER = 'STAMPER_STDERR_END';
const EXIT_MARKER_PREFIX = 'STAMPER_EXIT:';
const HOST_READY_MARKER = 'STAMPER_HOST_READY';

/** Verbatim from `SessionManager.ts:49-63` (incl. the 2.35.1 Authentication pin and its rationale -- see that file's doc comment). */
const GRAPH_MODULE_IMPORTS = [
  'Import-Module Microsoft.Graph.Authentication -RequiredVersion 2.35.1 -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Identity.Governance -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Users -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Identity.DirectoryManagement -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Groups -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Identity.ConditionalAccess -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.DeviceManagement -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Identity.SignIns -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Identity.Authentication -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Reports -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Domains -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.Applications -Force -ErrorAction SilentlyContinue',
  'Import-Module Microsoft.Graph.DirectoryObjects -Force -ErrorAction SilentlyContinue',
];

/** Verbatim from `SessionManager.ts:66-78`. */
const SESSION_MODULE_MAP: Record<SessionType, string[]> = {
  graph: GRAPH_MODULE_IMPORTS,
  exchange: [],
  purview: [],
  azure: [
    'Import-Module Az.Monitor -Force -ErrorAction SilentlyContinue',
    'Import-Module Az.Storage -Force -ErrorAction SilentlyContinue',
  ],
  sharepoint: [
    'Import-Module Microsoft.Online.SharePoint.PowerShell -Force -ErrorAction SilentlyContinue',
  ],
  teams: [],
};

const DEFAULT_SESSION_HOST_SCRIPT = path.resolve(
  __dirname,
  '../../../ces-shared/scripts/session-host.ps1',
);

const SPO_KEEPALIVE_INTERVAL_MS = 2 * 60 * 1000;

const STALE_CONNECTION_RE = /No connection available|Use Connect-\w+Service before running/i;

// Port of `ces-stamper/src/utils/retryWithBackoff.ts` (only the surface
// `SessionManager.connect()` uses: maxRetries/baseDelayMs/shouldRetry).
interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  shouldRetry?: (err: unknown) => boolean;
}
async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, shouldRetry = () => false } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < maxRetries - 1 && shouldRetry(err)) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
}

export class PersistentSessionFactory implements TenantSessionFactory {
  private readonly config: SessionCredentials;
  private readonly dryRun: boolean;
  private readonly spawnFn: SpawnFn;
  private readonly sessionHostScript: string;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error'>;
  private readonly defaultConsumer?: ConsumerIdentity;
  private readonly activity?: TenantActivityRecorder;
  private readonly tenantSlug?: string;

  private processes: Map<SessionType, SpawnedProcessLike> = new Map();
  private states: Map<SessionType, SessionState> = new Map();
  private keepaliveTimers: Map<SessionType, ReturnType<typeof setInterval>> = new Map();
  private commandQueues: Map<SessionType, Promise<any>> = new Map();

  constructor(config: SessionCredentials, options: PersistentSessionFactoryOptions = {}) {
    this.config = config;
    this.dryRun = options.dryRun ?? false;
    this.spawnFn = options.spawnFn ?? ((cmd, args, opts) => spawn(cmd, [...args], opts));
    this.sessionHostScript = options.sessionHostScript ?? DEFAULT_SESSION_HOST_SCRIPT;
    this.logger = options.logger ?? console;
    this.defaultConsumer = options.consumer;
    this.activity = options.activity;
    this.tenantSlug = options.tenantSlug;
    const types: SessionType[] = ['graph', 'exchange', 'purview', 'azure', 'sharepoint', 'teams'];
    for (const t of types) {
      this.states.set(t, { type: t, connected: false, connectedAt: null, lastUsedAt: null, tokenExpiresAt: null });
    }
  }

  // ---- RATIFIED AMENDMENT (founder, 2026-07-10) — caller identity + activity recording ----

  /**
   * Resolve the effective caller identity for a request: per-request
   * override, else construction-time binding. INVARIANT (`consumer.ts`):
   * missing both is logged here (library mode) and recorded as
   * `consumer: null`; the M6 service rejects such requests instead.
   */
  private resolveConsumer(operation: string, perRequest?: ConsumerIdentity): ConsumerIdentity | null {
    const consumer = perRequest ?? this.defaultConsumer;
    if (!consumer) {
      this.logger.warn(
        `[SessionFactory] ${operation} request without consumer identity (module/purpose) -- logged in library mode; service mode rejects (ratified amendment 2026-07-10).`,
      );
      return null;
    }
    return consumer;
  }

  /** Run a request, appending exactly one ok/error activity entry when a recorder is wired. */
  private async withActivity<T>(
    operation: string,
    type: SessionType | undefined,
    consumer: ConsumerIdentity | null,
    fn: () => Promise<T>,
    detail?: string,
  ): Promise<T> {
    const base = {
      consumer,
      operation,
      ...(this.tenantSlug !== undefined ? { tenantSlug: this.tenantSlug } : {}),
      ...(type !== undefined ? { sessionType: type } : {}),
    };
    try {
      const result = await fn();
      this.activity?.recordActivity({ ...base, outcome: 'ok', ...(detail !== undefined ? { detail } : {}) });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.activity?.recordActivity({ ...base, outcome: 'error', detail: message.substring(0, 300) });
      throw err;
    }
  }

  /** Port of `SessionManager.ensureConnected()` (`SessionManager.ts:104-139`); amended 2026-07-10 to carry caller identity. */
  async ensureConnected(type: SessionType, consumer?: ConsumerIdentity): Promise<void> {
    const identity = this.resolveConsumer('ensureConnected', consumer);
    await this.withActivity('ensureConnected', type, identity, () => this.ensureConnectedCore(type));
  }

  /** The unamended `ensureConnected` behavior (verbatim M1 port), shared by the public method and `execute()`'s internal call. */
  private async ensureConnectedCore(type: SessionType): Promise<void> {
    if (this.dryRun) {
      this.logger.log(`[SessionFactory] ensureConnected(${type}) -- skipped (dry-run)`);
      return;
    }

    const state = this.states.get(type)!;
    const proc = this.processes.get(type);
    const processAlive = proc && !proc.killed && proc.exitCode === null;

    const tokenExpiring =
      state.tokenExpiresAt && state.tokenExpiresAt.getTime() - Date.now() < TOKEN_EXPIRY_BUFFER_MS;

    if (!state.connected || !processAlive) {
      await this.connect(type);
    } else if (tokenExpiring) {
      try {
        const connectCmd = this.buildConnectCommand(type);
        await this.queueCommand(type, connectCmd);
        state.tokenExpiresAt = new Date(Date.now() + DEFAULT_TOKEN_LIFETIME_MS);
      } catch {
        this.killProcess(type);
        await this.connect(type);
      }
    }
  }

  /** Port of `SessionManager.execute()` (`SessionManager.ts:142-233`), incl. the stale-connection and process-death retry loops; amended 2026-07-10 to carry caller identity. */
  async execute(type: SessionType, command: string, onStdout?: (chunk: string) => void, consumer?: ConsumerIdentity): Promise<PSResult> {
    const identity = this.resolveConsumer('execute', consumer);
    return this.withActivity('execute', type, identity, () => this.executeCore(type, command, onStdout), command.substring(0, 120));
  }

  /** The unamended `execute` behavior (verbatim M1 port). */
  private async executeCore(type: SessionType, command: string, onStdout?: (chunk: string) => void): Promise<PSResult> {
    if (this.dryRun) {
      return {
        stdout: `[dry-run] Session: ${type} | Command: ${command.substring(0, 100)}...`,
        stderr: '',
        exitCode: 0,
        durationMs: 0,
      };
    }

    await this.ensureConnectedCore(type);

    const startTime = Date.now();
    const wrappedCommand = `$ErrorActionPreference = "Stop"\n${command}`;

    try {
      const result = await this.queueCommand(type, wrappedCommand, onStdout);

      if (STALE_CONNECTION_RE.test(result.stderr)) {
        const MAX_STALE_RETRIES = 5;
        for (let attempt = 1; attempt <= MAX_STALE_RETRIES; attempt++) {
          this.logger.warn(
            `[SessionFactory] Stale ${type} connection detected, reconnecting (attempt ${attempt}/${MAX_STALE_RETRIES})...`,
          );
          this.killProcess(type);
          await this.connect(type);
          if (type === 'sharepoint') {
            await new Promise((r) => setTimeout(r, 10000));
          }
          const retryResult = await this.queueCommand(type, wrappedCommand, onStdout);
          if (!STALE_CONNECTION_RE.test(retryResult.stderr)) {
            const retryState = this.states.get(type)!;
            retryState.lastUsedAt = new Date();
            return { ...retryResult, durationMs: Date.now() - startTime };
          }
        }
        this.logger.error(`[SessionFactory] ${type} connection still stale after ${MAX_STALE_RETRIES} retries, giving up.`);
        const state = this.states.get(type)!;
        state.lastUsedAt = new Date();
        return { ...result, durationMs: Date.now() - startTime };
      }

      const state = this.states.get(type)!;
      state.lastUsedAt = new Date();
      return { ...result, durationMs: Date.now() - startTime };
    } catch (err) {
      const MAX_RESPAWN_RETRIES = 5;
      for (let attempt = 1; attempt <= MAX_RESPAWN_RETRIES; attempt++) {
        this.logger.warn(
          `[SessionFactory] Process died during execute for ${type}, respawning (attempt ${attempt}/${MAX_RESPAWN_RETRIES})...`,
        );
        this.killProcess(type);
        try {
          await this.connect(type);
          if (type === 'sharepoint') {
            await new Promise((r) => setTimeout(r, 10000));
          }
          const result = await this.queueCommand(type, wrappedCommand, onStdout);
          const state = this.states.get(type)!;
          state.lastUsedAt = new Date();
          return { ...result, durationMs: Date.now() - startTime };
        } catch (retryErr) {
          if (attempt === MAX_RESPAWN_RETRIES) {
            this.logger.error(`[SessionFactory] ${type} respawn failed after ${MAX_RESPAWN_RETRIES} attempts, giving up.`);
            throw retryErr;
          }
        }
      }
      throw err;
    }
  }

  /** Port of `SessionManager.getSessionState()` (`SessionManager.ts:236-238`). */
  getSessionState(type: SessionType): SessionState {
    return { ...this.states.get(type)! };
  }

  /** Port of `SessionManager.getAllSessionStates()` (`SessionManager.ts:241-243`). */
  getAllSessionStates(): SessionState[] {
    return Array.from(this.states.values()).map((s) => ({ ...s }));
  }

  /** Port of `SessionManager.disconnectAll()` (`SessionManager.ts:246-251`). */
  async disconnectAll(): Promise<void> {
    for (const [type] of this.processes) {
      this.killProcess(type);
    }
    this.processes.clear();
  }

  /** Port of `SessionManager.connectMgGraph()` (`SessionManager.ts:256-280`); amended 2026-07-10 to carry caller identity. */
  async connectMgGraph(tenantId?: string, appId?: string, certThumbprint?: string, consumer?: ConsumerIdentity): Promise<void> {
    const identity = this.resolveConsumer('connectMgGraph', consumer);
    await this.withActivity('connectMgGraph', 'graph', identity, () => this.connectMgGraphCore(tenantId, appId, certThumbprint));
  }

  private async connectMgGraphCore(tenantId?: string, appId?: string, certThumbprint?: string): Promise<void> {
    if (this.dryRun) return;
    const connectCmd = this.buildConnectCommand('graph', tenantId, appId, certThumbprint);
    const modules = SESSION_MODULE_MAP['graph'];

    await this.spawnPersistentProcess('graph');
    const initScript = [
      '$ErrorActionPreference = "Stop"',
      ...modules,
      connectCmd,
      'Write-Output "STAMPER_SESSION_CONNECTED"',
    ].join('\n');

    const result = await this.queueCommand('graph', initScript);
    if (result.exitCode !== 0) {
      this.killProcess('graph');
      throw new Error(`Failed to connect Microsoft Graph: ${result.stderr}`);
    }

    const state = this.states.get('graph')!;
    state.connected = true;
    state.connectedAt = new Date();
    state.tokenExpiresAt = new Date(Date.now() + DEFAULT_TOKEN_LIFETIME_MS);
  }

  /** Port of `SessionManager.connectIPPS()` (`SessionManager.ts:285-308`); amended 2026-07-10 to carry caller identity. */
  async connectIPPS(tenantId?: string, appId?: string, certThumbprint?: string, consumer?: ConsumerIdentity): Promise<void> {
    const identity = this.resolveConsumer('connectIPPS', consumer);
    await this.withActivity('connectIPPS', 'purview', identity, () => this.connectIPPSCore(tenantId, appId, certThumbprint));
  }

  private async connectIPPSCore(tenantId?: string, appId?: string, certThumbprint?: string): Promise<void> {
    if (this.dryRun) return;
    const connectCmd = this.buildConnectCommand('purview', tenantId, appId, certThumbprint);
    const modules = SESSION_MODULE_MAP['graph']; // IPPS needs Graph modules too

    await this.spawnPersistentProcess('purview');
    const initScript = [
      '$ErrorActionPreference = "Stop"',
      ...modules,
      connectCmd,
      'Write-Output "STAMPER_SESSION_CONNECTED"',
    ].join('\n');

    const result = await this.queueCommand('purview', initScript);
    if (result.exitCode !== 0) {
      this.killProcess('purview');
      throw new Error(`Failed to connect IPPS: ${result.stderr}`);
    }

    const state = this.states.get('purview')!;
    state.connected = true;
    state.connectedAt = new Date();
    state.tokenExpiresAt = new Date(Date.now() + DEFAULT_TOKEN_LIFETIME_MS);
  }

  /** Port of `SessionManager.connect()` (`SessionManager.ts:310-390`). */
  private async connect(type: SessionType): Promise<void> {
    await retryWithBackoff(
      async () => {
        this.killProcess(type);
        await this.spawnPersistentProcess(type);

        const modules = SESSION_MODULE_MAP[type];
        const connectCmd = this.buildConnectCommand(type);
        const initScript = [
          ...modules,
          `try { ${connectCmd} } catch { Start-Sleep -Seconds 2; ${connectCmd} }`,
          '$ErrorActionPreference = "Stop"',
          'Write-Output "STAMPER_SESSION_CONNECTED"',
        ].join('\n');

        const result = await this.queueCommand(type, initScript);
        if (result.exitCode !== 0) {
          this.killProcess(type);
          throw new Error(`Failed to connect session "${type}": ${result.stderr}`);
        }

        if (result.stderr.trim()) {
          this.logger.warn(`[SessionFactory] ${type} init script stderr (exitCode=0): ${result.stderr.substring(0, 500)}`);
        }

        // SPO stabilization window + probe -- `SessionManager.ts:342-364`.
        if (type === 'sharepoint') {
          await new Promise((r) => setTimeout(r, 10000));
          let validated = false;
          for (let i = 0; i < 3 && !validated; i++) {
            if (i > 0) await new Promise((r) => setTimeout(r, 2000));
            const probe = await this.queueCommand(type, 'Get-SPOTenant | Select-Object -First 1 SharingCapability');
            if (!STALE_CONNECTION_RE.test(probe.stderr) && probe.exitCode === 0) {
              validated = true;
            }
          }
          if (!validated) {
            this.killProcess(type);
            throw new Error(`[SessionFactory] SPO post-connect validation failed after 3 attempts -- connection is dead`);
          }
        }

        const state = this.states.get(type)!;
        state.connected = true;
        state.connectedAt = new Date();
        state.tokenExpiresAt = new Date(Date.now() + DEFAULT_TOKEN_LIFETIME_MS);

        // Best-effort identity probe -- `SessionManager.ts:373-381`.
        try {
          const identityCmd = this.getIdentityCommand(type);
          if (identityCmd) {
            const idResult = await this.queueCommand(type, identityCmd);
            if (idResult.exitCode === 0 && idResult.stdout.trim()) {
              this.logger.log(`[SessionFactory] ${type}: identity -- ${idResult.stdout.trim().substring(0, 300)}`);
            }
          }
        } catch {
          /* best-effort -- identity query failure must not break the session */
        }

        if (type === 'sharepoint') {
          this.startKeepalive(type);
        }
      },
      { maxRetries: 3, baseDelayMs: 2000, shouldRetry: () => true },
    );
  }

  /** Port of `SessionManager.buildConnectCommand()` (`SessionManager.ts:392-432`) -- hardcoded GCC High/USGov literals preserved per the scope fence (design 2.2 is named new work, not this milestone). */
  buildConnectCommand(type: SessionType, tenantId?: string, appId?: string, certThumbprint?: string): string {
    const tid = tenantId || this.config.tenantId;
    const aid = appId || this.config.appId;
    const ct = certThumbprint || this.config.certThumbprint;
    const targetTenantDomain = this.config.targetTenantDomain ?? '';
    const tenantName = targetTenantDomain.split('.')[0];

    switch (type) {
      case 'graph':
        return `Connect-MgGraph -TenantId "${tid}" -ClientId "${aid}" -CertificateThumbprint "${ct}" -Environment USGov -NoWelcome`;

      case 'exchange':
        return `Connect-ExchangeOnline -AppId "${aid}" -Organization "${targetTenantDomain}" -CertificateThumbprint "${ct}" -ExchangeEnvironmentName O365USGovGCCHigh -ShowBanner:$false`;

      case 'purview':
        return `Connect-IPPSSession -AppId "${aid}" -Organization "${targetTenantDomain}" -CertificateThumbprint "${ct}" -ConnectionUri "https://ps.compliance.protection.office365.us/powershell-liveid/" -AzureADAuthorizationEndpointUri "https://login.microsoftonline.us/organizations"`;

      case 'azure': {
        const subId = this.config.subscriptionId;
        const subParam = subId ? ` -Subscription "${subId}"` : '';
        return `Connect-AzAccount -ServicePrincipal -TenantId "${tid}" -ApplicationId "${aid}" -CertificateThumbprint "${ct}" -Environment AzureUSGovernment${subParam} | Out-Null`;
      }

      case 'sharepoint': {
        // -CertificateThumbprint lets the SPO module do the CurrentUser\My
        // lookup internally (see `SessionManager.ts:417-423` comment).
        return `Import-Module Microsoft.Online.SharePoint.PowerShell -DisableNameChecking -WarningAction SilentlyContinue; Connect-SPOService -Url "https://${tenantName}-admin.us.sharepoint.us" -ClientId "${aid}" -TenantId "${tid}" -CertificateThumbprint "${ct}" -Region ITAR -ErrorAction Stop`;
      }

      case 'teams':
        return `Connect-MicrosoftTeams -TenantId "${tid}" -ApplicationId "${aid}" -CertificateThumbprint "${ct}" -TeamsEnvironmentName TeamsGCCH`;

      default:
        throw new Error(`Unknown session type: ${type}`);
    }
  }

  /** Port of `SessionManager.getIdentityCommand()` (`SessionManager.ts:434-451`). */
  private getIdentityCommand(type: SessionType): string | null {
    switch (type) {
      case 'graph':
        return '(Get-MgContext) | Select-Object -Property ClientId, TenantId, AppName | ConvertTo-Json -Compress';
      case 'azure':
        return '(Get-AzContext).Account | Select-Object -Property Id, Type | ConvertTo-Json -Compress';
      case 'exchange':
      case 'purview':
        return 'Get-ConnectionInformation | Select-Object -Property UserPrincipalName, Organization, ConnectionUri | ConvertTo-Json -Compress';
      case 'sharepoint':
      case 'teams':
      default:
        return null;
    }
  }

  // ---- Persistent process management ----

  /** Port of `SessionManager.spawnPersistentProcess()` (`SessionManager.ts:459-526`), spawn point injected via `spawnFn`. */
  private spawnPersistentProcess(type: SessionType): Promise<void> {
    return new Promise((resolve, reject) => {
      const existing = this.processes.get(type);
      if (existing && !existing.killed) {
        try {
          existing.kill();
        } catch {
          /* already dead */
        }
      }

      const proc = this.spawnFn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.sessionHostScript],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
      );

      this.processes.set(type, proc);

      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill();
          reject(new Error(`[SessionFactory] session-host.ps1 did not become ready within ${HOST_READY_TIMEOUT_MS / 1000}s for ${type}`));
        }
      }, HOST_READY_TIMEOUT_MS);

      const onData = (data: Buffer): void => {
        const text = data.toString();
        if (text.includes(HOST_READY_MARKER) && !settled) {
          settled = true;
          clearTimeout(timeout);
          proc.stdout!.removeListener('data', onData);
          resolve();
        }
      };
      proc.stdout!.on('data', onData);

      proc.on('error', (err: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`[SessionFactory] Failed to spawn session-host.ps1 for ${type}: ${err.message}`));
        } else {
          this.logger.warn(`[SessionFactory] Process error for ${type} (post-spawn): ${err.message}`);
        }
      });

      proc.on('close', (code: number | null) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`[SessionFactory] session-host.ps1 exited (code ${code}) before ready for ${type}`));
        }
        const state = this.states.get(type);
        if (state) state.connected = false;
      });
    });
  }

  /** Port of `SessionManager.queueCommand()` (`SessionManager.ts:532-543`). */
  private queueCommand(
    type: SessionType,
    command: string,
    onStdout?: (chunk: string) => void,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const prev = this.commandQueues.get(type) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(() => this.sendCommand(type, command, onStdout));
    this.commandQueues.set(type, next);
    return next;
  }

  /** Port of `SessionManager.sendCommand()` (`SessionManager.ts:549-656`) -- marker-based stdio protocol, verbatim. */
  private sendCommand(
    type: SessionType,
    command: string,
    onStdout?: (chunk: string) => void,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = this.processes.get(type);
      if (!proc || proc.killed || proc.exitCode !== null || !proc.stdin || !proc.stdout || !proc.stderr) {
        reject(new Error(`[SessionFactory] No live process for session "${type}"`));
        return;
      }

      const stdin = proc.stdin;
      const stdout = proc.stdout;
      const stderr = proc.stderr;

      let stdoutBuf = '';
      let stderrBuf = '';
      let stdoutDone = false;
      let stderrDone = false;
      let exitCode = 0;

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`[SessionFactory] Command timed out after ${COMMAND_TIMEOUT_MS / 1000}s for session "${type}"`));
      }, COMMAND_TIMEOUT_MS);

      const tryResolve = (): void => {
        if (stdoutDone && stderrDone) {
          cleanup();
          resolve({ stdout: stdoutBuf, stderr: stderrBuf, exitCode });
        }
      };

      const onStdoutData = (data: Buffer): void => {
        const text = data.toString();
        const lines = (stdoutBuf + text).split('\n');
        stdoutBuf = '';

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trim();

          if (trimmed === STDOUT_END_MARKER) {
            stdoutDone = true;
            continue;
          }

          if (trimmed.startsWith(EXIT_MARKER_PREFIX)) {
            exitCode = parseInt(trimmed.substring(EXIT_MARKER_PREFIX.length), 10) || 0;
            tryResolve();
            return;
          }

          if (i < lines.length - 1) {
            if (!stdoutDone) {
              stdoutBuf += line + '\n';
              if (onStdout) onStdout(line + '\n');
            }
          } else {
            if (!stdoutDone) {
              stdoutBuf += line;
            }
          }
        }
      };

      const onStderrData = (data: Buffer): void => {
        const text = data.toString();
        if (text.includes(STDERR_END_MARKER)) {
          const parts = text.split(STDERR_END_MARKER);
          stderrBuf += parts[0];
          stderrDone = true;
          tryResolve();
        } else {
          stderrBuf += text;
        }
      };

      const onClose = (code: number | null): void => {
        cleanup();
        reject(new Error(`[SessionFactory] Process for "${type}" died (code ${code}) during command execution`));
      };

      const cleanup = (): void => {
        clearTimeout(timeout);
        stdout.removeListener('data', onStdoutData);
        stderr.removeListener('data', onStderrData);
        proc.removeListener('close', onClose);
      };

      stdout.on('data', onStdoutData);
      stderr.on('data', onStderrData);
      proc.on('close', onClose);

      stdin.write(command + '\n' + CMD_END_MARKER + '\n');
    });
  }

  /** Port of `SessionManager.startKeepalive()` (`SessionManager.ts:659-678`). */
  private startKeepalive(type: SessionType): void {
    this.stopKeepalive(type);
    const timer = setInterval(async () => {
      const state = this.states.get(type);
      if (!state?.connected) {
        this.stopKeepalive(type);
        return;
      }
      if (state.lastUsedAt && Date.now() - state.lastUsedAt.getTime() < SPO_KEEPALIVE_INTERVAL_MS) {
        return;
      }
      try {
        await this.queueCommand(type, 'Get-SPOTenant | Select-Object -First 1 SharingCapability');
        state.lastUsedAt = new Date();
      } catch {
        /* process died -- keepalive will stop on next check */
      }
    }, SPO_KEEPALIVE_INTERVAL_MS);
    timer.unref();
    this.keepaliveTimers.set(type, timer);
  }

  private stopKeepalive(type: SessionType): void {
    const timer = this.keepaliveTimers.get(type);
    if (timer) {
      clearInterval(timer);
      this.keepaliveTimers.delete(type);
    }
  }

  /** Port of `SessionManager.killProcess()` (`SessionManager.ts:685-698`). */
  private killProcess(type: SessionType): void {
    this.stopKeepalive(type);
    this.commandQueues.delete(type);
    const proc = this.processes.get(type);
    if (proc) {
      try {
        proc.stdin?.end();
        proc.kill();
      } catch {
        /* already dead */
      }
      this.processes.delete(type);
    }
    const state = this.states.get(type);
    if (state) state.connected = false;
  }
}
