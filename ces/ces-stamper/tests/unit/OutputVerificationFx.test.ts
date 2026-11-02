// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX-03 / FX-04: case-insensitive regex, multi-jsonpath checks, and no format-mismatch forgiveness.
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';

const ok = { stdout: '', stderr: '', exitCode: 0 };
const engine = new OutputVerificationEngine();
const verify = (stdout: string, evidence: any, stateChanged?: boolean) =>
  engine.verify(ok, { stdout, exitCode: 0 }, { evidence }, stateChanged === undefined ? undefined : { stateChanged });

describe('OutputVerificationEngine — FX-03 / FX-04', () => {
  it('raw-stdout regex is case-insensitive: "true" in the rule matches PowerShell "True"', () => {
    expect(verify('storageBlockRemovableStorage : True', { regex: 'storageBlockRemovableStorage.*true' }).passed).toBe(true);
    expect(verify('{"cortanaBlocked":  true}', { regex: 'cortanaBlocked.*True' }).passed).toBe(true);
  });

  it('jsonpath + regex is case-insensitive too', () => {
    expect(verify('{"State":"Enabled"}', { jsonpath: '$.State', regex: '^enabled$' }).passed).toBe(true);
  });

  it('a resolved equals value matches the id in the JSON', () => {
    expect(verify('[{"Id":"user-guid-1"}]', { jsonpath: '$.Id', equals: 'user-guid-1' }).passed).toBe(true);
    expect(verify('[{"Id":"user-guid-2"}]', { jsonpath: '$.Id', equals: 'user-guid-1' }).passed).toBe(false);
  });

  it('checks: every jsonpath check must pass, independent of key order', () => {
    const rule = { checks: [
      { jsonpath: '$.sessionControls.signInFrequency.value', equals: '8' },
      { jsonpath: '$.sessionControls.persistentBrowser.mode', equals: 'never' },
    ] };
    const json = '{"SessionControls":{"PersistentBrowser":{"IsEnabled":true,"Mode":"never"},"SignInFrequency":{"IsEnabled":true,"Type":"hours","Value":8}}}';
    expect(verify(json, rule).passed).toBe(true);
    expect(verify(json.replace('"never"', '"always"'), rule).passed).toBe(false);
    expect(verify('signInFrequency : 8', rule).passed).toBe(false);
  });

  it('an unchanged state no longer hides a failed evidence check (it only explains a pass)', () => {
    const failed = verify('passwordRequired : True', { jsonpath: '$.passwordRequired', equals: 'True' }, false);
    expect(failed.passed).toBe(false);
    expect(failed.details.evidence_check).toBe(false);
    const passed = verify('{"passwordRequired":true}', { jsonpath: '$.passwordRequired', equals: 'True' }, false);
    expect(passed.passed).toBe(true);
    expect(passed.reason).toContain('Already compliant');
  });
});
