// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-29 (finishing plan PH-2 harness): the shared shape of the new steps (E0, E7S, E8R, E8T, E8G, E9A, E9E, E9M) and
 * the run context `muster-e2e-run.ts` hands them. Each area module (fin29-stamper.ts, ao-sweep-run.ts / fin29-ao.ts,
 * fin29-eo-muster.ts) exports step factories that take this context; the runner places them. Every FIN-29 step is
 * `fatal: false` and outside REQUIRED_STEPS: the V-checks (V77, V101, V115-V117, V119-V121, V126-V130) judge them.
 *
 * Run secrets: a step that mints or receives a secret value registers it with `ctx.registerSecret(name, value)` so the
 * end-of-run leak scan (V101, SP-11) can count it. The value stays in memory; only counts are written.
 */
import type { ChildProcess } from 'node:child_process';

export interface Fin29StepOutcome {
  rc: number;
  detail?: string;
  extra?: Record<string, unknown>;
}

export interface Fin29StepDef {
  id: string;
  title: string;
  commands: string[];
  /** Always false for FIN-29 steps (kept explicit so the runner's StepDef shape is satisfied). */
  fatal: false;
  /** When set, the step is recorded as skipped with this reason. */
  skip?: string;
  run: () => Promise<Fin29StepOutcome>;
}

export interface Fin29Captured {
  rc: number;
  stdout: string;
  stderr: string;
}

/** Paths a FIN-29 step may use (a subset of muster-e2e-run.ts musterE2ePaths, plus the FIN-29 records). */
export interface Fin29Paths {
  ws: string;
  pkg: string;
  ces: string;
  out: string;
  logs: string;
  pl: string;
  tenants: string;
  sim: string;
  musterApi: string;
  muster: string;
  stamper: string;
  stamperRegistry: string;
  tsx: string;
  exe: string;
  st: string;
  stCwd: string;
  forced: string;
  plansPushed: string;
  planDir: string;
  aoRoot: string;
  aoCli: string;
  eoRoot: string;
  registryRecord: string;
  mintToken: string;
}

export interface Fin29Urls {
  sim: string;
  api: string;
  ec: string;
  eo: string;
}

export interface Fin29StepCtx {
  slug: string;
  /** The scenario JSON (MusterE2eScenario); typed loosely so area modules do not import the loader. */
  scenario: Record<string, unknown>;
  P: Fin29Paths;
  urls: Fin29Urls;
  /** process.execPath */
  node: string;
  log: (line: string) => void;
  /** A path relative to the workspace root, forward slashes (for records and step commands). */
  rel: (p: string) => string;
  nowIso: () => string;
  /** One child call with captured output, logged to logs/<label>.{out,err}; 10 min, then the tree is stopped. */
  runCapture: (label: string, exe: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<Fin29Captured>;
  /** One AO CLI call (node <ces-ao cli>), logged to logs/E7A-<label>.{out,err}. */
  runAoCli: (args: string[], env: NodeJS.ProcessEnv, label: string) => Promise<Fin29Captured>;
  /** A background child logged to logs/<name>.{out,err}; the caller stops it with stopTree. */
  startBg: (name: string, exe: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => ChildProcess;
  stopTree: (c: ChildProcess | undefined) => void;
  /** True when any HTTP answer arrives within `seconds`. */
  waitHttp: (url: string, method: 'GET' | 'POST', seconds: number) => Promise<boolean>;
  portHeld: (port: number) => Promise<boolean>;
  /** EO's bearer headers (SEC-4), as every harness EO call sends. */
  eoAuthHeaders: () => Record<string, string>;
  // ---------- run state (getters: the runner fills these as the steps run) ----------
  /** The sim launch env (E5); undefined before E5. */
  simEnv: () => NodeJS.ProcessEnv | undefined;
  /** The Stamper child env (sim env + the muster-api secret resolver while muster-api is up). */
  stamperEnv: () => NodeJS.ProcessEnv | undefined;
  /** AO's child env (E7A's). */
  aoEnv: () => NodeJS.ProcessEnv | undefined;
  simUp: () => boolean;
  eoUp: () => boolean;
  musterApiUp: () => boolean;
  /** E3's muster-api operator token (never argv, never a file). */
  musterToken: () => string | undefined;
  /** E3's muster-api JWT secret (a second tenant's token is minted with it). */
  musterJwt: () => string | undefined;
  /** Register a run secret for the V101 leak scan (counts only are written). */
  registerSecret: (name: string, value: string | undefined | null) => void;
}

/** Schema ids of the FIN-29 records (the V-checks pin them). */
export const FIN29_SCHEMAS = {
  e0: 'ces-tester/e0-clean-tenant@1',
  e8r: 'ces-tester/e8r-lifecycle@1',
  e8t: 'ces-tester/e8t-cli-terminal@1',
  e8g: 'ces-tester/e8g-gui-cost@1',
  aoSweep: 'ces-tester/ao-sweep@1',
  aoSurfaces: 'ces-tester/ao-surfaces@1',
  eoRoutes: 'ces-tester/eo-routes@1',
  eoContinuous: 'ces-tester/eo-continuous@1',
  musterEngagement: 'ces-tester/muster-engagement@1',
  musterSurfaces: 'ces-tester/muster-surfaces@1',
  secretScan: 'ces-tester/secret-scan@1',
} as const;

/** The FIN-29 output files under out/ (per-run artefacts: the runner's cleanup removes them before E1). */
export const FIN29_FILES = {
  e0: 'e0-clean-tenant.json',
  e8r: 'e8r-lifecycle.json',
  e8t: 'cli-terminal.json',
  e8g: 'stamper-gui-cost.json',
  aoSweep: 'ao-sweep.json',
  aoSurfaces: 'ao-surfaces.json',
  eoRoutes: 'eo-routes.json',
  eoContinuous: 'eo-continuous.json',
  musterEngagement: 'muster-engagement.json',
  musterSurfaces: 'muster-surfaces.json',
  secretScan: 'secret-scan.json',
} as const;

/** Per-run directories under out/ the FIN-29 steps write (private roots copies, PTY transcripts). */
export const FIN29_DIRS = ['e0', 'e8r', 'e8t', 'e8g', 'ao-sweep', 'ao-surfaces', 'e9'] as const;
