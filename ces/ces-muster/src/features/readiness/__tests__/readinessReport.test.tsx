// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// G-MUSTER-READINESS-1 M3 gate 3: the report renders SPRS now, the two-tier
// gap list, and SPRS after with the word "projection" present — asserted, not
// described. Plus the FCA rendering rules: draft labeling exact strings,
// provenance badges, unconditional disclaimer footer, BHD-weights banner.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import ReadinessReport from '../ReadinessReport';
import type { ReadinessResult } from '@/shared/types/readinessResult';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const RESULT: ReadinessResult = {
  schema_version: 'readiness-result/1.0.0',
  manifest: {
    mode: 'independent',
    auth_tier: 'script-upload',
    tenant: { slug: 'stacksim-demo', kind: 'sim' },
    operator: { name: 'Jane Assessor', role: 'assessor' },
    engagement_id: 'eng-1',
    party_id: 'party-1',
    engagement_kind: 'individual_contractor',
    started_at: '2026-07-12T09:00:00Z',
  },
  observations: [],
  facts: [
    {
      question_id: 'iam-001',
      question_text: 'MFA enforced?',
      answer: 'yes',
      provenance: 'discovery-inferred',
      confidence: 'medium',
      recorded_at: '2026-07-12T09:30:00Z',
      // unconfirmed draft
    },
    {
      question_id: 'iam-002',
      question_text: 'User inventory?',
      answer: 'yes',
      provenance: 'discovery-inferred',
      confidence: 'medium',
      recorded_at: '2026-07-12T09:31:00Z',
      attestation: {
        drafted_by: 'discovery inference',
        confirmed_by: 'Jane Assessor',
        confirmed_on: '2026-07-12',
      },
    },
  ],
  derived: {
    sprs_now: {
      sprs: 102,
      assessed_count: 3,
      deductions: [
        { requirement_id: 'AC.L1-3.1.1', weight: 5 },
        { requirement_id: 'AT.L2-3.2.1', weight: 3 },
      ],
    },
    gaps: [
      {
        requirement_id: 'AC.L1-3.1.1',
        weight: 5,
        fix_entry_ids: ['tenant:AC.L2-3.1.1.group-create'],
        fixable: 'registry',
      },
      { requirement_id: 'AT.L2-3.2.1', weight: 3, fix_entry_ids: [], fixable: 'manual' },
    ],
    sprs_after: 107,
  },
  provenance: {
    registry_versions: { 'cmmc-l2-commands': '1.0.0/2026-03-01' },
    coverage_dataset: 'registry-objective-coverage-2026-07-10',
    engine: { name: 'muster-readiness-exporter', version: '0.1.0' },
    generated_at: '2026-07-12T10:00:00Z',
  },
};

describe('ReadinessReport — M3 gate', () => {
  it('renders SPRS now, the two-tier gap list, and SPRS after WITH the word "projection"', () => {
    act(() => root.render(<ReadinessReport result={RESULT} />));

    expect(container.querySelector('[data-testid="readiness-report-sprs-now"]')?.textContent).toContain('102');

    // Two tiers, correctly split
    expect(container.querySelector('[data-testid="gap-registry-AC.L1-3.1.1"]')?.textContent).toContain(
      'tenant:AC.L2-3.1.1.group-create'
    );
    expect(container.querySelector('[data-testid="gap-manual-AT.L2-3.2.1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="gap-registry-AT.L2-3.2.1"]')).toBeNull();

    const after = container.querySelector('[data-testid="readiness-report-sprs-after"]')?.textContent ?? '';
    expect(after).toContain('107');
    expect(after.toLowerCase()).toContain('projection');
  });

  it('labels drafts and attestations exactly; disclaimer footer and BHD banner are unconditional', () => {
    act(() => root.render(<ReadinessReport result={RESULT} />));

    expect(container.querySelector('[data-testid="report-draft-iam-001"]')?.textContent).toBe(
      'UNCONFIRMED DRAFT'
    );
    expect(container.querySelector('[data-testid="report-attestation-iam-002"]')?.textContent).toContain(
      'drafted by discovery inference, confirmed by Jane Assessor on 2026-07-12'
    );
    expect(container.querySelector('[data-testid="report-draft-iam-002"]')).toBeNull();

    expect(container.querySelector('[data-testid="readiness-report-fca-footer"]')?.textContent).toContain(
      'not a certification'
    );
    // SPRS weights are now the authoritative methodology values (READINESS-1 M4
    // satisfied 2026-07-12) — the "pending BHD validation" banner is retired and
    // replaced by a methodology-provenance note.
    expect(container.querySelector('[data-testid="bhd-weights-banner"]')).toBeNull();
    expect(container.querySelector('[data-testid="sprs-methodology-note"]')?.textContent).toContain(
      'DoD Assessment Methodology'
    );
  });

  it('manual gaps render the collect-list residuals from the coverage extract', () => {
    act(() => root.render(<ReadinessReport result={RESULT} />));
    const row = container.querySelector('[data-testid="gap-manual-AT.L2-3.2.1"]')?.textContent ?? '';
    // AT.L2-3.2.1 carries EMX residuals in the derived extract.
    expect(row).toMatch(/EMX-|Documentary evidence/);
  });
});