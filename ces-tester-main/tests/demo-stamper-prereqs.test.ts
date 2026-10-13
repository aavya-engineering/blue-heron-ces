// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// GP-DEMO-3 M3 — sim-certificate prereq helpers (pure halves only).
//
// Nothing here spawns PowerShell or touches Cert:\CurrentUser\My; the live
// routes are exercised by M7's run. What IS pinned: the store-presence and
// generation-output parsers (a mis-parse would silently report a cert that is
// not installed, which is exactly how the Connect gate fails confusingly), and
// the identity rule — the certificate subject must stay identity-free.
import { describe, it, expect } from 'vitest';
import {
  parseCertPresence,
  parseCertGenerationOutput,
  SIM_CERT_SUBJECT,
  SIM_CERT_FILENAME,
} from '../src/demo/stamper-prereqs.js';

describe('parseCertPresence', () => {
  it('reads the sentinel from the last line, ignoring PowerShell preamble', () => {
    expect(parseCertPresence('IN-STORE')).toBe(true);
    expect(parseCertPresence('some banner\r\nIN-STORE\r\n')).toBe(true);
    expect(parseCertPresence('ABSENT')).toBe(false);
  });

  it('treats anything unrecognised as NOT present (fail closed)', () => {
    expect(parseCertPresence('')).toBe(false);
    expect(parseCertPresence('Get-ChildItem : Cannot find path')).toBe(false);
    expect(parseCertPresence('in-store')).toBe(false);
  });
});

describe('parseCertGenerationOutput', () => {
  it('reads the compressed JSON the generation run prints last', () => {
    const out = parseCertGenerationOutput(
      'WARNING: something\r\n{"thumbprint":"2F916D65470F7E8DD5B8ABB2860757E0A21F2323","pfxPath":"C:\\\\run\\\\sim.pfx"}',
    );
    expect(out.thumbprint).toBe('2F916D65470F7E8DD5B8ABB2860757E0A21F2323');
    expect(out.pfxPath).toBe('C:\\run\\sim.pfx');
  });

  it('throws on output that is not the expected record', () => {
    expect(() => parseCertGenerationOutput('{"thumbprint":123}')).toThrow(/unexpected certificate generation output/);
    expect(() => parseCertGenerationOutput('not json')).toThrow();
  });
});

describe('sim certificate identity rule', () => {
  it('uses an identity-free subject — the artifact may travel with a run', () => {
    expect(SIM_CERT_SUBJECT).toBe('CN=ces-tester-sim');
    expect(SIM_CERT_SUBJECT.toLowerCase()).not.toMatch(/sutton|mhsutton|blueheron|@/);
    expect(SIM_CERT_FILENAME).toBe('sim.pfx');
  });
});
