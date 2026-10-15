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
import { SnippetDataResolver } from '../../../src/eo/ssp/SnippetDataResolver';
import { NarrativeLanguageGuard } from '../../../src/eo/ssp/NarrativeLanguageGuard';
import type { ArchitectureMetadata } from '../../../src/shared/types/evidence.types';
import type { ExtendedDirectiveMetadata } from '../../../src/shared/types/directive.types';
import type { CmmcControl } from 'ces-shared/types/controls';

const fixturePath = path.resolve(__dirname, '../../fixtures/evidence-session-controlled-byod-passing.json');
const fixture: ArchitectureMetadata = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

const WIRELESS_CONTROLS = ['AC.L2-3.1.16', 'AC.L2-3.1.17'];

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

describe('Integration: Session-Controlled BYOD wireless controls', () => {
  it('AC.L2-3.1.16 uses wireless template with TLS language', () => {
    const resolver = new SnippetDataResolver();
    const ctrl = makeControl('AC.L2-3.1.16');
    const dm = makeDirectiveMetadata('AC.L2-3.1.16');
    const narrative = resolver.resolveByodNarrative(ctrl, dm, fixture, '2.3');
    expect(narrative).not.toBeNull();
    expect(narrative!.implementationDescription).toContain('TLS 1.2+');
    expect(narrative!.implementationDescription).toContain('transport-layer encryption');
    expect(narrative!.implementationDescription).toContain('Section 2.3');
  });

  it('AC.L2-3.1.17 uses wireless template with TLS language', () => {
    const resolver = new SnippetDataResolver();
    const ctrl = makeControl('AC.L2-3.1.17');
    const dm = makeDirectiveMetadata('AC.L2-3.1.17');
    const narrative = resolver.resolveByodNarrative(ctrl, dm, fixture, '2.3');
    expect(narrative).not.toBeNull();
    expect(narrative!.implementationDescription).toContain('TLS 1.2+');
    expect(narrative!.implementationDescription).toContain('wireless');
  });

  it('wireless narratives include tenant_variant', () => {
    const resolver = new SnippetDataResolver();
    for (const cid of WIRELESS_CONTROLS) {
      const ctrl = makeControl(cid);
      const dm = makeDirectiveMetadata(cid);
      const narrative = resolver.resolveByodNarrative(ctrl, dm, fixture, '2.3');
      expect(narrative).not.toBeNull();
      expect(narrative!.implementationDescription).toContain('GCC High');
    }
  });

  it('wireless narratives do not contain session control language', () => {
    const resolver = new SnippetDataResolver();
    for (const cid of WIRELESS_CONTROLS) {
      const ctrl = makeControl(cid);
      const dm = makeDirectiveMetadata(cid);
      const narrative = resolver.resolveByodNarrative(ctrl, dm, fixture, '2.3');
      expect(narrative).not.toBeNull();
      // Session control language should not leak into wireless narratives
      expect(narrative!.implementationDescription).not.toContain('Conditional Access App Control');
      expect(narrative!.implementationDescription).not.toContain('Non-Browser Client Block');
    }
  });

  it('wireless narratives pass language guard', () => {
    const resolver = new SnippetDataResolver();
    for (const cid of WIRELESS_CONTROLS) {
      const ctrl = makeControl(cid);
      const dm = makeDirectiveMetadata(cid);
      const narrative = resolver.resolveByodNarrative(ctrl, dm, fixture, '2.3');
      expect(narrative).not.toBeNull();
      const guardResult = NarrativeLanguageGuard.validateNoForbiddenTerms(
        narrative!.implementationDescription,
        'session_controlled_byod'
      );
      expect(guardResult.valid).toBe(true);
    }
  });

  it('wireless narratives include verification date', () => {
    const resolver = new SnippetDataResolver();
    for (const cid of WIRELESS_CONTROLS) {
      const ctrl = makeControl(cid);
      const dm = makeDirectiveMetadata(cid);
      const narrative = resolver.resolveByodNarrative(ctrl, dm, fixture, '2.3');
      expect(narrative).not.toBeNull();
      expect(narrative!.implementationDescription).toContain('April');
      expect(narrative!.implementationDescription).toContain('2026');
    }
  });
});
