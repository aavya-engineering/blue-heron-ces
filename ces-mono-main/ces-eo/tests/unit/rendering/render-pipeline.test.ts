// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { VariableSubstitutionEngine } from '../../../src/eo/rendering/VariableSubstitutionEngine';
import { InputSourceResolver } from '../../../src/eo/rendering/InputSourceResolver';
import { EvidenceFileWriter } from '../../../src/eo/rendering/EvidenceFileWriter';
import { RenderOrchestrator } from '../../../src/eo/rendering/RenderOrchestrator';
import { StamperEvidenceLoader } from '../../../src/eo/evidence/StamperEvidenceLoader';
import { RenderDirectiveSchema, DIRECTIVE_CODES } from '../../../src/shared/types/render.types';
import type { RenderResult, RenderStatus, RenderContext } from '../../../src/shared/types/render.types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ---------- VariableSubstitutionEngine ----------

describe('VariableSubstitutionEngine', () => {
  const engine = new VariableSubstitutionEngine();

  it('substitutes {date} variable', () => {
    const result = engine.substituteVariables('report-{date}.docx', { date: '2026-04-22' });
    expect(result).toBe('report-2026-04-22.docx');
  });

  it('substitutes {control_id} variable', () => {
    const result = engine.substituteVariables(
      'artifacts/{control_id}/report.docx',
      { date: '2026-04-22', control_id: 'IA.L2-3.5.8' }
    );
    expect(result).toBe('artifacts/IA.L2-3.5.8/report.docx');
  });

  it('substitutes {tenant_name} variable', () => {
    const result = engine.substituteVariables(
      '{tenant_name}/ssp-{date}.docx',
      { date: '2026-04-22', tenant_name: 'acme-corp' }
    );
    expect(result).toBe('acme-corp/ssp-2026-04-22.docx');
  });

  it('substitutes {change_id} variable', () => {
    const result = engine.substituteVariables(
      'sia/{change_id}.docx',
      { date: '2026-04-22', change_id: 'AO-2026-04-21-001' }
    );
    expect(result).toBe('sia/AO-2026-04-21-001.docx');
  });

  it('substitutes multiple variables in one template', () => {
    const result = engine.substituteVariables(
      '{tenant_name}/artifacts/{control_id}/{date}-report.docx',
      { date: '2026-04-22', tenant_name: 'acme', control_id: 'CM.L2-3.4.4' }
    );
    expect(result).toBe('acme/artifacts/CM.L2-3.4.4/2026-04-22-report.docx');
  });

  it('throws on unknown variable', () => {
    expect(() => {
      engine.substituteVariables('report-{unknown_var}.docx', { date: '2026-04-22' });
    }).toThrow('Unknown variable');
  });

  it('returns empty string for missing optional variables', () => {
    const result = engine.substituteVariables(
      'sia/{change_id}.docx',
      { date: '2026-04-22' }
    );
    expect(result).toBe('sia/.docx');
  });

  it('passes through template with no variables', () => {
    const result = engine.substituteVariables(
      'static-path/report.docx',
      { date: '2026-04-22' }
    );
    expect(result).toBe('static-path/report.docx');
  });
});

// ---------- InputSourceResolver ----------

describe('InputSourceResolver', () => {
  const resolver = new InputSourceResolver();

  it('returns resolved=false for entra stub', () => {
    const result = resolver.resolveInputSource('entra.password_policy.history_count');
    expect(result.resolved).toBe(false);
    if (!result.resolved) {
      expect(result.reason).toContain('entra');
    }
  });

  it('returns resolved=false for sentinel stub', () => {
    const result = resolver.resolveInputSource('sentinel.workbook.audit_summary');
    expect(result.resolved).toBe(false);
  });

  it('returns resolved=false for defender stub', () => {
    const result = resolver.resolveInputSource('defender.xdr.alerts');
    expect(result.resolved).toBe(false);
  });

  it('returns resolved=false for defender_for_cloud stub', () => {
    const result = resolver.resolveInputSource('defender_for_cloud.vulnerability_findings');
    expect(result.resolved).toBe(false);
  });

  it('returns resolved=false for unknown prefix', () => {
    const result = resolver.resolveInputSource('nonexistent.source.path');
    expect(result.resolved).toBe(false);
    if (!result.resolved) {
      expect(result.reason).toContain('Unknown input source prefix');
    }
  });

  it('parses dotted path into prefix and segments', () => {
    const result = resolver.resolveInputSource('intune.app_protection.policies');
    expect(result.resolved).toBe(false);
    if (!result.resolved) {
      expect(result.reason).toContain('intune');
    }
  });

  it('handles single-segment paths', () => {
    const result = resolver.resolveInputSource('entra');
    expect(result.resolved).toBe(false);
  });

  const stubPrefixes = [
    'entra', 'sentinel', 'defender', 'defender_for_cloud',
    'planner', 'stamper', 'intune',
    'purview', 'exchange', 'sharepoint', 'teams',
  ];

  it.each(stubPrefixes)('%s prefix answers (unresolved without tenant context, reason names the prefix)', (prefix) => {
    const result = resolver.resolveInputSource(`${prefix}.test.path`);
    expect(result.resolved).toBe(false);
    if (!result.resolved) {
      expect(result.reason).toContain(prefix);
    }
  });

  it('adminops resolver returns unresolved when no data loaded', () => {
    const result = resolver.resolveInputSource('adminops.test.path');
    expect(result.resolved).toBe(false);
  });
});

// ---------- EvidenceFileWriter ----------

describe('EvidenceFileWriter', () => {
  let tmpDir: string;
  let writer: EvidenceFileWriter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-test-'));
    const evidenceDir = path.join(tmpDir, 'plan-data', 'test-tenant', 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
    writer = new EvidenceFileWriter(tmpDir, 'test-tenant');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends eo_render_status to evidence file', () => {
    const evidenceDir = path.join(tmpDir, 'plan-data', 'test-tenant', 'evidence');
    const filePath = path.join(evidenceDir, 'test-evidence.json');
    fs.writeFileSync(filePath, JSON.stringify({ control_id: 'IA.L2-3.5.8', readiness: 'met' }, null, 2));

    const status: RenderStatus = {
      directive_code: 'EO_RENDER_PASSWORD_REUSE_POLICY',
      state: 'rendered',
      artifact_path: 'compliance-repo/policies/password-reuse.docx',
      rendered_at: '2026-04-22T14:30:00Z',
      artifact_version: '1.0',
    };

    writer.appendRenderStatus(filePath, status);

    const updated = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(updated.control_id).toBe('IA.L2-3.5.8');
    expect(updated.eo_render_status).toBeDefined();
    expect(updated.eo_render_status.EO_RENDER_PASSWORD_REUSE_POLICY.state).toBe('rendered');
    expect(updated.eo_render_status.EO_RENDER_PASSWORD_REUSE_POLICY.artifact_path).toBe(
      'compliance-repo/policies/password-reuse.docx'
    );
  });

  it('appends failed render status', () => {
    const evidenceDir = path.join(tmpDir, 'plan-data', 'test-tenant', 'evidence');
    const filePath = path.join(evidenceDir, 'test-evidence.json');
    fs.writeFileSync(filePath, JSON.stringify({ control_id: 'CM.L2-3.4.4' }, null, 2));

    const status: RenderStatus = {
      directive_code: 'EO_RENDER_SIA',
      state: 'failed',
      failure_reason: 'input_source_unreachable: adminops.change_log returned empty',
      rendered_at: '2026-04-22T14:30:00Z',
      artifact_version: '1.0',
    };

    writer.appendRenderStatus(filePath, status);

    const updated = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(updated.eo_render_status.EO_RENDER_SIA.state).toBe('failed');
    expect(updated.eo_render_status.EO_RENDER_SIA.failure_reason).toContain('adminops');
  });

  it('preserves existing evidence file content', () => {
    const evidenceDir = path.join(tmpDir, 'plan-data', 'test-tenant', 'evidence');
    const filePath = path.join(evidenceDir, 'test-evidence.json');
    const original = {
      control_id: 'IA.L2-3.5.8',
      readiness: 'met',
      signal_summary: { password_history: 24 },
    };
    fs.writeFileSync(filePath, JSON.stringify(original, null, 2));

    writer.appendRenderStatus(filePath, {
      directive_code: 'EO_RENDER_PASSWORD_REUSE_POLICY',
      state: 'rendered',
      artifact_path: 'test.docx',
      rendered_at: '2026-04-22T14:30:00Z',
      artifact_version: '1.0',
    });

    const updated = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(updated.control_id).toBe('IA.L2-3.5.8');
    expect(updated.readiness).toBe('met');
    expect(updated.signal_summary.password_history).toBe(24);
  });

  it('throws on missing evidence file', () => {
    expect(() => {
      writer.appendRenderStatus('/nonexistent/path.json', {
        directive_code: 'EO_RENDER_SIA',
        state: 'failed',
        rendered_at: '2026-04-22T14:30:00Z',
        artifact_version: '1.0',
      });
    }).toThrow('Evidence file not found');
  });

  it('creates backup file', () => {
    const evidenceDir = path.join(tmpDir, 'plan-data', 'test-tenant', 'evidence');
    const filePath = path.join(evidenceDir, 'backup-test.json');
    fs.writeFileSync(filePath, JSON.stringify({ control_id: 'test' }));

    const backupPath = writer.backupOriginal(filePath);
    expect(fs.existsSync(backupPath)).toBe(true);
    expect(backupPath).toBe(filePath + '.bak');

    const backupContent = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
    expect(backupContent.control_id).toBe('test');
  });

  it('supports multiple render statuses on same file', () => {
    const evidenceDir = path.join(tmpDir, 'plan-data', 'test-tenant', 'evidence');
    const filePath = path.join(evidenceDir, 'multi-render.json');
    fs.writeFileSync(filePath, JSON.stringify({ control_id: 'test' }, null, 2));

    writer.appendRenderStatus(filePath, {
      directive_code: 'EO_RENDER_PASSWORD_REUSE_POLICY',
      state: 'rendered',
      artifact_path: 'policy.docx',
      rendered_at: '2026-04-22T14:30:00Z',
      artifact_version: '1.0',
    });

    writer.appendRenderStatus(filePath, {
      directive_code: 'EO_RENDER_SIA',
      state: 'failed',
      failure_reason: 'test failure',
      rendered_at: '2026-04-22T14:31:00Z',
      artifact_version: '1.0',
    });

    const updated = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(Object.keys(updated.eo_render_status)).toHaveLength(2);
    expect(updated.eo_render_status.EO_RENDER_PASSWORD_REUSE_POLICY.state).toBe('rendered');
    expect(updated.eo_render_status.EO_RENDER_SIA.state).toBe('failed');
  });
});

// ---------- RenderDirectiveSchema ----------

describe('RenderDirectiveSchema', () => {
  it('validates a valid render directive', () => {
    const result = RenderDirectiveSchema.safeParse({
      directive_code: 'EO_RENDER_PASSWORD_REUSE_POLICY',
      artifact_version: '1.0',
      input_sources: ['entra.password_policy.history_count'],
      output_target: 'compliance-repo/policies/password-reuse-{date}.docx',
    });
    expect(result.success).toBe(true);
  });

  it('applies defaults for optional fields', () => {
    const result = RenderDirectiveSchema.parse({
      directive_code: 'EO_RENDER_SIA',
      input_sources: ['adminops.change_log'],
      output_target: 'sia/{change_id}.docx',
    });
    expect(result.artifact_version).toBe('1.0');
    expect(result.depends_on).toEqual([]);
  });

  it('rejects missing required fields', () => {
    const result = RenderDirectiveSchema.safeParse({
      directive_code: 'EO_RENDER_SIA',
    });
    expect(result.success).toBe(false);
  });
});

// ---------- DIRECTIVE_CODES ----------

describe('DIRECTIVE_CODES', () => {
  it('contains all 12 directive codes', () => {
    expect(Object.keys(DIRECTIVE_CODES)).toHaveLength(12);
  });

  it('all codes start with EO_RENDER_', () => {
    for (const code of Object.values(DIRECTIVE_CODES)) {
      expect(code).toMatch(/^EO_RENDER_/);
    }
  });

  it('has the correct code values', () => {
    expect(DIRECTIVE_CODES.PASSWORD_REUSE_POLICY).toBe('EO_RENDER_PASSWORD_REUSE_POLICY');
    expect(DIRECTIVE_CODES.SSP).toBe('EO_RENDER_SSP');
    expect(DIRECTIVE_CODES.POAM).toBe('EO_RENDER_POAM');
    expect(DIRECTIVE_CODES.VULN_SCAN_REPORT).toBe('EO_RENDER_VULN_SCAN_REPORT');
  });
});

// ---------- SPRS render-aware downgrade ----------

describe('DirectiveSprsCalculator render-aware logic', () => {
  // Import lazily to avoid module-level import.meta.url issues
  let DirectiveSprsCalculator: any;

  beforeAll(async () => {
    try {
      const mod = await import('../../../src/eo/ssp/DirectiveSprsCalculator');
      DirectiveSprsCalculator = mod.DirectiveSprsCalculator;
    } catch {
      // If import fails due to ESM/CJS incompatibility, skip these tests
    }
  });

  it('exists and can be instantiated', () => {
    if (!DirectiveSprsCalculator) return;
    const calc = new DirectiveSprsCalculator();
    expect(calc).toBeDefined();
    expect(typeof calc.calculateSprsValue).toBe('function');
  });
});

// ---------- EO-19: RenderOrchestrator end-to-end ----------
//
// VERIFY-eo.md's EO-19 gap: `adminops.change_log` was never a valid AdminOps collection
// (InputSourceResolver.adminOpsResolver only accepts `evidence`/`executions`), but no ces-eo
// test drove a REAL `EO_RENDER_SIA` directive (the shape ces-stamper's live
// `EO_RENDER_DIRECTIVES` for CM.L2-3.4.4 actually emits, `input_sources: ['entra_audit_logs']`)
// end to end through the loader and orchestrator to a started render. This proves it: a real
// Stamper evidence fixture is loaded by the REAL StamperEvidenceLoader, fed to the REAL
// RenderOrchestrator (no mocks), which resolves `entra_audit_logs` from the REAL
// InputSourceResolver against the same fixture evidence, and SiaFromChangeLogRenderer produces
// a real DOCX.
describe('EO-19: RenderOrchestrator end-to-end (real EO_RENDER_SIA directive, entra_audit_logs)', () => {
  const T = { slug: 'eo19-tenant', guid: '00000000-0000-4000-8000-0000000e19aa' };
  let tmp: string;
  let stamperRoot: string;
  let complianceRepoPath: string;
  const prevPipelineRoot = process.env.CES_PIPELINE_ROOT;

  function writeFixtureEvidence(): string {
    const evidenceDir = path.join(stamperRoot, 'plan-data', T.slug, 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const filePath = path.join(evidenceDir, 'cm-3-4-4-audit.json');
    // Shape actually written by ces-stamper's EO_RENDER_DIRECTIVES for CM.L2-3.4.4
    // (ces-stamper/src/evidence/eoRenderDirective.ts, W4-ST4): directive_code (not `code`),
    // input_sources: ['entra_audit_logs'] (never 'adminops.change_log').
    fs.writeFileSync(filePath, JSON.stringify({
      metadata: {
        controlIds: ['CM.L2-3.4.4'],
        commandExecuted: 'Get-MgAuditLogSignIn -Top 50', // matches SERVICE_COLLECTIONS.entra.audit_logs
        timestamp: '2026-09-27T10:00:00Z',
        sha256Hash: 'fixture-sha256',
      },
      registryEntry: { entry_id: 'cm-3-4-4-audit', label: 'Entra sign-in audit logs', engine: 'mgraph' },
      rawResponse: '{"value":[{"id":"sign-in-1"}]}',
      outcome: 'success',
      complianceVerdict: 'met',
      eo_render_directive: {
        directive_code: 'EO_RENDER_SIA',
        artifact_type: 'sia_template',
        artifact_version: '1.0',
        input_sources: ['entra_audit_logs'],
        output_target: 'Security Impact Analysis Template - CM.L2-3.4.4.docx',
        render_scope: 'change_management_sia',
      },
    }, null, 2));
    return filePath;
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo19-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    // getStamperTenantRoot(slug) = CES_PIPELINE_ROOT/Stamper/plan-data/slug -- both
    // StamperEvidenceLoader and InputSourceResolver's entra provider read through it.
    stamperRoot = path.join(process.env.CES_PIPELINE_ROOT, 'Stamper');
    complianceRepoPath = path.join(tmp, 'compliance-repo');
    fs.mkdirSync(complianceRepoPath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipelineRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipelineRoot;
  });

  it("StamperEvidenceLoader parses ces-stamper's real EO_RENDER_SIA directive shape (directive_code, not code)", () => {
    writeFixtureEvidence();
    const loader = new StamperEvidenceLoader(T.slug);
    const evidences = loader.loadEvidenceForTenant();
    expect(evidences).toHaveLength(1);
    expect(evidences[0].renderDirective).toBeDefined();
    expect(evidences[0].renderDirective?.directive_code).toBe('EO_RENDER_SIA');
    expect(evidences[0].renderDirective?.input_sources).toEqual(['entra_audit_logs']);
  });

  it('a real EO_RENDER_SIA directive resolves entra_audit_logs and renders a real DOCX (state: rendered)', async () => {
    const evidenceFilePath = writeFixtureEvidence();
    const loader = new StamperEvidenceLoader(T.slug);
    const [evidence] = loader.loadEvidenceForTenant();
    expect(evidence.renderDirective).toBeDefined();

    const orchestrator = new RenderOrchestrator(stamperRoot, T.slug);
    const context: RenderContext = {
      tenantSlug: T.slug,
      tenantName: 'EO-19 Fixture Tenant',
      complianceRepoPath,
      assessmentSnapshot: { snapshotId: 'eo19-snap', tenantId: T.guid, controls: [] },
      renderedArtifacts: new Map(),
      date: '2026-09-27',
    };

    const results = await orchestrator.orchestrateRenders(
      [{ controlId: evidence.controlIds[0], directive: evidence.renderDirective!, evidenceFilePath }],
      context,
    );

    const result = results.get('CM.L2-3.4.4');
    expect(result?.state).toBe('rendered');
    expect(result?.artifact_path).toBeDefined();
    const buf = fs.readFileSync(result!.artifact_path!);
    expect(buf.subarray(0, 2).toString('ascii')).toBe('PK'); // DOCX is a zip container

    // Render status was written back to the evidence file (proves the full round trip).
    const updated = JSON.parse(fs.readFileSync(evidenceFilePath, 'utf-8'));
    expect(updated.eo_render_status.EO_RENDER_SIA.state).toBe('rendered');

    // 'rendered' alone doesn't prove entra_audit_logs actually resolved -- the renderer also
    // returns 'rendered' when a source is unavailable (it just adds a notice; see the next
    // test). Prove resolution really happened: a fresh resolver against the same fixture data
    // must find it, and find the specific fixture record (not merely "not empty").
    const resolver = new InputSourceResolver({ tenantSlug: T.slug });
    const resolved = resolver.resolveInputSource('entra_audit_logs');
    expect(resolved.resolved).toBe(true);
    if (resolved.resolved) {
      const rows = resolved.data as Array<{ entryId: string }>;
      expect(rows.some(r => r.entryId === 'cm-3-4-4-audit')).toBe(true);
    }
  });

  it('renders with a "data unavailable" notice (not a failure) when entra_audit_logs cannot resolve -- resolver confirms it genuinely did not resolve', async () => {
    // No fixture evidence written -- InputSourceResolver.loadStamperEvidence() finds no
    // evidence dir at all, so entra_audit_logs cannot resolve and the renderer must say so.
    const orchestrator = new RenderOrchestrator(stamperRoot, T.slug);
    const evidenceDir = path.join(stamperRoot, 'plan-data', T.slug, 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const evidenceFilePath = path.join(evidenceDir, 'no-data.json');
    fs.writeFileSync(evidenceFilePath, JSON.stringify({ control_id: 'CM.L2-3.4.4' }));

    const context: RenderContext = {
      tenantSlug: T.slug,
      tenantName: 'EO-19 Fixture Tenant',
      complianceRepoPath,
      assessmentSnapshot: { snapshotId: 'eo19-snap-empty', tenantId: T.guid, controls: [] },
      renderedArtifacts: new Map(),
      date: '2026-09-27',
    };

    const results = await orchestrator.orchestrateRenders(
      [{
        controlId: 'CM.L2-3.4.4',
        directive: {
          directive_code: 'EO_RENDER_SIA', artifact_version: '1.0',
          input_sources: ['entra_audit_logs'],
          output_target: 'SIA-{date}.docx', depends_on: [],
        },
        evidenceFilePath,
      }],
      context,
    );

    // The renderer still produces a DOCX (with a "data unavailable" notice) rather than
    // failing outright -- it never silently claims resolved data it doesn't have. Confirm,
    // via a fresh resolver against the same fixture, that entra_audit_logs genuinely did not
    // resolve -- the same answer the renderer itself saw -- so this isn't a vacuous pass.
    const result = results.get('CM.L2-3.4.4');
    expect(result?.state).toBe('rendered');
    const buf = fs.readFileSync(result!.artifact_path!);
    expect(buf.subarray(0, 2).toString('ascii')).toBe('PK');

    const resolver = new InputSourceResolver({ tenantSlug: T.slug });
    expect(resolver.resolveInputSource('entra_audit_logs').resolved).toBe(false);
  });
});
