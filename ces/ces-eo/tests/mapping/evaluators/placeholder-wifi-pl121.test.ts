// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIX-SCORE PL-121 Round 2 (founder 2026-11-02: the setting that provides the protection must not depend on a
// placeholder). EO's own Wi-Fi evaluators (AC.L2-3.1.16, AC.L2-3.1.17) refuse a profile whose SSID is Muster's
// unanswered placeholder, with the same reason as Stamper. Read shape: R-F11 mp /deviceManagement/deviceConfigurations.
import * as fs from 'fs';
import * as path from 'path';
import type { SignalResult } from 'ces-shared/types/signal';
import { evaluatorRegistry } from '../../../src/eo/mapping/evaluators/index';
import { isMusterPlaceholder, PLACEHOLDER_REASON } from '../../../src/eo/mapping/evaluators/placeholders';

const sig = (rawData: unknown): SignalResult => ({
  signalId: 'deviceConfigurations', source: 'graph', endpoint: '/deviceManagement/deviceConfigurations', timestamp: '2026-11-02T03:51:00.000Z', rawData, status: 'success',
});
const wifi = (ssid: string, id = 'deviceConfiguration-4', name = 'CMMC-WiFi-Secure') => ({ id, displayName: name, '@odata.type': '#microsoft.graph.windowsWifiConfiguration', networkName: 'CUI-Network', ssid, wifiSecurityType: 'wpa2Enterprise' });
const run = (name: string, rows: unknown[]) => evaluatorRegistry[name]([sig(rows)], undefined);

describe('PL-121: EO Wi-Fi evaluators refuse a placeholder SSID', () => {
  it.each(['wifiProfileEvaluator', 'wirelessProtectionEvaluator'])('%s: met on S1, not_met on the mp placeholder profile with the reason', (name) => {
    expect(run(name, [wifi('S1-MACH-CORP')]).status).toBe('met');
    const mp = run(name, [wifi('MUSTER-DEFAULT-SSID')]);
    expect(mp.status).toBe('not_met');
    expect(mp.evidence).toContain(`${PLACEHOLDER_REASON} ('MUSTER-DEFAULT-SSID')`);
  });
  it.each(['wifiProfileEvaluator', 'wirelessProtectionEvaluator'])('%s: a real profile beside a placeholder one still counts; the placeholder one is not cited', (name) => {
    const r = run(name, [wifi('MUSTER-DEFAULT-SSID'), wifi('S1-MACH-CORP', 'deviceConfiguration-6', 'Corp WiFi')]);
    expect(r.status).toBe('met');
    expect(r.evidence).not.toContain('CMMC-WiFi-Secure');
  });
  it('no Wi-Fi profile at all stays not_assessed (unchanged)', () => {
    expect(run('wifiProfileEvaluator', [{ id: 'x', displayName: 'Other', '@odata.type': '#microsoft.graph.windows10GeneralConfiguration' }]).status).toBe('not_assessed');
  });
});

describe('PL-121: the marker list equals Stamper\'s', () => {
  it('same families (source text) as ces-stamper src/shared/musterPlaceholders.ts', () => {
    const families = (file: string) => {
      const t = fs.readFileSync(file, 'utf-8');
      return t.slice(t.indexOf('const FAMILIES'), t.indexOf('];', t.indexOf('const FAMILIES')));
    };
    const eo = families(path.resolve(__dirname, '../../../src/eo/mapping/evaluators/placeholders.ts'));
    const stamper = families(path.resolve(__dirname, '../../../../ces-stamper/src/shared/musterPlaceholders.ts'));
    expect(eo.length).toBeGreaterThan(50);
    expect(eo).toBe(stamper);
  });
  it('the predicate', () => {
    for (const p of ['MUSTER-DEFAULT-SSID', 'unset-security-email@example.invalid', 'a@b.invalid']) expect(isMusterPlaceholder(p)).toBe(true);
    for (const v of ['S1-MACH-CORP', 'security@s1-mach.simtenant.onmicrosoft.us', 'invalidated', undefined, 5]) expect(isMusterPlaceholder(v)).toBe(false);
  });
});
