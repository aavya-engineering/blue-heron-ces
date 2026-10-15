// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/shared/components/Display/Card';
import { CostEstimatorForm } from './CostEstimatorForm';
import { CostReportDisplay } from './CostReportDisplay';
import { calculateTenantCost } from '../services/tenantCost';
import type { CostEstimateInput, CostEstimateOutput } from '../types';

export function CostEstimatorPage() {
  const navigate = useNavigate();
  const [result, setResult] = useState<CostEstimateOutput | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleCalculate = (input: CostEstimateInput) => {
    const r = calculateTenantCost(input);
    if (r.kind === 'estimate') {
      setResult(r.output);
      setNotice(null);
    } else {
      setResult(null);
      setNotice(r.message);
    }
  };

  const handleReset = () => {
    setResult(null);
    setNotice(null);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tenant Cost Estimator</h1>
          <p className="text-sm text-gray-500 mt-1">
            GCC High G5 monthly cost estimate with line-item breakdown
          </p>
        </div>
        <button
          onClick={() => navigate('/dashboard')}
          className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Back to Dashboard
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <Card title="Estimate Configuration">
            <CostEstimatorForm onCalculate={handleCalculate} />
          </Card>
        </div>

        <div className="lg:col-span-2">
          {result ? (
            <Card
              title="Cost Estimate Report"
              headerAction={
                <button
                  onClick={handleReset}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Clear
                </button>
              }
            >
              <CostReportDisplay output={result} />
            </Card>
          ) : notice ? (
            <Card
              title="Cost Estimate Report"
              headerAction={
                <button onClick={handleReset} className="text-sm text-gray-500 hover:text-gray-700">
                  Clear
                </button>
              }
            >
              <div className="flex items-center justify-center min-h-[300px]">
                <div className="max-w-md text-center bg-amber-50 border border-amber-200 rounded-lg p-6">
                  <p className="text-sm font-medium text-amber-800 mb-1">Cost model not available</p>
                  <p className="text-sm text-amber-700">{notice}</p>
                </div>
              </div>
            </Card>
          ) : (
            <Card title="Cost Estimate Report">
              <div className="flex items-center justify-center min-h-[300px]">
                <p className="text-sm text-gray-400 italic">
                  Configure inputs and click Calculate to generate a cost estimate.
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
