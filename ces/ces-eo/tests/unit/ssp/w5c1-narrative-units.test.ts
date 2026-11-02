// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W5 cycle 1 unit rules: read rows (SC-1 rows 1, 17), the met-only template rule (row 1), the fallback
 * narrative (row 1), the objective rationale (SC-2 row 8), profile variables and ODP provenance (SC-5,
 * row 9), the content-gap sentence (SC-5, row 12) and the hashed-policy credit (SC-3b).
 */
import { createHash } from 'node:crypto';
import type { ControlAssessment } from 'ces-shared/types/controls';
import type { SignalResult } from 'ces-shared/types/signal';
import { rowsOf, userScopeOf, SIGNAL_REGISTRY } from '../../../src/eo/generation/SignalRegistry.js';
import { SnippetTemplateEngine, flagSignals } from '../../../src/eo/generation/SnippetTemplateEngine.js';
import { composeObjectiveRationale } from '../../../src/eo/assessment/DeterminationLedger.js';
import { variablesFromPolicyProfile, applyPolicyInputs } from '../../../src/eo/ssp/OdpValueProvider.js';
import { NOT_SUPPLIED, notSupplied } from '../../../src/eo/ssp/ContentGap.js';
import { creditDocumentaryItem, buildEvidenceIndex } from '../../../src/eo/packager/EvidenceIndex.js';
import { DirectiveNarrativeBuilder } from '../../../src/eo/generation/DirectiveNarrativeBuilder.js';

const transform = (id: string, rawData: unknown) => SIGNAL_REGISTRY.find(e => e.signalId === id)!.transform({ signalId: id, status: 'success', rawData } as SignalResult);
const sig = (signalId: string, rawData: unknown): SignalResult => ({ signalId, status: 'success', rawData, endpoint: `/${signalId}`, timestamp: '2026-10-28T00:00:00Z' } as unknown as SignalResult);
const assessment = (status: string, extra: Record<string, unknown> = {}): ControlAssessment =>
  ({ control_id: 'X', status, evidenceArtifactIds: [], sources: [], ...extra } as unknown as ControlAssessment);

describe('read rows (SC-1 rows 1 and 17)', () => {
  test('rowsOf reads a bare array, a Graph page and a one-item read; anything else has no rows', () => {
    expect(rowsOf([{ a: 1 }, { a: 2 }])).toHaveLength(2);
    expect(rowsOf({ value: [{ a: 1 }] })).toHaveLength(1);
    expect(rowsOf({ id: 'policyLabel-1', name: 'L1' })).toEqual([{ id: 'policyLabel-1', name: 'L1' }]);
    expect(rowsOf({ displayName: 'no id' })).toEqual([]);
    expect(rowsOf(null)).toEqual([]);
  });

  test('a bare-array device read counts its devices (was 0)', () => {
    expect(transform('managedDevices', Array.from({ length: 58 }, () => ({}))).deviceCount).toBe(58);
    expect(transform('conditionalAccess', [{ displayName: 'p' }]).caPoliciesTotalCount).toBe(1);
  });

  test('a Conditional Access user scope is the users, groups and roles read, not an includeUsers count', () => {
    expect(userScopeOf({ includeUsers: ['All'] })).toBe('all users');
    expect(userScopeOf({ includeUsers: [], includeRoles: ['r1', 'r2', 'r3', 'r4', 'r5'] })).toBe('5 directory roles');
    expect(userScopeOf({ includeUsers: ['u1'], includeGroups: ['g1', 'g2'] })).toBe('1 user, 2 groups');
    expect(userScopeOf(undefined)).toBe('no included users in the policy read');
  });

  test('an authentication-methods policy read without method configurations shows no MFA methods', () => {
    expect(transform('authMethods', { id: 'authenticationMethodsPolicy', policyVersion: '1' }).mfaEnabled).toBe(false);
    expect(transform('authMethods', { authenticationMethodConfigurations: [{ id: 'Fido2', state: 'enabled' }] })).toMatchObject({ mfaEnabled: true, authMethodsCount: 1 });
  });

  test('a PIM read that returned one policy object is one policy', () => {
    expect(transform('pimPolicies', { id: 'roleManagementPolicy-1', displayName: 'P1' }).pimConfigured).toBe(true);
    expect(transform('pimPolicies', []).pimConfigured).toBe(false);
  });
});

describe('met-only template rule (SC-1 row 1)', () => {
  const engine = new SnippetTemplateEngine();
  const ca = sig('conditionalAccess', [{ displayName: 'CA01', state: 'enabled', conditions: { users: { includeUsers: ['All'] } }, grantControls: { builtInControls: ['mfa'] } }]);

  test('flag map: a template flag knows the signals that set it', () => {
    expect([...flagSignals().get('cuiGroupExists')!]).toEqual(['cuiGroup']);
    expect(flagSignals().get('policies')!.has('conditionalAccess')).toBe(true);
  });

  test('met: the absence branch of a flag whose signal was not read for the control is dropped', () => {
    const n = engine.renderControlNarrative('AC.L1-3.1.1', assessment('met'), [ca], { tenantName: 'T' });
    expect(n).not.toContain('has not been created');
    expect(n).toContain('**CA01** (enabled): Enforces mfa for all users');
  });

  test('met: a read that ran and returned nothing keeps its absence branch (stated, not hidden)', () => {
    const n = engine.renderControlNarrative('AC.L1-3.1.1', assessment('met'), [sig('conditionalAccess', [])], { tenantName: 'T' });
    expect(n).toContain('Conditional Access policies are not yet configured');
  });

  test('met: an `{{#unless <flag>}}` absence sentence is dropped when the flag\'s signal was not read; not met keeps it', () => {
    const cp = sig('compliancePolicies', [{ displayName: 'CP1' }]);
    const neg = 'Update deployment rings have not been configured';
    expect(engine.renderControlNarrative('SI.L1-3.14.1', assessment('met'), [cp], { tenantName: 'T' })).not.toContain(neg);
    expect(engine.renderControlNarrative('SI.L1-3.14.1', assessment('not_met'), [cp], { tenantName: 'T' })).toContain(neg);
    expect(engine.renderControlNarrative('SI.L1-3.14.1', assessment('met'), [cp, sig('updateRings', [])], { tenantName: 'T' })).toContain(neg);
  });

  test('not met: every absence branch stays', () => {
    const n = engine.renderControlNarrative('AC.L1-3.1.1', assessment('not_met'), [ca], { tenantName: 'T' });
    expect(n).toContain('A dedicated security group for authorized users has not been created.');
  });

  test('fallback (no template): a met control whose evaluator text negates states its basis and reads instead', () => {
    const a = assessment('met', { implementation_narrative: "Users: 'users' was not read — not assessed", statusRationale: 'Tier 4 (evidence-only Stamper SAT) decides; state not verified: x' });
    const n = engine.renderControlNarrative('IA.L1-3.5.1', a, [sig('directoryUsers', { value: [{}, {}, {}] })]);
    expect(n).toContain('Determination basis: Tier 4 (evidence-only Stamper SAT) decides; state not verified: x.');
    expect(n).toContain('Live reads for this control: directoryUsers returned 3 objects (/directoryUsers).');
    expect(n).not.toContain('was not read');
    const kept = engine.renderControlNarrative('IA.L1-3.5.1', assessment('not_assessed', { implementation_narrative: "Users: 'users' was not read" }), []);
    expect(kept).toContain("'users' was not read");
  });
});

describe('objective rationale (SC-2 row 8)', () => {
  const base = { objectiveId: 'AC.L1-3.1.1[a]', statement: 'authorized users are identified', status: 'satisfied' as const, controlId: 'AC.L1-3.1.1', controlStatus: 'met' as const };
  test('names the tier, the objective\'s records, the counted Stamper records and the family policy', () => {
    const r = composeObjectiveRationale({
      ...base, statusRationale: 'Tier 2 (live read) decides: discovery/exists: x',
      refs: [{ recordId: 'r', tenantId: 't', sourceId: 'conditionalAccess', sha256: 'a'.repeat(64), collectedAt: '2026-10-28T16:01:22.510Z', status: 'success', endpoint: '/identity/conditionalAccess/policies' } as any],
      stamper: [{ label: 'Create CUI Security Group', counted: true }, { label: 'Verify X (SAT on an empty payload; not counted)', counted: false }],
      policy: { name: 'policies/access-control-policy.md', sha256: 'c'.repeat(64) },
    });
    expect(r).toBe('AC.L1-3.1.1[a] (authorized users are identified) is satisfied: AC.L1-3.1.1 is met at Tier 2 (live read); evidence-store records for this objective: conditionalAccess at 2026-10-28T16:01:22.510Z from /identity/conditionalAccess/policies, sha256 aaaaaaaaaaaa; 1 counted Stamper record(s) for the control ("Create CUI Security Group"); 1 Stamper record(s) not counted; policy reference policies/access-control-policy.md (sha256 cccccccccccc); a policy documents the requirement and does not decide it.');
    expect(r).not.toMatch(/^inherited from control assessment/);
  });
  test('presence only: the reads are carried; nothing behind it: said so', () => {
    expect(composeObjectiveRationale({ ...base, statement: 'transactions are limited', statusRationale: 'Tier 2 (live read) decides met (presence only: x): y', presenceRead: "'pimPolicies' was read (/p) and returned 1 object", refs: [], stamper: [] }))
      .toBe("AC.L1-3.1.1[a] (transactions are limited) is satisfied: AC.L1-3.1.1 is met at Tier 2 (live read) (presence only: 'pimPolicies' was read (/p) and returned 1 object).");
    expect(composeObjectiveRationale({ ...base, statement: 'transactions are limited', status: 'not_assessed', controlStatus: 'not_assessed', refs: [], stamper: [] }))
      .toBe('AC.L1-3.1.1[a] (transactions are limited) is not assessed: no source decides AC.L1-3.1.1 (not assessed); no live read, Stamper record or policy stands behind this determination.');
  });
});

describe('profile fills and ODP provenance (SC-5, SC-2 rows 9 and 12)', () => {
  const personnel = [
    { role_id: 'isso', role_title: 'ISSO', name: 'Fict Isso', title: 'Information Systems Security Officer (ISSO)', email: 'isso@example.invalid' },
    { role_id: 'system_owner', name: 'Fict Owner', title: 'President' },
    { role_id: 'compliance_officer', name: 'Fict Issm', title: 'Information Security Manager (ISSM)' },
    { role_id: 'ir_lead', name: 'Fict Admin', title: 'Systems Administrator' },
    { role_id: 'hr_representative', name: 'adm.x@example.invalid', title: 'Controller' },
  ];
  test('named role holders become SSP variables; a UPN-only draft is not a name; no AO is inferred', () => {
    const v = variablesFromPolicyProfile({ personnel });
    expect(v).toMatchObject({ issoName: 'Fict Isso', issoEmail: 'isso@example.invalid', systemOwnerName: 'Fict Owner', issmName: 'Fict Issm', sysAdminName: 'Fict Admin', systemAdministrator: 'Fict Admin (Systems Administrator)' });
    expect(v.humanResourcesManager).toBeUndefined();
    expect(v.authorizingOfficialName).toBeUndefined();
  });

  const ssp = () => ({ controlImplementations: [{ control_id: 'AC.L2-3.1.8', nist_ref: '3.1.8', family: 'AC', status: 'met', implementationNarrative: 'n', relatedPolicies: [] as string[], odpValues: [] as Array<{ parameter: string; value: string; source: string }> }] });
  const src = (s: ReturnType<typeof ssp>) => s.controlImplementations[0].odpValues.find(o => o.parameter === 'PI.ODP.001 account_lockout_threshold')!.source;
  test('row 9: per-question provenance decides when the profile carries it', () => {
    expect(src(applyPolicyInputs(ssp(), { odps: { account_lockout_threshold: 3 }, sources: [{ question_id: 'PI.ODP.001', provenance: 'defaulted' }] }, null))).toMatch(/defaulted/);
    expect(src(applyPolicyInputs(ssp(), { odps: { account_lockout_threshold: 3 }, sources: [{ question_id: 'PI.ODP.001', provenance: 'answered' }] }, null))).toBe('policy-inputs profile: supplied');
  });
  test('row 9: without it, an answered interview (named personnel) means supplied, said so; else the bank comparison stands', () => {
    expect(src(applyPolicyInputs(ssp(), { odps: { account_lockout_threshold: 3 }, personnel }, null))).toBe("policy-inputs profile: supplied (answered Policy Inputs interview; equals the bank's recommended value; the envelope carries no per-parameter provenance)");
    expect(src(applyPolicyInputs(ssp(), { odps: { account_lockout_threshold: 3 } }, null))).toMatch(/: defaulted \(/);
    expect(src(applyPolicyInputs(ssp(), { odps: { account_lockout_threshold: 5 } }, null))).toBe('policy-inputs profile: supplied');
  });
  test('the content-gap sentence is one exact text', () => {
    expect(NOT_SUPPLIED).toBe('Not supplied by the organisation (content gap)');
    expect(notSupplied('the CUI volume.')).toBe('Not supplied by the organisation (content gap): the CUI volume.');
  });
});

describe('FedRAMP inheritance counts (SC-5; plan W5 "counts replace the constant \'0\'")', () => {
  test('the facility and equipment categories count the inherited PE and MP / MA controls', () => {
    const ctl = (id: string, family: string) => ({ control_id: id, family, practice: 'p' }) as any;
    const inherited = [ctl('PE.L1-3.10.1', 'PE'), ctl('PE.L1-3.10.3', 'PE'), ctl('MP.L2-3.8.1', 'MP'), ctl('AC.L1-3.1.1', 'AC')];
    const n = DirectiveNarrativeBuilder.buildInheritFedRampNarrative(inherited[0], { directive: 'inherit-fedramp', evidence_artifacts: [], fedramp_package_id: 'PKG-1', tenant_variant_confirmed: 'GCC High' } as any, true, inherited);
    expect(n).toContain('1 compute/logical controls, 2 facility/physical controls, and 1 equipment/media controls');
    const gap = DirectiveNarrativeBuilder.buildInheritFedRampNarrative(inherited[0], { directive: 'inherit-fedramp', evidence_artifacts: [] } as any, true, inherited);
    expect(gap).not.toContain('[MANUAL INPUT REQUIRED]');
  });
});

describe('hashed-policy credit (SC-3b)', () => {
  const text = '# Access Control Policy\n\nIn accordance with NIST SP 800-171 Rev 2 (Family 3.1).\n\n### 4.1 Account Management (3.1.1, 3.1.2)\n';
  const sha = createHash('sha256').update(text, 'utf8').digest('hex');
  const docs = [{ name: 'policies/access-control-policy.md', sha256: sha, text }];
  test('a policy / procedure item is credited to the hashed family document that names the family', () => {
    expect(creditDocumentaryItem('AC.L1-3.1.1', 'procedures addressing account management', docs)).toEqual({ document: 'policies/access-control-policy.md', sha256: sha });
  });
  test('not credited: a hash mismatch, no text, a document that does not name the family, a non-policy item, another family', () => {
    expect(creditDocumentaryItem('AC.L1-3.1.1', 'Access control policy', [{ ...docs[0], sha256: 'f'.repeat(64) }])).toBeUndefined();
    expect(creditDocumentaryItem('AC.L1-3.1.1', 'Access control policy', [{ name: docs[0].name, sha256: sha }])).toBeUndefined();
    const other = '# Access Control Policy\n\nNo family named.\n';
    expect(creditDocumentaryItem('AC.L1-3.1.1', 'Access control policy', [{ name: docs[0].name, sha256: createHash('sha256').update(other).digest('hex'), text: other }])).toBeUndefined();
    expect(creditDocumentaryItem('AC.L1-3.1.1', 'system design documentation', docs)).toBeUndefined();
    expect(creditDocumentaryItem('AU.L2-3.3.1', 'audit and accountability policy', docs)).toBeUndefined();
    // "3.10.x" does not name family 3.1.
    const pe = '# P\n\n(3.10.1)\n';
    expect(creditDocumentaryItem('AC.L1-3.1.1', 'policy', [{ name: docs[0].name, sha256: createHash('sha256').update(pe).digest('hex'), text: pe }])).toBeUndefined();
  });
  test('a plan item prefers the family plan document', () => {
    const plan = '# Incident Response Plan\n\nReporting (3.6.2).\n';
    const pol = '# Incident Response Policy\n\n(Family 3.6)\n';
    const h = (t: string) => createHash('sha256').update(t).digest('hex');
    const ir = [{ name: 'policies/incident-response-policy.md', sha256: h(pol), text: pol }, { name: 'policies/incident-response-plan.md', sha256: h(plan), text: plan }];
    expect(creditDocumentaryItem('IR.L2-3.6.1', 'incident response plan', ir)?.document).toBe('policies/incident-response-plan.md');
    expect(creditDocumentaryItem('IR.L2-3.6.1', 'incident response policy', ir)?.document).toBe('policies/incident-response-policy.md');
  });
  test('the index marks credited documentary items; automatable coverage (SC-3a) does not move', () => {
    const controls = [{ control_id: 'AC.L1-3.1.1', family: 'AC', status: 'met', evidenceDetails: [] }];
    const without = buildEvidenceIndex({ controls, generatedAt: '2026-10-28T00:00:00Z' });
    const withCredit = buildEvidenceIndex({ controls, generatedAt: '2026-10-28T00:00:00Z', policyDocuments: docs });
    const items = (i: typeof without) => i.examineCoverage[0].items;
    const auto = (i: typeof without) => items(i).filter(x => !['documentary', 'ssp', 'poam'].includes(x.category) && x.status === 'covered').length;
    expect(auto(withCredit)).toBe(auto(without));
    const credited = items(withCredit).filter(x => x.creditedTo);
    expect(credited.length).toBeGreaterThan(0);
    for (const x of credited) expect(x.category).toBe('documentary');
    expect(items(without).filter(x => x.creditedTo)).toEqual([]);
  });
});
