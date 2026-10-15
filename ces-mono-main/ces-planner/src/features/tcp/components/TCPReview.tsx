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
import { useTCPStore } from '../stores/tcpStore';
import { generateArtifactId } from '@/shared/utils/idGenerator';
import { persistTenantConfigProfile } from '@/shared/services/artifactPersistence';
import type { TenantConfigProfileOutput } from '@/shared/types/artifacts';

interface TCPReviewProps {
  profile: TenantConfigProfileOutput;
  bankVersion: string;
  customerId: number;
  onBack: () => void;
}

const SECTION_LABELS: Record<string, string> = {
  identity: 'Tenant Identity',
  licensing: 'Licensing',
  identity_architecture: 'Identity Architecture',
  privileged_access: 'Privileged Access',
  group_architecture: 'Group Architecture',
  conditional_access: 'Conditional Access',
  device_management: 'Device Management',
  data_protection: 'Data Protection',
  monitoring: 'Monitoring & SIEM',
};

function renderValue(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (Array.isArray(val)) {
    if (val.length === 0) return '—';
    if (typeof val[0] === 'object') return JSON.stringify(val, null, 2);
    return val.join(', ');
  }
  if (typeof val === 'object') {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return '—';
    return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
  }
  return String(val);
}

export function TCPReview({ profile, customerId, onBack }: TCPReviewProps) {
  const navigate = useNavigate();
  const { selectedBaselineId, setSelectedTenantConfigId } = useAppStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!selectedBaselineId) {
      setError('No baseline selected. Please select a baseline from the dashboard.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const artifactId = generateArtifactId('tenant_config_profile');
      const id = await dbHelpers.createTenantConfigProfile({
        customerId,
        baselineId: selectedBaselineId,
        artifactId,
        data: profile,
        createdAt: new Date().toISOString(),
      });
      await persistTenantConfigProfile(profile, customerId, artifactId);
      setSelectedTenantConfigId(id);
      useTCPStore.getState().reset();
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save tenant config profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Tenant Config Profile Review</h1>
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
            {saving ? 'Saving...' : 'Save Profile'}
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
          <span className="text-gray-900">{profile.ces.artifact}</span>
          <span className="text-gray-500">Version:</span>
          <span className="text-gray-900">{profile.ces.version}</span>
          <span className="text-gray-500">Generated:</span>
          <span className="text-gray-900">{profile.ces.generated_on}</span>
          <span className="text-gray-500">Bank Version:</span>
          <span className="text-gray-900">{profile.ces.tcp_bank_version}</span>
        </div>
      </div>

      {/* Profile by section */}
      {Object.entries(profile.tenant_config).map(([sectionKey, sectionData]) => (
        <div key={sectionKey} className="bg-white border border-gray-200 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            {SECTION_LABELS[sectionKey] || sectionKey}
          </h2>
          <div className="divide-y divide-gray-100">
            {Object.entries(sectionData as Record<string, unknown>).map(([key, val]) => (
              <div key={key} className="py-2 flex items-start gap-4">
                <span className="text-sm font-medium text-gray-700 w-64 shrink-0">
                  {key.replace(/_/g, ' ')}
                </span>
                <span className="text-sm text-gray-900 whitespace-pre-wrap">
                  {renderValue(val)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
