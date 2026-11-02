// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-3 M2 — the `demo:e2e --config <id>` configuration registry
 * (`PLAN-E2E-AO-DEMO.md`, FD-4 Option A).
 *
 * FD-4's ruling: the full chain (Muster wizard -> Stamper remediation -> EO
 * before/after -> AO) is proven ONLY on `demo-dib-small`, because the wizard
 * answer map targets that tenant's MFA gap. The five evaluation-mode configs
 * (T1-T5, `docs/demo/EVAL-CONFIGS.md`) are selectable so a run can show a
 * different posture story, but they carry no proven remediation path — for
 * them the Stamper beat is reported `n/a`, never silently skipped. That is
 * what `fullChain` encodes, and it is the only thing it encodes.
 *
 * This module is DATA ONLY: no seeding, no spawning, no orchestration. M5
 * (`e2e-run.ts`) owns the run; it reads `expectedDiscovery.source` to know
 * which seeding path a config needs:
 *   - `calibrated`   -> `demo-dib-small` is materialized by stacksim's own
 *                       `scripts/build-demo-scenario.mjs` + `scenario <slug>`
 *                       (`needle-run.ts:105` `resetDemoDibSmallTenant`).
 *   - `eval-config`  -> the T-config is materialized from the `stacksim_seed`
 *                       block inside the referenced `scenarios/eval/*.json`
 *                       (`eval-run.ts:243` `runScenario`).
 */
import * as path from 'node:path';
import { loadEvalConfigFile } from './eval-run.js';

/** DISCOVERY-1's whole vocabulary: presence-based, so it never emits
 * `not_met` from silence (`docs/demo/EVAL-CONFIGS.md`). */
export type DiscoveryPosture = 'met' | 'unknown';

/**
 * A ground-truth posture map pinned INLINE here, because nothing else on disk
 * owns it. `source: 'calibrated'` is structural only — it says "an inline map,
 * not a file pointer" (contrast `EvalConfigDiscoveryGroundTruth`); it does NOT,
 * by itself, claim the map was measured live. `provenance` is the field that
 * discloses that, and it is LOAD-BEARING: the run leg reads it to decide whether
 * a clean gate/re-read may be STAKED on this map.
 */
export interface CalibratedDiscoveryGroundTruth {
  readonly source: 'calibrated';
  readonly postures: Readonly<Record<string, DiscoveryPosture>>;
  /**
   * How `postures` was established — the honest disclosure the old
   * `source:'calibrated' + calibratedAt` shape could not carry (a reader diffing
   * dates could not tell an authored contract from a live measurement):
   *  - `'live-adjudicated'` — produced by two identical live
   *    seed -> serve -> discovery cycles (the demo-dib-small / GP-DEMO-2
   *    attempt-3 protocol). A clean pass MAY be staked on it (clause 3 gate,
   *    clause 10 re-read report `pass`/`fail` normally).
   *  - `'authored-contract'` — derived from prior evidence (e.g.
   *    `runs/e2e/m7-run5/`) and the SPEC after-table, but NOT yet reproduced on
   *    THIS config's own seed path. The run leg REFUSES a clean clause-10 pass on
   *    it: it reports `calibrating` (recorded, never rendered clean), which only
   *    an explicit `--calibrate` run — the serial live-calibration phase — accepts.
   *    That phase must reproduce these exact per-probe values, then re-stamp the
   *    map `'live-adjudicated'` (the number is never quietly changed — SPEC §4).
   */
  readonly provenance: GroundTruthProvenance;
  /**
   * ISO date `postures` was established: the live-adjudication date when
   * `provenance` is `'live-adjudicated'`, the authoring date when
   * `'authored-contract'`. Named `establishedAt`, not `calibratedAt`, so the
   * field never claims "calibrated" for a map that was only authored.
   */
  readonly establishedAt: string;
}

/** Whether an inline posture map was measured live or authored as a contract
 * pending live calibration. See `CalibratedDiscoveryGroundTruth.provenance`. */
export type GroundTruthProvenance = 'live-adjudicated' | 'authored-contract';

/** Ground truth that already lives in a `scenarios/eval/*.json` file. Held as
 * a POINTER, never a copy: T1-T5's maps have been corrected after live
 * adjudication before (`AC.L2-3.1.20` and `AC.L2-3.1.18` were dropped from the
 * probe set), and a second inline copy would silently diverge on the next
 * correction. */
export interface EvalConfigDiscoveryGroundTruth {
  readonly source: 'eval-config';
  /** Repo-relative, POSIX separators (e.g. `scenarios/eval/t1-eval-bare.json`). */
  readonly configFile: string;
}

export type DiscoveryGroundTruth = CalibratedDiscoveryGroundTruth | EvalConfigDiscoveryGroundTruth;

export interface E2eConfigEntry {
  readonly id: string;
  /** stacksim tenant slug this config is served under. */
  readonly slug: string;
  /** true ⇒ the Stamper remediation beat has a proven path for this config. */
  readonly fullChain: boolean;
  readonly description: string;
  /** The BEFORE-truth: the pinned per-control posture the discovery gate (clause
   * 3) reads on the pristine tenant, before any remediation. */
  readonly expectedDiscovery: DiscoveryGroundTruth;
  /**
   * OPTIONAL after-truth: the per-control posture the SAME presence-based
   * discovery walk should read AFTER the Stamper leg has remediated the tenant.
   * Same shape and `met|unknown` vocabulary as `expectedDiscovery`, resolved by
   * the same machinery — a `calibrated` inline map or an `eval-config` pointer.
   *
   * Only meaningful on a `fullChain` config (a config with no proven remediation
   * path never changes posture). When present, the run re-runs discovery after
   * remediation and judges it as predicate clause 10 (post-remediation Muster
   * re-read). When ABSENT, clause 10 reports `n/a` — never a fabricated pass.
   *
   * Left undefined on every entry in THIS scaffold: a real after-truth for
   * demo-dib-small requires live calibration (two identical post-remediation
   * seed->serve->discovery cycles), which is a separate serial phase. The
   * Integrate phase supplies the values and the new entries below.
   */
  readonly afterTruth?: DiscoveryGroundTruth;
  /** AO command id executed by Beat 5 (FD-3: A-18, Tier 2, zero parameters). */
  readonly aoCommand: string;
}

/**
 * `demo-dib-small`'s discovery ground truth — CALIBRATED LIVE, GP-DEMO-3 M2,
 * 2026-08-29, and not adjusted toward the demo narrative.
 *
 * Protocol (the GP-DEMO-2 attempt-3 live-adjudication pattern): two full
 * seed -> serve -> `mu discovery --sim --slug demo-dib-small --out` cycles,
 * `STAMPER_REGISTRY_ROOT` = `ces-stamper/src/registry`, each Ajv-validated
 * against `ces-muster/public/schemas/readiness-result.schema.json`. Both runs
 * produced 329 observations over 111 controls that were IDENTICAL in order and
 * posture, `schemaValid: true`, and a stacksim ledger `type === 'mutate'` delta
 * of 0 (the read-only proof). Two consecutive identical reads = calibrated.
 *
 * Vocabulary is deliberately the T1-T5 11-probe set (`docs/demo/EVAL-CONFIGS.md`)
 * so `diffPostures` compares demo-dib-small on exactly the terms the eval gate
 * uses. Values are last-observation-wins per control, matching `diffPostures`'
 * own `new Map(observations.map(...))` semantics (`eval-run.ts:62`).
 *
 * Two reads worth knowing that are NOT gate entries:
 *  - `IA.L2-3.5.3` (the demo's headline MFA gap) reads **met**, because
 *    demo-dib-small's MFA CA policy exists but is report-only and DISCOVERY-1
 *    is presence-blind (`REQ-MUSTER-DISCOVERY-STATE-BLINDNESS`). Recorded, not
 *    corrected — it is the layer telling the truth about its own depth.
 *  - `AC.L2-3.1.20` emits no observation at all, exactly as T1-T5 found
 *    (`REQ-STACKSIM-GRAPH-CMDLET-IN-EXO-MODULE`); `AC.L1-3.1.20` is the probe.
 */
export const DEMO_DIB_SMALL_EXPECTED_DISCOVERY: Readonly<Record<string, DiscoveryPosture>> = {
  // P1 session-timeout CA — CA policies exist but are not CMMC-named
  'AC.L2-3.1.11': 'unknown',
  // P2 block-untrusted CA (two control ids, one probe)
  'AC.L2-3.1.14': 'unknown',
  'SC.L2-3.13.7': 'unknown',
  // P3 admin-MFA CA
  'AC.L2-3.1.15': 'unknown',
  // P5 remote-maintenance CA
  'MA.L2-3.7.5': 'unknown',
  // P6 disabled account present
  'PS.L2-3.9.2': 'met',
  // P7 users exist
  'IA.L2-3.5.5': 'met',
  'IA.L2-3.5.6': 'met',
  // P9 cross-tenant policy
  'AC.L1-3.1.20': 'met',
  // N1/N2 negative controls — unmatchable, always unknown
  'AC.L2-3.1.12': 'unknown',
  'IA.L2-3.5.4': 'unknown',
};

/** Default `--config` when the flag is absent (FD-4: the full chain). */
export const E2E_DEFAULT_CONFIG_ID = 'demo-dib-small';

export const E2E_CONFIGS: readonly E2eConfigEntry[] = [
  {
    id: 'demo-dib-small',
    slug: 'demo-dib-small',
    fullChain: true,
    description:
      'FD-4 default — Ridgeline Fabrication, the proven full chain: discovery gate -> Muster wizard -> Stamper IA.L2-3.5.3 remediation -> EO before/after -> AO A-18',
    expectedDiscovery: {
      source: 'calibrated',
      postures: DEMO_DIB_SMALL_EXPECTED_DISCOVERY,
      provenance: 'live-adjudicated',
      establishedAt: '2026-08-29',
    },
    aoCommand: 'A-18',
  },
  {
    id: 'eval-bare',
    slug: 'eval-bare',
    fullChain: false,
    description: 'T1 — brand-new tenant, nothing configured; the honest zero',
    expectedDiscovery: { source: 'eval-config', configFile: 'scenarios/eval/t1-eval-bare.json' },
    aoCommand: 'A-18',
  },
  {
    id: 'eval-identity-first',
    slug: 'eval-identity-first',
    fullChain: false,
    description: 'T2 — identity CA work done, nothing else; mixed read, no halo',
    expectedDiscovery: { source: 'eval-config', configFile: 'scenarios/eval/t2-eval-identity-first.json' },
    aoCommand: 'A-18',
  },
  {
    id: 'eval-half-configured',
    slug: 'eval-half-configured',
    fullChain: false,
    description: 'T3 — 18 months in, undocumented; the realistic met/unknown interleave',
    expectedDiscovery: { source: 'eval-config', configFile: 'scenarios/eval/t3-eval-half-configured.json' },
    aoCommand: 'A-18',
  },
  {
    id: 'eval-mostly-hardened',
    slug: 'eval-mostly-hardened',
    fullChain: false,
    description: 'T4 — diligent shop, few real gaps; near-perfect reads near-perfect',
    expectedDiscovery: { source: 'eval-config', configFile: 'scenarios/eval/t4-eval-mostly-hardened.json' },
    aoCommand: 'A-18',
  },
  {
    id: 'eval-decoys',
    slug: 'eval-decoys',
    fullChain: false,
    description: 'T5 — the trap: policies exist but are decoy-named; presence of the WRONG objects earns no credit',
    expectedDiscovery: { source: 'eval-config', configFile: 'scenarios/eval/t5-eval-decoys.json' },
    aoCommand: 'A-18',
  },
  // ------------------------------------------------------------------ //
  // GP-DEMO-3 INTEGRATE-PHASE — the 3 full-chain simsstack configs        //
  // (docs/demo/SIMSTACK-CONFIGS-SPEC.md §2, LOCKED).                       //
  // ------------------------------------------------------------------ //
  // Each is a REAL full chain (`fullChain: true`): its BEFORE-truth stays a
  // POINTER at the authored `scenarios/eval/*.json` (single source of truth,
  // same as T1-T5), and its AFTER-truth ships as a `calibrated` inline map —
  // the ONLY valid shape, because an `eval-config` after-truth pointer would
  // silently resolve to that file's `expected_discovery` = the BEFORE map and
  // judge clause 10 against the wrong posture (SPEC §4, the trap).
  //
  // Each `afterTruth` below SHIPPED as `provenance: 'authored-contract'` (the DATA,
  // not just this comment, discloses it) — the SPEC §2 AFTER-table CONTRACT derived
  // from `runs/e2e/m7-run5/` GUI-leg evidence, NOT yet reproduced on each config's
  // own seed path. The serial GP-DEMO-3 `--calibrate` live phase re-stamps a map
  // `'live-adjudicated'` from ITS OWN calibrate run once that run's recorded
  // post-remediation re-read is confirmed. LIVE CORRECTION (fresh-gap, 2026-08-30,
  // run gpd3-freshgap-cal): the ONE plan flips FOUR probes — P1 `AC.L2-3.1.11`,
  // P5 `MA.L2-3.7.5`, AND N1 `AC.L2-3.1.12` + N2 `IA.L2-3.5.4` — because the plan's
  // producer tasks create a namedLocation + auth-strength object that DISCOVERY-1's
  // paired get/set entries then read `met`. The authored "flips exactly P1/P5;
  // N1/N2 unmatchable" was a BEFORE-read fact m7-run5 never re-measured after
  // remediation (it predates clause 10). See each entry's afterTruth comment +
  // SIMSTACK-CONFIGS-SPEC.md §5. Until a config is re-stamped, code
  // (`e2e-run.ts` clause 10) refuses a clean clause-10 pass on it — it reports
  // `calibrating`; only `--calibrate` accepts the recorded re-read. See
  // `CalibratedDiscoveryGroundTruth.provenance`.
  {
    id: 'eval-decoy-maze',
    slug: 'eval-decoy-maze',
    fullChain: true,
    description:
      'SIMSTACK §2.1 — the full-chain successor to T5: five CA policies, every one decoy-named, so the most-configured tenant earns the least credit. The plan flips only P1/P5; P2/P3 stay open (pinned honest-open) — remediation != completeness.',
    expectedDiscovery: { source: 'eval-config', configFile: 'scenarios/eval/eval-decoy-maze.json' },
    // LIVE-CALIBRATED GP-DEMO-3, run gpd3-decoymaze-cal (2026-08-31): the recorded
    // post-remediation re-read reproduced this map on decoy-maze's OWN runScenario
    // seed path (read-only). Its ONLY divergence from the authored contract was the
    // SAME N1 (AC.L2-3.1.12) + N2 (IA.L2-3.5.4) unknown→met flip fresh-gap showed —
    // the plan's producer tasks create the namedLocation + auth-strength objects
    // DISCOVERY-1's paired get/set entries read (SPEC §5). Corrected from THIS
    // config's own evidence, not pre-edited from fresh-gap. P2/P3 stay unknown
    // (pinned honest-open — decoy-named, capture-cascade) and P9 stays met: both
    // CONFIRMED live (clause-10 mismatch set was exactly {N1,N2}, nothing else).
    afterTruth: {
      source: 'calibrated',
      provenance: 'live-adjudicated',
      establishedAt: '2026-08-31',
      postures: {
        'AC.L2-3.1.11': 'met', // P1 flips (plan creates CMMC-SessionTimeout)
        'AC.L2-3.1.14': 'unknown', // P2 pinned honest-open (namedLocationId cascade) — confirmed live
        'SC.L2-3.13.7': 'unknown', // P2
        'AC.L2-3.1.15': 'unknown', // P3 pinned honest-open (phishingResistantStrengthId) — confirmed live
        'MA.L2-3.7.5': 'met', // P5 flips (plan creates CMMC-RemoteMaintenance-MFA)
        'PS.L2-3.9.2': 'met', // P6 held by seed
        'IA.L2-3.5.5': 'met', // P7 held by seed
        'IA.L2-3.5.6': 'met', // P7
        'AC.L1-3.1.20': 'met', // P9 held by seed — confirmed met live
        'AC.L2-3.1.12': 'met', // N1 flips — plan producer creates a namedLocation (get/set paired); live gpd3-decoymaze-cal
        'IA.L2-3.5.4': 'met', // N2 flips — plan producer creates an auth-strength policy; live gpd3-decoymaze-cal
      },
    },
    aoCommand: 'A-18',
  },
  {
    id: 'eval-fresh-gap',
    slug: 'eval-fresh-gap',
    fullChain: true,
    description:
      'SIMSTACK §2.2 — a brand-new, competently-built CUI enclave: P2/P3 correctly CMMC-named at seed, only P1/P5 never stood up. The confounder-free control — mirror of decoy-maze (does Muster UNDER-credit?) — that ends fully green except the permanently-unmatchable N1/N2.',
    expectedDiscovery: { source: 'eval-config', configFile: 'scenarios/eval/eval-fresh-gap.json' },
    // LIVE-CALIBRATED GP-DEMO-3, run gpd3-freshgap-cal (2026-08-30): the recorded
    // post-remediation Muster re-read reproduced this map on fresh-gap's OWN
    // runScenario seed path (read-only, ledgerWriteDelta 0). CORRECTION vs the
    // authored contract: N1 (AC.L2-3.1.12) + N2 (IA.L2-3.5.4) flip unknown→met, NOT
    // stay unknown. Airtight mechanism: the ONE plan's producer tasks
    // AC.L2-3.1.12.named-location + IA.L2-3.5.4.auth-strength COMPLETE and create a
    // `namedLocations` + `authenticationStrengthPolicies` object (ledger `create`,
    // gpd3-freshgap-cal/ledger-snapshot.json), and DISCOVERY-1's N1/N2 probes GET the
    // SAME registry entry id the plan SET (after-read ran_entry_ids === the producer
    // id) — a paired get/set on one entry, so the get matches what the set created.
    // ⇒ the plan flips FOUR probes (P1, P5, N1, N2), so fresh-gap ends FULLY green
    // (all 11 met). SPEC §1's "flips exactly P1/P5" / "N1/N2 unmatchable" was a
    // BEFORE-read fact (seed-created objects don't match) that m7-run5 never
    // re-measured after remediation (it predates clause 10). See SIMSTACK §5 amendment.
    afterTruth: {
      source: 'calibrated',
      provenance: 'live-adjudicated',
      establishedAt: '2026-08-30',
      postures: {
        'AC.L2-3.1.11': 'met', // P1 flips (plan creates CMMC-SessionTimeout)
        'AC.L2-3.1.14': 'met', // P2 held met (seeded, plan task fails pre-execution → untouched)
        'SC.L2-3.13.7': 'met', // P2
        'AC.L2-3.1.15': 'met', // P3 held met (seeded, untouched)
        'MA.L2-3.7.5': 'met', // P5 flips (plan creates CMMC-RemoteMaintenance-MFA)
        'PS.L2-3.9.2': 'met', // P6 held by seed
        'IA.L2-3.5.5': 'met', // P7 held by seed
        'IA.L2-3.5.6': 'met', // P7
        'AC.L1-3.1.20': 'met', // P9 held by seed
        'AC.L2-3.1.12': 'met', // N1 flips — plan producer AC.L2-3.1.12.named-location creates a namedLocation (get/set paired on one entry); live gpd3-freshgap-cal
        'IA.L2-3.5.4': 'met', // N2 flips — plan producer IA.L2-3.5.4.auth-strength creates an auth-strength policy; live gpd3-freshgap-cal
      },
    },
    aoCommand: 'A-18',
  },
  {
    id: 'eval-scope-boundary',
    slug: 'eval-scope-boundary',
    fullChain: true,
    description:
      'SIMSTACK §2.3 — the automation-reach case: two decoy-shadowed CA gaps the plan CAN fix (P1/P5) plus a governance gap it structurally CANNOT (P9, no cross-tenant policy). Teaches a permanent scope boundary (P9, architectural) apart from a transient tool bug (P2/P3, pinned).',
    expectedDiscovery: { source: 'eval-config', configFile: 'scenarios/eval/eval-scope-boundary.json' },
    afterTruth: {
      source: 'calibrated',
      provenance: 'authored-contract',
      establishedAt: '2026-08-30',
      postures: {
        'AC.L2-3.1.11': 'met', // P1 flips
        'AC.L2-3.1.14': 'unknown', // P2 pinned honest-open (transient)
        'SC.L2-3.13.7': 'unknown', // P2
        'AC.L2-3.1.15': 'unknown', // P3 pinned honest-open (transient)
        'MA.L2-3.7.5': 'met', // P5 flips
        'PS.L2-3.9.2': 'met', // P6 held by seed
        'IA.L2-3.5.5': 'met', // P7 held by seed
        'IA.L2-3.5.6': 'met', // P7
        'AC.L1-3.1.20': 'unknown', // P9 STAYS unknown — architectural (plan has no crossTenant create)
        'AC.L2-3.1.12': 'unknown', // N1 unmatchable
        'IA.L2-3.5.4': 'unknown', // N2 unmatchable
      },
    },
    aoCommand: 'A-18',
  },
];

/** Lookup without a verdict — `undefined` when the id is not registered. */
export function findE2eConfig(id: string): E2eConfigEntry | undefined {
  return E2E_CONFIGS.find((c) => c.id === id);
}

/**
 * Resolves a `--config` argument. Absent ⇒ the FD-4 default
 * (`demo-dib-small`). An UNKNOWN id throws rather than silently defaulting:
 * running the wrong tenant while the operator believes they picked another is
 * exactly the kind of quiet substitution the honesty rules forbid.
 */
export function resolveE2eConfig(id: string | undefined): E2eConfigEntry {
  if (id === undefined) return findE2eConfig(E2E_DEFAULT_CONFIG_ID)!;
  const found = findE2eConfig(id);
  if (!found) {
    throw new Error(`unknown --config '${id}'; known configs: ${E2E_CONFIGS.map((c) => c.id).join(', ')}`);
  }
  return found;
}

/**
 * Materializes any `DiscoveryGroundTruth` into the flat control->posture map
 * `diffPostures` consumes. Calibrated entries return their pinned map;
 * eval-config entries are read from the file that owns them, so the eval
 * fixtures stay the single source of truth. Shared by the before-truth
 * (`resolveExpectedDiscovery`) and the after-truth (`resolveAfterTruth`) so a
 * single resolution path serves both clause 3 and clause 10.
 */
async function resolveGroundTruth(
  gt: DiscoveryGroundTruth,
  testerRoot: string,
): Promise<Readonly<Record<string, DiscoveryPosture>>> {
  if (gt.source === 'calibrated') return gt.postures;
  const filePath = path.resolve(testerRoot, gt.configFile);
  const config = await loadEvalConfigFile(filePath);
  return config.expected_discovery;
}

/**
 * The BEFORE-truth map for the discovery gate (clause 3): the pinned posture on
 * the pristine tenant. Calibrated entries return their map; eval-config entries
 * stay a pointer, so T1-T5's fixtures remain the single source of truth.
 */
export async function resolveExpectedDiscovery(
  entry: E2eConfigEntry,
  testerRoot: string,
): Promise<Readonly<Record<string, DiscoveryPosture>>> {
  return resolveGroundTruth(entry.expectedDiscovery, testerRoot);
}

/**
 * The AFTER-truth map for the post-remediation re-read (clause 10), or
 * `undefined` when the entry carries none. `undefined` is the honest signal that
 * clause 10 must report `n/a` rather than fabricate a pass — the run must never
 * substitute the before-truth here. An eval-config-sourced after-truth reads the
 * referenced file's `expected_discovery` block, exactly like the before-truth.
 */
export async function resolveAfterTruth(
  entry: E2eConfigEntry,
  testerRoot: string,
): Promise<Readonly<Record<string, DiscoveryPosture>> | undefined> {
  if (!entry.afterTruth) return undefined;
  return resolveGroundTruth(entry.afterTruth, testerRoot);
}

/**
 * The provenance of a config's after-truth, or `undefined` when it carries none
 * (or when the after-truth is an `eval-config` pointer, which owns no provenance
 * of its own). The run leg reads this to decide clause 10's verdict: an
 * `'authored-contract'` after-truth cannot stake a clean pass — clause 10 reports
 * `calibrating` — while a `'live-adjudicated'` one is judged `pass`/`fail`.
 */
export function afterTruthProvenance(entry: E2eConfigEntry): GroundTruthProvenance | undefined {
  if (entry.afterTruth?.source === 'calibrated') return entry.afterTruth.provenance;
  return undefined;
}
