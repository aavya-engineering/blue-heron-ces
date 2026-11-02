// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, beforeEach } from 'vitest';
import { createHilService } from '../src/services/hilService.js';
import { createMockDb } from './helpers/mockDb.js';

const BASE_FACT = {
  tenant_id: 'tenant-1',
  party_id: 'party-1',
  question_id: 'q-access-control-01',
  answer: 'partial',
};

describe('hilService routing thresholds (DONE-WHEN #7)', () => {
  let db: ReturnType<typeof createMockDb>;
  let svc: ReturnType<typeof createHilService>;

  beforeEach(() => {
    db = createMockDb();
    svc = createHilService(db);
  });

  // ─── Routes ───────────────────────────────────────────────────────────────

  it('routes when confidence=low AND weight=3', async () => {
    const item = await svc.routeFact({
      ...BASE_FACT,
      confidence: 'low',
      weight: 3,
    });
    expect(item).not.toBeNull();
    expect((item as Record<string, unknown>)['reason']).toBe('low_confidence_high_weight');
  });

  it('routes when confidence=low AND weight > 3', async () => {
    const item = await svc.routeFact({
      ...BASE_FACT,
      confidence: 'low',
      weight: 5,
    });
    expect(item).not.toBeNull();
  });

  it('routes when sub_flagged=true regardless of confidence and weight', async () => {
    // Even high confidence and weight 0 → routes because sub_flagged
    const item = await svc.routeFact({
      ...BASE_FACT,
      confidence: 'high',
      weight: 0,
      sub_flagged: true,
    });
    expect(item).not.toBeNull();
    expect((item as Record<string, unknown>)['reason']).toBe('sub_flagged');
  });

  it('routes when sub_flagged=true even with medium confidence weight=1', async () => {
    const item = await svc.routeFact({
      ...BASE_FACT,
      confidence: 'medium',
      weight: 1,
      sub_flagged: true,
    });
    expect(item).not.toBeNull();
  });

  // ─── Does NOT route ────────────────────────────────────────────────────────

  it('does NOT route when confidence=low AND weight=2', async () => {
    const item = await svc.routeFact({
      ...BASE_FACT,
      confidence: 'low',
      weight: 2,
    });
    expect(item).toBeNull();
  });

  it('does NOT route when confidence=low AND weight=0', async () => {
    const item = await svc.routeFact({
      ...BASE_FACT,
      confidence: 'low',
      weight: 0,
    });
    expect(item).toBeNull();
  });

  it('does NOT route when confidence=medium AND weight=3 (not low)', async () => {
    const item = await svc.routeFact({
      ...BASE_FACT,
      confidence: 'medium',
      weight: 3,
    });
    expect(item).toBeNull();
  });

  it('does NOT route when confidence=high AND weight=10', async () => {
    const item = await svc.routeFact({
      ...BASE_FACT,
      confidence: 'high',
      weight: 10,
    });
    expect(item).toBeNull();
  });

  it('does NOT route when sub_flagged=false and thresholds not met', async () => {
    const item = await svc.routeFact({
      ...BASE_FACT,
      confidence: 'low',
      weight: 2,
      sub_flagged: false,
    });
    expect(item).toBeNull();
  });

  // ─── Resolve ───────────────────────────────────────────────────────────────

  it('resolve sets resolved_at and advisor_minutes', async () => {
    const item = await svc.routeFact({ ...BASE_FACT, confidence: 'low', weight: 3 });
    const id = (item as Record<string, unknown>)['id'] as string;
    const resolved = await svc.resolve(id, 'user-123', 12.5);
    expect((resolved as Record<string, unknown>)['resolved_at']).toBeDefined();
    expect((resolved as Record<string, unknown>)['advisor_minutes']).toBe(12.5);
    expect((resolved as Record<string, unknown>)['resolved_by_user_id']).toBe('user-123');
  });

  it('resolve throws when HilItem is already resolved', async () => {
    const item = await svc.routeFact({ ...BASE_FACT, confidence: 'low', weight: 3 });
    const id = (item as Record<string, unknown>)['id'] as string;
    await svc.resolve(id, 'user-123', 5);
    await expect(svc.resolve(id, 'user-123', 5)).rejects.toThrow('already resolved');
  });
});
