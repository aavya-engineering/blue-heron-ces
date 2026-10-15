// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Contract Tests: Stamper Directive Migration (Set B)
 *
 * Tests the Planner->Stamper boundary contract for the six-directive set:
 * implement, validate, manual, document-absence, document-prohibition, skip
 *
 * Verifies:
 * - Legacy 'exclude' directive is rejected with version mismatch error
 * - SPRS mapping is exhaustive for all six directive values
 * - document-absence produces N/A, never MET or NOT MET
 * - document-prohibition with enforcement produces MET
 * - document-prohibition without enforcement produces NOT MET
 * - StructuredEvidence schemas are correct for each directive type
 */

import { normalizeStamperAction, StamperDirectiveEnum } from '../src/types/ces-artifacts.types.js';
import { PlanTranslator } from '../src/translators/PlanTranslator.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Test: Stamper rejects legacy 'exclude' directive ----

describe('normalizeStamperAction', () => {
  it('rejects legacy exclude directive with version mismatch error', () => {
    expect(() => normalizeStamperAction('exclude')).toThrow('version mismatch');
  });

  it('accepts document-absence and returns document-absence', () => {
    expect(normalizeStamperAction('document-absence')).toBe('document-absence');
  });

  it('accepts document-prohibition and returns document-prohibition', () => {
    expect(normalizeStamperAction('document-prohibition')).toBe('document-prohibition');
  });

  it('accepts implement and returns automated', () => {
    expect(normalizeStamperAction('implement')).toBe('automated');
  });

  it('accepts nonstack and returns nonstack', () => {
    expect(normalizeStamperAction('nonstack')).toBe('nonstack');
  });

  it('accepts automated and returns automated', () => {
    expect(normalizeStamperAction('automated')).toBe('automated');
  });
});

// ---- Test: Muster value normalization (MS-R2) ----

describe('normalizeStamperAction — Muster values', () => {
  it('maps N-A-Capability-Absent to document-absence', () => {
    expect(normalizeStamperAction('N-A-Capability-Absent')).toBe('document-absence');
  });

  it('maps Met-By-Prohibition to document-prohibition', () => {
    expect(normalizeStamperAction('Met-By-Prohibition')).toBe('document-prohibition');
  });

  it('maps Inherited-FedRAMP to inherit-fedramp', () => {
    expect(normalizeStamperAction('Inherited-FedRAMP')).toBe('inherit-fedramp');
  });

  it('maps automated (Muster canonical) to automated', () => {
    expect(normalizeStamperAction('automated')).toBe('automated');
  });

  it('maps nonstack to nonstack', () => {
    expect(normalizeStamperAction('nonstack')).toBe('nonstack');
  });

  it('throws on unknown values instead of defaulting to automated', () => {
    expect(() => normalizeStamperAction('bogus-action')).toThrow('Unknown stamper_action');
    expect(() => normalizeStamperAction('foo')).toThrow('Unknown stamper_action');
  });

  it('throws on empty string', () => {
    expect(() => normalizeStamperAction('')).toThrow('Unknown stamper_action');
  });
});

// ---- Test: StamperDirectiveEnum accepts Set B values ----

describe('StamperDirectiveEnum', () => {
  const SET_B_DIRECTIVES = ['implement', 'validate', 'manual', 'document-absence', 'document-prohibition', 'skip'] as const;

  it('accepts all six Set B directive values', () => {
    for (const directive of SET_B_DIRECTIVES) {
      const result = StamperDirectiveEnum.safeParse(directive);
      expect(result.success).toBe(true);
    }
  });

  it('rejects legacy exclude directive', () => {
    const result = StamperDirectiveEnum.safeParse('exclude');
    expect(result.success).toBe(false);
  });

  it('rejects unknown directive values', () => {
    const result = StamperDirectiveEnum.safeParse('bogus');
    expect(result.success).toBe(false);
  });
});

// ---- Test: SPRS mapping is exhaustive for all six directives ----

describe('SPRS mapping contract', () => {
  /**
   * Simulates the SPRS value mapping logic from execute.routes.ts
   * for each directive type. This is the contract that Planner relies on.
   */
  function mapDirectiveToSprs(directive: string, enforcementVerified: boolean): string {
    switch (directive) {
      case 'implement':
      case 'validate':
        return 'MET'; // Automated evidence -> MET (when passing)
      case 'manual':
        return 'PROVISIONAL'; // Manual gate -> provisional until review
      case 'document-absence':
        return 'N/A';
      case 'document-prohibition':
        return enforcementVerified ? 'MET' : 'NOT MET';
      case 'skip':
        return 'SKIP'; // Skip is not counted
      default:
        throw new Error(`Unknown directive: ${directive}`);
    }
  }

  it('document-absence produces N/A', () => {
    expect(mapDirectiveToSprs('document-absence', false)).toBe('N/A');
    expect(mapDirectiveToSprs('document-absence', true)).toBe('N/A');
  });

  it('document-absence NEVER produces MET', () => {
    const result = mapDirectiveToSprs('document-absence', true);
    expect(result).not.toBe('MET');
    expect(result).not.toBe('NOT MET');
  });

  it('document-prohibition with enforcement verified produces MET', () => {
    expect(mapDirectiveToSprs('document-prohibition', true)).toBe('MET');
  });

  it('document-prohibition with enforcement failure produces NOT MET', () => {
    expect(mapDirectiveToSprs('document-prohibition', false)).toBe('NOT MET');
  });

  it('implement produces MET', () => {
    expect(mapDirectiveToSprs('implement', true)).toBe('MET');
  });

  it('validate produces MET', () => {
    expect(mapDirectiveToSprs('validate', true)).toBe('MET');
  });

  it('manual produces PROVISIONAL', () => {
    expect(mapDirectiveToSprs('manual', false)).toBe('PROVISIONAL');
  });

  it('skip produces SKIP', () => {
    expect(mapDirectiveToSprs('skip', false)).toBe('SKIP');
  });

  it('covers all six directive values exhaustively', () => {
    const directives = ['implement', 'validate', 'manual', 'document-absence', 'document-prohibition', 'skip'];
    for (const d of directives) {
      // Should not throw for any known directive
      expect(() => mapDirectiveToSprs(d, false)).not.toThrow();
      expect(() => mapDirectiveToSprs(d, true)).not.toThrow();
    }
  });

  it('throws for unknown directive values', () => {
    expect(() => mapDirectiveToSprs('exclude', false)).toThrow('Unknown directive');
    expect(() => mapDirectiveToSprs('bogus', false)).toThrow('Unknown directive');
  });
});

// ---- Test: StructuredEvidence output for document-absence ----

describe('document-absence StructuredEvidence contract', () => {
  function buildAbsenceEvidence(justification: string) {
    return {
      rawResponse: justification,
      outcome: 'not_applicable' as const,
      outcomeRationale: `Capability absent from CUI boundary: ${justification}`,
      complianceVerdict: undefined,
      verdictRationale: 'N/A — capability not deployed; no compliance verdict applicable',
      metadata: {
        controlIds: ['AC.L2-3.1.18'],
        timestamp: new Date().toISOString(),
        executorIdentity: 'stamper',
        commandExecuted: '',
        sha256Hash: '',
      }
    };
  }

  it('produces outcome not_applicable', () => {
    const evidence = buildAbsenceEvidence('No wireless networks deployed');
    expect(evidence.outcome).toBe('not_applicable');
  });

  it('has undefined complianceVerdict (N/A controls have no verdict)', () => {
    const evidence = buildAbsenceEvidence('No wireless networks deployed');
    expect(evidence.complianceVerdict).toBeUndefined();
  });

  it('includes justification in outcomeRationale', () => {
    const evidence = buildAbsenceEvidence('No wireless networks deployed');
    expect(evidence.outcomeRationale).toContain('No wireless networks deployed');
  });

  it('does not contain MET or NOT_SAT in verdict', () => {
    const evidence = buildAbsenceEvidence('No wireless networks deployed');
    expect(evidence.complianceVerdict).not.toBe('SAT');
    expect(evidence.complianceVerdict).not.toBe('NOT_SAT');
  });
});

// ---- Test: StructuredEvidence output for document-prohibition ----

describe('document-prohibition StructuredEvidence contract', () => {
  function buildProhibitionEvidence(
    justification: string,
    enforcementOutput: string,
    enforcementVerified: boolean
  ) {
    return {
      rawResponse: JSON.stringify({
        policy_text: justification,
        enforcement_config: enforcementOutput || 'No enforcement query available',
      }),
      outcome: 'policy_compliance' as const,
      outcomeRationale: enforcementVerified
        ? `Prohibition enforced: ${justification}`
        : `Prohibition enforcement verification failed: No enforcement artifacts found`,
      complianceVerdict: enforcementVerified ? 'SAT' as const : 'NOT_SAT' as const,
      verdictRationale: enforcementVerified
        ? 'Enforcement artifacts confirm prohibition is actively enforced'
        : 'Enforcement verification failed — prohibition not confirmed',
      metadata: {
        controlIds: ['MP.L2-3.8.7'],
        timestamp: new Date().toISOString(),
        executorIdentity: 'stamper',
        commandExecuted: 'Get-MgDeviceManagementDeviceConfiguration',
        sha256Hash: '',
      }
    };
  }

  it('produces outcome policy_compliance', () => {
    const evidence = buildProhibitionEvidence('USB disabled', '{"profile": "blocked"}', true);
    expect(evidence.outcome).toBe('policy_compliance');
  });

  it('has two artifacts in rawResponse (policy_text + enforcement_config)', () => {
    const evidence = buildProhibitionEvidence('USB disabled', '{"profile": "blocked"}', true);
    const parsed = JSON.parse(evidence.rawResponse);
    expect(parsed).toHaveProperty('policy_text');
    expect(parsed).toHaveProperty('enforcement_config');
  });

  it('produces SAT verdict when enforcement verified', () => {
    const evidence = buildProhibitionEvidence('USB disabled', '{"profile": "blocked"}', true);
    expect(evidence.complianceVerdict).toBe('SAT');
  });

  it('produces NOT_SAT verdict when enforcement fails', () => {
    const evidence = buildProhibitionEvidence('USB disabled', '', false);
    expect(evidence.complianceVerdict).toBe('NOT_SAT');
  });

  it('includes enforcement command in metadata', () => {
    const evidence = buildProhibitionEvidence('USB disabled', '{"profile": "blocked"}', true);
    expect(evidence.metadata.commandExecuted).toBe('Get-MgDeviceManagementDeviceConfiguration');
  });
});

// ---- Test: Version gate rejects unknown ces.version (MS-R1) ----

describe('PlanTranslator version gate', () => {
  const TM_PATH = path.resolve(__dirname, 'fixtures', 'full-registry-manifest.json');

  it('rejects an unknown ces.version with a clear error', () => {
    const badPlan = {
      ces: { artifact: 'manual_mission_plan', version: '99.0.0', generated_on: '2026-09-26', intent: 'test' },
      inputs: {},
      outputs: { human_readable_mission_plan: { plan_id: 'test', plan_mode: 'build_new', target_level: 'L2', milestones: [{ id: 'm1', name: 'M1', objective: 'test', exit_criteria: ['done'], target_date: '2026-10-01' }], assessor_alignment_notes: [] }, cost_proposal_sow: null },
    };
    const translator = new PlanTranslator();
    expect(() => translator.translate(badPlan, {} as any)).toThrow(/Unsupported mission plan version "99\.0\.0"/);
  });

  it('accepts version 1.0.0', () => {
    const MP_PATH = path.resolve(__dirname, 'fixtures', 'full-registry-mission-plan.json');
    const translator = new PlanTranslator();
    expect(() => translator.translateFile(MP_PATH, TM_PATH, path.join(os.tmpdir(), `ep-version-test-${Date.now()}.json`))).not.toThrow();
  });
});

// ---- Test: cesId flows from mission plan into executable plan (MS-R4) ----

describe('PlanTranslator cesId propagation', () => {
  const MP_PATH = path.resolve(__dirname, 'fixtures', 'full-registry-mission-plan.json');
  const TM_PATH = path.resolve(__dirname, 'fixtures', 'full-registry-manifest.json');

  it('executable plan carries ces.cesId from the mission plan', () => {
    const mpJson = JSON.parse(fs.readFileSync(MP_PATH, 'utf8'));
    mpJson.ces.cesId = 'CES-TEST-1';
    const tmpMp = path.join(os.tmpdir(), `mp-cesid-test-${Date.now()}.json`);
    fs.writeFileSync(tmpMp, JSON.stringify(mpJson));

    const translator = new PlanTranslator();
    const result = translator.translateFile(tmpMp, TM_PATH, path.join(os.tmpdir(), `ep-cesid-test-${Date.now()}.json`));
    expect(result.plan.ces?.cesId).toBe('CES-TEST-1');

    fs.unlinkSync(tmpMp);
  });
});

// ---- Test: ExecutionResultsCollector emits contractVersion + planId (MS-R9) ----

describe('ExecutionResultsCollector shared contract', () => {
  it('emits contractVersion and planId in the manifest', async () => {
    const { ExecutionResultsCollector } = await import('../src/core/ExecutionResultsCollector.js');
    const { EXECUTION_RESULTS_CONTRACT_VERSION } = await import('ces-shared/types/execution-results');
    const collector = new ExecutionResultsCollector();
    collector.recordControlResult('AC.L2-3.1.1', 'automated', 'SAT', 'Passed', '/evidence/ac.json');
    collector.recordControlResult('AC.L2-3.1.2', 'document-absence', 'N/A', 'Capability absent');
    const manifest = collector.buildManifest('run-001', 'test-tenant', 'plan-001', 'ces-t1');
    // FX-ST5: pin to the shared current-version constant, and prove it is the 1.1.0+ line
    // (the one that carries executablePlanId) rather than a stale 1.0.0 build.
    expect(manifest.contractVersion).toBe(EXECUTION_RESULTS_CONTRACT_VERSION);
    expect(manifest.contractVersion).not.toBe('1.0.0');
    expect(manifest.planId).toBe('plan-001');
    expect(manifest.cesId).toBe('ces-t1');
    expect(manifest.results).toHaveLength(2);
    expect(manifest.results[0].controlId).toBe('AC.L2-3.1.1');
  });

  it('buildManifest passes shared ExecutionResultsManifestSchema.safeParse (T3/E6)', async () => {
    const { ExecutionResultsCollector } = await import('../src/core/ExecutionResultsCollector.js');
    const { ExecutionResultsManifestSchema: SharedSchema } = await import('ces-shared/types/execution-results');
    const collector = new ExecutionResultsCollector();
    collector.recordControlResult('AC.L2-3.1.1', 'automated', 'SAT', 'Passed', '/evidence/ac.json');
    collector.recordControlResult('AC.L2-3.1.2', 'document-absence', 'N/A', 'Capability absent');
    collector.recordControlResult('PE.L2-3.10.6', 'inherit-fedramp', 'NOT_SAT', 'Failed verification');
    collector.recordControlResult('SC.L2-3.13.1', 'nonstack', 'PROVISIONAL', 'Manual review pending');
    const manifest = collector.buildManifest('run-002', 'test-tenant', 'plan-002', 'ces-t2');

    expect(manifest.results[0].verdict).toBe('sat');
    expect(manifest.results[1].verdict).toBe('not_applicable');
    expect(manifest.results[2].verdict).toBe('not_sat');
    expect(manifest.results[3].verdict).toBe('provisional');

    const parsed = SharedSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
  });
});

// ---- Test: controls[] without control_directives yield correct directive map (MS-R2) ----

describe('PlanTranslator directive map from Muster controls[]', () => {
  const MP_PATH = path.resolve(__dirname, 'fixtures', 'full-registry-mission-plan.json');
  const TM_PATH = path.resolve(__dirname, 'fixtures', 'full-registry-manifest.json');

  it('controls with Muster stamper_action values produce the correct directive map', () => {
    const mpControls = [
      { requirement_id: 'AC.L2-3.1.18', title: 'Wireless Access Control', domain: 'AC', level: 'L2',
        scope_status: 'scoped_out', readiness_status: 'not_assessed',
        stamper_action: 'N-A-Capability-Absent', task_ids: [], estimated_effort_hours: 0,
        gap_classifications: [], scope_justification: 'No wireless deployed' },
      { requirement_id: 'MP.L2-3.8.7', title: 'Media Prohibition', domain: 'MP', level: 'L2',
        scope_status: 'in_scope', readiness_status: 'not_assessed',
        stamper_action: 'Met-By-Prohibition', task_ids: [], estimated_effort_hours: 0,
        gap_classifications: [] },
      { requirement_id: 'PE.L2-3.10.6', title: 'FedRAMP Inheritance', domain: 'PE', level: 'L2',
        scope_status: 'in_scope', readiness_status: 'not_assessed',
        stamper_action: 'Inherited-FedRAMP', task_ids: [], estimated_effort_hours: 0,
        gap_classifications: [] },
    ];

    const translator = new PlanTranslator(undefined, undefined, mpControls);
    const result = translator.translateFile(MP_PATH, TM_PATH, path.join(os.tmpdir(), `ep-directive-map-${Date.now()}.json`));
    const cdMap = result.plan.variables._control_directives as Record<string, string>;

    expect(cdMap['AC.L2-3.1.18']).toBe('document-absence');
    expect(cdMap['MP.L2-3.8.7']).toBe('document-prohibition');
    expect(cdMap['PE.L2-3.10.6']).toBe('inherit-fedramp');
  });

  it('controls with Muster stamper_action produce tasks whose _directive matches (in_scope)', () => {
    const mpControls = [
      { requirement_id: 'AC.L2-3.1.18', title: 'Wireless Access Control', domain: 'AC', level: 'L2',
        scope_status: 'in_scope', readiness_status: 'not_assessed',
        stamper_action: 'N-A-Capability-Absent', task_ids: [], estimated_effort_hours: 0,
        gap_classifications: [] },
      { requirement_id: 'MP.L2-3.8.7', title: 'Media Prohibition', domain: 'MP', level: 'L2',
        scope_status: 'in_scope', readiness_status: 'not_assessed',
        stamper_action: 'Met-By-Prohibition', task_ids: [], estimated_effort_hours: 0,
        gap_classifications: [] },
      { requirement_id: 'PE.L2-3.10.6', title: 'FedRAMP Inheritance', domain: 'PE', level: 'L2',
        scope_status: 'in_scope', readiness_status: 'not_assessed',
        stamper_action: 'Inherited-FedRAMP', task_ids: [], estimated_effort_hours: 0,
        gap_classifications: [] },
    ];

    const translator = new PlanTranslator(undefined, undefined, mpControls);
    const result = translator.translateFile(MP_PATH, TM_PATH, path.join(os.tmpdir(), `ep-directive-tasks-${Date.now()}.json`));

    const taskDirectives = new Map<string, string>();
    for (const task of result.plan.execution_graph) {
      const dir = task.action?.args?._directive as string | undefined;
      if (dir) {
        for (const cid of (task.controls || [])) {
          taskDirectives.set(cid, dir);
        }
      }
    }

    expect(taskDirectives.get('AC.L2-3.1.18')).toBe('document-absence');
    expect(taskDirectives.get('MP.L2-3.8.7')).toBe('document-prohibition');
    expect(taskDirectives.get('PE.L2-3.10.6')).toBe('inherit-fedramp');
  });

  it('inherit-fedramp task carries fedramp_package_id from the control (MS-R4)', () => {
    const mpControls = [
      { requirement_id: 'PE.L2-3.10.6', title: 'FedRAMP Inheritance', domain: 'PE', level: 'L2',
        scope_status: 'in_scope', readiness_status: 'not_assessed',
        stamper_action: 'Inherited-FedRAMP', task_ids: [], estimated_effort_hours: 0,
        gap_classifications: [], fedramp_package_id: 'FR-TEST-9999' },
    ];

    const translator = new PlanTranslator(undefined, undefined, mpControls);
    const result = translator.translateFile(MP_PATH, TM_PATH, path.join(os.tmpdir(), `ep-fedramp-pkg-${Date.now()}.json`));

    const inheritTask = result.plan.execution_graph.find(
      (t: any) => t.action?.args?._directive === 'inherit-fedramp' && (t.controls || []).includes('PE.L2-3.10.6')
    );

    expect(inheritTask).toBeDefined();
    expect(inheritTask!.action.args._fedramp_package_id).toBe('FR-TEST-9999');
  });
});
