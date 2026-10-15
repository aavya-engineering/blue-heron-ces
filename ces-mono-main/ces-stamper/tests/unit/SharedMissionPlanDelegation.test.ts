// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// T4 (MS-R1 / N-12 / N-14): Stamper delegates mission-plan body validation to
// ces-shared. These tests prove (a) the shared schemas are the base, (b) the
// Stamper-only refinements still reject what they rejected before, (c) the
// canonical `infrastructure` key and the deprecated alias both resolve, and
// (d) a Muster fixture (read-only) translates through the shared schema.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import {
  StamperDirective as SharedStamperDirective,
  ManualMissionPlanSchema as SharedManualMissionPlanSchema,
  TenantManifestSchema as SharedTenantManifestSchema,
} from 'ces-shared/types/mission-plan';
import {
  CESManualMissionPlanSchema,
  CESTenantManifestSchema,
  CESTenantManifestBodySchema,
  CESInfrastructureManifestSchema,
  StamperDirectiveEnum,
} from '../../src/types/ces-artifacts.types';
import { PlanTranslator } from '../../src/translators/PlanTranslator';
import { ManifestReader } from '../../src/translators/ManifestReader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STAMPER_ROOT = path.resolve(__dirname, '..', '..');
const MUSTER_FIXTURES = path.resolve(STAMPER_ROOT, '..', 'ces-muster', 'src', 'features', 'plan', '__fixtures__');
const MUSTER_MMP = path.join(MUSTER_FIXTURES, 'manual-mission-plan.json');
const MUSTER_TM = path.join(MUSTER_FIXTURES, 'tenant-manifest.json');
const STAMPER_MMP = path.join(STAMPER_ROOT, 'tests', 'fixtures', 'synthetic-mission-plan.json');

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('T4 shared delegation — directives', () => {
  it('StamperDirectiveEnum is the ces-shared StamperDirective (not a fork)', () => {
    expect(StamperDirectiveEnum).toBe(SharedStamperDirective);
  });
});

describe('T4 shared delegation — Muster fixture through the shared schema', () => {
  it('Muster manual-mission-plan fixture parses with shared and Stamper schemas', () => {
    const mmp = readJson(MUSTER_MMP);
    expect(SharedManualMissionPlanSchema.safeParse(mmp).success).toBe(true);
    const r = CESManualMissionPlanSchema.safeParse(mmp);
    if (!r.success) throw new Error(JSON.stringify(r.error.issues));
    expect(r.success).toBe(true);
  });

  it('Muster tenant-manifest fixture parses with shared and Stamper schemas', () => {
    const tm = readJson(MUSTER_TM);
    expect(SharedTenantManifestSchema.safeParse(tm).success).toBe(true);
    const r = CESTenantManifestSchema.safeParse(tm);
    if (!r.success) throw new Error(JSON.stringify(r.error.issues));
    expect(r.success).toBe(true);
  });

  it('Muster MMP + TM translate end-to-end through PlanTranslator', () => {
    const mmp = readJson(MUSTER_MMP);
    const manifest = ManifestReader.fromFile(MUSTER_TM);
    const result = new PlanTranslator().translate(mmp, manifest);
    expect(result.plan).toBeDefined();
    expect(Array.isArray(result.plan.execution_graph)).toBe(true);
  });
});

describe('T4 shared delegation — Stamper-only refinements still hold', () => {
  const base = readJson(STAMPER_MMP);

  it('baseline Stamper fixture passes', () => {
    expect(CESManualMissionPlanSchema.safeParse(base).success).toBe(true);
  });

  it('rejects an empty milestones array (shared allows it)', () => {
    const p = clone(base);
    p.outputs.human_readable_mission_plan.milestones = [];
    expect(SharedManualMissionPlanSchema.safeParse(p).success).toBe(true);
    const r = CESManualMissionPlanSchema.safeParse(p);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some(i => i.path.join('.') === 'outputs.human_readable_mission_plan.milestones')).toBe(true);
    }
  });

  it('rejects a milestone with empty exit_criteria', () => {
    const p = clone(base);
    p.outputs.human_readable_mission_plan.milestones[0].exit_criteria = [];
    expect(CESManualMissionPlanSchema.safeParse(p).success).toBe(false);
  });

  it('rejects a step section outside the seven infra sections', () => {
    const p = clone(base);
    p.outputs.human_readable_mission_plan.steps[0].section = 'bogus';
    expect(SharedManualMissionPlanSchema.safeParse(p).success).toBe(true);
    const r = CESManualMissionPlanSchema.safeParse(p);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(['outputs', 'human_readable_mission_plan', 'steps', 0, 'section']);
    }
  });

  it('rejects a malformed step tech_ref', () => {
    const p = clone(base);
    p.outputs.human_readable_mission_plan.steps[0].tech_ref = { nist_mapping: 42 };
    expect(CESManualMissionPlanSchema.safeParse(p).success).toBe(false);
  });

  it('rejects an empty-string asset tag in a tenant manifest body', () => {
    const body = clone(readJson(MUSTER_TM).tenant_manifest);
    body.assets = [{ asset_id: 'a1', asset_type: 't', scope_category: 'cui', tags: [''] }];
    const r = CESTenantManifestBodySchema.safeParse(body);
    expect(r.success).toBe(false);
  });

  it('still rejects a non-canonical ces.artifact (shared literal)', () => {
    const p = clone(base);
    p.ces.artifact = 'ces-manual-mission-plan';
    expect(CESManualMissionPlanSchema.safeParse(p).success).toBe(false);
  });
});

describe('T4 shared delegation — infrastructure manifest key (N-12)', () => {
  const ces = {
    artifact: 'infrastructure_manifest',
    version: '1.0.0',
    generated_on: '2026-09-27T10:00:00.000Z',
    intent: 'test',
  };
  const body = {
    identity: [], logging: [], security: [], storage: [],
    network: [], automation: [], diagnostics: [],
    stamper_variable_map: {
      subscriptionId: 's', resourceGroup: 'rg', location: 'l',
      lawWorkspaceName: 'law', eoAppDisplayName: 'eo',
      storageAccountName: '', keyVaultName: '', cmkKeyName: '',
      vnetName: '', vnetCidr: '', subnetPeName: '', subnetPeCidr: '',
      nsgPeName: '', automationAccountName: '',
    },
    registry_coverage: { total_infra_entries: 0, covered_entry_ids: [], uncovered_entry_ids: [], coverage_pct: 0 },
    provenance: [],
    infrastructure_model: 'm365_sentinel',
  };

  it('reads the canonical infrastructure key', () => {
    const r = CESInfrastructureManifestSchema.safeParse({ ces, infrastructure: body });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.infrastructure.infrastructure_model).toBe('m365_sentinel');
  });

  it('normalizes the deprecated infrastructure_manifest alias onto infrastructure', () => {
    const r = CESInfrastructureManifestSchema.safeParse({ ces, infrastructure_manifest: body });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.infrastructure.stamper_variable_map.resourceGroup).toBe('rg');
      expect((r.data as Record<string, unknown>).infrastructure_manifest).toBeUndefined();
    }
  });

  it('rejects a date-only generated_on (Stamper requires ISO date-time)', () => {
    const r = CESInfrastructureManifestSchema.safeParse({ ces: { ...ces, generated_on: '2026-09-27' }, infrastructure: body });
    expect(r.success).toBe(false);
  });
});

describe('T4 shared delegation — no private body schemas remain', () => {
  // Field names that only appear in a body-schema definition. A private
  // re-definition in src/ would reintroduce the fork T4 removed.
  const MARKERS = [
    /manifest_id:\s*z\./,
    /stamper_variable_map:\s*[A-Za-z]*Schema|stamper_variable_map:\s*z\./,
    /what_to_do:\s*z\./,
    /normative_controls:\s*z\./,
    /control_directives:\s*z\./,
    /human_readable_mission_plan:\s*[A-Za-z]*Schema/,
  ];

  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []);

  it('src/ contains no private MMP / TM / IM / directive schema definitions', () => {
    const hits: string[] = [];
    for (const f of walk(path.join(STAMPER_ROOT, 'src'))) {
      const text = fs.readFileSync(f, 'utf-8');
      for (const m of MARKERS) if (m.test(text)) hits.push(`${path.relative(STAMPER_ROOT, f)} ~ ${m}`);
    }
    expect(hits).toEqual([]);
  });
});
