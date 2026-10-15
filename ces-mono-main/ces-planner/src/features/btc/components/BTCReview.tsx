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
import { useBTCStore } from '../stores/btcStore';
import { generateArtifactId } from '@/shared/utils/idGenerator';
import { persistBTCConfirmation } from '@/shared/services/artifactPersistence';
import { DecisionLogViewer } from './DecisionLogViewer';
import clsx from 'clsx';
import type { BTCConfirmationOutput } from '@/shared/types/artifacts';

interface BTCReviewProps {
  confirmation: BTCConfirmationOutput;
  customerId: number;
  onBack: () => void;
}

export function BTCReview({ confirmation, customerId, onBack }: BTCReviewProps) {
  const navigate = useNavigate();
  const { selectedBaselineId, selectedCUIBoundaryId, setSelectedBTCConfirmationId } = useAppStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const btcConf = confirmation.btc_confirmation;
  const gates = Object.entries(btcConf.gate_status);
  const passCount = gates.filter(([, g]) => g.pass).length;
  const failCount = gates.filter(([, g]) => !g.pass).length;

  const handleSave = async () => {
    if (!selectedBaselineId || !selectedCUIBoundaryId) {
      setError('Missing baseline or CUI boundary selection.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const artifactId = generateArtifactId('btc_confirmation');
      const id = await dbHelpers.createBTC({
        customerId,
        baselineId: selectedBaselineId,
        cuiBoundaryId: selectedCUIBoundaryId,
        artifactId,
        data: confirmation,
        createdAt: new Date().toISOString(),
      });
      await persistBTCConfirmation(confirmation, customerId, artifactId);
      setSelectedBTCConfirmationId(id);
      useBTCStore.getState().reset();
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save BTC confirmation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">BTC Confirmation Review</h1>
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
            {saving ? 'Saving...' : 'Save BTC Confirmation'}
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
          <span className="text-gray-900">{confirmation.ces.artifact}</span>
          <span className="text-gray-500">Generated:</span>
          <span className="text-gray-900">{confirmation.ces.generated_on}</span>
          <span className="text-gray-500">Bank Version:</span>
          <span className="text-gray-900">{confirmation.ces.btc_bank_version}</span>
          <span className="text-gray-500">Activation Pkg:</span>
          <span className="text-gray-900">{confirmation.ces.activation_package_version}</span>
        </div>
      </div>

      {/* Gate Status */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Gate Status ({passCount} pass, {failCount} fail)
        </h2>
        <div className="space-y-2">
          {gates.map(([sectionId, gate]) => (
            <div
              key={sectionId}
              className={clsx(
                'flex items-center justify-between p-3 rounded-md border',
                gate.pass ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
              )}
            >
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {sectionId} — {gate.domain}
                </p>
                <p className="text-xs text-gray-600 mt-0.5">{gate.reason}</p>
              </div>
              <span
                className={clsx(
                  'text-xs font-medium px-2 py-1 rounded',
                  gate.pass ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'
                )}
              >
                {gate.pass ? 'PASS' : 'FAIL'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Risk Flags */}
      {btcConf.risk_flags.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-amber-900 mb-3">
            Risk Flags ({btcConf.risk_flags.length})
          </h2>
          <div className="space-y-2">
            {btcConf.risk_flags.map((flag) => (
              <div key={flag.flag_id} className="flex items-start gap-2 text-sm">
                <svg
                  className="w-4 h-4 text-amber-600 shrink-0 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <p className="font-medium text-amber-800">{flag.description}</p>
                  <p className="text-xs text-amber-600">
                    Domain: {flag.domain} &middot; Rule: {flag.source_rule_id}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Evidence Summary */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Evidence ({btcConf.evidence_refs.length} items)
        </h2>
        {btcConf.evidence_refs.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No evidence items attached.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {btcConf.evidence_refs.map((e) => (
              <div key={e.evidence_id} className="py-2 flex items-start gap-4 text-sm">
                <span className="text-gray-400 font-mono text-xs w-24 shrink-0 truncate">
                  {e.question_id}
                </span>
                <div className="min-w-0">
                  <p className="text-gray-700 truncate">{e.location}</p>
                  <p className="text-xs text-gray-400">
                    {e.source_system} &middot; {e.captured_at}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Answers */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Answers ({Object.keys(btcConf.answers).length})
        </h2>
        <div className="divide-y divide-gray-100">
          {Object.entries(btcConf.answers).map(([qid, a]) => (
            <div key={qid} className="py-2 flex items-start gap-4 text-sm">
              <span className="text-gray-400 font-mono text-xs w-28 shrink-0">{qid}</span>
              <span className="text-gray-700">{String(a.answer)}</span>
              {a.mode !== 'full' && (
                <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                  {a.mode}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Decision Log */}
      <DecisionLogViewer entries={btcConf.decision_log} />
    </div>
  );
}
