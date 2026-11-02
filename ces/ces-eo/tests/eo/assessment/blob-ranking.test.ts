// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W0.2b (EO-collection plan; REVIEW P0 #3; critique G7/PE-5): EO blob captures rank below every
 * Stamper verdict and never outvote a live read; Stamper sources are no longer dropped when a
 * blob exists. At load, a blob is used only when it is this tenant's, within 30 days and not a
 * NOT_SAT payload. Unit-proven only (runs 17 and 19 have no blobs).
 */
import type { AssessmentSource, ControlAssessment } from 'ces-shared/types/controls';
import { ControlAssessor, type BlobArtifact, type EoControlAssessment } from '../../../src/eo/assessment/ControlAssessor';
import { blobInScope, BLOB_MAX_AGE_DAYS } from '../../../src/eo/server/routers/assessment-router';

const controlsRefPath = require.resolve('ces-shared/data/cmmc-l2-controls');
const C = 'AC.L1-3.1.1';
const TS = '2026-10-27T13:00:40.000Z';

const blob: BlobArtifact = { artifactId: 'art-1', runId: 'r', capturedAt: TS, source: 'graph', checkId: 'conditionalAccess', controlIds: [C], sha256: 'x' };
const live = (result: 'exists' | 'missing' | 'no_query'): ControlAssessment => ({
  control_id: C, nist_ref: '3.1.1', status: result === 'exists' ? 'met' : result === 'missing' ? 'not_met' : 'not_assessed',
  classification: 'automated', sources: [{ type: 'discovery', timestamp: TS, detail: 'live read', result }], last_assessed: TS,
  signals: [], evidenceArtifactIds: [], automationSource: 'graph', lastFetchedAt: TS,
});
const imp = (detail: string, result: AssessmentSource['result'] = 'imported'): AssessmentSource => ({ type: 'evidence_import', timestamp: TS, detail, result });

function assess(o: { blobs?: BlobArtifact[]; stamper?: AssessmentSource[]; signal?: ControlAssessment }): EoControlAssessment {
  const stamper = o.stamper ? new Map([[C, o.stamper]]) : undefined;
  const signals = o.signal ? new Map([[C, o.signal]]) : undefined;
  const snap = new ControlAssessor(controlsRefPath, []).merge('w02b', [], o.blobs ?? [], [], [], stamper, signals);
  return snap.controls.find(c => c.control_id === C) as EoControlAssessment;
}

describe('W0.2b blob ranking in ControlAssessor.merge', () => {
  it('a blob never outvotes a negative live read', () => {
    const c = assess({ blobs: [blob], signal: live('missing') });
    expect(c.status).toBe('not_met');
    expect(c.statusRationale).toMatch(/^Tier 2 \(live read\)/);
  });

  it('a blob never outvotes a current-run Stamper NOT_SAT', () => {
    const c = assess({ blobs: [blob], stamper: [imp('Set X failed', 'missing')] });
    expect(c.status).toBe('not_met');
    expect(c.statusRationale).toMatch(/^Tier 1/);
  });

  it('Stamper sources are kept when a blob exists, and a state-verified SAT decides over the blob', () => {
    const c = assess({ blobs: [blob], stamper: [imp('Create CUI group')] });
    expect(c.sources.some(s => s.type === 'evidence_import')).toBe(true);
    expect(c.sources.some(s => s.type === 'blob_artifact')).toBe(true);
    expect(c.status).toBe('met');
    expect(c.statusRationale).toMatch(/^Tier 3/);
  });

  it('an evidence-only SAT also ranks above the blob (the blob is the last tier)', () => {
    const c = assess({ blobs: [blob], stamper: [imp('Verify CA (state not verified)')] });
    expect(c.statusRationale).toMatch(/^Tier 4/);
  });

  it('a blob decides only when nothing else has an opinion (unread live read, no Stamper verdict)', () => {
    const c = assess({ blobs: [blob], signal: live('no_query') });
    expect(c.status).toBe('met');
    expect(c.statusRationale).toMatch(/^Tier 5 \(EO blob capture/);
    expect(c.evidenceArtifactIds).toEqual(['art-1']);
  });

  it('a positive live read decides over the blob (rationale names the live read)', () => {
    const c = assess({ blobs: [blob], signal: live('exists') });
    expect(c.status).toBe('met');
    expect(c.statusRationale).toMatch(/^Tier 2/);
  });
});

describe('W0.2b blobInScope: which blobs may become sources', () => {
  const NOW = Date.parse(TS);
  const DAY = 24 * 60 * 60 * 1000;
  const tenant = { slug: 'muster-partial', tenantId: 'guid-mp' };
  const art = (extra: Record<string, unknown>) => ({ artifactId: 'a', controlIds: [C], capturedAt: new Date(NOW - DAY).toISOString(), ...extra });

  it('an in-age blob with no tenant marker is in scope (the blob account is the tenant\'s own)', () => {
    expect(blobInScope(art({}), tenant, NOW)).toEqual({ ok: true });
  });

  it('a blob older than 30 days, or with no capture time, is not used', () => {
    expect(blobInScope(art({ capturedAt: new Date(NOW - (BLOB_MAX_AGE_DAYS + 1) * DAY).toISOString() }), tenant, NOW)).toEqual({ ok: false, reason: 'stale' });
    expect(blobInScope(art({ capturedAt: undefined }), tenant, NOW)).toEqual({ ok: false, reason: 'stale' });
  });

  it('a Stamper-shaped upload is dated by metadata.timestamp', () => {
    const stamper = { complianceVerdict: 'SAT', metadata: { controlIds: [C], timestamp: new Date(NOW - DAY).toISOString() } };
    expect(blobInScope(stamper, tenant, NOW)).toEqual({ ok: true });
    expect(blobInScope({ ...stamper, metadata: { controlIds: [C], timestamp: new Date(NOW - 40 * DAY).toISOString() } }, tenant, NOW)).toEqual({ ok: false, reason: 'stale' });
  });

  it('a blob naming another tenant is not used; naming this tenant (slug or id) is', () => {
    expect(blobInScope(art({ tenantId: 'guid-other' }), tenant, NOW)).toEqual({ ok: false, reason: 'foreign_tenant' });
    expect(blobInScope(art({ tenant: 'edcgov' }), tenant, NOW)).toEqual({ ok: false, reason: 'foreign_tenant' });
    expect(blobInScope(art({ tenantId: 'guid-mp' }), tenant, NOW)).toEqual({ ok: true });
    expect(blobInScope(art({ tenantSlug: 'muster-partial' }), tenant, NOW)).toEqual({ ok: true });
  });

  it('a NOT_SAT payload is never positive', () => {
    expect(blobInScope(art({ complianceVerdict: 'NOT_SAT' }), tenant, NOW)).toEqual({ ok: false, reason: 'not_sat' });
    expect(blobInScope(art({ verdict: 'NOT_SAT' }), tenant, NOW)).toEqual({ ok: false, reason: 'not_sat' });
  });
});
