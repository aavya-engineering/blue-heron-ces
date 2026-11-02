// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// simDiscoveryRun.ts — W4-MU2 (MU-02): the ONE sim discovery run, shared by
// `mu discovery --sim` (cli/discoveryCli.ts) and POST /api/discovery/run
// (routes/discovery.ts). Extracted verbatim from the CLI body so the SPA's
// "Run discovery" and the CLI walk the same registry, over the same live-sim
// session, with the same zero-writes assertion and the same envelope builder —
// one path, not a second one.
//
// Sim only, structurally: the target is the SIM_URL constant (127.0.0.1:4390)
// and the session is buildLiveSimSession() (sim psmodules as the ONLY
// PSModulePath). No caller can pass a tenant URL. FD-LIVE-SMOKE.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  runDiscovery,
  type RegistryGetEntry,
  type DiscoverySession,
  type CaptureSink,
  type DiscoveryObservation,
} from './discoveryService.js';
import { loadRegistryGetEntries } from './discoveryWiring.js';
import { SIM_URL, buildLiveSimSession, ledgerReachable, queryLedger } from './liveSimSession.js';
import { buildDiscoveryReadinessResult, fileCaptureSink } from './discoveryEnvelope.js';
import { answerBoundsFromFacts, resolveDiscoveryVariables, variableCoverage, type AnswerFact } from './discoveryVariables.js';
import { realGraphClient } from '../lib/graphClient.js';
import { recordDiscovery } from './musterWorm.js';

export interface SimDiscoveryDeps {
  probeLedger?: (url: string) => Promise<boolean>;
  loadEntries?: () => RegistryGetEntry[];
  session?: DiscoverySession;
  makeCapture?: (outDir: string) => CaptureSink;
  mkdir?: (path: string) => void;
  now?: () => Date;
  /** Default queries the real sim ledger (create/mutate since the walk began). */
  assertZeroWrites?: (simUrl: string, since: string) => Promise<{ ok: boolean; offenders?: unknown[] }>;
  registryRoot?: string;
  /**
   * W5c3 (P-2): the `{variable}` values for the walk. Default: the sim's Graph
   * tenant reads plus one az workspace read (discoveryVariables.ts); with an
   * injected session and no resolver, none (tests stay offline).
   */
  resolveVariables?: (session: DiscoverySession) => Promise<Record<string, string>>;
  /**
   * W5c4: the organisation's answers (InterviewFact[]: an answers file or the
   * session's facts). They supply the lookup blocks' answer-held variable
   * (wifiSsid, TCP.MU.006) and the answered bounds (PI.ODP.003). None: those
   * conditions stay undecidable or keep the registry bound.
   */
  answers?: AnswerFact[];
  /**
   * FLOW-1: records the completed run write-once in ces.db (muster_discovery).
   * Default: recordDiscovery; with an injected session and no recorder, none
   * (tests stay off the real ces.db).
   */
  recordDiscovery?: typeof recordDiscovery;
}

export type SimDiscoveryFailure = 'sim_unreachable' | 'no_entries' | 'writes_detected' | 'envelope_invalid';

export type SimDiscoveryOutcome =
  | {
      ok: true;
      envelope: unknown;
      stats: Awaited<ReturnType<typeof runDiscovery>>['stats'];
      postures: { met: number; unknown: number; not_met: number };
      /** W5c3 (P-2): the variables resolved, and the registry entries whose placeholders they fill (sim walk only; the live walk does not resolve them yet). */
      variables?: { resolved: string[]; coverage: ReturnType<typeof variableCoverage> };
      /** W5c4: the answered bounds applied to lookup conditions (dot path -> value). */
      bounds?: Record<string, number | string>;
    }
  | { ok: false; code: SimDiscoveryFailure; message: string };

const REGISTRY_FILES = ['cmmc-l2-commands.registry.json', 'infra-cmmc-l2-commands.registry.json'];

export function defaultRegistryRoot(): string {
  // Module-anchored (muster-api/{src|dist}/services -> up 4 = ces/), not cwd.
  // Env override still wins.
  return process.env.STAMPER_REGISTRY_ROOT ?? resolve(__dirname, '..', '..', '..', '..', 'ces-stamper', 'src', 'registry');
}

/** Read each registry file's own `version` field for provenance.registry_versions. */
export function readRegistryVersions(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of REGISTRY_FILES) {
    const p = join(root, file);
    if (!existsSync(p)) continue;
    try {
      const reg = JSON.parse(readFileSync(p, 'utf-8'));
      out[file.replace('.registry.json', '')] = typeof reg.version === 'string' ? reg.version : 'unknown';
    } catch {
      // Malformed registry file: omit its version rather than fail the run.
    }
  }
  return out;
}

async function defaultAssertZeroWrites(
  simUrl: string,
  since: string
): Promise<{ ok: boolean; offenders?: unknown[] }> {
  const offenders: unknown[] = [];
  for (const type of ['create', 'mutate'] as const) {
    offenders.push(...(await queryLedger(simUrl, type, since)));
  }
  return offenders.length === 0 ? { ok: true } : { ok: false, offenders };
}

export function postureCounts(observations: DiscoveryObservation[]): { met: number; unknown: number; not_met: number } {
  const met = observations.filter((o) => o.derived_posture === 'met').length;
  const unknown = observations.filter((o) => o.derived_posture === 'unknown').length;
  return { met, unknown, not_met: observations.length - met - unknown };
}

/**
 * Probe the running sim, walk the Stamper registry read-only, assert the sim
 * ledger saw zero writes, and build the readiness-result.v1 envelope. Captures
 * land under `<outDir>/captures`. Never boots or resets the sim.
 */
export async function runSimDiscovery(
  input: { slug: string; outDir: string },
  deps: SimDiscoveryDeps = {}
): Promise<SimDiscoveryOutcome> {
  const probeLedger = deps.probeLedger ?? ledgerReachable;
  const loadEntries = deps.loadEntries ?? loadRegistryGetEntries;
  const now = deps.now ?? (() => new Date());
  const mkdir = deps.mkdir ?? ((p: string) => mkdirSync(p, { recursive: true }));
  const assertZeroWrites = deps.assertZeroWrites ?? defaultAssertZeroWrites;
  const registryRoot = deps.registryRoot ?? defaultRegistryRoot();

  const reachable = await probeLedger(SIM_URL);
  if (!reachable) {
    return {
      ok: false,
      code: 'sim_unreachable',
      message:
        `stacksim sim server not reachable at ${SIM_URL} (POST /ledger did not answer). ` +
        'This CLI does not boot or reset the sim — the caller owns seeding + serving. ' +
        'Start it first, e.g.: cd tenant-stacksim && node bin/stacksim.mjs serve m365_azure',
    };
  }

  const entries = loadEntries();
  if (entries.length === 0) {
    return {
      ok: false,
      code: 'no_entries',
      message: 'no Stamper registry get-entries loaded (check STAMPER_REGISTRY_ROOT / the sibling ces-stamper checkout)',
    };
  }

  const session = deps.session ?? buildLiveSimSession();
  mkdir(join(input.outDir, 'captures'));
  const capture = (deps.makeCapture ?? fileCaptureSink)(input.outDir);

  const resolveVariables =
    deps.resolveVariables ??
    (deps.session
      ? async () => ({})
      : async (s: DiscoverySession) =>
          (await resolveDiscoveryVariables(
            realGraphClient('stacksim', `${SIM_URL}/v1.0`),
            s,
            undefined,
            deps.answers ?? []
          )) as Record<string, string>);
  const variables = await resolveVariables(session);
  const bounds = answerBoundsFromFacts(deps.answers ?? []);

  const startedAt = now().toISOString();
  const result = await runDiscovery(entries, session, capture, { variables, bounds });
  const completedAt = now().toISOString();

  const zeroWrites = await assertZeroWrites(SIM_URL, startedAt);
  if (!zeroWrites.ok) {
    return {
      ok: false,
      code: 'writes_detected',
      message: `READ-ONLY guarantee violated: the sim ledger recorded create/mutate entries during the walk: ${JSON.stringify(
        zeroWrites.offenders
      )}`,
    };
  }

  let envelope: unknown;
  try {
    envelope = buildDiscoveryReadinessResult({
      observations: result.observations,
      slug: input.slug,
      startedAt,
      completedAt,
      registryVersions: readRegistryVersions(registryRoot),
    });
  } catch (e) {
    return { ok: false, code: 'envelope_invalid', message: String(e instanceof Error ? e.message : e) };
  }

  const postures = postureCounts(result.observations);
  const record = deps.recordDiscovery ?? (deps.session ? undefined : recordDiscovery);
  record?.({ tenant_slug: input.slug, tenant_kind: 'sim', envelope, postures });

  return {
    ok: true,
    envelope,
    stats: result.stats,
    postures,
    variables: { resolved: Object.keys(variables).sort(), coverage: variableCoverage(entries, variables) },
    bounds,
  };
}
