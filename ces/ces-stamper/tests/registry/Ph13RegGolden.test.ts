// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// PH-13 P13-REG: the re-aimed SI entries, checked against the reads the simulator returns
// (tenant-stacksim src/resolvers/depth10P13Golden.test.ts proves SET then GET) and against the R-F9 S1
// tenant equivalent 'S1-Defender-AV' (gc-rf9-s1-mach ... si.l1-3.14.5.scan-schedule-evidence.json).
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { evaluateExpectedValue } from '../../src/core/PostcheckRunner';
import { applyRegistryExpectedValues } from '../../src/translators/objectiveCredit';
import { lookupGetCommand, verifyEquivalent } from '../../src/registry/lookup';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');

const registry = CommandRegistry.load(REGISTRY_PATH);
const engine = new OutputVerificationEngine();
const entry = (id: string) => registry.allEntries.find(e => e.entry_id === id)!;
const SCAN = 'SI.L1-3.14.5.scan-schedule-evidence';
const AV = 'SI.L1-3.14.4.av-update-evidence';
const assigned = [{ id: 'p_group-cui-1', target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: 'group-cui-1' } }];

/** The simulator read after the SET (CES's own object, found by name). */
const ownRead = {
  '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', id: 'deviceConfiguration-9', displayName: 'CMMC-Defender-AntivirusPolicy',
  defenderScanType: 'full', defenderScheduledScanTime: '02:00', defenderScheduledQuickScanTime: '06:00', defenderSignatureUpdateIntervalInHours: 4,
  defenderMonitorFileActivity: 'monitorAllFiles', defenderCloudBlockLevel: 'high', defenderSystemScanSchedule: 'sunday', assignments: assigned,
};
/** The R-F9 S1 tenant equivalent (fields the lookup reads). */
const s1Equivalent = {
  '@odata.type': '#microsoft.graph.windows10GeneralConfiguration', id: '51510000-00b4-4000-8000-000000000002', displayName: 'S1-Defender-AV',
  defenderCloudBlockLevel: 'high', defenderScanType: 'full', defenderSystemScanSchedule: 'saturday', defenderScheduledScanTime: '02:00:00.0000000',
  defenderSignatureUpdateIntervalInHours: 4, assignments: assigned,
};
const verify = (read: unknown) =>
  engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: JSON.stringify(read), exitCode: 0 }, { evidence: entry(SCAN).verification!.evidence }).passed;

describe('PH-13 P13-REG: SI.L1-3.14.5.scan-schedule-evidence (LOG-PH12-R4 O1, O2, O3)', () => {
  it('posts the Graph v1.0 type that carries the defender* properties, with a matching Learn source', () => {
    expect(entry(SCAN).set_command).toContain("'@odata.type' = '#microsoft.graph.windows10GeneralConfiguration'");
    expect(entry(SCAN).set_command).not.toContain('windows10EndpointProtectionConfiguration');
    expect(entry(SCAN).source).toBe('https://learn.microsoft.com/graph/api/resources/intune-deviceconfig-windows10generalconfiguration');
  });

  it('credits SI.L1-3.14.4[a] next to its SI.L1-3.14.5 objectives, with SI.L1-3.14.5 still first', () => {
    expect(entry(SCAN).control_ids).toEqual(['SI.L1-3.14.5', 'SI.L1-3.14.4']);
    expect(entry(SCAN).objective_ids).toEqual(['SI.L1-3.14.5[a]', 'SI.L1-3.14.5[b]', 'SI.L1-3.14.5[c]', 'SI.L1-3.14.4[a]']);
  });

  it('the regex values are checks[]; the top-level literal is $.defenderScanType = full', () => {
    const ev = entry(SCAN).verification!.evidence as { jsonpath?: string; equals?: string; regex?: string; checks?: Array<{ jsonpath: string; equals?: string; min_items?: number }> };
    expect(ev.regex).toBeUndefined();
    expect(ev).toMatchObject({ jsonpath: '$.defenderScanType', equals: 'full' });
    expect(ev.checks).toEqual([
      { jsonpath: '$.defenderScanType', equals: 'full' },
      { jsonpath: '$.defenderCloudBlockLevel', equals: 'high' },
      { jsonpath: '$.defenderSignatureUpdateIntervalInHours', equals: '4' },
      { jsonpath: '$.assignments', min_items: 1 },
    ]);
  });

  it('passes on the simulator read after the SET, and fails when any value or the assignment is missing', () => {
    expect(verify(ownRead)).toBe(true);
    expect(verify({ ...ownRead, defenderScanType: 'quick' })).toBe(false);
    expect(verify({ ...ownRead, defenderCloudBlockLevel: 'notConfigured' })).toBe(false);
    expect(verify({ ...ownRead, defenderSignatureUpdateIntervalInHours: 8 })).toBe(false);
    expect(verify({ ...ownRead, assignments: [] })).toBe(false);
  });

  it('the GET is the one its lookup block generates, and now asks for a signature interval of at least 1 hour', () => {
    expect(entry(SCAN).get_command).toBe(lookupGetCommand(entry(SCAN).lookup!));
    expect(entry(SCAN).lookup!.by_effect).toContainEqual({ path: '$.defenderSignatureUpdateIntervalInHours', op: 'gte', value: 1 });
  });

  it("the R-F9 S1 equivalent 'S1-Defender-AV' still verifies by effect; one that never checks for signatures (0) does not", () => {
    const ok = verifyEquivalent(JSON.stringify(s1Equivalent), entry(SCAN).lookup!, undefined);
    expect(ok?.verification.passed).toBe(true);
    expect(ok?.match.conditions).toHaveLength(6);
    expect(verifyEquivalent(JSON.stringify({ ...s1Equivalent, defenderSignatureUpdateIntervalInHours: 0 }), entry(SCAN).lookup!, undefined)?.verification.passed).toBe(false);
    expect(verifyEquivalent(JSON.stringify({ ...s1Equivalent, defenderSignatureUpdateIntervalInHours: null }), entry(SCAN).lookup!, undefined)?.verification.passed).toBe(false);
  });

  it('the objective postchecks take the literal, and it holds on both reads (V94 SI.L1-3.14.5[a-c], SI.L1-3.14.4[a])', () => {
    const objectives = ['SI.L1-3.14.5[a]', 'SI.L1-3.14.5[b]', 'SI.L1-3.14.5[c]', 'SI.L1-3.14.4[a]'];
    const pcs = objectives.map(o => ({ id: `pc-${o}`, description: o, method: 'config_export' as const, expected: o, objective_id: o }));
    const n = applyRegistryExpectedValues(pcs as never, objectives.map(o => ({ objective_id: o, type: 'configure' as const, entry_ids: [SCAN] })) as never, new Map([[SCAN, entry(SCAN)]]));
    expect(n).toBe(4);
    for (const pc of pcs as Array<{ expected_value?: { path: string; op: string; value: unknown; source: string } }>) {
      expect(pc.expected_value).toEqual({ path: '$.defenderScanType', op: 'equals', value: 'full', source: 'registry' });
      expect(evaluateExpectedValue(JSON.stringify(ownRead), pc.expected_value as never).passed).toBe(true);
      expect(evaluateExpectedValue(JSON.stringify(s1Equivalent), pc.expected_value as never).passed).toBe(true);
    }
  });
});

describe('PH-13 P13-REG: SI.L1-3.14.4.av-update-evidence (LOG-PH12-R4 O3)', () => {
  it('reads Defender signature currency per Windows device, tagged SI.L1-3.14.4[a], evidence only', () => {
    expect(entry(AV).control_ids).toEqual(['SI.L1-3.14.4']);
    expect(entry(AV).objective_ids).toEqual(['SI.L1-3.14.4[a]']);
    expect(entry(AV).idempotency).toBe('evidence-only');
    expect(entry(AV).set_command).toBe('');
    expect(entry(AV).source).toMatch(/^https:\/\/learn\.microsoft\.com\/graph\/api\/intune-devices-windowsprotectionstate-get/);
    expect(entry(AV).get_command).toContain('/beta/deviceManagement/managedDevices/$($m.id)/windowsProtectionState');
    expect(entry(AV).get_command).not.toMatch(/windowsUpdateForBusiness/);
    expect(entry(AV).evidence_commands).toEqual([entry(AV).get_command]);
  });

  it('always emits one summary object, so a successful read is never empty (no device: counts are 0)', () => {
    const get = entry(AV).get_command;
    expect(get.trim().startsWith('$d = @(')).toBe(true);
    expect(get).toMatch(/\[pscustomobject\]@\{ windowsDevicesRead = \$d\.Count; protectionStatesReported = .*signatureUpdateOverdueCount = .*devices = \$s \} \| ConvertTo-Json -Depth 5$/);
    // A device whose state read fails is a row with reported = false, never a thrown read.
    expect(get).toMatch(/catch \{ \[pscustomobject\]@\{ deviceName = \$m\.deviceName; reported = \$false \} \}/);
  });
});
