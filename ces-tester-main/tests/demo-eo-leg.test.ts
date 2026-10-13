// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-1 Beat 3 (EO leg) — pure helpers. The live runEoLeg self-gates and is
// exercised by the live rehearsal, not here.
import { describe, it, expect } from 'vitest';
import { buildEoChildEnv, parseSseData, summarizeEoAssess, mapControlDetail } from '../src/demo/eo-leg.js';

describe('buildEoChildEnv (P1-9 env scrub)', () => {
  const cfg = {
    simRoot: 'C:/ces/tenant-stacksim',
    psModules: 'C:/ces/tenant-stacksim/psmodules',
    psHomeModules: 'C:/PS/Modules',
    tenantRoot: 'C:/tmp/tenants',
    stamperRegistry: 'C:/ces/ces-stamper/reg.json',
    storageRoot: 'C:/tmp/store',
    slug: 'demo-dib-small',
    simUrl: 'http://127.0.0.1:4390',
    port: 45123,
  };

  it('strips EVERY casing of PSModulePath and Path from the inherited env', () => {
    const base = { PSModulePath: 'C:/real/graph', PATH: 'C:/a', Path: 'C:/b', psmodulepath: 'C:/c', KEEP: 'yes' };
    const env = buildEoChildEnv(base, cfg);
    // no inherited real-graph module path survives under any casing
    const keys = Object.keys(env);
    expect(keys.filter((k) => k.toLowerCase() === 'psmodulepath')).toEqual(['PSModulePath']);
    expect(env.PSModulePath).toContain('tenant-stacksim/psmodules');
    expect(env.PSModulePath).not.toContain('real/graph');
    expect(env.KEEP).toBe('yes');
  });

  it('sets the sim shims + EO config env', () => {
    const env = buildEoChildEnv({ Path: 'C:/prior' }, cfg);
    expect(env.PSModulePath).toBe('C:/ces/tenant-stacksim/psmodules;C:/PS/Modules');
    expect(env.Path).toContain('azshim'); // sim az shim prepended (separator is OS-dependent)
    expect(env.Path).toContain('C:/prior'); // prior Path preserved after it
    expect(env.STACKSIM_SERVER_URL).toBe('http://127.0.0.1:4390');
    expect(env.CES_TENANT_ROOT).toBe('C:/tmp/tenants');
    expect(env.REGISTRY_PATH).toBe('C:/ces/ces-stamper/reg.json');
    expect(env.STORAGE_ROOT).toBe('C:/tmp/store');
    expect(env.TENANT_SLUG).toBe('demo-dib-small');
    expect(env.EO_PORT).toBe('45123');
  });

  it('falls back to just the sim psmodules when PSHOME modules are unknown', () => {
    const env = buildEoChildEnv({}, { ...cfg, psHomeModules: '' });
    expect(env.PSModulePath).toBe('C:/ces/tenant-stacksim/psmodules');
  });
});

describe('parseSseData', () => {
  it('parses a data frame', () => {
    expect(parseSseData('event: x\ndata: {"type":"done","ok":true}')).toEqual({ type: 'done', ok: true });
  });
  it('returns undefined for a keepalive / non-data frame', () => {
    expect(parseSseData(': keepalive')).toBeUndefined();
    expect(parseSseData('data: not-json')).toBeUndefined();
  });
});

describe('summarizeEoAssess', () => {
  it('extracts the last assess_summary and maps wire fields', () => {
    const s = summarizeEoAssess([
      { type: 'assess_progress' },
      { type: 'assess_summary', snapshotId: 'snap-1', sprs_score: 72, controls_met: 37, controls_not_met: 36, controls_partial: 2, controls_not_assessed: 35, liveAssessmentCount: 106 },
    ]);
    expect(s.snapshotId).toBe('snap-1');
    expect(s.sprsScore).toBe(72);
    expect(s.controlsMet).toBe(37);
    expect(s.liveAssessmentCount).toBe(106);
  });

  it('returns {} when no summary event is present', () => {
    expect(summarizeEoAssess([{ type: 'assess_progress' }])).toEqual({});
  });
});

describe('mapControlDetail (GP-DEMO-1 iter5 per-control fetch)', () => {
  it('maps a real ControlAssessment JSON body', () => {
    const d = mapControlDetail({ control_id: 'IA.L2-3.5.3', status: 'met', nist_ref: '3.5.3', classification: 'automated' });
    expect(d).toEqual({ controlId: 'IA.L2-3.5.3', status: 'met', nistRef: '3.5.3' });
  });

  it('accepts all four ces-eo status values', () => {
    for (const status of ['met', 'not_met', 'partial', 'not_assessed'] as const) {
      expect(mapControlDetail({ control_id: 'X', status })?.status).toBe(status);
    }
  });

  it('returns undefined for a malformed or unrecognized shape', () => {
    expect(mapControlDetail(null)).toBeUndefined();
    expect(mapControlDetail({})).toBeUndefined();
    expect(mapControlDetail({ control_id: 'X', status: 'bogus' })).toBeUndefined();
    expect(mapControlDetail({ status: 'met' })).toBeUndefined();
  });
});
