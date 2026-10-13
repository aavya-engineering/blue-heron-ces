// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-3 M2 — the `demo:e2e --config <id>` registry (FD-4 Option A).
// Registry validity + fullChain flags + ground-truth resolution. The
// demo-dib-small map's CORRECTNESS was established by live adjudication (two
// identical seed->serve->discovery cycles, 2026-08-29); this file guards the
// registry's shape and its no-drift contract with scenarios/eval/*.json.
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import {
  E2E_CONFIGS,
  E2E_DEFAULT_CONFIG_ID,
  DEMO_DIB_SMALL_EXPECTED_DISCOVERY,
  findE2eConfig,
  resolveE2eConfig,
  resolveExpectedDiscovery,
  resolveAfterTruth,
  afterTruthProvenance,
  type E2eConfigEntry,
} from '../src/demo/e2e-configs.js';
import { loadEvalConfigFile } from '../src/demo/eval-run.js';
import { AO_DEMO_COMMAND_ID } from '../src/demo/ao-leg.js';

const TESTER_ROOT = path.resolve('.');

describe('E2E_CONFIGS registry', () => {
  it('holds the FD-4 set + the 3 GP-DEMO-3 full-chain configs, ids unique', () => {
    expect(E2E_CONFIGS.map((c) => c.id)).toEqual([
      'demo-dib-small',
      'eval-bare',
      'eval-identity-first',
      'eval-half-configured',
      'eval-mostly-hardened',
      'eval-decoys',
      // GP-DEMO-3 (SIMSTACK-CONFIGS-SPEC §2) — appended at the insertion point.
      'eval-decoy-maze',
      'eval-fresh-gap',
      'eval-scope-boundary',
    ]);
    expect(new Set(E2E_CONFIGS.map((c) => c.id)).size).toBe(E2E_CONFIGS.length);
    expect(new Set(E2E_CONFIGS.map((c) => c.slug)).size).toBe(E2E_CONFIGS.length);
  });

  it('every entry carries a slug, a description and the FD-3 AO command', () => {
    for (const c of E2E_CONFIGS) {
      expect(c.slug, c.id).toBeTruthy();
      expect(c.description.length, c.id).toBeGreaterThan(0);
      // Literal, not imported into the registry module (keeping better-sqlite3
      // out of its graph) — pinned equal here instead.
      expect(c.aoCommand, c.id).toBe(AO_DEMO_COMMAND_ID);
    }
  });

  it('fullChain is true for demo-dib-small + the 3 GP-DEMO-3 configs (FD-4 extended: the proven remediation paths)', () => {
    expect(E2E_CONFIGS.filter((c) => c.fullChain).map((c) => c.id)).toEqual([
      'demo-dib-small',
      'eval-decoy-maze',
      'eval-fresh-gap',
      'eval-scope-boundary',
    ]);
  });

  it('demo-dib-small is the default + calibrated; T1-T5 and the 3 new configs point at their eval files', () => {
    expect(E2E_DEFAULT_CONFIG_ID).toBe('demo-dib-small');
    const dib = findE2eConfig('demo-dib-small')!;
    expect(dib.expectedDiscovery.source).toBe('calibrated');
    for (const c of E2E_CONFIGS.filter((x) => x.id !== 'demo-dib-small')) {
      expect(c.expectedDiscovery.source, c.id).toBe('eval-config');
      if (c.expectedDiscovery.source === 'eval-config') {
        // T1-T5 are `t*-*.json`; the 3 GP-DEMO-3 configs are `eval-*.json`.
        expect(c.expectedDiscovery.configFile, c.id).toMatch(/^scenarios\/eval\/(t[1-5]-|eval-).+\.json$/);
      }
    }
  });
});

describe('resolveE2eConfig', () => {
  it('defaults to demo-dib-small when --config is absent', () => {
    expect(resolveE2eConfig(undefined).id).toBe('demo-dib-small');
  });

  it('returns the named entry', () => {
    expect(resolveE2eConfig('eval-decoys').id).toBe('eval-decoys');
  });

  it('THROWS on an unknown id rather than silently defaulting to another tenant', () => {
    expect(() => resolveE2eConfig('eval-nope')).toThrow(/unknown --config 'eval-nope'/);
    expect(findE2eConfig('eval-nope')).toBeUndefined();
  });
});

describe('demo-dib-small calibrated ground truth', () => {
  it('uses the T1-T5 11-probe vocabulary, met|unknown only', () => {
    const keys = Object.keys(DEMO_DIB_SMALL_EXPECTED_DISCOVERY);
    expect(keys).toHaveLength(11);
    for (const [control, posture] of Object.entries(DEMO_DIB_SMALL_EXPECTED_DISCOVERY)) {
      expect(['met', 'unknown'], control).toContain(posture);
    }
  });

  it('carries the two negative controls (N1/N2) as unknown — the calibration sanity check', () => {
    expect(DEMO_DIB_SMALL_EXPECTED_DISCOVERY['AC.L2-3.1.12']).toBe('unknown');
    expect(DEMO_DIB_SMALL_EXPECTED_DISCOVERY['IA.L2-3.5.4']).toBe('unknown');
  });

  it('omits AC.L2-3.1.20 (emits no observation) and keeps AC.L1-3.1.20 — same as T1-T5', () => {
    expect(DEMO_DIB_SMALL_EXPECTED_DISCOVERY['AC.L2-3.1.20']).toBeUndefined();
    expect(DEMO_DIB_SMALL_EXPECTED_DISCOVERY['AC.L1-3.1.20']).toBe('met');
  });

  it('records the live read: CA-name probes unknown (policies exist, not CMMC-named), user probes met', () => {
    for (const control of ['AC.L2-3.1.11', 'AC.L2-3.1.14', 'SC.L2-3.13.7', 'AC.L2-3.1.15', 'MA.L2-3.7.5']) {
      expect(DEMO_DIB_SMALL_EXPECTED_DISCOVERY[control], control).toBe('unknown');
    }
    for (const control of ['PS.L2-3.9.2', 'IA.L2-3.5.5', 'IA.L2-3.5.6']) {
      expect(DEMO_DIB_SMALL_EXPECTED_DISCOVERY[control], control).toBe('met');
    }
  });

  it('does NOT claim IA.L2-3.5.3 — the headline MFA control is not a discovery-gate entry', () => {
    // It reads `met` live (report-only CA, presence-blind DISCOVERY-1). Kept out
    // of the gate's 11-probe vocabulary; documented in e2e-configs.ts.
    expect(DEMO_DIB_SMALL_EXPECTED_DISCOVERY['IA.L2-3.5.3']).toBeUndefined();
  });
});

describe('resolveExpectedDiscovery', () => {
  it('returns the pinned map for the calibrated entry', async () => {
    const map = await resolveExpectedDiscovery(resolveE2eConfig('demo-dib-small'), TESTER_ROOT);
    expect(map).toEqual(DEMO_DIB_SMALL_EXPECTED_DISCOVERY);
  });

  it('reads T1-T5 from their eval files, so the fixtures stay the single source of truth', async () => {
    for (const entry of E2E_CONFIGS.filter((c) => c.expectedDiscovery.source === 'eval-config')) {
      const viaRegistry = await resolveExpectedDiscovery(entry, TESTER_ROOT);
      const file = (entry.expectedDiscovery as { configFile: string }).configFile;
      const direct = await loadEvalConfigFile(path.resolve(TESTER_ROOT, file));
      expect(viaRegistry, entry.id).toEqual(direct.expected_discovery);
      expect(direct.config_id, entry.id).toBe(entry.id);
    }
  });
});

// The 3 GP-DEMO-3 full-chain configs carry an after-truth; the original 6 must not.
const AFTER_TRUTH_IDS = ['eval-decoy-maze', 'eval-fresh-gap', 'eval-scope-boundary'];

describe('afterTruth (clause 10 — post-remediation Muster re-read)', () => {
  it('exactly the 3 GP-DEMO-3 full-chain configs carry an afterTruth; the original 6 do not', () => {
    // A non-fullChain / non-remediating config carrying an after-truth would be
    // inert (clause 10 n/a), so only the 3 new proven chains get one; the FD-4
    // set (demo-dib-small awaiting its own live calibration + T1-T5 eval-only)
    // stays after-truth-less so clause 10 reports n/a, never a fabricated pass.
    const carriers = E2E_CONFIGS.filter((c) => c.afterTruth !== undefined).map((c) => c.id);
    expect(carriers).toEqual(AFTER_TRUTH_IDS);
    for (const c of E2E_CONFIGS.filter((x) => !AFTER_TRUTH_IDS.includes(x.id))) {
      expect(c.afterTruth, c.id).toBeUndefined();
    }
  });

  it('every after-truth is a CALIBRATED inline map (never an eval-config pointer — SPEC §4 trap)', () => {
    // An eval-config after-truth would resolve to that file\'s expected_discovery
    // = the BEFORE map, silently judging clause 10 against the wrong posture.
    for (const id of AFTER_TRUTH_IDS) {
      const at = findE2eConfig(id)!.afterTruth!;
      expect(at.source, id).toBe('calibrated');
      if (at.source === 'calibrated') expect(at.establishedAt, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('each after-truth discloses its provenance IN THE DATA (authored-contract until its own live phase re-stamps it)', () => {
    // These maps SHIPPED as the SPEC §2 CONTRACT derived from m7-run5, NOT
    // live-measured on each config's own seed path — `provenance` makes that
    // machine-readable, and `afterTruthProvenance` is what the run leg reads to
    // report clause 10 `calibrating` instead of a fabricated pass. The serial
    // GP-DEMO-3 `--calibrate` live phase re-stamps a config `'live-adjudicated'`
    // from ITS OWN calibrate run once the recorded re-read is confirmed. This map
    // tracks that per-config state (flip an entry when its calibrate run lands):
    //   eval-fresh-gap    — live-adjudicated 2026-08-30, run gpd3-freshgap-cal.
    //   eval-decoy-maze   — live-adjudicated 2026-08-31, run gpd3-decoymaze-cal.
    const EXPECTED_PROVENANCE: Record<string, 'authored-contract' | 'live-adjudicated'> = {
      'eval-decoy-maze': 'live-adjudicated',
      'eval-fresh-gap': 'live-adjudicated',
      'eval-scope-boundary': 'authored-contract',
    };
    for (const id of AFTER_TRUTH_IDS) {
      const at = findE2eConfig(id)!.afterTruth!;
      if (at.source === 'calibrated') expect(at.provenance, id).toBe(EXPECTED_PROVENANCE[id]);
      expect(afterTruthProvenance(findE2eConfig(id)!), id).toBe(EXPECTED_PROVENANCE[id]);
    }
  });

  it('demo-dib-small before-truth is provenance=live-adjudicated (the genuine two-cycle calibration)', () => {
    const dib = findE2eConfig('demo-dib-small')!.expectedDiscovery;
    expect(dib.source).toBe('calibrated');
    if (dib.source === 'calibrated') {
      expect(dib.provenance).toBe('live-adjudicated');
      expect(dib.establishedAt).toBe('2026-08-29');
    }
    // demo-dib-small carries no after-truth, so afterTruthProvenance is undefined.
    expect(afterTruthProvenance(findE2eConfig('demo-dib-small')!)).toBeUndefined();
  });

  it('resolveAfterTruth returns undefined for the after-truth-less entries — the honest n/a signal', async () => {
    for (const c of E2E_CONFIGS.filter((x) => !AFTER_TRUTH_IDS.includes(x.id))) {
      expect(await resolveAfterTruth(c, TESTER_ROOT), c.id).toBeUndefined();
    }
  });

  it('resolves a CALIBRATED inline after-truth to its pinned map', async () => {
    const entry: E2eConfigEntry = {
      id: 'synthetic-calibrated',
      slug: 'synthetic-calibrated',
      fullChain: true,
      description: 'synthetic — calibrated after-truth',
      expectedDiscovery: { source: 'calibrated', postures: DEMO_DIB_SMALL_EXPECTED_DISCOVERY, provenance: 'live-adjudicated', establishedAt: '2026-08-30' },
      afterTruth: { source: 'calibrated', postures: { 'IA.L2-3.5.3': 'met', 'AC.L1-3.1.20': 'met' }, provenance: 'live-adjudicated', establishedAt: '2026-08-30' },
      aoCommand: 'A-18',
    };
    expect(await resolveAfterTruth(entry, TESTER_ROOT)).toEqual({ 'IA.L2-3.5.3': 'met', 'AC.L1-3.1.20': 'met' });
  });

  it('resolves an EVAL-CONFIG after-truth by reading that file\'s expected_discovery block', async () => {
    // Same resolution path as the before-truth: an eval-config-sourced after-truth
    // reads the referenced file's expected_discovery, so the fixture stays the
    // single source of truth. (T3 stands in as an existing, valid target.)
    const entry: E2eConfigEntry = {
      id: 'synthetic-eval-after',
      slug: 'synthetic-eval-after',
      fullChain: true,
      description: 'synthetic — eval-config after-truth pointer',
      expectedDiscovery: { source: 'calibrated', postures: DEMO_DIB_SMALL_EXPECTED_DISCOVERY, provenance: 'live-adjudicated', establishedAt: '2026-08-30' },
      afterTruth: { source: 'eval-config', configFile: 'scenarios/eval/t3-eval-half-configured.json' },
      aoCommand: 'A-18',
    };
    const direct = await loadEvalConfigFile(path.resolve(TESTER_ROOT, 'scenarios/eval/t3-eval-half-configured.json'));
    expect(await resolveAfterTruth(entry, TESTER_ROOT)).toEqual(direct.expected_discovery);
  });
});

// --------------------------------------------------------------------------- //
// GP-DEMO-3 — the 3 full-chain simsstack configs (SIMSTACK-CONFIGS-SPEC §2).   //
// Loads + validates each via the REAL loader (loadEvalConfigFile), round-trips //
// the before-truth pointer, and pins the after-truth CONTRACT the serial live- //
// calibration phase must reproduce (SPEC §4). Ground-truth CORRECTNESS is the  //
// live gate's job; this guards the wiring and the authored contract.           //
// --------------------------------------------------------------------------- //
describe('GP-DEMO-3 full-chain configs (SIMSTACK §2)', () => {
  const P1 = 'AC.L2-3.1.11';
  const P5 = 'MA.L2-3.7.5';
  const P9 = 'AC.L1-3.1.20';
  const N1 = 'AC.L2-3.1.12';
  const N2 = 'IA.L2-3.5.4';
  const P2P3 = ['AC.L2-3.1.14', 'SC.L2-3.13.7', 'AC.L2-3.1.15'];

  const casByEntry = async (id: string) => {
    const entry = findE2eConfig(id)!;
    const file = (entry.expectedDiscovery as { configFile: string }).configFile;
    const config = await loadEvalConfigFile(path.resolve(TESTER_ROOT, file));
    const caNames = (config.stacksim_seed.steps ?? [])
      .filter((s) => s.uri.includes('/conditionalAccess/policies/'))
      .map((s) => (s.body as { displayName?: string }).displayName as string);
    return { entry, config, caNames };
  };

  for (const id of ['eval-decoy-maze', 'eval-fresh-gap', 'eval-scope-boundary']) {
    describe(id, () => {
      it('loads via the real loader; config_id === registry id; before-truth round-trips', async () => {
        const { entry, config } = await casByEntry(id);
        expect(config.config_id).toBe(id);
        expect(entry.fullChain).toBe(true);
        const viaRegistry = await resolveExpectedDiscovery(entry, TESTER_ROOT);
        expect(viaRegistry).toEqual(config.expected_discovery);
      });

      it('after-truth is present, 11-key, same probe set as before, met|unknown only', async () => {
        const after = (await resolveAfterTruth(findE2eConfig(id)!, TESTER_ROOT))!;
        const { config } = await casByEntry(id);
        expect(after, id).toBeDefined();
        expect(Object.keys(after).sort()).toEqual(Object.keys(config.expected_discovery).sort());
        expect(Object.keys(after)).toHaveLength(11);
        for (const [control, posture] of Object.entries(after)) {
          expect(['met', 'unknown'], `${id}/${control}`).toContain(posture);
        }
      });

      it('the plan flips P1 + P5 unknown→met (both remediable CA gaps close; live phase adds N1/N2 — SIMSTACK §5)', async () => {
        const before = (await casByEntry(id)).config.expected_discovery;
        const after = (await resolveAfterTruth(findE2eConfig(id)!, TESTER_ROOT))!;
        expect(before[P1], `${id} before P1`).toBe('unknown');
        expect(before[P5], `${id} before P5`).toBe('unknown');
        expect(after[P1], `${id} after P1`).toBe('met');
        expect(after[P5], `${id} after P5`).toBe('met');
      });

      it('never pre-seeds a plan-created name (no CMMC-SessionTimeout / CMMC-RemoteMaintenance*)', async () => {
        const { caNames } = await casByEntry(id);
        for (const n of caNames) {
          expect(n, id).not.toBe('CMMC-SessionTimeout');
          expect(n, id).not.toMatch(/^CMMC-RemoteMaintenance/);
        }
      });
    });
  }

  it('decoy-maze: 5 decoy CA names, none CMMC-prefixed; P2/P3 stay unknown after; P9 met', async () => {
    const { caNames } = await casByEntry('eval-decoy-maze');
    expect(caNames).toHaveLength(5);
    for (const n of caNames) expect(n).not.toMatch(/^CMMC-/);
    const after = (await resolveAfterTruth(findE2eConfig('eval-decoy-maze')!, TESTER_ROOT))!;
    for (const c of P2P3) expect(after[c], c).toBe('unknown');
    expect(after[P9]).toBe('met');
  });

  it('fresh-gap: exactly its 2 CMMC-named policies; ends FULLY green after (live gpd3-freshgap-cal — N1/N2 flip too)', async () => {
    const { caNames } = await casByEntry('eval-fresh-gap');
    expect(caNames.filter((n) => n.startsWith('CMMC-'))).toEqual([
      'CMMC-BlockUntrustedLocations',
      'CMMC-AdminMFA-PhishingResistant',
    ]);
    // Live-calibration CORRECTED the authored contract: N1 (AC.L2-3.1.12) + N2
    // (IA.L2-3.5.4) flip unknown→met because the plan's producer tasks create the
    // namedLocation + auth-strength objects DISCOVERY-1's paired get/set entries
    // read (run gpd3-freshgap-cal; SIMSTACK §5). So the fully-remediated fresh-gap
    // has NO unknowns — every one of the 11 gated probes reads met.
    const after = (await resolveAfterTruth(findE2eConfig('eval-fresh-gap')!, TESTER_ROOT))!;
    const unknowns = Object.entries(after).filter(([, p]) => p === 'unknown').map(([c]) => c);
    expect(unknowns).toEqual([]);
    for (const p of Object.values(after)) expect(p).toBe('met');
  });

  it('scope-boundary: 2 decoys none CMMC-prefixed; P9 STAYS unknown after (architectural); P2/P3 unknown', async () => {
    const { caNames } = await casByEntry('eval-scope-boundary');
    expect(caNames).toHaveLength(2);
    for (const n of caNames) expect(n).not.toMatch(/^CMMC-/);
    const after = (await resolveAfterTruth(findE2eConfig('eval-scope-boundary')!, TESTER_ROOT))!;
    expect(after[P9]).toBe('unknown');
    for (const c of P2P3) expect(after[c], c).toBe('unknown');
  });

  it('the 3 after-truths are pairwise distinct (SPEC §3 distinctness)', async () => {
    const maps = await Promise.all(
      ['eval-decoy-maze', 'eval-fresh-gap', 'eval-scope-boundary'].map((id) =>
        resolveAfterTruth(findE2eConfig(id)!, TESTER_ROOT),
      ),
    );
    const serialized = maps.map((m) => JSON.stringify(m));
    expect(new Set(serialized).size).toBe(3);
  });
});
