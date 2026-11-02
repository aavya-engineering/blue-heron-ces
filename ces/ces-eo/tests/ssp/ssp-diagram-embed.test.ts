// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * STEP 2 — Mermaid diagram embedding (§2.1 authorization boundary, §4 network).
 *
 * Verifies that when a DiagramRenderer is provided, SspGenerator.generate()
 * populates authorizationBoundary.diagramPath and networkTopology.diagramPath
 * from the rendered diagram paths, so SspDocxExporter embeds them inline.
 *
 * Also verifies graceful degradation: when the renderer cannot produce a PNG
 * (mmdc unavailable -> returns null), diagramPath stays undefined and the
 * existing Mermaid-code-block appendix fallback still applies.
 *
 * mmdc is NOT installed in CI, so a deterministic stub DiagramRenderer is used.
 */
import { describe, test, expect, jest, beforeAll } from '@jest/globals';

jest.mock('ces-shared/blob', () => ({
  uploadEvidenceBlob: jest.fn(),
  downloadBlob: jest.fn(),
}), { virtual: true });
jest.mock('ces-shared/storage', () => ({
  getStamperPlanDataRoot: jest.fn(() => '/tmp/golden-plan-data'),
}), { virtual: true });

import { createRequire } from 'node:module';
import type { SystemSecurityPlan } from 'ces-shared/types/ssp';
import type { DiagramRenderer } from '../../src/eo/ssp/DiagramRenderer.js';
import {
  buildGoldenAssessment,
  buildGoldenTenantManifest,
  buildGoldenInfraManifest,
  buildGoldenManifests,
  buildGoldenAuthorizationBoundary,
  buildGoldenCuiDataFlows,
} from './golden-fixtures.js';

const _require = createRequire(__filename);
const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');

/** Stub renderer that "succeeds" — returns deterministic fake artifact paths. */
function makeSucceedingRenderer(): DiagramRenderer {
  const stub = {
    renderNetworkDiagramToSvg: jest.fn(() => '/tmp/eo-diagrams/network-architecture.svg'),
    renderDataFlowDiagramToSvg: jest.fn(() => '/tmp/eo-diagrams/data-flow-diagram.svg'),
    renderAuthBoundaryDiagramToSvg: jest.fn(() => '/tmp/eo-diagrams/authorization-boundary.svg'),
    renderMermaidToPng: jest.fn((_code: string, outputPath: string) => outputPath),
    renderMermaidToSvg: jest.fn((_code: string, outputPath: string) => outputPath),
    cleanup: jest.fn(),
  };
  return stub as unknown as DiagramRenderer;
}

/** Stub renderer simulating mmdc-absent: every render returns null. */
function makeDegradedRenderer(): DiagramRenderer {
  const stub = {
    renderNetworkDiagramToSvg: jest.fn(() => null),
    renderDataFlowDiagramToSvg: jest.fn(() => null),
    renderAuthBoundaryDiagramToSvg: jest.fn(() => null),
    renderMermaidToPng: jest.fn(() => null),
    renderMermaidToSvg: jest.fn(() => null),
    cleanup: jest.fn(),
  };
  return stub as unknown as DiagramRenderer;
}

async function generateWith(renderer?: DiagramRenderer): Promise<SystemSecurityPlan> {
  const { SspGenerator } = await import('../../src/eo/ssp/SspGenerator.js');
  const generator = new SspGenerator(
    controlsRefPath,
    sprsWeightsPath,
    undefined,
    undefined,
    undefined,
    renderer ? { diagramRenderer: renderer } : undefined,
  );
  return generator.generate({
    assessment: buildGoldenAssessment(controlsRefPath),
    tenantManifest: buildGoldenTenantManifest(),
    infraManifest: buildGoldenInfraManifest(),
    manifests: buildGoldenManifests(),
    authorizationBoundaryDiagram: buildGoldenAuthorizationBoundary(),
    cuiDataFlowsDiagram: buildGoldenCuiDataFlows(),
    variables: { organizationName: 'Golden Reference Defense Co.' },
  });
}

describe('SSP diagram embedding (Step 2)', () => {
  describe('with a working DiagramRenderer (PNG render succeeds)', () => {
    let ssp: SystemSecurityPlan;
    beforeAll(async () => { ssp = await generateWith(makeSucceedingRenderer()); });

    test('networkTopology.diagramPath is populated', () => {
      expect(ssp.networkTopology.diagramPath).toBeDefined();
      expect(ssp.networkTopology.diagramPath).toMatch(/network-architecture-.*\.png$/);
    });

    test('authorizationBoundary.diagramPath is populated', () => {
      expect(ssp.authorizationBoundary.diagramPath).toBeDefined();
      expect(ssp.authorizationBoundary.diagramPath).toMatch(/authorization-boundary-.*\.png$/);
    });
  });

  describe('graceful degradation (mmdc unavailable — renderer returns null)', () => {
    let ssp: SystemSecurityPlan;
    beforeAll(async () => { ssp = await generateWith(makeDegradedRenderer()); });

    test('networkTopology.diagramPath stays undefined', () => {
      expect(ssp.networkTopology.diagramPath).toBeUndefined();
    });

    test('authorizationBoundary.diagramPath stays undefined', () => {
      expect(ssp.authorizationBoundary.diagramPath).toBeUndefined();
    });

    test('Mermaid-code-block appendix fallback still present', () => {
      const network = ssp.appendices!.find(a => a.title.toLowerCase().includes('network'));
      expect(network).toBeDefined();
      expect(network!.summary.startsWith('flowchart ')).toBe(true);
    });
  });

  describe('no DiagramRenderer provided', () => {
    let ssp: SystemSecurityPlan;
    beforeAll(async () => { ssp = await generateWith(undefined); });

    test('diagramPath fields stay undefined (no regression)', () => {
      expect(ssp.networkTopology.diagramPath).toBeUndefined();
      expect(ssp.authorizationBoundary.diagramPath).toBeUndefined();
    });
  });
});
