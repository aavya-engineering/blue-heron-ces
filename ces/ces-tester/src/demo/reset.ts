// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-1 — unified demo reset (critique P1-8, and GP-DEMO-1 M1 "one command
 * to reset").
 *
 * After a demo run, state is scattered: the seeded stacksim tenant, this repo's
 * gitignored `runs/`, a throwaway EO STORAGE_ROOT, and (harmlessly, but
 * noisily) a stale `.stacksim.lock`. `demo:reset` restores pristine so the next
 * run — or the next take of a recording — starts clean and deterministic.
 *
 * DO-NO-HARM stance on ports/processes: freeing a port means terminating
 * whatever owns it, and mis-identifying the owner could kill an unrelated
 * process. So reset does NOT force-kill by default: it performs the safe,
 * scoped filesystem cleanup and REPORTS any occupied demo port for the operator
 * (or pre-flight) to resolve. Aggressive port reclamation is a deliberate,
 * opt-in follow-up (iteration 2), not a default that could harm.
 *
 * planReset() is pure so the plan is unit-testable; executeReset() performs it.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type ResetActionKind =
  | 'stacksim-tenant-reset' // wipe+reseed the demo slug (delegated to stacksim)
  | 'remove-lock' // stale .stacksim.lock
  | 'clear-runs' // this repo's gitignored runs/
  | 'clear-eo-storage' // throwaway EO STORAGE_ROOT
  | 'report-ports'; // occupied demo ports (report only — see do-no-harm note)

export interface ResetAction {
  readonly id: string;
  readonly kind: ResetActionKind;
  readonly description: string;
  /** Filesystem target for fs-affecting actions (absent for report-only). */
  readonly target?: string;
}

export interface ResetPlanOptions {
  readonly stacksimRoot: string;
  readonly demoSlug: string;
  readonly testerRoot: string;
  /** Throwaway EO storage root, if the run used one. */
  readonly eoStorageRoot?: string;
  readonly ports: readonly { readonly name: string; readonly port: number }[];
}

/**
 * Build the ordered reset plan. Order matters: reset the tenant (which also
 * clears its lock) before we bother removing a leftover lock, clear local run
 * artifacts, drop throwaway EO storage, and finally report ports last so the
 * operator sees the one thing reset intentionally will not auto-do.
 */
export function planReset(opts: ResetPlanOptions): ResetAction[] {
  const tenantRoot = path.join(opts.stacksimRoot, '.stacksim', 'tenants', opts.demoSlug);
  const actions: ResetAction[] = [
    {
      id: 'tenant',
      kind: 'stacksim-tenant-reset',
      description: `reset stacksim demo tenant '${opts.demoSlug}' to pristine (wipe + reseed)`,
      target: tenantRoot,
    },
    {
      id: 'lock',
      kind: 'remove-lock',
      description: `remove stale ${opts.demoSlug} .stacksim.lock if present`,
      target: path.join(tenantRoot, '.stacksim.lock'),
    },
    {
      id: 'runs',
      kind: 'clear-runs',
      description: 'clear ces-tester runs/ (gitignored run artifacts)',
      target: path.join(opts.testerRoot, 'runs'),
    },
  ];
  if (opts.eoStorageRoot) {
    actions.push({
      id: 'eo-storage',
      kind: 'clear-eo-storage',
      description: 'delete throwaway EO STORAGE_ROOT',
      target: opts.eoStorageRoot,
    });
  }
  actions.push({
    id: 'ports',
    kind: 'report-ports',
    description: `report occupancy of demo ports ${opts.ports.map((p) => p.port).join('/')} (not auto-killed — see reset do-no-harm note)`,
  });
  return actions;
}

export interface ResetActionOutcome {
  readonly id: string;
  readonly kind: ResetActionKind;
  readonly status: 'done' | 'skipped' | 'reported' | 'error';
  readonly detail: string;
}

async function rmrf(target: string): Promise<'done' | 'skipped'> {
  try {
    await fs.rm(target, { recursive: true, force: true });
    return 'done';
  } catch {
    return 'skipped';
  }
}

export interface ExecuteResetDeps {
  /** Reset the demo tenant to pristine. Injected so the CLI wires stacksim's
   * own `demo:reset` and tests stay filesystem-free. */
  readonly resetTenant?: (slug: string) => Promise<void>;
  /** Probe a port for the report-ports action. */
  readonly probePort?: (port: number) => Promise<'free' | 'occupied'>;
}

/** Execute a reset plan. Filesystem clears are best-effort; nothing throws so a
 * partial reset still reports every action's outcome. */
export async function executeReset(
  plan: readonly ResetAction[],
  opts: ResetPlanOptions,
  deps: ExecuteResetDeps = {},
): Promise<ResetActionOutcome[]> {
  const outcomes: ResetActionOutcome[] = [];
  for (const action of plan) {
    switch (action.kind) {
      case 'stacksim-tenant-reset': {
        if (deps.resetTenant) {
          try {
            await deps.resetTenant(opts.demoSlug);
            outcomes.push({ id: action.id, kind: action.kind, status: 'done', detail: `tenant ${opts.demoSlug} reset` });
          } catch (err) {
            outcomes.push({
              id: action.id,
              kind: action.kind,
              status: 'error',
              detail: err instanceof Error ? err.message : String(err),
            });
          }
        } else {
          outcomes.push({
            id: action.id,
            kind: action.kind,
            status: 'skipped',
            detail: 'no tenant-reset wired (run stacksim `npm run demo:reset` manually)',
          });
        }
        break;
      }
      case 'remove-lock':
      case 'clear-runs':
      case 'clear-eo-storage': {
        const r = action.target ? await rmrf(action.target) : 'skipped';
        outcomes.push({ id: action.id, kind: action.kind, status: r, detail: action.target ?? '(no target)' });
        break;
      }
      case 'report-ports': {
        const probe = deps.probePort;
        if (!probe) {
          outcomes.push({ id: action.id, kind: action.kind, status: 'reported', detail: 'port probe not wired' });
          break;
        }
        const occupied: number[] = [];
        for (const p of opts.ports) {
          if ((await probe(p.port)) === 'occupied') occupied.push(p.port);
        }
        outcomes.push({
          id: action.id,
          kind: action.kind,
          status: 'reported',
          detail: occupied.length ? `still occupied: ${occupied.join(', ')}` : 'all demo ports free',
        });
        break;
      }
    }
  }
  return outcomes;
}
