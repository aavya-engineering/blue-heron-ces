// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W3.5 (REVIEW #7, #20) on run 20's inputs:
 *  - a narrative that would be only the Tenant Manifest (TM) `required_state` assertion
 *    ("… — implemented and continuously verified") is composed from the Infrastructure Manifest
 *    (IM) resources, the AdminOps knowledge bank (KB) `configurationSteps`, the Mission Plan (MP)
 *    steps and the TM `verification[]`;
 *  - the family-overview VPN and wireless claims are printed only when the Strategic-Intent (SI)
 *    baseline posture (MP `disposition_summary.si_key_facts`) supports them.
 * The generator is called as documents-router calls it: raw files plus resolved `manifests`.
 */
import { describe, test, expect, jest, beforeAll } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({ uploadEvidenceBlob: jest.fn(), downloadBlob: jest.fn() }), { virtual: true });
jest.mock('ces-shared/storage', () => ({ getStamperPlanDataRoot: jest.fn(() => '/tmp/golden-plan-data') }), { virtual: true });

import type { AllManifests } from 'ces-shared/types/ssp';
import type { AssessmentSnapshot } from 'ces-shared/types/controls';
import type { EoSystemSecurityPlan, DirectiveControlImplementation } from '../../../src/shared/types/ssp.types.js';
import { SnippetDataResolver } from '../../../src/eo/ssp/SnippetDataResolver.js';
import { AdminOpsDataProvider } from '../../../src/eo/ssp/AdminOpsDataProvider.js';
import { NarrativeNegationGuard } from '../../../src/eo/ssp/NarrativeNegationGuard.js';
import { replayRun20Snapshot, run20Fixture, run20Paths, readJson, controlsRefPath, sprsWeightsPath } from '../../ssp/run20-replay.js';

const fx = run20Fixture();
const tm = readJson(run20Paths.tm);
const im = readJson(run20Paths.im);
const mp = readJson(run20Paths.mp);
const normative = (tm.tenant_manifest as { normative_controls: Array<{ control_id: string; required_state: string }> }).normative_controls;
const requiredState = new Map(normative.map(c => [c.control_id, c.required_state.trim()]));
const imResourcesFor = (controlId: string): Array<{ name: string; resource_type: string }> => {
  const infra = im.infrastructure as Record<string, unknown>;
  return Object.values(infra).filter(Array.isArray).flat()
    .filter((r: any) => Array.isArray(r?.control_ids) && r.control_ids.includes(controlId)) as Array<{ name: string; resource_type: string }>;
};
/**
 * The run-20 controls whose SSP narrative was exactly the bare required_state (nine; AU.L2-3.3.7 is tested on
 * its own below since W5 cycle 7: its registry route now attaches run 20's device-configurations read; AC.L2-3.1.7
 * likewise since GC-RED-2: a run-20 read now reaches it, so its narrative is the snippet template).
 */
const FORMERLY_BARE = ['AC.L1-3.1.2', 'AC.L2-3.1.13', 'AC.L1-3.1.22', 'AU.L2-3.3.1', 'MP.L1-3.8.3', 'SC.L2-3.13.13', 'SC.L2-3.13.14'];

async function generateRun20(snap: AssessmentSnapshot, missionPlan: Record<string, unknown>): Promise<EoSystemSecurityPlan> {
  const adminOps = new AdminOpsDataProvider();
  adminOps.initialize();
  const resolver = new SnippetDataResolver({ adminOpsProvider: adminOps });
  const manifests: AllManifests = await resolver.loadManifests('muster-partial', {
    tenantManifestPath: run20Paths.tm, infraManifestPath: run20Paths.im, missionPlanPath: run20Paths.mp,
  });
  const { SspGenerator } = await import('../../../src/eo/ssp/SspGenerator.js');
  return new SspGenerator(controlsRefPath, sprsWeightsPath, resolver).generate({
    assessment: snap, tenantManifest: tm, infraManifest: im, missionPlan, manifests, variables: {}, tenantSlug: 'muster-partial',
  });
}

describe('W3.5 mechanism narratives (run 20 inputs)', () => {
  let snap: AssessmentSnapshot;
  let ssp: EoSystemSecurityPlan;
  const ci = (id: string) => ssp.controlImplementations.find(c => c.control_id === id) as DirectiveControlImplementation;

  beforeAll(async () => {
    jest.useFakeTimers({ now: new Date(fx.generatedAt), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
    snap = replayRun20Snapshot();
    jest.useRealTimers();
    ssp = await generateRun20(snap, mp);
  }, 60000);

  test('AU.L2-3.3.1: at least 200 characters and names a deployed IM resource', () => {
    const narrative = ci('AU.L2-3.3.1').implementationNarrative;
    expect(narrative.length).toBeGreaterThanOrEqual(200);
    const resources = imResourcesFor('AU.L2-3.3.1');
    expect(resources.some(r => r.resource_type === 'log_analytics_workspace')).toBe(true);
    const workspace = resources.find(r => r.resource_type === 'log_analytics_workspace')!;
    expect(narrative).toContain(`log_analytics_workspace ${workspace.name}`);
    expect(narrative).toContain('retention_days 365');
    expect(narrative).toMatch(/Procedure \(Mission Plan step "Audit Event Logging \(AU\.L2-3\.3\.1\)", owner role compliance_engineer\)/);
    expect(narrative).toMatch(/Verification \(Tenant Manifest\): /);
  });

  test('no narrative equals the bare TM required_state', () => {
    for (const c of ssp.controlImplementations) {
      const rs = requiredState.get(c.control_id);
      if (rs) expect(c.implementationNarrative.trim()).not.toBe(rs);
    }
  });

  test.each(FORMERLY_BARE)('%s: the assertion is labelled as the required state and a mechanism part follows', async (id) => {
    const narrative = ci(id).implementationNarrative;
    // GC-PKG-2: a control that is not met carries the required state without its implementation claim.
    const { withoutImplementationClaims } = await import('../../../src/eo/ssp/SspGenerator.js');
    const rs = ci(id).status === 'met' ? requiredState.get(id)! : withoutImplementationClaims(`${requiredState.get(id)}.`).replace(/.$/, '');
    expect(narrative.startsWith(`Required state (Tenant Manifest): ${rs}`)).toBe(true);
    expect(narrative).toMatch(/\n\n(Mechanism|Configuration|Procedure|Verification) \(/);
    expect(narrative.length).toBeGreaterThanOrEqual(200);
  });

  test('a knowledge bank is cited only for its primary control, with its provenance', () => {
    for (const id of FORMERLY_BARE) {
      const m = /Configuration \(AdminOps knowledge bank (\S+) "[^"]*", (designed procedure|live execution)\)/.exec(ci(id).implementationNarrative);
      if (m) expect(m[2]).toBe('designed procedure');
    }
    // AU.L2-3.3.1 is the primary control of the E-01..E-07 audit banks; since primaries are indexed before related ids
    // (2026-10-27 loader fix), the DLP bank D-02 (which only lists it as related) no longer hides them, so a bank is cited.
    expect(ci('AU.L2-3.3.1').implementationNarrative).toMatch(/Configuration \(AdminOps knowledge bank E-0\d /);
  });

  // W5 cycle 7: AU.L2-3.3.7 routes the settings catalog and the device configurations (ces-shared source registry).
  // With the built registry, run 20's device-configurations read reaches it, so its narrative is the control's
  // snippet template, as for any control with a read; before the ces-shared build it has no read and keeps the
  // composed mechanism narrative.
  test('AU.L2-3.3.7: the snippet template when a read reaches it, else the composed mechanism narrative', () => {
    const routed = (snap.controls.find(c => c.control_id === 'AU.L2-3.3.7')!.signals ?? []).length > 0;
    const narrative = ci('AU.L2-3.3.7').implementationNarrative;
    if (routed) {
      expect(narrative.startsWith('## Control AU.L2-3.3.7: Provide a System Capability That Compares and Synchronizes Internal System Clocks')).toBe(true);
    } else {
      expect(narrative.startsWith(`Required state (Tenant Manifest): ${requiredState.get('AU.L2-3.3.7')}`)).toBe(true);
      expect(NarrativeNegationGuard.check('met', narrative)).toEqual([]);
    }
  });

  // GC-RED-2: AC.L2-3.1.7 as AU.L2-3.3.7 above: the snippet template when a read reaches it, else the composed narrative.
  test('AC.L2-3.1.7: the snippet template when a read reaches it, else the composed mechanism narrative', () => {
    const routed = (snap.controls.find(c => c.control_id === 'AC.L2-3.1.7')!.signals ?? []).length > 0;
    const narrative = ci('AC.L2-3.1.7').implementationNarrative;
    if (routed) {
      expect(narrative.startsWith('## Control AC.L2-3.1.7: Prevent Non-Privileged Users from Executing Privileged Functions')).toBe(true);
    } else {
      expect(narrative.startsWith(`Required state (Tenant Manifest): ${requiredState.get('AC.L2-3.1.7')}`)).toBe(true);
      expect(NarrativeNegationGuard.check('met', narrative)).toEqual([]);
    }
  });

  test('composed narratives raise no negation flag', () => {
    for (const id of FORMERLY_BARE) {
      expect(NarrativeNegationGuard.check('met', ci(id).implementationNarrative)).toEqual([]);
    }
  });

  // EO-collection W2 part 2: vulnRemediationEvaluator (RA.L2-3.11.3) no longer returns not_met from a missing
  // Windows Update ring read; it tests collected vulnerability records, which run 20 never read, so 3.11.3
  // moves not_met -> not_assessed (80 / 6 / 0 / 24 -> 80 / 5 / 0 / 25). No other control moves.
  // Synthetic-customer W5 cycle 1: AC.L2-3.1.3 met -> not_met, IA.L2-3.5.7 / 3.5.10 / 3.5.11 met ->
  // not_assessed (the rewritten evaluators test their condition): 80 / 5 / 0 / 25 -> 76 / 6 / 0 / 28.
  // Synthetic-customer W5 cycle 2: one mover, IA.L2-3.5.10 not_assessed -> not_met at Tier 2: the cycle-1 conditional-access route on IA.L2-3.5.10 (ces-shared registry, run 44a item 2) lets certBasedAuthEvaluator read the CA policies, and none of run 20's 8 blocks legacy authentication for all users: 76 / 6 / 0 / 28 -> 76 / 7 / 0 / 27.
  // Synthetic-customer W5 cycle 3 (assignment-aware credit): run 20's Intune objects carry no assignment information, so
  // AC.L2-3.1.17, MA.L2-3.7.4, MP.L2-3.8.6 and MP.L2-3.8.7 go met -> not_assessed (no other source): 76 / 7 / 0 / 27 -> 72 / 7 / 0 / 31.
  // W5 cycle 7: AU.L2-3.3.7 not_met -> not_assessed (run 20 never read the settings catalog): 72 / 6 / 0 / 32.
  // FIN-27 (FD-4): the replay passes no EO assessment / POA&M records, so CA.L2-3.12.1 / 3.12.3 are not_assessed (72 -> 70) and CA.L2-3.12.2 not_met -> not_assessed (6 -> 5).
  test('status counts after W5 cycle 7 and FIN-27 (70 / 5 / 0 / 35)', () => {
    const counts = ['met', 'not_met', 'partial', 'not_assessed'].map(s => ssp.controlImplementations.filter(c => c.status === s).length);
    expect(counts).toEqual([70, 5, 0, 35]);
    // The W5 cycle 2 mover.
    expect(ssp.controlImplementations.find(c => c.control_id === 'IA.L2-3.5.10')!.status).toBe('not_met');
  });

  test('a required_state of 200 characters or more is kept verbatim', () => {
    const resolver = new SnippetDataResolver();
    const long = 'Conditional Access requires phishing-resistant MFA and a compliant device for every user who reaches CUI in SharePoint Online, Teams and Exchange Online; legacy authentication is blocked tenant-wide by policy CMMC-Block.';
    expect(long.length).toBeGreaterThanOrEqual(200);
    const manifests = { tenantManifest: { normative_controls: [{ control_id: 'AC.L1-3.1.1', required_state: long, verification: [], evidence_artifacts: [] }] } } as unknown as AllManifests;
    expect(resolver.buildControlNarrative('AC.L1-3.1.1', manifests).implementationDescription).toBe(long);
  });
});

describe('W3.5 family overviews gated on the SI posture', () => {
  let snap: AssessmentSnapshot;
  beforeAll(() => {
    jest.useFakeTimers({ now: new Date(fx.generatedAt), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
    snap = replayRun20Snapshot();
    jest.useRealTimers();
  });

  const withPosture = (remote: string, wireless: string): Record<string, unknown> => {
    const copy = JSON.parse(JSON.stringify(mp)) as any;
    copy.outputs.human_readable_mission_plan.disposition_summary.si_key_facts.remote_access_posture = remote;
    copy.outputs.human_readable_mission_plan.disposition_summary.si_key_facts.wireless_posture = wireless;
    return copy;
  };

  test('run 20 (both postures unknown): no VPN, Application Proxy or wireless claim is printed', async () => {
    const facts = (mp as any).outputs.human_readable_mission_plan.disposition_summary.si_key_facts;
    expect([facts.remote_access_posture, facts.wireless_posture]).toEqual(['unknown', 'unknown']);
    const ssp = await generateRun20(snap, mp);
    const ac = ssp.familyOverviews!.AC;
    expect(ac).not.toMatch(/VPN configurations|Application Proxy and VPN|Wireless access is restricted/);
    expect(ac).toContain('Remote access posture is not yet confirmed (Strategic-Intent baseline remote_access_posture: unknown); no VPN or Application Proxy configuration is claimed.');
    expect(ac).toContain('Wireless posture is not yet confirmed (Strategic-Intent baseline wireless_posture: unknown); no wireless access restriction is claimed.');
    expect(ssp.familyOverviewGating!.map(g => [g.family, g.postureField, g.kept])).toEqual([
      ['AC', 'remote_access_posture', false],
      ['AC', 'wireless_posture', false],
    ]);
    expect(Object.keys(ssp.familyOverviews!)).toHaveLength(14);
  }, 60000);

  test('vpn_only and managed_wireless keep the claims as written', async () => {
    const ssp = await generateRun20(snap, withPosture('vpn_only', 'managed_wireless'));
    expect(ssp.familyOverviews!.AC).toContain('Remote access is managed through Azure AD Application Proxy and VPN configurations');
    expect(ssp.familyOverviews!.AC).toContain('Wireless access is restricted through Conditional Access');
    expect(ssp.familyOverviewGating!.every(g => g.kept)).toBe(true);
  }, 60000);

  test('a fallback-only (non-Microsoft) stack gets no overviews', async () => {
    const { SspGenerator } = await import('../../../src/eo/ssp/SspGenerator.js');
    const stub = { id: 'stub', sspNarrativeSourceId: 'stub-empty' } as unknown as import('ces-shared/stack').StackCapabilities;
    const ssp = new SspGenerator(controlsRefPath, sprsWeightsPath).generate({ assessment: snap, missionPlan: mp, variables: {}, stack: stub });
    expect(ssp.familyOverviews).toBeUndefined();
    expect(ssp.familyOverviewGating).toBeUndefined();
  }, 60000);

  test('no_remote and no_wireless print the posture instead', async () => {
    const ssp = await generateRun20(snap, withPosture('no_remote', 'no_wireless'));
    expect(ssp.familyOverviews!.AC).toContain('Remote access to CUI systems is not permitted (Strategic-Intent baseline remote_access_posture: no_remote); no VPN or Application Proxy configuration is claimed.');
    expect(ssp.familyOverviews!.AC).toContain('Wireless networks are not used in the in-scope environment (Strategic-Intent baseline wireless_posture: no_wireless); no wireless access restriction is claimed.');
  }, 60000);
});
