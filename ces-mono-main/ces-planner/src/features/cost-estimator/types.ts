// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export type TenantStance = 'm365_only' | 'm365_sentinel' | 'm365_azure';

export type AzureWorkload = 'light' | 'medium' | 'heavy';

export const USER_COUNT_TIERS = [10, 25, 50, 75, 100] as const;
export type UserCountTier = (typeof USER_COUNT_TIERS)[number];

export interface CostEstimateInput {
  stance: TenantStance;
  workload?: AzureWorkload;
  user_count: UserCountTier;
  /**
   * G7: active compliance stack id (stack-provider seam). Absent ⇒ Microsoft/GCC High reference
   * stack, so existing behavior is unchanged. Non-Microsoft stacks have no authored cost model yet.
   */
  stackId?: string;
}

export interface CostLineItem {
  component: string;
  description: string;
  monthly_cost: number;
  annual_cost: number;
  notes?: string;
}

export interface CostEstimateOutput {
  user_count: number;
  stance: TenantStance;
  workload?: AzureWorkload;
  license_monthly: number;
  license_annual: number;
  infrastructure_monthly: number;
  infrastructure_annual: number;
  total_monthly: number;
  total_annual: number;
  line_items: CostLineItem[];
  effective_date: string;
}

export const TENANT_STANCE_LABELS: Record<TenantStance, string> = {
  m365_only: 'M365 Only',
  m365_sentinel: 'M365 + Sentinel',
  m365_azure: 'M365 + Azure (Full)',
};

export const AZURE_WORKLOAD_LABELS: Record<AzureWorkload, string> = {
  light: 'Light (50 GB/day)',
  medium: 'Medium (150 GB/day)',
  heavy: 'Heavy (300 GB/day)',
};
