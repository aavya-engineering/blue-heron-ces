// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W4-EO3 — every InputSourceResolver provider resolves REAL CES data from a temp pipeline root.
 *
 * The temp CES_PIPELINE_ROOT holds, for two tenants (A and B):
 *   Stamper/plan-data/<slug>/evidence/**.json   Stamper discovery evidence (real persisted shape)
 *   Stamper/plan-data/<slug>/state/execution-results-*.json, plans/executable-plan-*.json
 *   Planner/customers/<name>/inputs/tenant-config-profile_*.json, outputs/*mission-plan*.json
 * Each provider is asked for tenant A and must return A's data only. Also: the 9 underscore names
 * Stamper actually emits (execute.routes.ts) resolve, and no provider says "not implemented".
 * Sim only: files on disk, no network.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { InputSourceResolver, STAMPER_INPUT_ALIASES, describeResolvedData } from '../../../src/eo/rendering/InputSourceResolver';

const A = { slug: 'w4eo3-a', guid: 'a0000000-0000-4000-8000-00000000e03a' };
const B = { slug: 'w4eo3-b', guid: 'b0000000-0000-4000-8000-00000000e03b' };

/** Real persisted Stamper evidence shape (see plan-data/<slug>/evidence/access_control/*.json). */
function evidence(entryId: string, engine: string, controlIds: string[], command: string, raw: string, extra: Record<string, unknown> = {}) {
  return {
    rawResponse: raw,
    outcome: 'automated_success',
    outcomeRationale: 'Resource present',
    complianceVerdict: 'SAT',
    verdictRationale: 'present',
    registryEntry: { entry_id: entryId, label: `Label ${entryId}`, engine, control_ids: controlIds, manual_only: engine === 'manual_gate' },
    metadata: {
      controlIds, timestamp: '2026-09-27T09:00:00.000Z', executorIdentity: 'sim',
      commandExecuted: command, sha256Hash: 'ab'.repeat(32), environment: 'GCC-High',
    },
    ...extra,
  };
}

// entryId, engine, controls, command, file (under evidence/)
const EVIDENCE: Array<[string, string, string[], string, string, Record<string, unknown>?]> = [
  ['IA.L2-3.5.8.password-policy-evidence', 'mgraph', ['IA.L2-3.5.8'], "[assess] Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/settings' | ConvertTo-Json", 'identification/ia.l2-3.5.8.json'],
  ['AU.L2-3.3.2.signin-logs', 'mgraph', ['AU.L2-3.3.2'], '[assess] Get-MgAuditLogSignIn -Top 5', 'audit/au.l2-3.3.2.json'],
  ['AC.L1-3.1.1.ca-policy-evidence', 'mgraph', ['AC.L1-3.1.1'], '[assess] Get-MgIdentityConditionalAccessPolicy', 'access_control/ac.l1-3.1.1.json'],
  ['CM.L2-3.4.8.app-protection-evidence', 'mgraph', ['CM.L2-3.4.8'], "[assess] (Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/v1.0/deviceAppManagement/managedAppPolicies')", 'config/cm.l2-3.4.8.json'],
  ['AC.L2-3.1.22.spo-site-sharing', 'mgraph', ['AC.L2-3.1.22'], "[assess] (Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.us/beta/admin/sharepoint/settings')", 'access_control/ac.l2-3.1.22.json'],
  ['SC.L2-3.13.8.tls-enforce', 'exchange', ['SC.L2-3.13.8'], '[assess] Get-TransportConfig | Select-Object AllowLegacyTLSClients', 'sc/sc.l2-3.13.8.json'],
  ['AU.L2-3.3.6.audit-report-evidence', 'exchange', ['AU.L2-3.3.6'], '[assess] Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-7) -EndDate (Get-Date)', 'audit/au.l2-3.3.6.json'],
  ['AU.L2-3.3.1.audit-retention', 'ipps', ['AU.L2-3.3.1'], "[assess] Get-UnifiedAuditLogRetentionPolicy | Where-Object Name -like 'CMMC*'", 'audit/au.l2-3.3.1.json'],
  ['AC.L2-3.1.20.teams-external', 'teams', ['AC.L2-3.1.20'], '[assess] Get-CsExternalAccessPolicy', 'access_control/ac.l2-3.1.20.json'],
  ['AZ-SEN-005', 'az', ['AU.L2-3.3.5'], "[assess] Get-AzSentinelAlertRule -ResourceGroupName 'rg' -WorkspaceName 'law'", 'audit/az-sen-005.json'],
  ['SI.L2-3.14.3.safe-links', 'exchange', ['SI.L2-3.14.3'], "[assess] Get-SafeLinksPolicy -Identity 'CMMC-SafeLinks'", 'si/si.l2-3.14.3.json'],
  ['AZ-FOUND-003', 'az', ['RA.L2-3.11.2'], "[assess] Get-AzSecurityPricing | Where-Object { $_.Name -in @('VirtualMachines') }", 'ra/az-found-003.json'],
  ['MP.L2-3.8.3.sanitize', 'manual_gate', ['MP.L2-3.8.3'], '[manual/evidence-only] Media Sanitization Before Disposal (Manual Gate)', 'mp/mp.l2-3.8.3.json'],
  ['CA.L2-3.12.4.ssp', 'policy', ['CA.L2-3.12.4'], '[policy] SSP', 'ca/ca.l2-3.12.4.json',
    { directiveMetadata: { control_id: 'CA.L2-3.12.4', directive: 'document-renderable', narrative_stub: 'The SSP is maintained by the ISSO.' } }],
];

function writeJson(file: string, body: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body, null, 2));
}

describe('W4-EO3: input-source providers resolve real CES data from a pipeline root', () => {
  let tmp: string;
  const prev = process.env.CES_PIPELINE_ROOT;
  let resolver: InputSourceResolver;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w4eo3-'));
    process.env.CES_PIPELINE_ROOT = tmp;
    for (const t of [A, B]) {
      const root = path.join(tmp, 'Stamper', 'plan-data', t.slug);
      for (const [id, engine, ctl, cmd, file, extra] of EVIDENCE) {
        writeJson(path.join(root, 'evidence', file), evidence(id, engine, ctl, cmd, `raw-${t.slug}-${id}`, extra ?? {}));
      }
      writeJson(path.join(root, 'state', 'execution-results-run1.json'), { runId: `run-${t.slug}`, tenantSlug: t.slug, results: [{ controlId: 'AC.L1-3.1.1', verdict: 'SAT' }] });
      writeJson(path.join(root, 'plans', 'executable-plan-2026-09-27T09-00-00Z.json'), { planId: `plan-${t.slug}`, steps: [] });
      const cust = path.join(tmp, 'Planner', 'customers', `customer-${t.slug}`);
      writeJson(path.join(cust, 'inputs', 'tenant-config-profile_tenant_config_profile_x1.json'), {
        ces: { artifact: 'tenant_config_profile', version: '1.0', generated_on: '2026-09-27' },
        tenant_config: { identity: { tenant_id: t.guid, primary_domain: `${t.slug}.onmicrosoft.us` }, licensing: { primary_sku: `SKU-${t.slug}` } },
      });
      writeJson(path.join(cust, 'outputs', `x_manual-mission-plan_manual-2026-09-27.json`), { plan: { steps: [{ what_to_do: `step-${t.slug}` }] } });
    }
    resolver = new InputSourceResolver({ tenantSlug: A.slug });
    resolver.setAssessmentSnapshot({ tenantId: A.guid, controls: [
      { control_id: 'AC.L1-3.1.1', status: 'met' }, { control_id: 'AU.L2-3.3.1', status: 'not_met' }, { control_id: 'CM.L2-3.4.4', status: 'partial' }] });
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prev === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prev;
  });

  const entries = (r: any): string[] => (r.data as any[]).map(x => x.entryId).sort();
  const onlyA = (r: any) => (r.data as any[]).every(x => String(x.rawResponse).startsWith(`raw-${A.slug}-`));

  // provider path -> expected Stamper entry ids (tenant A)
  const SERVICE_CASES: Array<[string, string[]]> = [
    ['entra.password_policy', ['IA.L2-3.5.8.password-policy-evidence']],
    ['entra.audit_logs', ['AU.L2-3.3.2.signin-logs']],
    ['entra.conditional_access', ['AC.L1-3.1.1.ca-policy-evidence']],
    ['intune.app_control_policies', ['CM.L2-3.4.8.app-protection-evidence']],
    ['sharepoint.sharing', ['AC.L2-3.1.22.spo-site-sharing']],
    ['exchange.transport', ['SC.L2-3.13.8.tls-enforce']],
    ['purview.unified_audit_log', ['AU.L2-3.3.1.audit-retention', 'AU.L2-3.3.6.audit-report-evidence']],
    ['teams.external_access', ['AC.L2-3.1.20.teams-external']],
    ['sentinel.alert_rules', ['AZ-SEN-005']],
    ['defender.office365', ['SI.L2-3.14.3.safe-links']],
    ['defender_for_cloud.findings', ['AZ-FOUND-003']],
  ];

  it.each(SERVICE_CASES)('%s resolves tenant A\'s Stamper discovery evidence', (p, expected) => {
    const r = resolver.resolveInputSource(p);
    expect(r.resolved).toBe(true);
    expect(entries(r)).toEqual(expected);
    expect(onlyA(r)).toBe(true);
  });

  it('a bare service prefix returns all of that service\'s evidence; [control=] narrows it', () => {
    const all = resolver.resolveInputSource('entra');
    expect(entries(all)).toEqual(['AC.L1-3.1.1.ca-policy-evidence', 'AU.L2-3.3.2.signin-logs', 'IA.L2-3.5.8.password-policy-evidence']);
    const one = resolver.resolveInputSource('entra.records[control=IA.L2-3.5.8]');
    expect(entries(one)).toEqual(['IA.L2-3.5.8.password-policy-evidence']);
    expect(resolver.resolveInputSource('entra.records[control=ZZ.L2-9.9.9]').resolved).toBe(false);
  });

  it('stamper: evidence, manual gate items, control narratives, execution results, plans', () => {
    const ev = resolver.resolveInputSource('stamper.evidence');
    expect((ev as any).data).toHaveLength(EVIDENCE.length);
    expect(onlyA(ev)).toBe(true);
    expect(entries(resolver.resolveInputSource('stamper.manual_gate_items'))).toEqual(['MP.L2-3.8.3.sanitize']);
    expect((resolver.resolveInputSource('stamper.control_narratives') as any).data)
      .toEqual([{ controlIds: ['CA.L2-3.12.4'], entryId: 'CA.L2-3.12.4.ssp', narrative: 'The SSP is maintained by the ISSO.' }]);
    expect((resolver.resolveInputSource('stamper.execution_results') as any).data.map((d: any) => d.runId)).toEqual([`run-${A.slug}`]);
    expect((resolver.resolveInputSource('stamper.plans') as any).data.map((d: any) => d.planId)).toEqual([`plan-${A.slug}`]);
  });

  it('planner: tenant_config and mission_plan come from the Planner customer whose profile names tenant A\'s GUID', () => {
    const tc = resolver.resolveInputSource('planner.tenant_config.licensing.primary_sku');
    expect(tc).toEqual({ resolved: true, data: `SKU-${A.slug}` });
    const whole = resolver.resolveInputSource('planner.tenant_config');
    expect((whole as any).data.identity.tenant_id).toBe(A.guid);
    const mp = resolver.resolveInputSource('planner.mission_plan');
    expect((mp as any).data.plan.steps[0].what_to_do).toBe(`step-${A.slug}`);
    expect(resolver.resolveInputSource('planner.tenant_config.no_such_key').resolved).toBe(false);
  });

  it('eo: not_sat_findings / snapshot come from EvidenceOps\' own assessment snapshot', () => {
    const r = resolver.resolveInputSource('eo.not_sat_findings');
    expect((r as any).data.map((c: any) => c.control_id)).toEqual(['AU.L2-3.3.1', 'CM.L2-3.4.4']);
    expect((resolver.resolveInputSource('eo.snapshot') as any).data.tenantId).toBe(A.guid);
  });

  it('the 9 underscore input names Stamper emits all resolve (aliases onto the dotted grammar)', () => {
    const stamperNames = ['entra_password_policy', 'entra_audit_logs', 'intune_app_control_policies', 'unified_audit_log',
      'pipeline_not_sat_findings', 'manual_gate_items', 'pipeline_control_narratives', 'evidence_manifests', 'defender_for_cloud_findings'];
    expect(Object.keys(STAMPER_INPUT_ALIASES).sort()).toEqual([...stamperNames].sort());
    for (const n of stamperNames) {
      const r = resolver.resolveInputSource(n);
      expect({ n, resolved: r.resolved }).toEqual({ n, resolved: true });
    }
  });

  it('tenant B\'s resolver sees only B', () => {
    const rb = new InputSourceResolver({ tenantSlug: B.slug, tenantId: B.guid });
    const r = rb.resolveInputSource('entra.password_policy');
    expect((r as any).data[0].rawResponse).toBe(`raw-${B.slug}-IA.L2-3.5.8.password-policy-evidence`);
    expect((rb.resolveInputSource('planner.tenant_config.licensing.primary_sku') as any).data).toBe(`SKU-${B.slug}`);
  });

  it('no provider is a stub: every prefix answers, and no failure says "not implemented"', () => {
    const bare = new InputSourceResolver();
    const expectedPrefixes = ['entra', 'sentinel', 'defender', 'defender_for_cloud', 'adminops', 'planner', 'stamper',
      'intune', 'purview', 'exchange', 'sharepoint', 'teams', 'eo'];
    expect([...bare.providerPrefixes].sort()).toEqual([...expectedPrefixes].sort());
    for (const r of [bare, resolver]) {
      for (const p of expectedPrefixes) {
        for (const q of [p, `${p}.test.path`, `${p}.records`]) {
          const res = r.resolveInputSource(q);
          if (!res.resolved) {
            expect(res.reason).not.toMatch(/not implemented/i);
            expect(res.reason).toContain(p);
          }
        }
      }
    }
    // And the source file carries no stub resolver.
    const src = fs.readFileSync(path.resolve(__dirname, '../../../src/eo/rendering/InputSourceResolver.ts'), 'utf-8');
    expect(src).not.toMatch(/stubResolver|Data source not implemented/);
  });

  it('describeResolvedData renders records as text (never "[object Object]")', () => {
    const r = resolver.resolveInputSource('entra_password_policy');
    const txt = describeResolvedData((r as any).data);
    expect(txt).toContain('IA.L2-3.5.8.password-policy-evidence');
    expect(txt).toContain(`raw-${A.slug}-`);
    expect(txt).not.toContain('[object Object]');
  });
});
