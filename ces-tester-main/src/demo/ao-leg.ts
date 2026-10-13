// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-3 M3 — Beat 5 (AO): "lock down default user permissions — nobody but
 * an admin creates apps or tenants; the evidence collects itself."
 *
 * Shape ruled by FD-3: command **A-18** (Tier 2, so no approval flow; zero
 * parameters) executed LIVE through the AdminOps GUI. A GUI dry-run against the
 * sim is structurally impossible — with the Live-Execution toggle off the
 * front-end hardcodes tenant `'dev'` (`public/index.html:1193`) — so the sim
 * leg IS the live one.
 *
 * **Artifact-judged, never exit-code-judged.** A row is written on every path
 * including dry-run and a persistence failure is silently swallowed
 * (finding #6), and the GUI's own evidence panel misrenders two fields
 * (finding #8), so neither the process exit code, the HTTP status, nor a badge
 * decides this beat. The judges are `ao-evidence.ts`'s: an `adminops_evidence`
 * row-count increase for THIS tenant, the new row's
 * `data.evidence.metadata.{stateChanged,commandExecuted,sha256Hash}`, and at
 * least one `type === 'mutate'` stacksim ledger entry inside AO's window.
 *
 * The beat must NOT narrate pre-state capture: AO's pre/post reads hardcode
 * `dryRun=true`, so those fields are stubs even here (finding #6b,
 * REQ-AO-GETTHENSET-PRESTATE-IS-STUB).
 *
 * Self-gating like `eo-leg.ts`: never throws, returns `available:false` when
 * the environment cannot host AO, and an honest `error` on any live failure —
 * a demo shows "AO detail pending", never a crash and never a fabricated pass.
 *
 * The Playwright drive is injected (`AoLegOptions.drive`): the user-perspective
 * layer is `src/demo/ao-ui-driver.ts`, an M4 deliverable. Structured numbers
 * never come from the DOM either way — they come from `ces.db` and the ledger.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SimLaunchEnv } from 'ces-tenant';
import { queryLedger, DEFAULT_STACKSIM_SERVER_URL } from '../stacksim-client/http.js';
import type { LedgerEntry } from '../stacksim-client/types.js';
import { buildGuiChildEnv, guiCliEntry, startAoGui, AO_GUI_PORT, type GuiServerHandle } from './gui-servers.js';
import {
  readAoEvidence,
  evaluateAoEvidence,
  diffAoEvidenceRows,
  simTenantId,
  type AoEvidenceRow,
  type AoEvidenceVerdict,
} from './ao-evidence.js';
import { HEADLESS_MODE, type WatchMode } from './watch-mode.js';

/** FD-3: "Default User Permission Lockdown" — Tier 2, zero parameters. */
export const AO_DEMO_COMMAND_ID = 'A-18';

/** What the Playwright driver is handed. */
export interface AoUiDriveContext {
  readonly baseUrl: string;
  readonly slug: string;
  readonly commandId: string;
  readonly watch: WatchMode;
}

/**
 * What the driver reports back. Only fields that genuinely render are worth
 * asserting on (`#resultStatusBadge`, `#evidenceOutcomeBadge`); `#resultOutput`
 * reads "No output available" on an empty-stdout PATCH and `#evidenceVerdict`
 * reads "No verdict available" even on `SAT` (finding #8).
 */
export interface AoUiDriveResult {
  readonly statusBadge?: string;
  readonly outcomeBadge?: string;
  /** Body of `POST /api/execute/<commandId>`, captured from the browser's own traffic. */
  readonly executeResponse?: unknown;
  /** FX-AO7: the `ao-ui-<uuid>` correlationId this click sent (route echo, else the result panel). */
  readonly correlationId?: string;
  readonly screenshots?: readonly string[];
}

export type AoUiDriver = (ctx: AoUiDriveContext) => Promise<AoUiDriveResult>;

export interface AoLegOptions {
  /** ces-ao checkout root — also the GUI spawn cwd. */
  readonly aoRoot: string;
  readonly slug: string;
  /** From `getSimLaunchEnv(registry, slug, ...)`. */
  readonly simLaunchEnv: SimLaunchEnv;
  /** ces-tester's `assets/psmodules-shim`. */
  readonly shimRoot: string;
  /** Run-scoped `CES_PIPELINE_ROOT` — never the shared `C:\CES_Pipeline`. */
  readonly pipelineRoot: string;
  /** The M4 Playwright driver (`ao-ui-driver.ts`). */
  readonly drive: AoUiDriver;
  readonly tenantRoot?: string;
  /** Defaults to `sim-tenant-<slug>` — rows scope by tenant_id, never by slug. */
  readonly tenantId?: string;
  readonly commandId?: string;
  readonly port?: number;
  readonly simUrl?: string;
  /** Defaults to `<pipelineRoot>/ces.db`. */
  readonly dbPath?: string;
  readonly logPath?: string;
  readonly watch?: WatchMode;
  readonly readyTimeoutMs?: number;
}

export interface AoLegResult {
  /** false ⇒ self-gated (env cannot host AO); caller shows "AO detail pending". */
  readonly available: boolean;
  /** true ⇒ the GUI drive completed without throwing (says nothing about evidence). */
  readonly executed: boolean;
  readonly tenantId: string;
  readonly commandId: string;
  /** The artifact judges. `verdict.satisfied` is the beat's pass/fail. */
  readonly verdict?: AoEvidenceVerdict;
  /** Rows that appeared in AO's window, for the run's evidence listing. */
  readonly addedRows?: readonly AoEvidenceRow[];
  readonly ui?: AoUiDriveResult;
  readonly error?: string;
}

/** `<pipelineRoot>/ces.db` — where AO persists evidence (finding #2). Pure. */
export function aoDbPath(pipelineRoot: string, dbPath?: string): string {
  return dbPath ?? path.join(pipelineRoot, 'ces.db');
}

export interface AoLegGateFacts {
  readonly platform: string;
  /** `<aoRoot>/dist/cli/index.js` exists — preflight builds it. */
  readonly aoCliExists: boolean;
  /** The FD-5 shim manifest is on disk (its absence breaks PowerShell prereqs). */
  readonly shimExists: boolean;
}

export interface AoLegGate {
  readonly available: boolean;
  readonly reason?: string;
}

/**
 * Can this environment host the AO leg at all? Pure, so the gate is testable
 * without a machine that satisfies it. Windows-only: every AO execution path
 * spawns `powershell.exe`.
 */
export function gateAoLeg(facts: AoLegGateFacts): AoLegGate {
  if (facts.platform !== 'win32') return { available: false, reason: 'AO leg requires Windows PowerShell (off-Windows)' };
  if (!facts.aoCliExists) return { available: false, reason: 'ces-ao is not built (dist/cli/index.js absent)' };
  if (!facts.shimExists) return { available: false, reason: 'Microsoft.Graph shim manifest missing from assets/psmodules-shim' };
  return { available: true };
}

export interface AoLegAssemblyInput {
  readonly gate: AoLegGate;
  readonly tenantId: string;
  readonly commandId: string;
  readonly executed: boolean;
  readonly verdict?: AoEvidenceVerdict;
  readonly addedRows?: readonly AoEvidenceRow[];
  readonly ui?: AoUiDriveResult;
  readonly error?: string;
}

/**
 * Assemble the leg's result. Pure. The one rule it enforces: an unsatisfied
 * verdict always surfaces a reason string, so a failing beat can never be
 * rendered as a silent pass — the failures come from the artifacts, in the
 * order the predicate lists them.
 */
export function buildAoLegResult(input: AoLegAssemblyInput): AoLegResult {
  if (!input.gate.available) {
    return {
      available: false,
      executed: false,
      tenantId: input.tenantId,
      commandId: input.commandId,
      error: input.gate.reason,
    };
  }
  const error =
    input.error ??
    (input.verdict && !input.verdict.satisfied
      ? `AO evidence not proven: ${input.verdict.failures.join('; ')}`
      : undefined);
  return {
    available: true,
    executed: input.executed,
    tenantId: input.tenantId,
    commandId: input.commandId,
    verdict: input.verdict,
    addedRows: input.addedRows,
    ui: input.ui,
    error,
  };
}

/**
 * Ledger snapshot. Deliberately propagates a failure to `runAoLeg`'s catch: a
 * window whose ledger could not be snapshotted cannot be judged, and an honest
 * error beats a mutation delta computed from a missing endpoint.
 */
async function snapshotLedger(simUrl: string): Promise<readonly LedgerEntry[]> {
  return queryLedger(simUrl, {});
}

/**
 * Run Beat 5. Boots `ao gui --port 3001` against the already-running sim
 * (this leg never owns the stacksim serve — the e2e run does), lets the
 * injected Playwright driver perform the live A-18 write from the user's
 * perspective, then judges the artifacts on both sides of that window.
 */
export async function runAoLeg(opts: AoLegOptions): Promise<AoLegResult> {
  const tenantId = opts.tenantId ?? simTenantId(opts.slug);
  const commandId = opts.commandId ?? AO_DEMO_COMMAND_ID;
  const shimManifest = path.join(opts.shimRoot, 'Microsoft.Graph', 'Microsoft.Graph.psd1');

  const gate = gateAoLeg({
    platform: process.platform,
    aoCliExists: fs.existsSync(guiCliEntry(opts.aoRoot)),
    shimExists: fs.existsSync(shimManifest),
  });
  if (!gate.available) return buildAoLegResult({ gate, tenantId, commandId, executed: false });

  const simUrl = opts.simUrl ?? DEFAULT_STACKSIM_SERVER_URL;
  const dbPath = aoDbPath(opts.pipelineRoot, opts.dbPath);
  let gui: GuiServerHandle | undefined;

  try {
    fs.mkdirSync(opts.pipelineRoot, { recursive: true });

    // BEFORE snapshot — taken before the server starts, so the window covers
    // everything AO does, including anything its own boot writes.
    const rowsBefore = readAoEvidence(dbPath, tenantId);
    const ledgerBefore = await snapshotLedger(simUrl);

    const env = buildGuiChildEnv({
      simLaunchEnv: opts.simLaunchEnv,
      shimRoot: opts.shimRoot,
      tenantRoot: opts.tenantRoot,
      pipelineRoot: opts.pipelineRoot,
    });

    gui = await startAoGui({
      aoRoot: opts.aoRoot,
      env,
      port: opts.port ?? AO_GUI_PORT,
      logPath: opts.logPath,
      readyTimeoutMs: opts.readyTimeoutMs,
    });

    const ui = await opts.drive({
      baseUrl: gui.baseUrl,
      slug: opts.slug,
      commandId,
      watch: opts.watch ?? HEADLESS_MODE,
    });

    const rowsAfter = readAoEvidence(dbPath, tenantId);
    const ledgerAfter = await snapshotLedger(simUrl);
    const verdict = evaluateAoEvidence({ rowsBefore, rowsAfter, ledgerBefore, ledgerAfter });

    return buildAoLegResult({
      gate,
      tenantId,
      commandId,
      executed: true,
      verdict,
      addedRows: diffAoEvidenceRows(rowsBefore, rowsAfter),
      ui,
    });
  } catch (err) {
    return buildAoLegResult({
      gate,
      tenantId,
      commandId,
      executed: false,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    if (gui) await gui.stop().catch(() => undefined);
  }
}
