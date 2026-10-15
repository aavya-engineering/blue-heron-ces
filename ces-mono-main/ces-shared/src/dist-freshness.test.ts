// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../dist');

function requireDist(msg: string): void {
  if (!fs.existsSync(DIST)) {
    throw new Error(`dist/ is missing — run \`npm run build\`. ${msg}`);
  }
}

describe('dist freshness — mission-plan', () => {
  it('dist/types/mission-plan.contract.js contains passthrough calls', () => {
    requireDist('Cannot verify mission-plan passthrough.');
    const js = fs.readFileSync(
      path.join(DIST, 'types/mission-plan.contract.js'),
      'utf-8',
    );
    expect(js).toContain('.passthrough()');
  });

  it('built ManualMissionPlanSchema preserves unknown keys (round-trip)', async () => {
    requireDist('Cannot import built module.');
    const mod = await import('../dist/types/mission-plan.contract.js');
    const plan = {
      ces: {
        artifact: 'manual_mission_plan',
        version: '1.0.0',
        generated_on: '2026-09-27',
        intent: 'freshness test',
        future_ces_x: 'kept',
      },
      inputs: {},
      outputs: {
        human_readable_mission_plan: {
          plan_id: 'fresh-001',
          plan_mode: 'harden_existing',
          target_level: 'L2',
          milestones: [{
            id: 'ms-1', name: 'P1', objective: 'O',
            exit_criteria: ['done'], target_date: '2026-12-31',
          }],
          assessor_alignment_notes: ['n1'],
          future_plan_x: 'kept',
        },
        future_outputs_x: 'kept',
      },
      future_top_x: 'kept',
    };
    const parsed = mod.ManualMissionPlanSchema.parse(plan);
    expect(parsed).toEqual(plan);
  });
});

describe('dist freshness — mission-plan typed output (FX-SH2)', () => {
  it('built .d.ts types ManualMissionPlanSchema output and exports the envelope schemas', async () => {
    requireDist('Cannot verify typed output.');
    const dts = fs.readFileSync(path.join(DIST, 'types/mission-plan.contract.d.ts'), 'utf-8');
    expect(dts).toContain('interface ManualMissionPlanParsed');
    expect(dts).not.toContain('z.ZodType<Record<string, unknown>>');
    const mod = await import('../dist/types/mission-plan.contract.js');
    expect(mod.CesPlanMetaSchema).toBeDefined();
    expect(mod.OutputsBlockSchema).toBeDefined();
    expect(mod.CheckSchema).toBeDefined();
  });
});

describe('dist freshness — adminops-evidence', () => {
  it('exports SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS with 1.0.0 through 1.3.0', async () => {
    requireDist('Cannot import built module.');
    const mod = await import('../dist/types/adminops-evidence.contract.js');
    expect(mod.SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS).toBeDefined();
    expect(mod.SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS).toContain('1.0.0');
    expect(mod.SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS).toContain('1.1.0');
    expect(mod.SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS).toContain('1.2.0');
    expect(mod.SUPPORTED_ADMINOPS_EVIDENCE_VERSIONS).toContain('1.3.0');
  });

  it('built schema keeps targetUPN / targetObjectId (FX-SH3, 1.3.0)', async () => {
    requireDist('Cannot import built module.');
    const mod = await import('../dist/types/adminops-evidence.contract.js');
    const row = {
      contractVersion: '1.3.0', commandId: 'A-02', tenantId: 'tid-125', mode: 'live', dryRun: false,
      outcome: 'executed', controlIds: ['AC.L2-3.1.1'], timestamp: '2026-09-27T00:00:00Z',
      verdict: 'SAT', sha256: 'abc125', targetUPN: 'target@contoso.us', targetObjectId: 'oid-1',
    };
    const result = mod.AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(true);
    expect(result.data.targetUPN).toBe('target@contoso.us');
    expect(result.data.targetObjectId).toBe('oid-1');
  });

  it('built schema accepts a 1.2.0 denied_sim_only row (FX-SH1)', async () => {
    requireDist('Cannot import built module.');
    const mod = await import('../dist/types/adminops-evidence.contract.js');
    const row = {
      contractVersion: '1.2.0',
      commandId: 'X-43',
      tenantId: 'tid-124',
      mode: 'live',
      dryRun: false,
      outcome: 'denied_sim_only',
      controlIds: ['AC.L2-3.1.5'],
      timestamp: '2026-09-27T00:00:00Z',
      verdict: 'NOT_APPLICABLE',
      sha256: 'abc124',
    };
    expect(mod.AdminOpsEvidenceSchema.safeParse(row).success).toBe(true);
    expect(mod.isDenial(row)).toBe(true);
  });

  it('built schema accepts dry-run with denied_cmmc (F-4)', async () => {
    requireDist('Cannot import built module.');
    const mod = await import('../dist/types/adminops-evidence.contract.js');
    const row = {
      contractVersion: '1.0.0',
      commandId: 'X-42',
      tenantId: 'tid-123',
      mode: 'dry_run',
      dryRun: true,
      outcome: 'denied_cmmc',
      controlIds: ['AC.L2-3.1.5'],
      timestamp: '2026-09-27T00:00:00Z',
      verdict: 'NOT_APPLICABLE',
      sha256: 'abc123',
    };
    const result = mod.AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(true);
  });

  it('built AdminOpsEvidenceSchema rejects unknown contractVersion', async () => {
    requireDist('Cannot import built module.');
    const mod = await import('../dist/types/adminops-evidence.contract.js');
    const row = {
      contractVersion: '99.0.0',
      commandId: 'X-01',
      tenantId: 'tid-001',
      mode: 'live',
      dryRun: false,
      outcome: 'executed',
      controlIds: ['AC.L2-3.1.1'],
      timestamp: '2026-09-27T00:00:00Z',
      verdict: 'SAT',
      sha256: 'abc',
    };
    const result = mod.AdminOpsEvidenceSchema.safeParse(row);
    expect(result.success).toBe(false);
  });
});

describe('dist freshness — execution-results', () => {
  it('dist/types/execution-results.contract.js exports EXECUTION_RESULTS_CONTRACT_VERSION', async () => {
    requireDist('Cannot import built module.');
    const mod = await import('../dist/types/execution-results.contract.js');
    expect(mod.EXECUTION_RESULTS_CONTRACT_VERSION).toBeDefined();
    expect(typeof mod.EXECUTION_RESULTS_CONTRACT_VERSION).toBe('string');
  });

  it('built schema keeps executablePlanId and accepts 1.0.0 + 1.1.0 (FX-SH3)', async () => {
    requireDist('Cannot import built module.');
    const mod = await import('../dist/types/execution-results.contract.js');
    expect(mod.SUPPORTED_EXECUTION_RESULTS_VERSIONS).toEqual(['1.0.0', '1.1.0']);
    const base = {
      runId: 'run-1', planId: 'plan-1', tenantSlug: 'test',
      completedAt: '2026-09-27T00:00:00Z', totalControls: 0, results: [],
    };
    const r = mod.ExecutionResultsManifestSchema.safeParse({ ...base, contractVersion: '1.1.0', executablePlanId: 'translated-plan-1' });
    expect(r.success).toBe(true);
    expect(r.data.executablePlanId).toBe('translated-plan-1');
    expect(mod.ExecutionResultsManifestSchema.safeParse({ ...base, contractVersion: '1.0.0' }).success).toBe(true);
  });

  it('built ExecutionResultsManifestSchema rejects unknown contractVersion', async () => {
    requireDist('Cannot import built module.');
    const mod = await import('../dist/types/execution-results.contract.js');
    const manifest = {
      contractVersion: '99.0.0',
      runId: 'run-1',
      planId: 'plan-1',
      tenantSlug: 'test',
      completedAt: '2026-09-27T00:00:00Z',
      totalControls: 0,
      results: [],
    };
    const result = mod.ExecutionResultsManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });
});

describe('dist freshness — request principal (W4-SH1)', () => {
  it('built ces-shared/http/principal verifies a token and exposes the principal', async () => {
    requireDist('Cannot import built module.');
    const mod = await import('../dist/http/requestPrincipal.js');
    expect(mod.REQUEST_PRINCIPAL_VERSION).toBe('1.1.0');
    const secret = 'dist-freshness-secret-0123456789';
    const verifier = mod.createHs256PrincipalVerifier({ secret });
    const token = mod.signPrincipalToken({ sub: 's1', upn: 'approver@example.test', roles: ['ces.approver'] }, { secret });
    const mw = mod.requirePrincipal({ verifier });
    const req = { path: '/api/x', headers: { 'x-ces-principal': token }, socket: { remoteAddress: '10.0.0.5' } };
    let called = false;
    mw(req, { status() { return this; }, json() {} } as any, () => { called = true; });
    expect(called).toBe(true);
    expect(mod.getRequestPrincipal(req)).toMatchObject({ upn: 'approver@example.test', roles: ['ces.approver'], verified: true });
  });

  it('FC-SH step 2: built module exposes jti as tokenId on the verified principal', async () => {
    requireDist('Cannot import built module.');
    const mod = await import('../dist/http/requestPrincipal.js');
    const secret = 'dist-freshness-secret-0123456789';
    const verifier = mod.createHs256PrincipalVerifier({ secret });
    const token = mod.signPrincipalToken({ sub: 's1', upn: 'approver@example.test', jti: 'mint-dist-1' }, { secret });
    const mw = mod.requirePrincipal({ verifier });
    const req = { path: '/api/x', headers: { 'x-ces-principal': token }, socket: { remoteAddress: '10.0.0.5' } };
    mw(req, { status() { return this; }, json() {} } as any, () => {});
    expect(mod.getRequestPrincipal(req)).toMatchObject({ tokenId: 'mint-dist-1' });
  });

  it('package.json exports ./http/principal → dist/http/requestPrincipal.js', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
    expect(pkg.exports['./http/principal']).toBe('./dist/http/requestPrincipal.js');
  });
});

describe('dist freshness — infra manifest (W4-SH2)', () => {
  it('built InfraManifestSchema parses the shipped example and normalizes fwSubnetCidr', async () => {
    requireDist('Cannot import built module.');
    const mod = await import('../dist/types/mission-plan.contract.js');
    const example = JSON.parse(fs.readFileSync(path.join(DIST, 'data/infra-manifest.example.json'), 'utf-8'));
    expect(mod.InfraManifestSchema.safeParse(example).success).toBe(true);
    const vm = { ...example.infrastructure.stamper_variable_map, fwSubnetCidr: '10.1.0.0/26' };
    delete vm.firewallSubnetCidr;
    const r = mod.InfraManifestSchema.parse({ ces: example.ces, infrastructure: { ...example.infrastructure, stamper_variable_map: vm } });
    expect(r.infrastructure.stamper_variable_map.firewallSubnetCidr).toBe('10.1.0.0/26');
    expect(mod.STAMPER_PROVISIONING_REQUIRED_VARIABLES).toContain('eoAppDisplayName');
  });
});

describe('dist freshness — requestLogger skipPaths (W4-SH3)', () => {
  it('built requestLogger honours skipPaths', async () => {
    requireDist('Cannot import built module.');
    const mod = await import('../dist/observability/requestLogger.js');
    const src = fs.readFileSync(path.join(DIST, 'observability/requestLogger.js'), 'utf-8');
    expect(src).toContain('skipPaths');
    expect(mod.requestLogger.length).toBeGreaterThanOrEqual(1);
  });
});

describe('dist freshness — evidence collector contract (M1, evidence-collector PLAN.md)', () => {
  it('dist/types/evidence-collector.contract.js exports EC_CONTRACT_VERSION 1.0.0', async () => {
    requireDist('Cannot import built module.');
    const mod = await import('../dist/types/evidence-collector.contract.js');
    expect(mod.EC_CONTRACT_VERSION).toBe('1.0.0');
    expect(mod.SUPPORTED_EC_CONTRACT_VERSIONS).toEqual(['1.0.0']);
  });

  it('built EcEvidenceItemSchema is strict: rejects a verdict or dryRun key', async () => {
    requireDist('Cannot import built module.');
    const mod = await import('../dist/types/evidence-collector.contract.js');
    const base = {
      contractVersion: '1.0.0',
      itemId: 'ITEM-DF-1',
      tenantSlug: 'contoso',
      controlIds: ['PE.L2-3.10.1'],
      source: 'manual_upload',
      filename: 'x.pdf',
      mediaType: 'application/pdf',
      sha256: 'a'.repeat(64),
      sizeBytes: 10,
      collectedAt: '2026-09-27T00:00:00Z',
      submittedByRole: 'compliance_admin',
      mode: 'sim',
    };
    expect(mod.EcEvidenceItemSchema.safeParse(base).success).toBe(true);
    expect(mod.EcEvidenceItemSchema.safeParse({ ...base, verdict: 'SAT' }).success).toBe(false);
    expect(mod.EcEvidenceItemSchema.safeParse({ ...base, dryRun: false }).success).toBe(false);
  });

  it('package.json exports ./types/evidence-collector → dist/types/evidence-collector.contract.js', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
    expect(pkg.exports['./types/evidence-collector']).toBe('./dist/types/evidence-collector.contract.js');
  });

  it('built storage/node.js exposes getEcModuleRoot/getEcTenantRoot under EvidenceCollector', async () => {
    requireDist('Cannot import built module.');
    const mod = await import('../dist/storage/node.js');
    const originalRoot = process.env.CES_PIPELINE_ROOT;
    process.env.CES_PIPELINE_ROOT = '/tmp/ces-dist-freshness-root';
    try {
      expect(mod.getEcModuleRoot()).toContain('EvidenceCollector');
      expect(mod.getEcTenantRoot('contoso')).toContain('contoso');
      expect(() => mod.getEcTenantRoot('../etc')).toThrow();
    } finally {
      if (originalRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
      else process.env.CES_PIPELINE_ROOT = originalRoot;
    }
  });
});
