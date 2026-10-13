// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, beforeEach } from 'vitest';
import { createLifecycleService } from '../src/services/lifecycleService.js';
import { createMockDb } from './helpers/mockDb.js';

const FIXED_NOW = new Date('2026-07-07T10:00:00Z');

async function seedParty(
  db: ReturnType<typeof createMockDb>,
  lifecycle: string = 'invited'
) {
  return db.party.create({
    data: {
      id: crypto.randomUUID(),
      tenant_id: 'tenant-1',
      engagement_id: 'eng-1',
      name: 'Test Party',
      on_prem_ot: 'no',
      lifecycle,
    },
  });
}

describe('lifecycleService — 8-state transitions', () => {
  let db: ReturnType<typeof createMockDb>;
  let svc: ReturnType<typeof createLifecycleService>;

  beforeEach(() => {
    db = createMockDb();
    svc = createLifecycleService(db, () => FIXED_NOW);
  });

  // ─── Valid transitions ─────────────────────────────────────────────────────

  it('invited → in_progress', async () => {
    const party = await seedParty(db, 'invited');
    const updated = await svc.transition(party.id as string, 'in_progress', 'user-1');
    expect(updated['lifecycle']).toBe('in_progress');
    expect(updated['last_activity_at']).toEqual(FIXED_NOW);
  });

  it('in_progress → stalled', async () => {
    const party = await seedParty(db, 'in_progress');
    const updated = await svc.transition(party.id as string, 'stalled', 'user-1');
    expect(updated['lifecycle']).toBe('stalled');
  });

  it('in_progress → complete', async () => {
    const party = await seedParty(db, 'in_progress');
    const updated = await svc.transition(party.id as string, 'complete', 'user-1');
    expect(updated['lifecycle']).toBe('complete');
  });

  it('stalled → in_progress (recovery)', async () => {
    const party = await seedParty(db, 'stalled');
    const updated = await svc.transition(party.id as string, 'in_progress', 'user-1');
    expect(updated['lifecycle']).toBe('in_progress');
  });

  it('complete → ready (writes Disposition)', async () => {
    const party = await seedParty(db, 'complete');
    await svc.transition(party.id as string, 'ready', 'user-1');
    const disps = await db.disposition.findMany({ where: { party_id: party.id as string } });
    expect(disps.length).toBe(1);
    expect(disps[0]['state']).toBe('ready');
    expect(disps[0]['set_by_user_id']).toBe('user-1');
  });

  it('ready → validate (writes Disposition)', async () => {
    const party = await seedParty(db, 'ready');
    await svc.transition(party.id as string, 'validate', 'user-1');
    const disps = await db.disposition.findMany({ where: { party_id: party.id as string } });
    expect(disps[0]['state']).toBe('validate');
  });

  it('validate → convert_to_enclave (writes Disposition)', async () => {
    const party = await seedParty(db, 'validate');
    await svc.transition(party.id as string, 'convert_to_enclave', 'user-1');
    const disps = await db.disposition.findMany({ where: { party_id: party.id as string } });
    expect(disps[0]['state']).toBe('convert_to_enclave');
  });

  it('any non-terminal → reassessment_due (writes Disposition with schedule_reassessment)', async () => {
    const party = await seedParty(db, 'ready');
    await svc.transition(party.id as string, 'reassessment_due', 'user-1');
    const disps = await db.disposition.findMany({ where: { party_id: party.id as string } });
    expect(disps[0]['state']).toBe('schedule_reassessment');
  });

  // ─── Terminals ────────────────────────────────────────────────────────────

  it('convert_to_enclave → any transition throws (terminal)', async () => {
    const party = await seedParty(db, 'convert_to_enclave');
    await expect(svc.transition(party.id as string, 'reassessment_due', 'user-1')).rejects.toThrow(
      'Illegal lifecycle transition'
    );
  });

  // ─── Illegal transitions ──────────────────────────────────────────────────

  it('invited → complete is illegal', async () => {
    const party = await seedParty(db, 'invited');
    await expect(svc.transition(party.id as string, 'complete', 'user-1')).rejects.toThrow(
      'Illegal lifecycle transition: invited → complete'
    );
  });

  it('in_progress → ready is illegal', async () => {
    const party = await seedParty(db, 'in_progress');
    await expect(svc.transition(party.id as string, 'ready', 'user-1')).rejects.toThrow(
      'Illegal lifecycle transition'
    );
  });

  it('invited → invited (self-loop) is illegal', async () => {
    const party = await seedParty(db, 'invited');
    await expect(svc.transition(party.id as string, 'invited', 'user-1')).rejects.toThrow(
      'Illegal lifecycle transition'
    );
  });

  // ─── markAbandoned / optOut ────────────────────────────────────────────────

  it('markAbandoned writes Disposition(abandoned) from any non-terminal', async () => {
    const party = await seedParty(db, 'in_progress');
    await svc.markAbandoned(party.id as string, 'user-1', 'Unresponsive');
    const disps = await db.disposition.findMany({ where: { party_id: party.id as string } });
    expect(disps[0]['state']).toBe('abandoned');
    expect(disps[0]['notes']).toBe('Unresponsive');
  });

  it('markAbandoned is idempotent-rejected (throws if already abandoned)', async () => {
    const party = await seedParty(db, 'in_progress');
    await svc.markAbandoned(party.id as string, 'user-1');
    await expect(svc.markAbandoned(party.id as string, 'user-1')).rejects.toThrow(
      'already abandoned'
    );
  });

  it('markAbandoned throws from terminal convert_to_enclave', async () => {
    const party = await seedParty(db, 'convert_to_enclave');
    await expect(svc.markAbandoned(party.id as string, 'user-1')).rejects.toThrow(
      'Cannot abandon'
    );
  });

  it('optOut writes Disposition(opted_out) from any non-terminal', async () => {
    const party = await seedParty(db, 'invited');
    await svc.optOut(party.id as string, 'user-1');
    const disps = await db.disposition.findMany({ where: { party_id: party.id as string } });
    expect(disps[0]['state']).toBe('opted_out');
  });

  it('optOut throws from terminal convert_to_enclave', async () => {
    const party = await seedParty(db, 'convert_to_enclave');
    await expect(svc.optOut(party.id as string, 'user-1')).rejects.toThrow('Cannot opt out');
  });

  // ─── Non-action-driven transitions do NOT write Disposition ────────────────

  it('invited → in_progress does NOT write a Disposition row', async () => {
    const party = await seedParty(db, 'invited');
    await svc.transition(party.id as string, 'in_progress', 'user-1');
    const disps = await db.disposition.findMany({ where: { party_id: party.id as string } });
    expect(disps.length).toBe(0);
  });
});
