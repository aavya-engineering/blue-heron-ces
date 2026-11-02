// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// contractsService.ts — CRUD over Contract (14 named fields).
// engagement_kind is immutable after creation; updateEngagementKind always throws.

interface ContractDb {
  contract: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findUnique(args: { where: Record<string, unknown> }): Promise<unknown>;
    findMany(args?: { where?: Record<string, unknown>; orderBy?: unknown }): Promise<unknown[]>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
    delete(args: { where: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface CreateContractInput {
  party_id: string;
  engagement_id: string;
  contract_number: string;
  program_name: string;
  cage_code?: string | null;
  uei?: string | null;
  contracting_office?: string | null;
  co_name?: string | null;
  award_date?: Date | null;
  pop_start?: Date | null;
  pop_end?: Date | null;
  cmmc_level_required: number;
  cui_categories: unknown;
}

export type UpdateContractInput = Partial<
  Omit<CreateContractInput, 'party_id' | 'engagement_id'>
>;

function validateCmmcLevel(level: number): void {
  // [validate with BHD] CMMC levels 1-3 per DoD Instruction 8171.01
  if (!Number.isInteger(level) || level < 1 || level > 3) {
    throw new Error('cmmc_level_required must be 1, 2, or 3');
  }
}

export function createContractsService(db: ContractDb) {
  return {
    async create(data: CreateContractInput): Promise<unknown> {
      validateCmmcLevel(data.cmmc_level_required);
      return db.contract.create({ data: data as unknown as Record<string, unknown> });
    },

    async get(id: string): Promise<unknown> {
      return db.contract.findUnique({ where: { id } });
    },

    async list(filters?: {
      party_id?: string;
      engagement_id?: string;
    }): Promise<unknown[]> {
      return db.contract.findMany({
        where: filters as Record<string, unknown> | undefined,
        orderBy: { created_at: 'asc' },
      });
    },

    async update(id: string, data: UpdateContractInput): Promise<unknown> {
      if (
        data.cmmc_level_required !== undefined &&
        data.cmmc_level_required !== null
      ) {
        validateCmmcLevel(data.cmmc_level_required);
      }
      return db.contract.update({
        where: { id },
        data: data as Record<string, unknown>,
      });
    },

    async delete(id: string): Promise<unknown> {
      return db.contract.delete({ where: { id } });
    },

    // engagement_kind is immutable after creation; this exists only to make
    // the enforcement explicit — calling it always throws.
    updateEngagementKind(_id: string, _kind: string): never {
      throw new Error('engagement_kind is immutable after creation');
    },
  };
}
