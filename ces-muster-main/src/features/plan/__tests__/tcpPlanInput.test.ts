// @vitest-environment node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// W4-MU1 (PLAN-3 M3): the Tenant Config Profile plan inputs.
//  - parity: every static TCP node matches the primed TCP bank (id, binding,
//    option set) — the nodes are a transcription, never a second bank;
//  - score-leak: TCP nodes carry no mapped requirements;
//  - adapter: interview answers win, SI derivation next, recommendations are
//    listed as defaulted, and a {domain} template is never invented.
import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { TCP_NODE_SPECS, TCP_PLAN_INPUT_NODES } from '@/features/interview/tcpPlanInputNodes';
import { buildTenantConfigProfile, decorateInfraManifest, hasTcpInput, type TcpQuestionBank } from '../tcpAdapter';
import type { InterviewFact } from '@/shared/types/engagement';
import type { InfrastructureManifest, SIBaseline } from '@/vendored/ces-planner/shared/types/artifacts';

const BANK = load(
  fs.readFileSync(path.resolve('public/knowledge', 'primed TCP Question Bank.yaml'), 'utf8')
) as TcpQuestionBank;
const BANK_Q = new Map(BANK.sections.flatMap((s) => s.questions).map((q) => [q.id, q]));

function fact(question_id: string, answer: string): InterviewFact {
  return {
    question_id,
    question_text: question_id,
    answer,
    provenance: 'operator_interview',
    confidence: 'high',
    recorded_at: '1970-01-01T00:00:00.000Z',
  };
}

function si(deps: Record<string, unknown>, scope: Record<string, unknown> = {}): SIBaseline {
  return { ces: {}, si_baseline: { dependencies: deps, scope, operations: {} } } as unknown as SIBaseline;
}

describe('TCP plan-input nodes ↔ primed TCP bank parity', () => {
  test('every node is a bank question with the same binding and option set', () => {
    for (const spec of TCP_NODE_SPECS) {
      const q = BANK_Q.get(spec.id);
      expect(q, spec.id).toBeDefined();
      expect(q!.bindings.tenant_config).toBe(spec.field);
      expect(q!.answer_type).toBe(spec.answerType);
      if (spec.answerType === 'single_select') {
        expect(spec.options.map((o) => o.bankOption)).toEqual(q!.options);
      } else {
        expect(spec.options.map((o) => o.bankOption).sort()).toEqual([false, true]);
      }
    }
  });

  test('every radio-capable bank question is a node (no silent omission)', () => {
    const radio = [...BANK_Q.values()].filter((q) => q.answer_type === 'single_select' || q.answer_type === 'boolean');
    expect(TCP_NODE_SPECS.map((s) => s.id).sort()).toEqual(radio.map((q) => q.id).sort());
  });

  test('nodes ride the one graph, carry no requirements, and are plan inputs', () => {
    for (const n of TCP_PLAN_INPUT_NODES) {
      expect(QUESTION_GRAPH).toContain(n);
      expect(n.mapped_requirements).toEqual([]);
      expect(n.plan_input?.contract).toBe('tenant_config_profile');
      expect(n.cluster).toBe('plan-input:tcp');
    }
  });
});

describe('tcpAdapter.buildTenantConfigProfile', () => {
  test('interview answer beats SI derivation; derivation beats recommendation', () => {
    // SI says gcc (-> "GCC"), interview says gcc_high: interview wins.
    const r = buildTenantConfigProfile(
      [fact('TCP.TI.004', 'gcc_high')],
      BANK,
      si({ tenant_model_preference: 'gcc' }, { deployment_posture: 'hybrid' }),
      { orgName: 'Adapter Test Co' }
    );
    expect(r.sources['TCP.TI.004']).toBe('interview');
    expect(r.tenantConfig.tenant_config.identity.cloud_environment).toBe('gcc_high');
    // IA.004 derived from SI deployment_posture=hybrid (Planner's own rule).
    expect(r.sources['TCP.IA.004']).toBe('derived');
    expect(r.tenantConfig.tenant_config.identity_architecture.identity_provider).toBe('hybrid_ad_connect');
    // GA.004 has only a bank recommendation -> used and listed as defaulted.
    expect(r.sources['TCP.GA.004']).toBe('recommended');
    expect(r.defaulted.some((d) => d.startsWith('TCP TCP.GA.004:'))).toBe(true);
  });

  test('a {domain} template and a placeholder GUID are never invented', () => {
    const r = buildTenantConfigProfile([], BANK, null, { orgName: 'Adapter Test Co' });
    expect(r.sources['TCP.TI.002']).toBe('unresolved'); // primary domain
    expect(r.sources['TCP.IA.001']).toBe('unresolved'); // breakglass1@{domain}
    expect(r.sources['TCP.TI.001']).toBe('unresolved'); // tenant id GUID
    expect(r.tenantConfig.tenant_config.identity.primary_domain).toBe('');
    expect(r.tenantConfig.tenant_config.identity.tenant_id).toBe('');
    expect(r.tenantConfig.tenant_config.identity_architecture.break_glass_accounts).toEqual([]);
    expect(r.tenantConfig.tenant_config.identity.display_name).toBe('Adapter Test Co');
    // {slug}/{ORG} resolve from the session.
    expect(r.tenantConfig.tenant_config.monitoring.sentinel_workspace_name).toBe('adapter-test-co-law-prod');
    // Every bank question has exactly one source.
    expect(Object.keys(r.sources).sort()).toEqual([...BANK_Q.keys()].sort());
  });

  test('hasTcpInput is true only for TCP node facts', () => {
    expect(hasTcpInput([fact('G-01', 'L2')])).toBe(false);
    expect(hasTcpInput([fact('TCP.PA.004', 'yes')])).toBe(true);
  });

  test('decorateInfraManifest emits the canonical shape: infrastructure key, model, cesId, no dropped fields', () => {
    const raw = {
      ces: { artifact: 'infrastructure_manifest', version: '1.0.0', generated_on: 'x', intent: 'y' },
      infrastructure_manifest: { identity: [], provenance: [], stamper_variable_map: { vnetCidr: '' } },
    } as unknown as InfrastructureManifest;
    const d = decorateInfraManifest(raw, si({ infrastructure_model: 'm365_sentinel' }), null, 'eng-1') as unknown as {
      ces: Record<string, unknown>;
      infrastructure: Record<string, unknown>;
      infrastructure_manifest?: unknown;
    };
    expect(d.infrastructure.infrastructure_model).toBe('m365_sentinel');
    expect(d.infrastructure.identity).toEqual([]);
    expect(d.infrastructure_manifest).toBeUndefined();
    expect(d.ces.cesId).toBe('eng-1');
    expect(d.ces.artifact).toBe('infrastructure_manifest');
  });

  test('m365_azure: canonical subnet + firewall/VM variables are added with provenance, never overwriting', () => {
    const raw = {
      ces: { artifact: 'infrastructure_manifest', version: '1.0.0', generated_on: 'x', intent: 'y' },
      infrastructure_manifest: {
        identity: [],
        provenance: [],
        stamper_variable_map: { vnetCidr: '10.0.0.0/16', fwSubnetCidr: '10.0.5.0/27', vmSize: 'Standard_D2s_v5' },
      },
    } as unknown as InfrastructureManifest;
    const d = decorateInfraManifest(raw, si({ infrastructure_model: 'm365_azure' }), null);
    const v = d.infrastructure.stamper_variable_map as Record<string, string>;
    expect(v.firewallSubnetCidr).toBe('10.0.5.0/27');
    expect(v.workloadSubnetCidr).toBe('10.0.6.0/27');
    expect(v.bastionSubnetCidr).toBe('10.0.7.0/26');
    expect(v.firewallName).toBe('cmmc-afw');
    expect(v.vmSize).toBe('Standard_D2s_v5'); // generator value kept
    const fields = d.infrastructure.provenance.map((p) => p.field);
    expect(fields).toContain('stamper_variable_map.bastionSubnetCidr');
    expect(fields).not.toContain('stamper_variable_map.vmSize');
  });
});
