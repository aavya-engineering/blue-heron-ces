// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// W5c3 (SC-8b): the bank's text / list TCP questions are typed nodes, so an
// answer (interview-answers.json) or a harvest fact reaches the Tenant Config
// Profile instead of the bank recommendation; unanswered, they stay defaulted.
import { describe, expect, test } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import type { InterviewFact } from '@/shared/types/engagement';
import { TCP_TYPED_SPEC_BY_ID } from '@/features/interview/tcpPlanInputNodes';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { buildTenantConfigProfile, type TcpQuestionBank } from '../tcpAdapter';

const BANK = load(
  fs.readFileSync(path.resolve('public/knowledge', 'primed TCP Question Bank.yaml'), 'utf8')
) as TcpQuestionBank;

// The 18 TCP questions run 48 listed as defaulted on S1, besides TCP.PA.003 (already a node).
const W5C3_IDS = [
  'TCP.LIC.003', 'TCP.LIC.004', 'TCP.IA.002', 'TCP.IA.003', 'TCP.PA.005', 'TCP.GA.001', 'TCP.GA.003', 'TCP.CA.001',
  'TCP.CA.002', 'TCP.DM.002', 'TCP.DM.003', 'TCP.DP.001', 'TCP.DP.002', 'TCP.DP.003', 'TCP.DP.004', 'TCP.MON.001',
  'TCP.MON.002', 'TCP.MON.005',
];

const fact = (question_id: string, answer: string, provenance = 'operator_interview'): InterviewFact => ({
  question_id,
  question_text: question_id,
  answer,
  provenance,
  confidence: 'high',
  recorded_at: '2026-10-01T00:00:00.000Z',
});

describe('W5c3: TCP text / list questions as typed nodes', () => {
  test('each is a graph node with no mapped requirements', () => {
    for (const id of W5C3_IDS) {
      expect(TCP_TYPED_SPEC_BY_ID.has(id), id).toBe(true);
      const node = QUESTION_GRAPH.find((n) => n.id === id);
      expect(node, id).toBeDefined();
      expect(node!.mapped_requirements).toEqual([]);
    }
  });

  test('S1-style answers replace the bank recommendations (asked, not defaulted)', () => {
    const facts = [
      fact('TCP.IA.002', 'adm.{firstname}.{lastname}@{domain}'),
      fact('TCP.CA.001', 'S1-CA{NN} {Purpose}'),
      fact('TCP.DM.002', 'S1-{Type}-{NN}'),
      fact('TCP.DP.002', 'https://s1-mach.sharepoint.us/sites/cui-enclave'),
      fact('TCP.DP.003', 'CUI-Programs, CUI-Engineering-Drawings'),
      fact('TCP.MON.001', 'law-s1-mach-prod'),
      fact('TCP.MON.002', 'rg-s1-mach-prod'),
      fact('TCP.LIC.004', 'Exchange Online, SharePoint Online, Teams, Intune, Sentinel'),
    ];
    const r = buildTenantConfigProfile(facts, BANK, null, { orgName: 'Sim Co (FICTIONAL)', tenantSlug: 's1-mach' });
    const tc = r.tenantConfig.tenant_config;
    for (const f of facts) expect(r.provenance[f.question_id], f.question_id).toBe('asked');
    expect(tc.identity_architecture.admin_naming_convention).toBe('adm.{firstname}.{lastname}@{domain}');
    expect(tc.conditional_access.ca_naming_convention).toBe('S1-CA{NN} {Purpose}');
    expect(tc.data_protection.cui_teams_channels).toEqual(['CUI-Programs', 'CUI-Engineering-Drawings']);
    expect(tc.monitoring.sentinel_workspace_name).toBe('law-s1-mach-prod');
    for (const f of facts) expect(r.defaulted.some((d) => d.startsWith(`TCP ${f.question_id}:`)), f.question_id).toBe(false);
    // Unanswered conventions keep the bank recommendation and stay listed.
    expect(r.provenance['TCP.GA.001']).toBe('defaulted');
    expect(r.defaulted.some((d) => d.startsWith('TCP TCP.GA.001:'))).toBe(true);
  });

  test('harvested named locations and break-glass group are discovered values in the TCP', () => {
    const r = buildTenantConfigProfile(
      [
        fact('TCP.CA.002', 'S1 Office Egress|ip|198.51.100.0/24, United States|country|US', 'auto_detected'),
        fact('TCP.PA.005', 'S1-Break-Glass', 'auto_detected'),
      ],
      BANK,
      null,
      { orgName: 'Sim Co (FICTIONAL)', tenantSlug: 's1-mach' }
    );
    expect(r.provenance['TCP.CA.002']).toBe('discovered');
    expect(r.provenance['TCP.PA.005']).toBe('discovered');
    expect(r.tenantConfig.tenant_config.conditional_access.named_locations).toEqual([
      { name: 'S1 Office Egress', type: 'ip', value: '198.51.100.0/24' },
      { name: 'United States', type: 'country', value: 'US' },
    ]);
    expect(r.tenantConfig.tenant_config.privileged_access.break_glass_exclusion_group).toBe('S1-Break-Glass');
  });

  test('R-2: "none" for TCP.LIC.003 is the empty list (asked, not defaulted); other list answers are unchanged', () => {
    const r = buildTenantConfigProfile([fact('TCP.LIC.003', 'none')], BANK, null, { orgName: 'Sim Co (FICTIONAL)', tenantSlug: 's1-mach' });
    expect(r.provenance['TCP.LIC.003']).toBe('asked');
    expect(r.tenantConfig.tenant_config.licensing.addon_skus).toEqual([]);
    expect(r.defaulted.some((d) => d.startsWith('TCP TCP.LIC.003:'))).toBe(false);
    const named = buildTenantConfigProfile([fact('TCP.LIC.003', 'IDENTITY_THREAT_PROTECTION')], BANK, null, { orgName: 'Sim Co (FICTIONAL)' });
    expect(named.tenantConfig.tenant_config.licensing.addon_skus).toEqual(['IDENTITY_THREAT_PROTECTION']);
    // Only the ruled question: "none" elsewhere stays a literal item.
    const other = buildTenantConfigProfile([fact('TCP.DP.003', 'none')], BANK, null, { orgName: 'Sim Co (FICTIONAL)' });
    expect(other.tenantConfig.tenant_config.data_protection.cui_teams_channels).toEqual(['none']);
  });
});
