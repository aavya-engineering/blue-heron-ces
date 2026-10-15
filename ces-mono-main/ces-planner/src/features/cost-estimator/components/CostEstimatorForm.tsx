// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useMemo, useState } from 'react';
import type {
  TenantStance,
  AzureWorkload,
  UserCountTier,
  CostEstimateInput,
} from '../types';
import {
  USER_COUNT_TIERS,
  TENANT_STANCE_LABELS,
  AZURE_WORKLOAD_LABELS,
} from '../types';
import { DEFAULT_STACK_ID } from '../../../../../ces-shared/src/stack/index';
import { listStacks, getStackInfrastructureModels } from '../services/tenantCost';

interface CostEstimatorFormProps {
  onCalculate: (input: CostEstimateInput) => void;
}

const WORKLOAD_OPTIONS: AzureWorkload[] = ['light', 'medium', 'heavy'];

/** Stance label, falling back to the raw model id for non-Microsoft stacks. */
function stanceLabel(s: string): string {
  return TENANT_STANCE_LABELS[s as TenantStance] ?? s;
}

export function CostEstimatorForm({ onCalculate }: CostEstimatorFormProps) {
  const stacks = useMemo(() => listStacks(), []);
  const [stackId, setStackId] = useState<string>(DEFAULT_STACK_ID);
  const [stance, setStance] = useState<string>('');
  const [workload, setWorkload] = useState<AzureWorkload | ''>('');
  const [userCount, setUserCount] = useState<UserCountTier | ''>('');

  // Stance options come from the active stack provider (G7), not a hard-coded Microsoft list.
  const stanceOptions = useMemo(() => getStackInfrastructureModels(stackId), [stackId]);

  const workloadDisabled = stance === 'm365_only';
  const workloadRequired = stance === 'm365_sentinel' || stance === 'm365_azure';

  const isValid =
    stackId !== '' &&
    stance !== '' &&
    userCount !== '' &&
    (!workloadRequired || workload !== '');

  const handleSubmit = () => {
    if (!stance || !userCount) return;

    const input: CostEstimateInput = {
      stance: stance as TenantStance,
      user_count: userCount,
      stackId,
    };

    if (!workloadDisabled && workload) {
      input.workload = workload;
    }

    onCalculate(input);
  };

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Compliance Stack</label>
        <select
          value={stackId}
          onChange={(e) => {
            setStackId(e.target.value);
            // Reset downstream selections — stance options are stack-specific.
            setStance('');
            setWorkload('');
          }}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        >
          {stacks.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">
          The cost model is authored for Microsoft / GCC High. Other stacks are recognized but have no
          cost model yet.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Tenant Infrastructure Stance
        </label>
        <select
          value={stance}
          onChange={(e) => {
            const val = e.target.value;
            setStance(val);
            if (val === 'm365_only') {
              setWorkload('');
            }
          }}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        >
          <option value="">Select infrastructure stance...</option>
          {stanceOptions.map((s) => (
            <option key={s} value={s}>
              {stanceLabel(s)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">
          {stance === 'm365_only' && 'No Azure subscription. M365 services only.'}
          {stance === 'm365_sentinel' && 'Sentinel SIEM for logging/monitoring. No other Azure resources.'}
          {stance === 'm365_azure' && 'Full Azure subscription: Sentinel + VNet + Key Vault + Storage.'}
          {stance === '' && 'Choose the infrastructure model for the tenant.'}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Azure Workload Tier
        </label>
        <select
          value={workloadDisabled ? '' : workload}
          onChange={(e) => setWorkload(e.target.value as AzureWorkload | '')}
          disabled={workloadDisabled}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-100 disabled:text-gray-400"
        >
          <option value="">
            {workloadDisabled ? 'Not applicable (M365 Only)' : 'Select workload tier...'}
          </option>
          {WORKLOAD_OPTIONS.map((w) => (
            <option key={w} value={w}>
              {AZURE_WORKLOAD_LABELS[w]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">
          {workloadDisabled
            ? 'Workload selection is disabled for M365 Only stance.'
            : 'Total Sentinel log ingestion volume (M365 + Azure logs combined).'}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">User Count</label>
        <select
          value={userCount}
          onChange={(e) =>
            setUserCount(e.target.value ? (Number(e.target.value) as UserCountTier) : '')
          }
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        >
          <option value="">Select user count...</option>
          {USER_COUNT_TIERS.map((count) => (
            <option key={count} value={count}>
              {count} users
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">
          Number of licensed users in the GCC High tenant.
        </p>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!isValid}
        className="w-full py-2.5 text-sm font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Calculate Estimate
      </button>
    </div>
  );
}
