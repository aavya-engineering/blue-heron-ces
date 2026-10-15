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
import { SectionTwoGenerator } from '../../../src/eo/ssp/SectionTwoGenerator';
import { MechanismNarrativeComposer } from '../../../src/eo/ssp/MechanismNarrativeComposer';
import { SnippetDataResolver } from '../../../src/eo/ssp/SnippetDataResolver';
import { SprsValidator } from '../../../src/eo/ssp/SprsValidator';
import type { DependencyTable } from '../../../src/eo/ssp/MechanismNarrativeComposer';
import type { ArchitectureMetadata } from '../../../src/shared/types/evidence.types';
import type { ExtendedDirectiveMetadata } from '../../../src/shared/types/directive.types';
import type { CmmcControl } from 'ces-shared/types/controls';

const fixturePath = path.resolve(__dirname, '../../fixtures/evidence-session-controlled-byod-dlp-gap.json');
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
    readiness: 'not-met',
    platform_inherited: false,
    evidence_artifacts: ['artifact-001'],
    enforcement_verified: false,
    narrative_stub: '',
    reasoning_trace: '',
    verification_date: '2026-04-15T10:30:00Z',
  };
}

const DLP_DEPENDENT_CONTROLS = ['AC.L1-3.1.22', 'MP.L2-3.8.8', 'MP.L2-3.8.9'];
const NON_DLP_CONTROLS = dependencyTable.dependencies
  .map(d => d.control_id)
  .filter(cid => !DLP_DEPENDENT_CONTROLS.includes(cid));

describe('Integration: Session-Controlled BYOD with DLP gap', () => {
  it('generates Section 2 with gap disclosure mentioning DLP', () => {
    const gen = new SectionTwoGenerator(dependencyTable);
    const result = gen.generateBoundaryNarrative(fixture, '2.3');
    expect(result.content).toContain('Gap Disclosure');
    expect(result.content).toContain('Data Loss Prevention');
  });

  it('Section 2 gap disclosure includes gap_description_dlp text', () => {
    const gen = new SectionTwoGenerator(dependencyTable);
    const result = gen.generateBoundaryNarrative(fixture, '2.3');
    expect(result.content).toContain('DLP policies not yet deployed to Exchange Online');
  });

  it('Section 2 gap disclosure includes POA&M reference', () => {
    const gen = new SectionTwoGenerator(dependencyTable);
    const result = gen.generateBoundaryNarrative(fixture, '2.3');
    expect(result.content).toContain('POAM-2026-003');
  });

  it('DLP-dependent controls get NOT MET narratives', () => {
    const resolver = new SnippetDataResolver();
    for (const cid of DLP_DEPENDENT_CONTROLS) {
      const ctrl = makeControl(cid);
      const dm = makeDirectiveMetadata(cid);
      const narrative = resolver.resolveByodNarrative(ctrl, dm, fixture, '2.3');
      expect(narrative).not.toBeNull();
      expect(narrative!.implementationDescription).toContain('NOT MET');
    }
  });

  it('DLP-dependent controls reference POA&M', () => {
    const resolver = new SnippetDataResolver();
    for (const cid of DLP_DEPENDENT_CONTROLS) {
      const ctrl = makeControl(cid);
      const dm = makeDirectiveMetadata(cid);
      const narrative = resolver.resolveByodNarrative(ctrl, dm, fixture, '2.3');
      expect(narrative).not.toBeNull();
      expect(narrative!.implementationDescription).toContain('POAM-2026-003');
    }
  });

  it('non-DLP controls are unaffected (still passing)', () => {
    const resolver = new SnippetDataResolver();
    for (const cid of NON_DLP_CONTROLS) {
      const ctrl = makeControl(cid);
      const dm = makeDirectiveMetadata(cid);
      const evaluation = MechanismNarrativeComposer.evaluateMechanismStatus(
        cid, fixture.mechanism_status, dependencyTable
      );
      const narrative = resolver.resolveByodNarrative(ctrl, dm, fixture, '2.3');
      expect(narrative).not.toBeNull();
      if (evaluation.allPass) {
        expect(narrative!.implementationDescription).toContain('assessed as MET');
      }
    }
  });

  it('SprsValidator detects mismatch when enforcement_verified=true but DLP inactive', () => {
    const dm = makeDirectiveMetadata('MP.L2-3.8.8');
    dm.enforcement_verified = true; // Force mismatch
    const result = SprsValidator.validateMechanismConsistency(
      'MP.L2-3.8.8', dm, fixture.mechanism_status, dependencyTable
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Data Loss Prevention');
  });
});
