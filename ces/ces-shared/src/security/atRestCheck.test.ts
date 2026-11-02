// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import {
  checkAtRest,
  enforceAtRestAtStartup,
  atRestHealth,
  dataVolumes,
  parseOverrideRecord,
  formatOverrideRecord,
  AtRestRefusedError,
  AT_REST_OVERRIDE_KIND,
  type AtRestProbes,
} from './atRestCheck.js';

const NOW = () => new Date('2026-10-31T12:00:00.000Z');
const DATA = ['D:\\ces\\data\\ces.db', 'D:\\ces\\evidence', 'E:\\evidence-archive'];

/** Probes with no Azure VM and no BitLocker unless overridden. */
function probes(over: Partial<AtRestProbes> = {}): AtRestProbes {
  return {
    readImdsSecurityProfile: async () => null,
    readBitLocker: async (volume) => ({ volume, protected: false, state: 'off' }),
    readOverrideFile: async () => null,
    ...over,
  };
}

const goodOverride = () => JSON.stringify({
  kind: AT_REST_OVERRIDE_KIND,
  acknowledged_by: 'operator-1',
  acknowledged_at: '2026-10-30T09:00:00.000Z',
  reason: 'Lab host without BitLocker; no CUI on this machine.',
  scope: 'lab-host-01',
});

describe('atRestCheck (FIN-41, SP-12)', () => {
  it('maps data paths to their volumes, de-duplicated', () => {
    expect(dataVolumes(DATA).map(v => v.toUpperCase())).toEqual(['D:\\', 'E:\\']);
    expect(dataVolumes(['', '  '])).toEqual([]);
  });

  it('encryption at host from IMDS covers every volume: ok, no BitLocker read', async () => {
    const seen: string[] = [];
    const r = await checkAtRest({
      dataPaths: DATA, releaseBuild: true, now: NOW,
      probes: probes({
        readImdsSecurityProfile: async () => ({ encryptionAtHost: 'true', securityType: 'TrustedLaunch', secureBootEnabled: 'true', virtualTpmEnabled: 'true' }),
        readBitLocker: async (v) => { seen.push(v); return null; },
      }),
    });
    expect(r).toMatchObject({ verdict: 'ok', encrypted: true, method: 'encryption_at_host', evidence_for_scoring: false });
    expect(r.imds).toEqual({ answered: true, encryption_at_host: true, security_type: 'TrustedLaunch' });
    expect(seen).toEqual([]);
  });

  it('BitLocker on every data volume: ok', async () => {
    const r = await checkAtRest({ dataPaths: DATA, releaseBuild: true, now: NOW, probes: probes({ readBitLocker: async (volume) => ({ volume, protected: true, state: 'on' }) }) });
    expect(r).toMatchObject({ verdict: 'ok', encrypted: true, method: 'bitlocker' });
    expect(r.volumes).toHaveLength(2);
  });

  it('an IMDS answer without the encryptionAtHost field is "not shown", never "on" (SP-0(c) unconfirmed)', async () => {
    const r = await checkAtRest({ dataPaths: DATA, releaseBuild: true, now: NOW, probes: probes({ readImdsSecurityProfile: async () => ({ securityType: 'TrustedLaunch' }) }) });
    expect(r.imds.encryption_at_host).toBeNull();
    expect(r.verdict).toBe('refuse');
  });

  it('one unprotected volume is enough to fail', async () => {
    const r = await checkAtRest({
      dataPaths: DATA, releaseBuild: true, now: NOW,
      probes: probes({ readBitLocker: async (volume) => ({ volume, protected: /^D/i.test(volume), state: /^D/i.test(volume) ? 'on' : 'encrypting' }) }),
    });
    expect(r.encrypted).toBe(false);
    expect(r.verdict).toBe('refuse');
    expect(r.reason).toMatch(/E:\\/);
  });

  it('release build, no protection, no override: refuse; enforce throws', async () => {
    const input = { dataPaths: DATA, releaseBuild: true, now: NOW, probes: probes() };
    expect((await checkAtRest(input)).verdict).toBe('refuse');
    const lines: string[] = [];
    await expect(enforceAtRestAtStartup(input, (l) => lines.push(l))).rejects.toBeInstanceOf(AtRestRefusedError);
    expect(lines[0]).toMatch(/^\[at-rest\] refuse: /);
  });

  it('developer build, no protection: warning only, never a refusal', async () => {
    const r = await enforceAtRestAtStartup({ dataPaths: DATA, releaseBuild: false, now: NOW, probes: probes() }, () => {});
    expect(r.verdict).toBe('warn');
  });

  it('release build reads CES_RELEASE_BUILD=1 when not passed', async () => {
    const r = await checkAtRest({ dataPaths: DATA, env: { CES_RELEASE_BUILD: '1' }, now: NOW, probes: probes() });
    expect(r.release_build).toBe(true);
    const d = await checkAtRest({ dataPaths: DATA, env: {}, now: NOW, probes: probes() });
    expect(d.release_build).toBe(false);
  });

  it('a recorded operator override (F-7) lets a release build start: ok_overridden, the record kept', async () => {
    const r = await checkAtRest({
      dataPaths: DATA, now: NOW, env: { CES_RELEASE_BUILD: '1', CES_AT_REST_OVERRIDE_FILE: 'X:\\install\\at-rest-override.json' },
      probes: probes({ readOverrideFile: async (p) => (p === 'X:\\install\\at-rest-override.json' ? goodOverride() : null) }),
    });
    expect(r.verdict).toBe('ok_overridden');
    expect(r.encrypted).toBe(false);
    expect(r.override).toMatchObject({ acknowledged_by: 'operator-1', scope: 'lab-host-01', path: 'X:\\install\\at-rest-override.json' });
  });

  it('an invalid override file is refused with its reason, and the release build still refuses', async () => {
    for (const [text, why] of [
      ['not json', /not JSON/],
      [JSON.stringify({ kind: 'other' }), /kind/],
      [JSON.stringify({ kind: AT_REST_OVERRIDE_KIND, acknowledged_by: 'op', acknowledged_at: 'yesterday', reason: 'long enough reason', scope: 's' }), /not a date/],
      [JSON.stringify({ kind: AT_REST_OVERRIDE_KIND, acknowledged_by: 'op', acknowledged_at: '2026-10-30T00:00:00Z', reason: 'short', scope: 's' }), /shorter/],
      [JSON.stringify({ kind: AT_REST_OVERRIDE_KIND, acknowledged_by: ' ', acknowledged_at: '2026-10-30T00:00:00Z', reason: 'long enough reason', scope: 's' }), /acknowledged_by/],
    ] as const) {
      const r = await checkAtRest({ dataPaths: DATA, releaseBuild: true, overridePath: 'o.json', now: NOW, probes: probes({ readOverrideFile: async () => text }) });
      expect(r.verdict).toBe('refuse');
      expect(r.override_rejected).toMatch(why);
    }
  });

  it('a probe that throws counts as "not shown"', async () => {
    const r = await checkAtRest({
      dataPaths: DATA, releaseBuild: false, now: NOW,
      probes: probes({ readImdsSecurityProfile: async () => { throw new Error('boom'); }, readBitLocker: async () => { throw new Error('boom'); } }),
    });
    expect(r).toMatchObject({ verdict: 'warn', encrypted: false, imds: { answered: false } });
    expect(r.volumes.every(v => v.state === 'unknown')).toBe(true);
  });

  it('no data path: refuse in a release build, warn otherwise', async () => {
    expect((await checkAtRest({ dataPaths: [], releaseBuild: true, now: NOW, probes: probes() })).verdict).toBe('refuse');
    expect((await checkAtRest({ dataPaths: [], releaseBuild: false, now: NOW, probes: probes() })).verdict).toBe('warn');
  });

  it('the health block carries no operator identity or reason text', async () => {
    const r = await checkAtRest({ dataPaths: DATA, releaseBuild: true, overridePath: 'o.json', now: NOW, probes: probes({ readOverrideFile: async () => goodOverride() }) });
    const h = atRestHealth(r);
    expect(h).toEqual({ verdict: 'ok_overridden', encrypted: false, method: 'none', release_build: true, override_recorded: true, override_at: '2026-10-30T09:00:00.000Z', checked_at: '2026-10-31T12:00:00.000Z', evidence_for_scoring: false });
    expect(JSON.stringify(h)).not.toMatch(/operator-1|Lab host/);
  });

  it('formatOverrideRecord writes a record parseOverrideRecord accepts, and refuses a bad one', () => {
    const text = formatOverrideRecord({ acknowledged_by: 'operator-2', reason: 'No BitLocker on this lab VM.', scope: 'vm-lab', acknowledged_at: '2026-10-31T00:00:00.000Z' });
    const parsed = parseOverrideRecord(text);
    expect('record' in parsed && parsed.record.acknowledged_by).toBe('operator-2');
    expect(() => formatOverrideRecord({ acknowledged_by: 'x', reason: 'short', scope: 's' })).toThrow(/shorter/);
  });
});
