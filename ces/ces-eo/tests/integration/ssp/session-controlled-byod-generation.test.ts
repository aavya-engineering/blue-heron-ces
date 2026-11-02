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
import { ArchitectureDetector } from '../../../src/eo/ssp/ArchitectureDetector';
import { SectionTwoGenerator } from '../../../src/eo/ssp/SectionTwoGenerator';
import { MechanismNarrativeComposer } from '../../../src/eo/ssp/MechanismNarrativeComposer';
import { NarrativeLanguageGuard } from '../../../src/eo/ssp/NarrativeLanguageGuard';
import { SnippetDataResolver } from '../../../src/eo/ssp/SnippetDataResolver';
import type { DependencyTable } from '../../../src/eo/ssp/MechanismNarrativeComposer';
import type { ArchitectureMetadata } from '../../../src/shared/types/evidence.types';
import type { ExtendedDirectiveMetadata } from '../../../src/shared/types/directive.types';
import type { CmmcControl } from 'ces-shared/types/controls';

const fixturePath = path.resolve(__dirname, '../../fixtures/evidence-session-controlled-byod-passing.json');
const fixture: ArchitectureMetadata = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

const depTablePath = path.resolve(__dirname, '../../../src/shared/data/mechanism-dependency-table.json');
const dependencyTable: DependencyTable = JSON.parse(fs.readFileSync(depTablePath, 'utf-8'));

function makeControl(controlId: string): CmmcControl {
  return {
    control_id: controlId,
    family: controlId.split('.')[0],
    cmmc_level: 2,
    nist_ref: controlId.replace(/^[A-Z]+\.L\d+-/, ''),
    practice: `Practice for ${controlId}`,
  };
}

function makeDirectiveMetadata(controlId: string): ExtendedDirectiveMetadata {
  return {
    control_id: controlId,
    directive: 'document-prohibition',
    readiness: 'met',
    platform_inherited: false,
    evidence_artifacts: ['artifact-001'],
    enforcement_verified: true,
    narrative_stub: '',
    reasoning_trace: '',
    verification_date: '2026-04-15T10:30:00Z',
  };
}

describe('Integration: Session-Controlled BYOD full generation (all passing)', () => {
  it('detects session-controlled BYOD architecture from fixture', () => {
    expect(ArchitectureDetector.isByodArchitecture(fixture)).toBe(true);
    expect(ArchitectureDetector.detectArchitecture(fixture)).toBe('session_controlled_byod');
  });

  it('generates Section 2 boundary narrative exactly once', () => {
    const gen = new SectionTwoGenerator(dependencyTable);
    const result = gen.generateBoundaryNarrative(fixture, '2.3');
    expect(result.sectionNumber).toBe('2.3');
    expect(result.content).toContain('2.3 Session-Controlled BYOD Architecture');
    expect(result.content).toContain('GCC High');
    expect(result.content).toContain('BYOD-Session-Controls');
  });

  it('Section 2 has no gap disclosure when all mechanisms pass', () => {
    const gen = new SectionTwoGenerator(dependencyTable);
    const result = gen.generateBoundaryNarrative(fixture, '2.3');
    expect(result.content).not.toContain('Gap Disclosure');
  });

  it('generates per-control narratives for all 11 dependency table controls', () => {
    const resolver = new SnippetDataResolver();
    const controlIds = dependencyTable.dependencies.map(d => d.control_id);

    for (const cid of controlIds) {
      const ctrl = makeControl(cid);
      const dm = makeDirectiveMetadata(cid);
      const narrative = resolver.resolveByodNarrative(ctrl, dm, fixture, '2.3');
      expect(narrative).not.toBeNull();
      expect(narrative!.implementationDescription).toContain('Section 2.3');
    }
  });

  it('per-control narratives for passing controls contain MET language', () => {
    const resolver = new SnippetDataResolver();
    const ctrl = makeControl('AC.L2-3.1.18');
    const dm = makeDirectiveMetadata('AC.L2-3.1.18');
    const narrative = resolver.resolveByodNarrative(ctrl, dm, fixture, '2.3');
    expect(narrative).not.toBeNull();
    expect(narrative!.implementationDescription).toContain('assessed as MET');
  });

  it('all generated narratives pass language guard', () => {
    const resolver = new SnippetDataResolver();
    const gen = new SectionTwoGenerator(dependencyTable);

    const section2 = gen.generateBoundaryNarrative(fixture, '2.3');
    const guardResult = NarrativeLanguageGuard.validateNoForbiddenTerms(
      section2.content, 'session_controlled_byod'
    );
    expect(guardResult.valid).toBe(true);

    const controlIds = dependencyTable.dependencies.map(d => d.control_id);
    for (const cid of controlIds) {
      const ctrl = makeControl(cid);
      const dm = makeDirectiveMetadata(cid);
      const narrative = resolver.resolveByodNarrative(ctrl, dm, fixture, '2.3');
      if (narrative) {
        const gr = NarrativeLanguageGuard.validateNoForbiddenTerms(
          narrative.implementationDescription, 'session_controlled_byod'
        );
        expect(gr.valid).toBe(true);
      }
    }
  });

  it('all mechanism evaluations return allPass=true for fixture', () => {
    const controlIds = dependencyTable.dependencies.map(d => d.control_id);
    for (const cid of controlIds) {
      const result = MechanismNarrativeComposer.evaluateMechanismStatus(
        cid, fixture.mechanism_status, dependencyTable
      );
      expect(result.allPass).toBe(true);
    }
  });
});
