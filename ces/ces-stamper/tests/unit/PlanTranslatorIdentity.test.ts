// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { PlanTranslator } from '../../src/translators/PlanTranslator';
import { ManifestReader } from '../../src/translators/ManifestReader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * G1/T2 identity propagation: assert the mission plan's `ces` envelope identity
 * (cesId, customerId, siBaselineId, customerName) survives Zod parse and is
 * carried onto the translated ExecutablePlan as `plan.ces`. Backward-compat:
 * a plan without identity fields still translates without throwing.
 */
describe('PlanTranslator — CES identity propagation (G1/T2)', () => {
  const fixturesDir = path.join(__dirname, '..', 'fixtures');
  const missionPlanPath = path.join(fixturesDir, 'synthetic-mission-plan.json');
  const tenantManifestPath = path.join(fixturesDir, 'synthetic-tenant-manifest.json');

  const baseMissionPlan = (): any =>
    JSON.parse(fs.readFileSync(missionPlanPath, 'utf-8'));

  it('propagates cesId and customerName from the mission plan ces envelope', () => {
    const missionPlan = baseMissionPlan();
    missionPlan.ces.cesId = 'ces-abc-123';
    missionPlan.ces.customerId = 42;
    missionPlan.ces.siBaselineId = 7;
    missionPlan.ces.customerName = 'Acme Defense Co';

    const manifest = ManifestReader.fromFile(tenantManifestPath);
    const translator = new PlanTranslator();

    const result = translator.translate(missionPlan, manifest);

    expect(result.plan.ces).toBeDefined();
    expect(result.plan.ces?.cesId).toBe('ces-abc-123');
    expect(result.plan.ces?.customerId).toBe(42);
    expect(result.plan.ces?.siBaselineId).toBe(7);
    expect(result.plan.ces?.customerName).toBe('Acme Defense Co');
  });

  it('includes tenantSlug from ClientConfig when available', () => {
    const missionPlan = baseMissionPlan();
    missionPlan.ces.cesId = 'ces-with-slug';

    const manifest = ManifestReader.fromFile(tenantManifestPath);
    // Minimal ClientConfig stub — only tenantSlug is read by buildCesIdentity.
    const clientConfig = { tenantSlug: 'acme-gov' } as any;
    const translator = new PlanTranslator(undefined, clientConfig);

    const result = translator.translate(missionPlan, manifest);

    expect(result.plan.ces?.cesId).toBe('ces-with-slug');
    expect(result.plan.ces?.tenantSlug).toBe('acme-gov');
  });

  it('backward-compat: a plan without identity fields still translates', () => {
    const missionPlan = baseMissionPlan();
    // Ensure no identity fields are present on the envelope.
    delete missionPlan.ces.cesId;
    delete missionPlan.ces.customerId;
    delete missionPlan.ces.siBaselineId;
    delete missionPlan.ces.customerName;

    const manifest = ManifestReader.fromFile(tenantManifestPath);
    const translator = new PlanTranslator();

    let result: ReturnType<typeof translator.translate> | undefined;
    expect(() => {
      result = translator.translate(missionPlan, manifest);
    }).not.toThrow();

    // plan_id is still produced; ces is omitted (no identity, no tenantSlug).
    expect(result!.plan.plan_id).toContain('translated-');
    expect(result!.plan.ces).toBeUndefined();
  });

  it('directive path also carries the ces identity block', () => {
    const missionPlan = baseMissionPlan();
    missionPlan.ces.cesId = 'ces-directive-001';
    missionPlan.ces.customerName = 'Directive Customer';

    // Force directive-mode by attaching control_directives to the human plan.
    const humanPlan = missionPlan.outputs.human_readable_mission_plan;
    humanPlan.control_directives = [
      { control_id: 'AC.L2-3.1.1', directive: 'manual' },
    ];

    const manifest = ManifestReader.fromFile(tenantManifestPath);
    const translator = new PlanTranslator();

    const result = translator.translate(missionPlan, manifest);

    expect(result.plan.variables._source).toBe('translated-from-control-directives');
    expect(result.plan.ces?.cesId).toBe('ces-directive-001');
    expect(result.plan.ces?.customerName).toBe('Directive Customer');
  });
});
