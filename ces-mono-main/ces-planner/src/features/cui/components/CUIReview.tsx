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
import { dbHelpers } from '@/shared/db/schema';
import { useAppStore } from '@/shared/stores/appStore';
import { useCUIStore } from '../stores/cuiStore';
import { generateArtifactId } from '@/shared/utils/idGenerator';
import { persistCUIBoundary } from '@/shared/services/artifactPersistence';
import type { CUIBoundaryOutput } from '@/shared/types/artifacts';

interface CUIReviewProps {
  boundary: CUIBoundaryOutput;
  bankVersion: string;
  customerId: number;
  onBack: () => void;
}

export function CUIReview({ boundary, customerId, onBack }: CUIReviewProps) {
  const navigate = useNavigate();
  const { selectedBaselineId, setSelectedCUIBoundaryId } = useAppStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries = Object.entries(boundary.cui_boundary);

  // Collect risk-related keys
  const riskKeys = entries.filter(
    ([key]) =>
      key.includes('risk') ||
      key === 'byod_model' ||
      key === 'guest_access_policy' ||
      key === 'backup_model'
  );

  const handleSave = async () => {
    if (!selectedBaselineId) {
      setError('No baseline selected. Please select a baseline from the dashboard.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const artifactId = generateArtifactId('cui_boundary');
      const id = await dbHelpers.createCUIBoundary({
        customerId,
        baselineId: selectedBaselineId,
        artifactId,
        data: boundary,
        createdAt: new Date().toISOString(),
      });
      await persistCUIBoundary(boundary, customerId, artifactId);
      setSelectedCUIBoundaryId(id);
      useCUIStore.getState().reset();
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save CUI boundary');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">CUI Boundary Review</h1>
        <div className="flex gap-2">
          <button
            onClick={onBack}
            className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Back to Questions
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 text-sm font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save CUI Boundary'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Metadata */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Artifact Metadata</h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <span className="text-gray-500">Artifact:</span>
          <span className="text-gray-900">{boundary.ces.artifact}</span>
          <span className="text-gray-500">Version:</span>
          <span className="text-gray-900">{boundary.ces.version}</span>
          <span className="text-gray-500">Generated:</span>
          <span className="text-gray-900">{boundary.ces.generated_on}</span>
          <span className="text-gray-500">Bank Version:</span>
          <span className="text-gray-900">{boundary.ces.cui_bank_version}</span>
        </div>
      </div>

      {/* Boundary Values */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Boundary Definition</h2>
        <div className="divide-y divide-gray-100">
          {entries.map(([key, val]) => (
            <div key={key} className="py-2 flex items-start gap-4">
              <span className="text-sm font-medium text-gray-700 w-64 shrink-0">
                {key.replace(/_/g, ' ')}
              </span>
              <span className="text-sm text-gray-900">
                {Array.isArray(val) ? val.join(', ') : String(val)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Risk Flags Summary */}
      {riskKeys.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-amber-900 mb-3">Risk-Related Fields</h2>
          <div className="space-y-2">
            {riskKeys.map(([key, val]) => (
              <div key={key} className="flex items-center gap-3 text-sm">
                <svg className="w-4 h-4 text-amber-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="font-medium text-amber-800">{key.replace(/_/g, ' ')}:</span>
                <span className="text-amber-700">
                  {Array.isArray(val) ? val.join(', ') : String(val)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
