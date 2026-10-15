// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState } from 'react';
import type { CostEstimateOutput } from '../types';
import { TENANT_STANCE_LABELS, AZURE_WORKLOAD_LABELS } from '../types';
import { formatCostReportMarkdown } from '../services/g5CostCalculator';

interface CostReportDisplayProps {
  output: CostEstimateOutput;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CostReportDisplay({ output }: CostReportDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const markdown = formatCostReportMarkdown(output);
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Configuration summary */}
      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 print:border-gray-400">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Configuration</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <span className="text-gray-500">Users:</span>{' '}
            <span className="font-medium">{output.user_count}</span>
          </div>
          <div>
            <span className="text-gray-500">Stance:</span>{' '}
            <span className="font-medium">{TENANT_STANCE_LABELS[output.stance]}</span>
          </div>
          {output.workload && (
            <div>
              <span className="text-gray-500">Workload:</span>{' '}
              <span className="font-medium">{AZURE_WORKLOAD_LABELS[output.workload]}</span>
            </div>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          label="Licensing"
          monthly={output.license_monthly}
          annual={output.license_annual}
          color="blue"
        />
        <SummaryCard
          label="Infrastructure"
          monthly={output.infrastructure_monthly}
          annual={output.infrastructure_annual}
          color="amber"
        />
        <SummaryCard
          label="Total"
          monthly={output.total_monthly}
          annual={output.total_annual}
          color="green"
        />
      </div>

      {/* Line-item table */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm border border-gray-200 print:border-gray-400">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-4 py-2 text-left font-medium text-gray-700 border-b border-gray-200">
                Component
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-700 border-b border-gray-200">
                Description
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-700 border-b border-gray-200">
                Monthly
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-700 border-b border-gray-200">
                Annual
              </th>
            </tr>
          </thead>
          <tbody>
            {output.line_items.map((item, i) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="px-4 py-2 font-medium text-gray-900">{item.component}</td>
                <td className="px-4 py-2 text-gray-600">
                  {item.description}
                  {item.notes && (
                    <span className="block text-xs text-gray-400 mt-0.5">{item.notes}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right text-gray-900">${fmt(item.monthly_cost)}</td>
                <td className="px-4 py-2 text-right text-gray-900">${fmt(item.annual_cost)}</td>
              </tr>
            ))}
            <tr className="bg-gray-50 font-medium">
              <td className="px-4 py-2 text-gray-900" colSpan={2}>
                Total
              </td>
              <td className="px-4 py-2 text-right text-gray-900">${fmt(output.total_monthly)}</td>
              <td className="px-4 py-2 text-right text-gray-900">${fmt(output.total_annual)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Assumptions callout */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 print:border-amber-400">
        <p className="font-medium mb-1">Assumptions</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>G5 GCC High license pricing as of the effective date shown below.</li>
          <li>
            Sentinel costs use an estimated GCC High commitment tier rate of $3.50/GB.
          </li>
          <li>
            Azure infrastructure costs (VNet, Key Vault, Storage) are planning estimates, not
            billing-precise values.
          </li>
          <li>NSG is free and not included as a line item.</li>
          {output.stance === 'm365_azure' && (
            <li>
              Storage estimate assumes 100 GB base at LRS tier ($0.025/GB/mo) with 1.5x immutability
              multiplier for 7-year WORM retention.
            </li>
          )}
        </ul>
      </div>

      {/* Footer with effective date and export */}
      <div className="flex items-center justify-between border-t border-gray-200 pt-4 print:border-gray-400">
        <p className="text-xs text-gray-500">
          Effective date: {new Date(output.effective_date).toLocaleString()}
        </p>
        <button
          onClick={handleCopy}
          className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 print:hidden"
        >
          {copied ? 'Copied!' : 'Copy as Markdown'}
        </button>
      </div>

      <p className="text-xs text-gray-400 italic print:text-gray-600">
        These are planning estimates and are not billing-precise values.
      </p>
    </div>
  );
}

function SummaryCard({
  label,
  monthly,
  annual,
  color,
}: {
  label: string;
  monthly: number;
  annual: number;
  color: 'blue' | 'amber' | 'green';
}) {
  const styles = {
    blue: 'bg-blue-50 border-blue-200',
    amber: 'bg-amber-50 border-amber-200',
    green: 'bg-green-50 border-green-200',
  };

  return (
    <div className={`rounded-lg border p-4 ${styles[color]}`}>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-xl font-semibold text-gray-900 mt-1">${fmt(monthly)}</p>
      <p className="text-xs text-gray-500 mt-0.5">${fmt(annual)}/year</p>
    </div>
  );
}
