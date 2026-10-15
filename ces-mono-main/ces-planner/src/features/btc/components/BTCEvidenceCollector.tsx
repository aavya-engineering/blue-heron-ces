// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState } from 'react';
import { useBTCStore } from '../stores/btcStore';
import { generateId, generateSHA256 } from '@/shared/utils/idGenerator';
import type { BTCEvidenceRef } from '@/shared/types/artifacts';

interface BTCEvidenceCollectorProps {
  questionId: string;
  existingEvidence: BTCEvidenceRef[];
  evidenceHints?: Record<string, string>;
}

export function BTCEvidenceCollector({
  questionId,
  existingEvidence,
  evidenceHints,
}: BTCEvidenceCollectorProps) {
  const { addEvidence, removeEvidence } = useBTCStore();
  const [location, setLocation] = useState('');
  const [sourceSystem, setSourceSystem] = useState('');
  const [notes, setNotes] = useState('');

  const handleAdd = () => {
    if (!location.trim()) return;

    const evidence: BTCEvidenceRef = {
      evidence_id: generateId('ev'),
      source_system: sourceSystem.trim() || 'manual',
      location: location.trim(),
      hash_sha256: generateSHA256(location + new Date().toISOString()),
      captured_at: new Date().toISOString(),
      question_id: questionId,
      notes: notes.trim() || undefined,
    };

    addEvidence(evidence);
    setLocation('');
    setSourceSystem('');
    setNotes('');
  };

  return (
    <div className="space-y-3">
      {evidenceHints && Object.keys(evidenceHints).length > 0 && (
        <div className="text-xs text-gray-500">
          <span className="font-medium">Expected evidence: </span>
          {Object.keys(evidenceHints).join(', ')}
        </div>
      )}

      {/* Existing evidence */}
      {existingEvidence.length > 0 && (
        <ul className="space-y-1">
          {existingEvidence.map((e) => (
            <li
              key={e.evidence_id}
              className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded px-3 py-1.5 text-sm"
            >
              <div className="min-w-0">
                <span className="text-gray-700 truncate block">{e.location}</span>
                <span className="text-xs text-gray-400">{e.source_system}</span>
              </div>
              <button
                onClick={() => removeEvidence(e.evidence_id)}
                className="text-red-500 hover:text-red-700 ml-2 shrink-0"
                title="Remove"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add evidence form */}
      <div className="border border-gray-200 rounded-md p-3 space-y-2">
        <p className="text-xs font-medium text-gray-600">Attach Evidence</p>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Location (URL, file path, or reference)"
          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
        <input
          type="text"
          value={sourceSystem}
          onChange={(e) => setSourceSystem(e.target.value)}
          placeholder="Source system (e.g., Entra, Intune, Sentinel)"
          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          rows={2}
          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
        <button
          onClick={handleAdd}
          disabled={!location.trim()}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add Evidence
        </button>
      </div>
    </div>
  );
}
