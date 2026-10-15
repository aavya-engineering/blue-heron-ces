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
import type { SIBaseline } from '@/shared/types/artifacts';
import { Card } from '@/shared/components/Display/Card';
import { Badge } from '@/shared/components/Display/Badge';
import { dbHelpers } from '@/shared/db/schema';
import { validateSIBaseline } from '@/shared/validation/validators';
import { Alert } from '@/shared/components/Display/Alert';
import { generateArtifactId, generateCesId } from '@/shared/utils/idGenerator';
import { persistSIBaseline } from '@/shared/services/artifactPersistence';

interface BaselineReviewProps {
  baseline: SIBaseline;
  customerId: number;
  onBack: () => void;
}

export function BaselineReview({ baseline, customerId, onBack }: BaselineReviewProps) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      // Get customer name for cesId generation
      const customer = await dbHelpers.getCustomerById(customerId);
      const customerName = customer?.name || 'Unknown';
      const timestamp = new Date().toISOString();

      // Generate cesId
      const cesId = await generateCesId(customerName, timestamp);

      // Inject cesId into baseline
      const baselineWithCesId = {
        ...baseline,
        ces: {
          ...baseline.ces,
          cesId,
        },
      };

      // Validate against schema (non-blocking)
      const validation = validateSIBaseline(baselineWithCesId);
      if (!validation.valid) {
        console.warn('Schema validation warnings for SI Baseline:', validation.errors);
      }

      // Save to database
      const artifactId = generateArtifactId('si_baseline');
      const id = await dbHelpers.createSIBaseline({
        customerId,
        artifactId,
        cesId,
        data: baselineWithCesId,
        createdAt: timestamp,
        isImmutable: true,
      });

      // Persist to local disk
      await persistSIBaseline(baselineWithCesId, customerId, artifactId);

      console.log('SI Baseline saved with ID:', id, 'cesId:', cesId);
      navigate('/dashboard');
    } catch (err) {
      console.error('Error saving baseline:', err);
      setError(err instanceof Error ? err.message : 'Failed to save baseline');
      setSaving(false);
    }
  };

  const si = baseline.si_baseline;

  return (
    <div className="max-w-6xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Review Strategic Intent Baseline</h1>
        <p className="text-gray-600">
          Review the normalized baseline before saving. Once saved, this baseline becomes immutable.
        </p>
      </div>

      {error && (
        <Alert variant="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div className="space-y-6">
        <Card title="Target">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(si.target || {}).map(([key, value]) => (
              <div key={key}>
                <dt className="text-sm font-medium text-gray-500">{formatFieldName(key)}</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Assessment">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(si.assessment || {}).map(([key, value]) => (
              <div key={key}>
                <dt className="text-sm font-medium text-gray-500">{formatFieldName(key)}</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Scope">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(si.scope || {}).map(([key, value]) => (
              <div key={key}>
                <dt className="text-sm font-medium text-gray-500">{formatFieldName(key)}</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Operations">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(si.operations || {}).map(([key, value]) => (
              <div key={key}>
                <dt className="text-sm font-medium text-gray-500">{formatFieldName(key)}</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Evidence">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(si.evidence || {}).map(([key, value]) => (
              <div key={key}>
                <dt className="text-sm font-medium text-gray-500">{formatFieldName(key)}</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Dependencies">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(si.dependencies || {}).map(([key, value]) => (
              <div key={key}>
                <dt className="text-sm font-medium text-gray-500">{formatFieldName(key)}</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Risk Acceptance">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(si.risk_acceptance || {}).map(([key, value]) => (
              <div key={key}>
                <dt className="text-sm font-medium text-gray-500">{formatFieldName(key)}</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Governance">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(si.governance || {}).map(([key, value]) => (
              <div key={key}>
                <dt className="text-sm font-medium text-gray-500">{formatFieldName(key)}</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatValue(value)}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Metadata">
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">Artifact</dt>
              <dd className="mt-1 text-sm text-gray-900 font-mono">{baseline.ces.artifact}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Version</dt>
              <dd className="mt-1 text-sm text-gray-900">{baseline.ces.version}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Generated On</dt>
              <dd className="mt-1 text-sm text-gray-900">{baseline.ces.generated_on}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Status</dt>
              <dd className="mt-1">
                <Badge variant="warning">Immutable (Once Saved)</Badge>
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="mt-8 flex justify-between">
        <button
          onClick={onBack}
          disabled={saving}
          className="px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Back to Questions
        </button>

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {saving ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Saving...
            </>
          ) : (
            'Save Baseline (Immutable)'
          )}
        </button>
      </div>
    </div>
  );
}

function formatFieldName(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatValue(value: any): string {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'None';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}
