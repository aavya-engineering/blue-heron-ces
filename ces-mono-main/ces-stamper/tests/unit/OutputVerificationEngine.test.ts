// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { OutputVerificationEngine, evidenceValueEquals } from '../../src/core/OutputVerificationEngine';

/**
 * FIDELITY tail (c) — 2026-07-12: jsonpath evidence extraction is case-insensitive
 * and single-element-array tolerant. Real Graph SDK cmdlets surface PascalCase
 * (.DisplayName/.State) while raw Graph JSON is camelCase; CES registry
 * verification jsonpaths are written both ways. This is the correct home for the
 * tolerance (Stamper's verification), NOT the shared stacksim response (which must
 * preserve raw Graph casing for EO/AO consumers).
 */
describe('OutputVerificationEngine — jsonpath casing + array tolerance (FIDELITY tail c)', () => {
  const engine = new OutputVerificationEngine();
  const okSet = { stdout: '', stderr: '', exitCode: 0 };

  function evidence(jsonpath: string, equals: string) {
    return { evidence: { jsonpath, equals } };
  }

  it('matches a PascalCase jsonpath against camelCase evidence JSON', () => {
    const evidenceResult = { stdout: JSON.stringify({ displayName: 'Approved-CUI-Networks' }), exitCode: 0 };
    const r = engine.verify(okSet, evidenceResult, evidence('$.DisplayName', 'Approved-CUI-Networks'));
    expect(r.passed).toBe(true);
  });

  it('matches a camelCase jsonpath against PascalCase evidence JSON', () => {
    const evidenceResult = { stdout: JSON.stringify({ State: 'enabled' }), exitCode: 0 };
    const r = engine.verify(okSet, evidenceResult, evidence('$.state', 'enabled'));
    expect(r.passed).toBe(true);
  });

  it('unwraps a single-element array (Get-Mg*...-Filter returns [ {...} ])', () => {
    const evidenceResult = { stdout: JSON.stringify([{ State: 'enabled' }]), exitCode: 0 };
    const r = engine.verify(okSet, evidenceResult, evidence('$.state', 'enabled'));
    expect(r.passed).toBe(true);
  });

  it('still FAILS on a genuine value mismatch (tolerance is casing/shape only, not values)', () => {
    const evidenceResult = { stdout: JSON.stringify({ state: 'disabled' }), exitCode: 0 };
    const r = engine.verify(okSet, evidenceResult, evidence('$.state', 'enabled'));
    // exitCode is clean so the overall result may still pass via exit weight; the
    // evidence check itself must be false.
    expect(r.details.evidence_check).toBe(false);
  });

  it('returns evidence_check false when the property is genuinely absent', () => {
    const evidenceResult = { stdout: JSON.stringify({ somethingElse: 1 }), exitCode: 0 };
    const r = engine.verify(okSet, evidenceResult, evidence('$.state', 'enabled'));
    expect(r.details.evidence_check).toBe(false);
  });

  it('does not unwrap a multi-element array (ambiguous — must not guess)', () => {
    const evidenceResult = { stdout: JSON.stringify([{ state: 'enabled' }, { state: 'disabled' }]), exitCode: 0 };
    const r = engine.verify(okSet, evidenceResult, evidence('$.state', 'enabled'));
    expect(r.details.evidence_check).toBe(false);
  });

  // FIDELITY tail (c) part 2: boolean/case-insensitive `equals` (PowerShell -eq).
  it('matches a JSON boolean true against the registry\'s PowerShell "True"', () => {
    const evidenceResult = { stdout: JSON.stringify({ UnifiedAuditLogIngestionEnabled: true }), exitCode: 0 };
    const r = engine.verify(okSet, evidenceResult, evidence('$.UnifiedAuditLogIngestionEnabled', 'True'));
    expect(r.details.evidence_check).toBe(true);
  });

  it('evidenceValueEquals mirrors PowerShell -eq (case-insensitive, exact value)', () => {
    expect(evidenceValueEquals(true, 'True')).toBe(true);
    expect(evidenceValueEquals(false, 'False')).toBe(true);
    expect(evidenceValueEquals('Enabled', 'enabled')).toBe(true);
    expect(evidenceValueEquals('disabled', 'enabled')).toBe(false);
    expect(evidenceValueEquals(true, 'False')).toBe(false);
  });
});
