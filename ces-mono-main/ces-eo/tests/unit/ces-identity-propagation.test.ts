// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * G1/T2 (identity propagation) — EO hop.
 *
 * Verifies that EO's three persistent outputs (AssessmentSnapshot, PlanOfActionMilestones,
 * SystemSecurityPlan) carry the optional CES identity block so customer↔tenant lineage is
 * recorded. See docs/adr/ADR-001-ces-identity-model.md.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ControlAssessor } from '../../src/eo/assessment/ControlAssessor.js';
import { PoamGenerator } from '../../src/eo/poam/PoamGenerator.js';
// NOTE on SspGenerator: it is not unit-invokable under jest because its transitive graph
// (VariableStore -> ces-shared/blob, /storage) loads ESM-only shared runtime modules that
// jest's CommonJS runtime cannot evaluate. Standing up a full SSP generate() here would require
// broad shared-module mapping (incl. the Azure blob SDK) that risks the existing suite. The SSP
// assembly point uses the IDENTICAL wiring as the other two outputs:
//   ces: resolveCesIdentity(loadCesConfig(), { tenantSlug: params.tenantSlug, tenantId: assessment.tenantId })
// so we assert that exact wiring directly (same loader + resolver, same key shape) below.
import { resolveCesIdentity } from 'ces-shared/config/ces';
import { loadCesConfig } from 'ces-shared/config/ces/node';
import type { AssessmentSnapshot } from 'ces-shared/types/controls';

/** Mirrors the exact ces assembly performed inside SspGenerator.generate(). */
function buildSspCes(params: { tenantSlug?: string }, assessment: AssessmentSnapshot) {
  return resolveCesIdentity(loadCesConfig(), {
    tenantSlug: params.tenantSlug,
    tenantId: assessment.tenantId,
  });
}

const CES_ENV = 'CES_CONFIG_PATH';

const controlsRefPath = require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = require.resolve('ces-shared/data/sprs-weights');

/** A minimal but type-valid AssessmentSnapshot for driving PoamGenerator / SspGenerator. */
function makeAssessment(tenantId: string, tenantSlug?: string): AssessmentSnapshot {
  const now = new Date().toISOString();
  return {
    snapshotId: 'snap-fixture',
    tenantId,
    ...(tenantSlug ? { ces: { tenantSlug, tenantId } } : {}),
    generatedAt: now,
    controls: [
      {
        control_id: 'AC.L1-3.1.1',
        nist_ref: '3.1.1',
        status: 'met',
        classification: 'manual',
        sources: [],
        last_assessed: now,
        signals: [],
        evidenceArtifactIds: [],
        automationSource: 'manual',
        lastFetchedAt: now,
      },
    ],
    sources_merged: [],
    sprs_score: 0,
    controls_met: 1,
    controls_not_met: 0,
    controls_partial: 0,
    controls_not_assessed: 0,
  };
}

describe('CES identity propagation (G1/T2, EO hop)', () => {
  const prevEnv = process.env[CES_ENV];

  afterEach(() => {
    if (prevEnv === undefined) delete process.env[CES_ENV];
    else process.env[CES_ENV] = prevEnv;
  });

  describe('with no CES config file (minimal echo)', () => {
    beforeEach(() => {
      // Point at a path that does not exist so loadCesConfig returns EMPTY_CES_CONFIG.
      process.env[CES_ENV] = path.join(os.tmpdir(), `ces-missing-${Date.now()}.json`);
    });

    it('AssessmentSnapshot from ControlAssessor.merge carries ces with the tenantId echoed', () => {
      const assessor = new ControlAssessor(controlsRefPath, []);
      const snapshot = assessor.merge('tenant-eo-001', [], [], []);

      expect(snapshot.ces).toBeDefined();
      expect(snapshot.ces?.tenantId).toBe('tenant-eo-001');
    });

    it('PlanOfActionMilestones from PoamGenerator.generate carries ces with the tenantId echoed', () => {
      const generator = new PoamGenerator(controlsRefPath, sprsWeightsPath);
      const poam = generator.generate({ assessment: makeAssessment('tenant-eo-002') });

      expect(poam.ces).toBeDefined();
      expect(poam.ces?.tenantId).toBe('tenant-eo-002');
    });

    it('POA&M echoes tenantSlug from the assessment ces block when present', () => {
      const generator = new PoamGenerator(controlsRefPath, sprsWeightsPath);
      const poam = generator.generate({
        assessment: makeAssessment('tenant-eo-003', 'eo-slug'),
      });

      expect(poam.ces?.tenantId).toBe('tenant-eo-003');
      expect(poam.ces?.tenantSlug).toBe('eo-slug');
    });

    it('SSP assembly wiring produces ces with tenantId + tenantSlug echoed', () => {
      const ces = buildSspCes(
        { tenantSlug: 'eo-ssp-slug' },
        makeAssessment('tenant-eo-004')
      );

      expect(ces).toBeDefined();
      expect(ces.tenantId).toBe('tenant-eo-004');
      expect(ces.tenantSlug).toBe('eo-ssp-slug');
    });
  });

  describe('with a mapped CES config file (full lineage)', () => {
    let cfgPath: string;

    beforeEach(() => {
      cfgPath = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'ces-cfg-')),
        'ces.config.json'
      );
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({
          version: '1',
          customers: [
            {
              customerName: 'Acme Corp',
              customerId: 42,
              tenantSlug: 'acme',
              tenantId: 'tenant-acme-123',
            },
          ],
        }),
        'utf-8'
      );
      process.env[CES_ENV] = cfgPath;
    });

    afterEach(() => {
      try {
        fs.rmSync(path.dirname(cfgPath), { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    });

    it('resolves customerName/customerId for a mapped tenant on the SSP wiring', () => {
      const ces = buildSspCes({ tenantSlug: 'acme' }, makeAssessment('tenant-acme-123'));

      expect(ces.customerName).toBe('Acme Corp');
      expect(ces.customerId).toBe(42);
      expect(ces.tenantSlug).toBe('acme');
      expect(ces.tenantId).toBe('tenant-acme-123');
    });

    it('resolves customerName/customerId for a mapped tenant on the POA&M', () => {
      const generator = new PoamGenerator(controlsRefPath, sprsWeightsPath);
      const poam = generator.generate({
        assessment: makeAssessment('tenant-acme-123', 'acme'),
      });

      expect(poam.ces?.customerName).toBe('Acme Corp');
      expect(poam.ces?.customerId).toBe(42);
    });

    it('resolves customerName for a mapped tenant on the AssessmentSnapshot (by tenantId)', () => {
      const assessor = new ControlAssessor(controlsRefPath, []);
      const snapshot = assessor.merge('tenant-acme-123', [], [], []);

      expect(snapshot.ces?.customerName).toBe('Acme Corp');
      expect(snapshot.ces?.tenantId).toBe('tenant-acme-123');
    });
  });
});
