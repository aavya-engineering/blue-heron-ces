// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * STEP 3 — Mermaid SYNTAX validation (DONE-WHEN: "renders without syntax errors").
 *
 * mmdc is not installed in CI and full visual render needs a browser, so we
 * statically validate the Mermaid syntax of each diagram class DiagramGenerator
 * emits, using the dependency-light MermaidSyntaxValidator.
 *
 * Asserts the validator PASSES real DiagramGenerator output (flowchart + graph +
 * sequenceDiagram) AND that it CATCHES deliberately-broken samples.
 *
 * Full visual rendering is performed separately via mmdc (DiagramRenderer); see
 * MermaidSyntaxValidator header for the documented scope.
 */
import { describe, test, expect } from '@jest/globals';
import { DiagramGenerator } from '../../src/eo/ssp/DiagramGenerator.js';
import { MermaidSyntaxValidator } from '../../src/eo/ssp/MermaidSyntaxValidator.js';
import {
  buildGoldenInfraManifest,
  buildGoldenAuthorizationBoundary,
  buildGoldenCuiDataFlows,
} from './golden-fixtures.js';

const gen = new DiagramGenerator();

describe('MermaidSyntaxValidator on DiagramGenerator output (Step 3)', () => {
  test('network topology flowchart is syntactically valid', () => {
    const code = gen.generateNetworkTopology(
      buildGoldenInfraManifest() as never,
    );
    expect(code.startsWith('flowchart ')).toBe(true);
    const result = MermaidSyntaxValidator.validate(code);
    if (!result.valid) console.error('Network diagram errors:', result.errors, '\n', code);
    expect(result.diagramType).toBe('flowchart');
    expect(result.valid).toBe(true);
  });

  test('authorization boundary graph is syntactically valid', () => {
    const code = gen.generateAuthorizationBoundary(buildGoldenAuthorizationBoundary());
    expect(code.startsWith('graph ')).toBe(true);
    const result = MermaidSyntaxValidator.validate(code);
    if (!result.valid) console.error('Boundary diagram errors:', result.errors, '\n', code);
    expect(result.diagramType).toBe('flowchart');
    expect(result.valid).toBe(true);
  });

  test('CUI data flow sequenceDiagram is syntactically valid', () => {
    const code = gen.generateDataFlowDiagram(buildGoldenCuiDataFlows());
    expect(code.startsWith('sequenceDiagram')).toBe(true);
    const result = MermaidSyntaxValidator.validate(code);
    if (!result.valid) console.error('Data flow diagram errors:', result.errors, '\n', code);
    expect(result.diagramType).toBe('sequenceDiagram');
    expect(result.valid).toBe(true);
  });
});

describe('MermaidSyntaxValidator catches broken samples (Step 3)', () => {
  test('rejects an invalid flowchart header', () => {
    const result = MermaidSyntaxValidator.validate('flowchart\n  A["A"]');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('rejects an invalid flowchart direction', () => {
    const result = MermaidSyntaxValidator.validate('flowchart ZZ\n  A["A"]');
    expect(result.valid).toBe(false);
  });

  test('rejects unbalanced subgraph / end', () => {
    const code = 'flowchart TB\n  subgraph z1 ["Zone"]\n    A["A"]';
    const result = MermaidSyntaxValidator.validate(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /subgraph/i.test(e))).toBe(true);
  });

  test('rejects a dangling edge reference', () => {
    const code = 'flowchart TB\n  A["A"]\n  A --> B';
    const result = MermaidSyntaxValidator.validate(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /undeclared node "B"/.test(e))).toBe(true);
  });

  test('rejects a sequenceDiagram message to an undeclared participant', () => {
    const code = 'sequenceDiagram\n  participant A as A\n  A->>B: hello';
    const result = MermaidSyntaxValidator.validate(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /undeclared participant "B"/.test(e))).toBe(true);
  });

  test('rejects an unknown diagram header', () => {
    const result = MermaidSyntaxValidator.validate('classDiagram\n  class A');
    expect(result.valid).toBe(false);
    expect(result.diagramType).toBe('unknown');
  });

  test('rejects empty input', () => {
    expect(MermaidSyntaxValidator.validate('').valid).toBe(false);
    expect(MermaidSyntaxValidator.validate('   ').valid).toBe(false);
  });
});
