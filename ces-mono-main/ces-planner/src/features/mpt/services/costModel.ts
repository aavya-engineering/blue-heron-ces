// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Cost model data for M365 GCC High license tiers and infrastructure models.
// Cost estimates are static per-user averages, not real-time Azure billing.

export interface CostTierConfig {
  monthly_per_user: number;
  annual_base_50_users: number;
}

export interface InfraCostConfig {
  monthly_fixed: number;
  annual: number;
  description: string;
}

export interface ReadinessRating {
  rating: 'GREEN' | 'YELLOW' | 'RED';
  description: string;
}

export const LICENSE_TIER_COSTS: Record<string, CostTierConfig> = {
  business_premium: { monthly_per_user: 60, annual_base_50_users: 36000 },
  g3: { monthly_per_user: 56, annual_base_50_users: 33600 },
  g5: { monthly_per_user: 52, annual_base_50_users: 31200 },
};

export const INFRA_MODEL_COSTS: Record<string, InfraCostConfig> = {
  m365_only: { monthly_fixed: 0, annual: 0, description: 'No Azure infrastructure cost' },
  m365_sentinel: {
    monthly_fixed: 500,
    annual: 6000,
    description: 'Sentinel + Log Analytics (~5GB/day M365 log ingestion)',
  },
  m365_azure: {
    monthly_fixed: 1167,
    annual: 14000,
    description: 'Sentinel + Azure infrastructure (VNet, Key Vault, Storage, NSG)',
  },
};

// Static 3x3 readiness matrix with GREEN/YELLOW/RED ratings per infrastructure model + license tier
// GREEN = High confidence L2 readiness
// YELLOW = Moderate confidence (assessor pre-approval recommended)
// RED = Not recommended
export const READINESS_MATRIX: Record<string, Record<string, ReadinessRating>> = {
  m365_only: {
    business_premium: {
      rating: 'YELLOW',
      description:
        '50 users = $36k/yr. Gaps: 9 controls need manual alternatives + AU/IR feature gaps. Not recommended for L3.',
    },
    g3: {
      rating: 'YELLOW',
      description:
        '50 users = $33.6k/yr. Gaps: 9 Azure controls. Cost savings minimal vs G5.',
    },
    g5: {
      rating: 'GREEN',
      description:
        '50 users = $31.2k/yr. Gaps: 9 Azure controls only. RECOMMENDED for cost-sensitive orgs.',
    },
  },
  m365_sentinel: {
    business_premium: {
      rating: 'YELLOW',
      description:
        '50 users = $42k/yr (+$6k Sentinel). Closes AU/IR gaps. Missing advanced compliance features.',
    },
    g3: {
      rating: 'GREEN',
      description:
        '50 users = $39.6k/yr (+$6k Sentinel). Strong AU/IR coverage. Good cost/compliance balance.',
    },
    g5: {
      rating: 'GREEN',
      description:
        '50 users = $37.2k/yr (+$6k Sentinel). Strongest coverage without full Azure infra. RECOMMENDED default.',
    },
  },
  m365_azure: {
    business_premium: {
      rating: 'RED',
      description:
        '50 users = $50k+/yr (+$14k+ Azure). License tier insufficient for full Azure. Avoid this combination.',
    },
    g3: {
      rating: 'GREEN',
      description:
        '50 users = $47.6k+/yr (+$14k+ Azure). Full control coverage. Higher operational complexity.',
    },
    g5: {
      rating: 'GREEN',
      description:
        '50 users = $45.2k+/yr (+$14k+ Azure). Maximum coverage. Required for L3 or complex enclaves.',
    },
  },
};
