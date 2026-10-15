// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import Dexie, { type EntityTable } from 'dexie';
import { PLANNER_DEXIE_DB_NAME } from '../../../../ces-shared/src/storage/DexieContract';
import type {
  Customer,
  SIBaselineRecord,
  RRQuestionSetRecord,
  ReadinessPostureRecord,
  MissionPlan,
  CUIBoundaryRecord,
  BTCConfirmationRecord,
  TenantConfigProfileRecord,
  PolicyInputsRecord,
  QuestionBankCache,
  DomainDataCache,
} from '../types/artifacts';
import { generateCesId } from '../utils/idGenerator';
import {
  type CesTuple,
  ownedOrUndefined,
  ownedBaselineOrUndefined,
  ownedByCustomerOrUndefined,
} from '../identity/cesTuple';

export class AppDatabase extends Dexie {
  customers!: EntityTable<Customer, 'id'>;
  si_baselines!: EntityTable<SIBaselineRecord, 'id'>;
  cui_boundaries!: EntityTable<CUIBoundaryRecord, 'id'>;
  btc_confirmations!: EntityTable<BTCConfirmationRecord, 'id'>;
  tenant_config_profiles!: EntityTable<TenantConfigProfileRecord, 'id'>;
  policy_inputs!: EntityTable<PolicyInputsRecord, 'id'>;
  rr_question_sets!: EntityTable<RRQuestionSetRecord, 'id'>;
  readiness_postures!: EntityTable<ReadinessPostureRecord, 'id'>;
  mission_plans!: EntityTable<MissionPlan, 'id'>;
  question_banks_cache!: EntityTable<QuestionBankCache, 'name'>;
  domain_data_cache!: EntityTable<DomainDataCache, 'name'>;

  constructor() {
    super(PLANNER_DEXIE_DB_NAME);

    this.version(1).stores({
      customers: '++id, name, createdAt',
      si_baselines: '++id, customerId, createdAt, isImmutable',
      rr_question_sets: '++id, baselineId, createdAt',
      readiness_postures: '++id, questionSetId, baselineId, createdAt',
      mission_plans: '++id, customerId, baselineId, postureId, createdAt',
      question_banks_cache: 'name, version, loadedAt',
      domain_data_cache: 'name, version, loadedAt',
    });

    this.version(2).stores({
      customers: '++id, name, createdAt',
      si_baselines: '++id, customerId, createdAt, isImmutable',
      rr_question_sets: '++id, baselineId, customerId, [customerId+baselineId], createdAt',
      readiness_postures: '++id, questionSetId, baselineId, customerId, [customerId+baselineId], createdAt',
      mission_plans: '++id, customerId, baselineId, postureId, [customerId+baselineId], createdAt',
      question_banks_cache: 'name, version, loadedAt',
      domain_data_cache: 'name, version, loadedAt',
    });

    this.version(3).stores({
      customers: '++id, name, createdAt',
      si_baselines: '++id, customerId, createdAt, isImmutable',
      cui_boundaries: '++id, customerId, baselineId, [customerId+baselineId], createdAt',
      btc_confirmations: '++id, customerId, baselineId, cuiBoundaryId, [customerId+baselineId], createdAt',
      rr_question_sets: '++id, baselineId, customerId, [customerId+baselineId], createdAt',
      readiness_postures: '++id, questionSetId, baselineId, customerId, [customerId+baselineId], createdAt',
      mission_plans: '++id, customerId, baselineId, postureId, [customerId+baselineId], createdAt',
      question_banks_cache: 'name, version, loadedAt',
      domain_data_cache: 'name, version, loadedAt',
    });

    this.version(4).stores({
      customers: '++id, name, createdAt',
      si_baselines: '++id, customerId, createdAt, isImmutable',
      cui_boundaries: '++id, customerId, baselineId, [customerId+baselineId], createdAt',
      btc_confirmations: '++id, customerId, baselineId, cuiBoundaryId, [customerId+baselineId], createdAt',
      tenant_config_profiles: '++id, customerId, baselineId, [customerId+baselineId], createdAt',
      rr_question_sets: '++id, baselineId, customerId, [customerId+baselineId], createdAt',
      readiness_postures: '++id, questionSetId, baselineId, customerId, [customerId+baselineId], createdAt',
      mission_plans: '++id, customerId, baselineId, postureId, [customerId+baselineId], createdAt',
      question_banks_cache: 'name, version, loadedAt',
      domain_data_cache: 'name, version, loadedAt',
    });

    this.version(5).stores({
      customers: '++id, name, createdAt',
      si_baselines: '++id, customerId, createdAt, isImmutable',
      cui_boundaries: '++id, customerId, baselineId, [customerId+baselineId], createdAt',
      btc_confirmations: '++id, customerId, baselineId, cuiBoundaryId, [customerId+baselineId], createdAt',
      tenant_config_profiles: '++id, customerId, baselineId, [customerId+baselineId], createdAt',
      policy_inputs: '++id, customerId, baselineId, [customerId+baselineId], createdAt',
      rr_question_sets: '++id, baselineId, customerId, [customerId+baselineId], createdAt',
      readiness_postures: '++id, questionSetId, baselineId, customerId, [customerId+baselineId], createdAt',
      mission_plans: '++id, customerId, baselineId, postureId, [customerId+baselineId], createdAt',
      question_banks_cache: 'name, version, loadedAt',
      domain_data_cache: 'name, version, loadedAt',
    });

    this.version(6).stores({
      customers: '++id, name, createdAt',
      si_baselines: '++id, customerId, createdAt, isImmutable',
      cui_boundaries: '++id, customerId, baselineId, [customerId+baselineId], createdAt',
      btc_confirmations: '++id, customerId, baselineId, cuiBoundaryId, [customerId+baselineId], createdAt',
      tenant_config_profiles: '++id, customerId, baselineId, [customerId+baselineId], createdAt',
      policy_inputs: '++id, customerId, createdAt',
      rr_question_sets: '++id, baselineId, customerId, [customerId+baselineId], createdAt',
      readiness_postures: '++id, questionSetId, baselineId, customerId, [customerId+baselineId], createdAt',
      mission_plans: '++id, customerId, baselineId, postureId, [customerId+baselineId], createdAt',
      question_banks_cache: 'name, version, loadedAt',
      domain_data_cache: 'name, version, loadedAt',
    });

    this.version(7).stores({
      customers: '++id, name, createdAt',
      si_baselines: '++id, customerId, cesId, createdAt, isImmutable',
      cui_boundaries: '++id, customerId, baselineId, cesId, [customerId+baselineId], createdAt',
      btc_confirmations: '++id, customerId, baselineId, cuiBoundaryId, cesId, [customerId+baselineId], createdAt',
      tenant_config_profiles: '++id, customerId, baselineId, cesId, [customerId+baselineId], createdAt',
      policy_inputs: '++id, customerId, cesId, createdAt',
      rr_question_sets: '++id, baselineId, customerId, cesId, [customerId+baselineId], createdAt',
      readiness_postures: '++id, questionSetId, baselineId, customerId, cesId, [customerId+baselineId], createdAt',
      mission_plans: '++id, customerId, baselineId, postureId, cesId, [customerId+baselineId], createdAt',
      question_banks_cache: 'name, version, loadedAt',
      domain_data_cache: 'name, version, loadedAt',
    }).upgrade(async (tx) => {
      // Backfill cesId for existing records

      // SI Baselines
      const baselines = await tx.table('si_baselines').toArray();
      for (const baseline of baselines) {
        if (!baseline.cesId) {
          const customer = await tx.table('customers').get(baseline.customerId);
          const customerName = customer?.name || 'Unknown';
          const timestamp = baseline.createdAt || new Date().toISOString();
          const cesId = await generateCesId(customerName, timestamp);
          await tx.table('si_baselines').update(baseline.id, { cesId });
          // Also update in data.ces.cesId
          if (baseline.data) {
            if (!baseline.data.ces) {
              baseline.data.ces = {} as any;
            }
            baseline.data.ces.cesId = cesId;
            await tx.table('si_baselines').update(baseline.id, { data: baseline.data });
          }
        }
      }

      // Propagate cesId from SI baselines to all downstream artifacts
      const cesIdMap = new Map<number, string>();
      for (const baseline of baselines) {
        if (baseline.id && baseline.cesId) {
          cesIdMap.set(baseline.id, baseline.cesId);
        }
      }

      // RR Question Sets
      const questionSets = await tx.table('rr_question_sets').toArray();
      for (const qs of questionSets) {
        if (!qs.cesId && qs.baselineId) {
          const cesId = cesIdMap.get(qs.baselineId);
          if (cesId) {
            await tx.table('rr_question_sets').update(qs.id, { cesId });
            if (qs.data) {
              if (!qs.data.ces) {
                qs.data.ces = {} as any;
              }
              qs.data.ces.cesId = cesId;
              await tx.table('rr_question_sets').update(qs.id, { data: qs.data });
            }
          }
        }
      }

      // Readiness Postures
      const postures = await tx.table('readiness_postures').toArray();
      for (const posture of postures) {
        if (!posture.cesId && posture.baselineId) {
          const cesId = cesIdMap.get(posture.baselineId);
          if (cesId) {
            await tx.table('readiness_postures').update(posture.id, { cesId });
            if (posture.data) {
              if (!posture.data.ces) {
                posture.data.ces = {} as any;
              }
              posture.data.ces.cesId = cesId;
              await tx.table('readiness_postures').update(posture.id, { data: posture.data });
            }
          }
        }
      }

      // Mission Plans
      const plans = await tx.table('mission_plans').toArray();
      for (const plan of plans) {
        if (!plan.cesId && plan.baselineId) {
          const cesId = cesIdMap.get(plan.baselineId);
          if (cesId) {
            await tx.table('mission_plans').update(plan.id, { cesId });
            if (plan.data) {
              if (plan.data.manual_plan) {
                if (!plan.data.manual_plan.ces) {
                  plan.data.manual_plan.ces = {} as any;
                }
                plan.data.manual_plan.ces.cesId = cesId;
              }
              if (plan.data.proposal) {
                if (!plan.data.proposal.ces) {
                  plan.data.proposal.ces = {} as any;
                }
                plan.data.proposal.ces.cesId = cesId;
              }
              if (plan.data.tenant_manifest) {
                if (!plan.data.tenant_manifest.ces) {
                  plan.data.tenant_manifest.ces = {} as any;
                }
                plan.data.tenant_manifest.ces.cesId = cesId;
              }
              if (plan.data.infrastructure_manifest) {
                if (!plan.data.infrastructure_manifest.ces) {
                  plan.data.infrastructure_manifest.ces = {} as any;
                }
                plan.data.infrastructure_manifest.ces.cesId = cesId;
              }
              await tx.table('mission_plans').update(plan.id, { data: plan.data });
            }
          }
        }
      }

      // CUI Boundaries
      const cuiBoundaries = await tx.table('cui_boundaries').toArray();
      for (const cb of cuiBoundaries) {
        if (!cb.cesId && cb.baselineId) {
          const cesId = cesIdMap.get(cb.baselineId);
          if (cesId) {
            await tx.table('cui_boundaries').update(cb.id, { cesId });
            if (cb.data) {
              if (!cb.data.ces) {
                cb.data.ces = {} as any;
              }
              cb.data.ces.cesId = cesId;
              await tx.table('cui_boundaries').update(cb.id, { data: cb.data });
            }
          }
        }
      }

      // BTC Confirmations
      const btcs = await tx.table('btc_confirmations').toArray();
      for (const btc of btcs) {
        if (!btc.cesId && btc.baselineId) {
          const cesId = cesIdMap.get(btc.baselineId);
          if (cesId) {
            await tx.table('btc_confirmations').update(btc.id, { cesId });
            if (btc.data) {
              if (!btc.data.ces) {
                btc.data.ces = {} as any;
              }
              btc.data.ces.cesId = cesId;
              await tx.table('btc_confirmations').update(btc.id, { data: btc.data });
            }
          }
        }
      }

      // Tenant Config Profiles
      const tcps = await tx.table('tenant_config_profiles').toArray();
      for (const tcp of tcps) {
        if (!tcp.cesId && tcp.baselineId) {
          const cesId = cesIdMap.get(tcp.baselineId);
          if (cesId) {
            await tx.table('tenant_config_profiles').update(tcp.id, { cesId });
            if (tcp.data) {
              if (!tcp.data.ces) {
                tcp.data.ces = {} as any;
              }
              tcp.data.ces.cesId = cesId;
              await tx.table('tenant_config_profiles').update(tcp.id, { data: tcp.data });
            }
          }
        }
      }

      // Policy Inputs
      const policyInputs = await tx.table('policy_inputs').toArray();
      for (const pi of policyInputs) {
        if (!pi.cesId && pi.customerId) {
          const customer = await tx.table('customers').get(pi.customerId);
          const customerName = customer?.name || 'Unknown';
          const timestamp = pi.createdAt || new Date().toISOString();
          const cesId = await generateCesId(customerName, timestamp);
          await tx.table('policy_inputs').update(pi.id, { cesId });
        }
      }
    });
  }
}

// Singleton instance
export const db = new AppDatabase();

// Helper functions for common queries
export const dbHelpers = {
  // Customers
  async getCustomers(): Promise<Customer[]> {
    return db.customers.orderBy('createdAt').reverse().toArray();
  },

  async getCustomerById(id: number): Promise<Customer | undefined> {
    return db.customers.get(id);
  },

  async createCustomer(customer: Omit<Customer, 'id'>): Promise<number> {
    return db.customers.add(customer) as Promise<number>;
  },

  // SI Baselines
  async getBaselinesByCustomer(customerId: number): Promise<SIBaselineRecord[]> {
    return db.si_baselines.where('customerId').equals(customerId).toArray();
  },

  async getLatestBaselineByCustomer(customerId: number): Promise<SIBaselineRecord | undefined> {
    const baselines = await db.si_baselines
      .where('customerId')
      .equals(customerId)
      .reverse()
      .sortBy('createdAt');
    return baselines[0];
  },

  // Ownership-aware read (G1/ADR-001): when `tuple` is supplied, a baseline not owned by that
  // (customer, SI-baseline) pair is returned as `undefined` — a non-owner gets "not found".
  // Omitting `tuple` preserves the legacy unscoped behavior for existing callers.
  async getBaselineById(id: number, tuple?: CesTuple): Promise<SIBaselineRecord | undefined> {
    const rec = await db.si_baselines.get(id);
    return tuple ? ownedBaselineOrUndefined(rec, tuple) : rec;
  },

  async createSIBaseline(baseline: Omit<SIBaselineRecord, 'id'>): Promise<number> {
    return db.si_baselines.add(baseline) as Promise<number>;
  },

  // SI Baselines (all) — unscoped; returns every customer's baselines. Prefer
  // getBaselinesForCustomer for multi-customer-safe reads (G1/ADR-001).
  async getAllBaselines(): Promise<SIBaselineRecord[]> {
    return db.si_baselines.orderBy('createdAt').reverse().toArray();
  },

  // Multi-customer-safe replacement for getAllBaselines: scoped to one customer.
  async getBaselinesForCustomer(customerId: number): Promise<SIBaselineRecord[]> {
    return db.si_baselines.where('customerId').equals(customerId).reverse().sortBy('createdAt');
  },

  // RR Question Sets
  async getQuestionSetByBaseline(baselineId: number): Promise<RRQuestionSetRecord | undefined> {
    return db.rr_question_sets.where('baselineId').equals(baselineId).first();
  },

  async getQuestionSetById(id: number, tuple?: CesTuple): Promise<RRQuestionSetRecord | undefined> {
    const rec = await db.rr_question_sets.get(id);
    return tuple ? ownedOrUndefined(rec, tuple) : rec;
  },

  async getQuestionSetsByCustomerAndBaseline(customerId: number, baselineId: number): Promise<RRQuestionSetRecord[]> {
    return db.rr_question_sets.where('[customerId+baselineId]').equals([customerId, baselineId]).toArray();
  },

  async createRRQuestionSet(questionSet: Omit<RRQuestionSetRecord, 'id'>): Promise<number> {
    return db.rr_question_sets.add(questionSet) as Promise<number>;
  },

  // Readiness Postures
  async getPostureByBaseline(baselineId: number): Promise<ReadinessPostureRecord | undefined> {
    return db.readiness_postures.where('baselineId').equals(baselineId).first();
  },

  async getPostureById(id: number, tuple?: CesTuple): Promise<ReadinessPostureRecord | undefined> {
    const rec = await db.readiness_postures.get(id);
    return tuple ? ownedOrUndefined(rec, tuple) : rec;
  },

  async getPosturesByCustomerAndBaseline(customerId: number, baselineId: number): Promise<ReadinessPostureRecord[]> {
    return db.readiness_postures.where('[customerId+baselineId]').equals([customerId, baselineId]).toArray();
  },

  async createReadinessPosture(posture: Omit<ReadinessPostureRecord, 'id'>): Promise<number> {
    return db.readiness_postures.add(posture) as Promise<number>;
  },

  // Mission Plans
  async getMissionPlanByBaseline(baselineId: number): Promise<MissionPlan | undefined> {
    return db.mission_plans.where('baselineId').equals(baselineId).first();
  },

  async getMissionPlanById(id: number, tuple?: CesTuple): Promise<MissionPlan | undefined> {
    const rec = await db.mission_plans.get(id);
    return tuple ? ownedOrUndefined(rec, tuple) : rec;
  },

  async getMissionPlansByCustomerAndBaseline(customerId: number, baselineId: number): Promise<MissionPlan[]> {
    return db.mission_plans.where('[customerId+baselineId]').equals([customerId, baselineId]).toArray();
  },

  async createMissionPlan(plan: Omit<MissionPlan, 'id'>): Promise<number> {
    return db.mission_plans.add(plan) as Promise<number>;
  },

  // CUI Boundaries
  async getCUIBoundariesByCustomerAndBaseline(customerId: number, baselineId: number): Promise<CUIBoundaryRecord[]> {
    return db.cui_boundaries.where('[customerId+baselineId]').equals([customerId, baselineId]).toArray();
  },

  async getCUIBoundaryById(id: number, tuple?: CesTuple): Promise<CUIBoundaryRecord | undefined> {
    const rec = await db.cui_boundaries.get(id);
    return tuple ? ownedOrUndefined(rec, tuple) : rec;
  },

  async createCUIBoundary(record: Omit<CUIBoundaryRecord, 'id'>): Promise<number> {
    return db.cui_boundaries.add(record) as Promise<number>;
  },

  async deleteCUIBoundary(id: number): Promise<void> {
    // Cascade: delete BTC confirmations linked to this CUI boundary
    await db.btc_confirmations.where('cuiBoundaryId').equals(id).delete();
    await db.cui_boundaries.delete(id);
  },

  // BTC Confirmations
  async getBTCsByCustomerAndBaseline(customerId: number, baselineId: number): Promise<BTCConfirmationRecord[]> {
    return db.btc_confirmations.where('[customerId+baselineId]').equals([customerId, baselineId]).toArray();
  },

  async getBTCById(id: number, tuple?: CesTuple): Promise<BTCConfirmationRecord | undefined> {
    const rec = await db.btc_confirmations.get(id);
    return tuple ? ownedOrUndefined(rec, tuple) : rec;
  },

  async createBTC(record: Omit<BTCConfirmationRecord, 'id'>): Promise<number> {
    return db.btc_confirmations.add(record) as Promise<number>;
  },

  async deleteBTC(id: number): Promise<void> {
    await db.btc_confirmations.delete(id);
  },

  // Tenant Config Profiles
  async getTenantConfigsByCustomerAndBaseline(
    customerId: number,
    baselineId: number,
  ): Promise<TenantConfigProfileRecord[]> {
    return db.tenant_config_profiles
      .where('[customerId+baselineId]')
      .equals([customerId, baselineId])
      .toArray();
  },

  async getTenantConfigById(id: number, tuple?: CesTuple): Promise<TenantConfigProfileRecord | undefined> {
    const rec = await db.tenant_config_profiles.get(id);
    return tuple ? ownedOrUndefined(rec, tuple) : rec;
  },

  async createTenantConfigProfile(
    record: Omit<TenantConfigProfileRecord, 'id'>,
  ): Promise<number> {
    return db.tenant_config_profiles.add(record) as Promise<number>;
  },

  async deleteTenantConfigProfile(id: number): Promise<void> {
    await db.tenant_config_profiles.delete(id);
  },

  // Policy Inputs
  async getPolicyInputsByCustomer(
    customerId: number,
  ): Promise<PolicyInputsRecord[]> {
    return db.policy_inputs
      .where('customerId')
      .equals(customerId)
      .sortBy('createdAt');
  },

  // Policy Inputs are customer-scoped only (no SI-baseline linkage) — ownership = customer match.
  async getPolicyInputsById(id: number, tuple?: CesTuple): Promise<PolicyInputsRecord | undefined> {
    const rec = await db.policy_inputs.get(id);
    return tuple ? ownedByCustomerOrUndefined(rec, tuple) : rec;
  },

  async createPolicyInputs(record: Omit<PolicyInputsRecord, 'id'>): Promise<number> {
    return db.policy_inputs.add(record) as Promise<number>;
  },

  async deletePolicyInputs(id: number): Promise<void> {
    await db.policy_inputs.delete(id);
  },

  // Cache management
  async getQuestionBank(name: string): Promise<QuestionBankCache | undefined> {
    return db.question_banks_cache.get(name);
  },

  async setQuestionBank(cache: QuestionBankCache): Promise<string> {
    return db.question_banks_cache.put(cache);
  },

  async getDomainData(name: string): Promise<DomainDataCache | undefined> {
    return db.domain_data_cache.get(name);
  },

  async setDomainData(cache: DomainDataCache): Promise<string> {
    return db.domain_data_cache.put(cache);
  },

  // Clear all data (dev mode)
  async clearAllData(): Promise<void> {
    await db.customers.clear();
    await db.si_baselines.clear();
    await db.cui_boundaries.clear();
    await db.btc_confirmations.clear();
    await db.tenant_config_profiles.clear();
    await db.policy_inputs.clear();
    await db.rr_question_sets.clear();
    await db.readiness_postures.clear();
    await db.mission_plans.clear();
  },

  // Clear cache only
  async clearCache(): Promise<void> {
    await db.question_banks_cache.clear();
    await db.domain_data_cache.clear();
  },
};
