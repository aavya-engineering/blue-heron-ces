// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, beforeEach } from 'vitest';
import { createContractsService } from '../src/services/contractsService.js';
import { createMockDb } from './helpers/mockDb.js';

const BASE = {
  party_id: '00000000-0000-0000-0000-000000000001',
  engagement_id: '00000000-0000-0000-0000-000000000002',
  contract_number: 'FA8621-22-C-0001',
  program_name: 'CMMC Compliance Program',
  cage_code: '1ABC2',
  uei: 'ABCDE1234567',
  contracting_office: 'AFLCMC/PK',
  co_name: 'Jane Smith',
  award_date: new Date('2022-01-01'),
  pop_start: new Date('2022-02-01'),
  pop_end: new Date('2025-01-31'),
  cmmc_level_required: 2,
  cui_categories: ['CTI', 'PRVCY'],
};

describe('contractsService', () => {
  let db: ReturnType<typeof createMockDb>;
  let svc: ReturnType<typeof createContractsService>;

  beforeEach(() => {
    db = createMockDb();
    svc = createContractsService(db);
  });

  it('creates a contract with all 14 named fields', async () => {
    const contract = await svc.create(BASE) as Record<string, unknown>;
    expect(contract.contract_number).toBe(BASE.contract_number);
    expect(contract.program_name).toBe(BASE.program_name);
    expect(contract.cage_code).toBe(BASE.cage_code);
    expect(contract.uei).toBe(BASE.uei);
    expect(contract.contracting_office).toBe(BASE.contracting_office);
    expect(contract.co_name).toBe(BASE.co_name);
    expect(contract.award_date).toEqual(BASE.award_date);
    expect(contract.pop_start).toEqual(BASE.pop_start);
    expect(contract.pop_end).toEqual(BASE.pop_end);
    expect(contract.cmmc_level_required).toBe(2);
    expect(contract.cui_categories).toEqual(['CTI', 'PRVCY']);
    expect(contract.party_id).toBe(BASE.party_id);
    expect(contract.engagement_id).toBe(BASE.engagement_id);
    expect(contract.id).toBeDefined();
  });

  it('rejects cmmc_level_required=0', async () => {
    await expect(svc.create({ ...BASE, cmmc_level_required: 0 })).rejects.toThrow(
      'cmmc_level_required must be 1, 2, or 3'
    );
  });

  it('rejects cmmc_level_required=4', async () => {
    await expect(svc.create({ ...BASE, cmmc_level_required: 4 })).rejects.toThrow(
      'cmmc_level_required must be 1, 2, or 3'
    );
  });

  it('rejects non-integer cmmc_level_required', async () => {
    await expect(svc.create({ ...BASE, cmmc_level_required: 1.5 })).rejects.toThrow(
      'cmmc_level_required must be 1, 2, or 3'
    );
  });

  it('reads a contract by id', async () => {
    const created = await svc.create(BASE) as Record<string, unknown>;
    const found = await svc.get(created.id as string) as Record<string, unknown>;
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.program_name).toBe(BASE.program_name);
  });

  it('lists contracts, optionally filtered by party_id', async () => {
    await svc.create(BASE);
    await svc.create({ ...BASE, party_id: '00000000-0000-0000-0000-000000000099' });

    const all = await svc.list() as unknown[];
    expect(all).toHaveLength(2);

    const filtered = await svc.list({ party_id: BASE.party_id }) as unknown[];
    expect(filtered).toHaveLength(1);
  });

  it('updates a contract field', async () => {
    const created = await svc.create(BASE) as Record<string, unknown>;
    const updated = await svc.update(created.id as string, { program_name: 'Updated Name' }) as Record<string, unknown>;
    expect(updated.program_name).toBe('Updated Name');
  });

  it('rejects invalid cmmc_level on update', async () => {
    const created = await svc.create(BASE) as Record<string, unknown>;
    await expect(
      svc.update(created.id as string, { cmmc_level_required: 5 })
    ).rejects.toThrow('cmmc_level_required must be 1, 2, or 3');
  });

  it('deletes a contract', async () => {
    const created = await svc.create(BASE) as Record<string, unknown>;
    await svc.delete(created.id as string);
    const found = await svc.get(created.id as string);
    expect(found).toBeNull();
  });

  it('updateEngagementKind always throws (immutability enforcement)', () => {
    expect(() => svc.updateEngagementKind('any-id', 'individual_contractor')).toThrow(
      'engagement_kind is immutable after creation'
    );
  });
});
