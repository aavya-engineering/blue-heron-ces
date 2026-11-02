// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W1.0 — unread is not absent. The causes of the 16 candidate W1 demotions (SSP-uplift critique
 * §3), driven through the real SignalToControlMapper + evaluator registry and the real
 * StamperEvidenceLoader:
 *   A  the signal is never fetched           -> no_query
 *   B  the fetch errored                     -> no_query
 *   C  read, but returned no objects (B7)    -> no_query, with the read printed
 *   C' the Stamper command got an HTTP 404   -> no_query
 *   D  a genuine negative read               -> missing (still a negative source)
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SignalResult } from 'ces-shared/types/signal';
import type { AssessmentSource } from 'ces-shared/types/controls';
import { SignalToControlMapper } from '../../../src/eo/mapping/SignalToControlMapper';
import { evaluatorRegistry } from '../../../src/eo/mapping/evaluators/index';
import { StamperEvidenceLoader } from '../../../src/eo/evidence/StamperEvidenceLoader';

const sig = (signalId: string, endpoint: string, rawData: unknown, status: SignalResult['status'] = 'success', error?: string): SignalResult => ({
  signalId, source: 'graph', endpoint, timestamp: '2026-10-27T13:00:00.000Z', rawData, status, ...(error ? { error } : {}),
});

function discovery(signals: SignalResult[], controlId: string): AssessmentSource {
  const a = new SignalToControlMapper().mapSignalsToControls(signals, evaluatorRegistry).find(x => x.control_id === controlId);
  if (!a) throw new Error(`${controlId} not in the control-signal registry`);
  return a.sources[0];
}

describe('W1.0 class A: a signal EO never fetched gives no negative source', () => {
  it.each([
    ['AC.L1-3.1.2'], ['AC.L2-3.1.7'], ['AC.L2-3.1.13'], ['AC.L1-3.1.20'], ['AC.L1-3.1.22'], ['CM.L2-3.4.3'], ['SC.L2-3.13.13'],
  ])('%s with no signal read -> no_query', (controlId) => {
    const s = discovery([], controlId);
    expect(s.result).toBe('no_query');
    expect(s.detail).toMatch(/was not read/);
  });

  // W5 cycle 1: both evaluators now read 'directoryUsers' (the /users read EO fetches). A users read alone
  // still decides neither: 3.1.6 needs a privileged-role read, 3.5.1 the fields and the device read.
  it("AC.L2-3.1.6 / IA.L1-3.5.1: a bare 'directoryUsers' read -> no_query, the read printed", () => {
    const signals = [sig('directoryUsers', '/users', { value: [{ id: 'u1' }] })];
    for (const controlId of ['AC.L2-3.1.6', 'IA.L1-3.5.1']) {
      const s = discovery(signals, controlId);
      expect(s.result).toBe('no_query');
      expect(s.detail).toContain("'directoryUsers' was read (/users) and returned 1 object");
    }
  });
});

describe('W1.0 class B: a fetch error gives no negative source', () => {
  it('AC.L2-3.1.19 appProtections error -> no_query, error printed', () => {
    const s = discovery([sig('appProtections', '/deviceAppManagement/iosManagedAppProtectionPolicies', null, 'error', 'Unexpected end of JSON input')], 'AC.L2-3.1.19');
    expect(s.result).toBe('no_query');
    expect(s.detail).toContain('Unexpected end of JSON input');
  });
});

describe('W1.0 class C (B7 sub-answer): an empty read gives no negative source, the read is printed', () => {
  it('AU.L2-3.3.5 zero incidents -> no_query', () => {
    const s = discovery([sig('securityIncidents', '/security/incidents', { value: [] })], 'AU.L2-3.3.5');
    expect(s.result).toBe('no_query');
    expect(s.detail).toMatch(/read and returned 0 objects/);
  });

  it('RA.L2-3.11.2 zero assessed devices -> no_query', () => {
    const s = discovery([sig('tvmAssessmentRecency', '/security/runHuntingQuery', { schema: [], results: [] })], 'RA.L2-3.11.2');
    expect(s.result).toBe('no_query');
    expect(s.detail).toMatch(/returned 0 devices/);
  });

  it('SC.L2-3.13.7 device configurations read with no VPN profile -> no_query, object count printed', () => {
    const s = discovery([sig('deviceConfigurations', '/deviceManagement/deviceConfigurations', {
      value: [{ id: 'c1', '@odata.type': '#microsoft.graph.windows10GeneralConfiguration' }],
    })], 'SC.L2-3.13.7');
    expect(s.result).toBe('no_query');
    expect(s.detail).toContain('1 object(s)');
  });

  it('an empty read in the AC evaluators (cross-tenant policy) -> no_query with the endpoint printed', () => {
    const s = discovery([sig('crossTenantPolicy', '/policies/crossTenantAccessPolicy/default', {})], 'AC.L1-3.1.20');
    expect(s.result).toBe('no_query');
    expect(s.detail).toContain('/policies/crossTenantAccessPolicy/default');
  });
});

describe("W1.0 class C': a Stamper NOT_SAT caused by an HTTP 404 gives no negative source", () => {
  let tmp: string;
  const prev = process.env.CES_PIPELINE_ROOT;
  const slug = 'w10-c-prime';

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w10-'));
    process.env.CES_PIPELINE_ROOT = tmp;
    const dir = path.join(tmp, 'Stamper', 'plan-data', slug, 'evidence', 'identification_auth');
    fs.mkdirSync(dir, { recursive: true });
    const record = (entry: string, label: string, verdict: string, rationale: string, controlIds: string[]) => JSON.stringify({
      rawResponse: '', outcome: verdict === 'SAT' ? 'automated_success' : 'failed_no_remediation', outcomeRationale: rationale,
      complianceVerdict: verdict, registryEntry: { entry_id: entry, label, control_ids: controlIds },
      metadata: { controlIds, timestamp: '2026-10-27T13:00:45.782Z', commandExecuted: `[manual/evidence-only] ${label}`, sha256Hash: 'x' },
    });
    fs.writeFileSync(path.join(dir, 'ia.l1-3.5.1.identity-evidence.json'), record('IA.L1-3.5.1.identity-evidence', 'Verify User and Device Identity Management', 'NOT_SAT',
      'Evidence command failed: Invoke-StacksimResolve : The remote server returned an error: (404) Not Found.', ['IA.L1-3.5.1', 'IA.L1-3.5.2']));
    fs.writeFileSync(path.join(dir, 'ia.l2-3.5.8.empty.json'), record('IA.L2-3.5.8.empty', 'Empty output', 'NOT_SAT',
      'Command completed but expected data output was empty', ['IA.L2-3.5.8']));
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prev === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prev;
  });

  // W5 cycle 2: the evidence-only empty NOT_SAT (run 45's shape) is no opinion too ("empty read, uncounted").
  it('IA.L1-3.5.1 and IA.L1-3.5.2: the 404 file becomes no_query; the evidence-only empty NOT_SAT is no_query too', () => {
    const loader = new StamperEvidenceLoader(slug);
    const map = loader.toAssessmentSources(loader.loadEvidenceForTenant());
    for (const controlId of ['IA.L1-3.5.1', 'IA.L1-3.5.2']) {
      expect(map.get(controlId)!.map(s => s.result)).toEqual(['no_query']);
      expect(map.get(controlId)![0].detail).toContain('HTTP 404');
    }
    expect(map.get('IA.L2-3.5.8')!.map(s => s.result)).toEqual(['no_query']);
    expect(map.get('IA.L2-3.5.8')![0].detail).toContain('empty read, uncounted');
  });
});

describe('W1.0 class D: a genuine negative read is still a negative source', () => {
  it('AC.L1-3.1.1: CA policies read, none requires MFA AND compliant device -> missing', () => {
    const s = discovery([sig('conditionalAccess', '/identity/conditionalAccess/policies', {
      value: [{ displayName: 'Sim CA Policy 1', state: 'enabled', grantControls: { builtInControls: ['mfa'], operator: 'OR' }, conditions: { users: { includeUsers: ['All'] } } }],
    })], 'AC.L1-3.1.1');
    expect(s.result).toBe('missing');
    expect(s.detail).toContain('none enforce MFA + compliant device');
  });
});

describe('S1 fix (2026-10-28): MA.L2-3.7.5 and IA.L2-3.5.11 agree on the conditionalAccess read', () => {
  const CA = '/identity/conditionalAccess/policies';
  it('a failed CA read (run 27 E8F: empty stdout) gives no negative source for either control', () => {
    const signals = [sig('conditionalAccess', CA, null, 'error', 'Unexpected end of JSON input')];
    for (const controlId of ['MA.L2-3.7.5', 'IA.L2-3.5.11']) {
      const s = discovery(signals, controlId);
      expect(s.result).toBe('no_query');
      expect(s.detail).toContain('Unexpected end of JSON input');
    }
    expect(evaluatorRegistry.remoteMfaEvaluator(signals).status).toBe('not_assessed');
  });

  it('an empty CA read gives no negative source for either control', () => {
    const signals = [sig('conditionalAccess', CA, [])];
    for (const controlId of ['MA.L2-3.7.5', 'IA.L2-3.5.11']) expect(discovery(signals, controlId).result).toBe('no_query');
  });

  // W5 cycle 1: MA.L2-3.7.5 now tests the condition (an enabled policy requiring MFA of privileged roles or
  // all users); a policy that grants nothing is a genuine negative.
  it('a CA read requiring MFA of all users decides met for MA.L2-3.7.5; one requiring nothing decides not_met', () => {
    const mfa = { id: 'caPolicy-1', state: 'enabled', conditions: { users: { includeUsers: ['All'] } }, grantControls: { builtInControls: ['mfa'], operator: 'OR' } };
    expect(evaluatorRegistry.remoteMfaEvaluator([sig('conditionalAccess', CA, [mfa])]).status).toBe('met');
    expect(discovery([sig('conditionalAccess', CA, [mfa])], 'MA.L2-3.7.5').result).toBe('exists');
    expect(evaluatorRegistry.remoteMfaEvaluator([sig('conditionalAccess', CA, [{ id: 'caPolicy-1', state: 'enabled' }])]).status).toBe('not_met');
  });
});
