// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type {
  CostEstimateInput,
  CostEstimateOutput,
  CostLineItem,
  AzureWorkload,
} from '../types';

// --- Pricing constants ---

/** G5 license cost per user per month (pre-July 2026) */
const G5_BASE_PRICE = 93;

/** G5 license cost increase after July 2026 (+5%) */
const G5_POST_JULY_2026_PRICE = 97.65;

/** Date threshold for price increase: 2026-07-01T00:00:00Z */
const PRICE_INCREASE_DATE = new Date('2026-07-01T00:00:00Z');

/** Sentinel GCC High estimated commitment tier rate per GB */
const SENTINEL_RATE_PER_GB = 3.5;

/** Sentinel daily ingestion volumes by workload tier (GB/day) */
const SENTINEL_DAILY_GB: Record<AzureWorkload, number> = {
  light: 50,
  medium: 150,
  heavy: 300,
};

/** Days per month for Sentinel cost calculation */
const DAYS_PER_MONTH = 30;

/** Months per year */
const MONTHS_PER_YEAR = 12;

// --- Azure infrastructure fixed costs (m365_azure stance only) ---

/** VNet regional flat estimate for GCC High Gov Virginia */
const VNET_MONTHLY = 7;

/** Key Vault base + estimated 10k ops/month */
const KEY_VAULT_MONTHLY = 5;

/** Storage (WORM) 100 GB base at LRS tier with immutability multiplier */
const STORAGE_MONTHLY = 150;

// --- Calculator ---

/**
 * Calculate GCC High G5 cost estimate.
 * Pure function with no side effects or DB access.
 */
export function calculateG5Cost(input: CostEstimateInput): CostEstimateOutput {
  const now = new Date();
  const effectiveDate = now.toISOString();

  // Date-aware G5 license pricing
  const g5Price = now >= PRICE_INCREASE_DATE ? G5_POST_JULY_2026_PRICE : G5_BASE_PRICE;
  const priceNote =
    now >= PRICE_INCREASE_DATE
      ? 'Post-July 2026 rate (+5% increase applied)'
      : 'Pre-July 2026 rate';

  const licenseMo = input.user_count * g5Price;
  const licenseAn = licenseMo * MONTHS_PER_YEAR;

  const lineItems: CostLineItem[] = [
    {
      component: 'M365 G5 Licenses',
      description: `${input.user_count} users x $${g5Price}/user/month`,
      monthly_cost: licenseMo,
      annual_cost: licenseAn,
      notes: priceNote,
    },
  ];

  let infraMo = 0;

  // Sentinel costs (m365_sentinel and m365_azure stances only)
  if (input.stance !== 'm365_only' && input.workload) {
    const dailyGB = SENTINEL_DAILY_GB[input.workload];
    const sentinelMo = dailyGB * DAYS_PER_MONTH * SENTINEL_RATE_PER_GB;
    const sentinelAn = sentinelMo * MONTHS_PER_YEAR;
    infraMo += sentinelMo;

    lineItems.push({
      component: 'Microsoft Sentinel',
      description: `${dailyGB} GB/day x 30 days x $${SENTINEL_RATE_PER_GB}/GB`,
      monthly_cost: sentinelMo,
      annual_cost: sentinelAn,
      notes: 'Estimated GCC High commitment tier rate. Includes M365 + Azure logs combined.',
    });
  }

  // Azure infrastructure components (m365_azure stance only)
  if (input.stance === 'm365_azure') {
    lineItems.push({
      component: 'Azure VNet',
      description: 'Regional flat estimate (GCC High Gov Virginia)',
      monthly_cost: VNET_MONTHLY,
      annual_cost: VNET_MONTHLY * MONTHS_PER_YEAR,
      notes: 'Planning estimate',
    });
    infraMo += VNET_MONTHLY;

    lineItems.push({
      component: 'Azure Key Vault',
      description: 'Base + estimated 10k operations/month',
      monthly_cost: KEY_VAULT_MONTHLY,
      annual_cost: KEY_VAULT_MONTHLY * MONTHS_PER_YEAR,
      notes: 'Planning estimate',
    });
    infraMo += KEY_VAULT_MONTHLY;

    lineItems.push({
      component: 'Azure Storage (WORM)',
      description: '100 GB LRS with 1.5x immutability multiplier, 7-year retention',
      monthly_cost: STORAGE_MONTHLY,
      annual_cost: STORAGE_MONTHLY * MONTHS_PER_YEAR,
      notes: 'Planning estimate',
    });
    infraMo += STORAGE_MONTHLY;
  }

  const infraAn = infraMo * MONTHS_PER_YEAR;
  const totalMo = licenseMo + infraMo;
  const totalAn = licenseAn + infraAn;

  return {
    user_count: input.user_count,
    stance: input.stance,
    workload: input.stance === 'm365_only' ? undefined : input.workload,
    license_monthly: licenseMo,
    license_annual: licenseAn,
    infrastructure_monthly: infraMo,
    infrastructure_annual: infraAn,
    total_monthly: totalMo,
    total_annual: totalAn,
    line_items: lineItems,
    effective_date: effectiveDate,
  };
}

/**
 * Format a CostEstimateOutput as a markdown report for clipboard export.
 */
export function formatCostReportMarkdown(output: CostEstimateOutput): string {
  const stanceLabels: Record<string, string> = {
    m365_only: 'M365 Only',
    m365_sentinel: 'M365 + Sentinel',
    m365_azure: 'M365 + Azure (Full)',
  };

  const workloadLabels: Record<string, string> = {
    light: 'Light (50 GB/day)',
    medium: 'Medium (150 GB/day)',
    heavy: 'Heavy (300 GB/day)',
  };

  const lines: string[] = [
    '# GCC High G5 Cost Estimate',
    '',
    '## Configuration',
    `- **Users:** ${output.user_count}`,
    `- **Infrastructure Stance:** ${stanceLabels[output.stance] ?? output.stance}`,
  ];

  if (output.workload) {
    lines.push(`- **Azure Workload:** ${workloadLabels[output.workload] ?? output.workload}`);
  }

  lines.push(
    '',
    '## Summary',
    `| Category | Monthly | Annual |`,
    `|----------|---------|--------|`,
    `| Licensing | $${fmt(output.license_monthly)} | $${fmt(output.license_annual)} |`,
    `| Infrastructure | $${fmt(output.infrastructure_monthly)} | $${fmt(output.infrastructure_annual)} |`,
    `| **Total** | **$${fmt(output.total_monthly)}** | **$${fmt(output.total_annual)}** |`,
    '',
    '## Line Items',
    `| Component | Description | Monthly | Annual | Notes |`,
    `|-----------|-------------|---------|--------|-------|`,
  );

  for (const item of output.line_items) {
    lines.push(
      `| ${item.component} | ${item.description} | $${fmt(item.monthly_cost)} | $${fmt(item.annual_cost)} | ${item.notes ?? ''} |`,
    );
  }

  lines.push('', `*Effective date: ${output.effective_date}*`);
  lines.push('', '*These are planning estimates and are not billing-precise values.*');

  return lines.join('\n');
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
