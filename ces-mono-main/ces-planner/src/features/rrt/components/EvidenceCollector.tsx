// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState } from 'react';
import type { EvidenceItem } from '../types';
import { generateId } from '@/shared/utils/idGenerator';
import { toISODateTime } from '@/shared/utils/dateFormatter';

interface EvidenceCollectorProps {
  evidence: EvidenceItem[];
  onAdd: (evidence: EvidenceItem) => void;
  onRemove: (evidenceId: string) => void;
}

export function EvidenceCollector({ evidence, onAdd, onRemove }: EvidenceCollectorProps) {
  const [showForm, setShowForm] = useState(false);
  const [location, setLocation] = useState('');
  const [sourceSystem, setSourceSystem] = useState('');
  const [archetypeId, setArchetypeId] = useState('');
  const [notes, setNotes] = useState('');

  const handleAdd = () => {
    if (!location || !sourceSystem) {
      alert('Please provide location and source system');
      return;
    }

    const newEvidence: EvidenceItem = {
      evidence_id: generateId(),
      source_system: sourceSystem,
      location,
      hash_sha256: generateId(), // In production, compute actual hash
      captured_at: toISODateTime(new Date()),
      archetype_id: archetypeId || 'general',
      notes: notes || undefined,
    };

    onAdd(newEvidence);

    // Reset form
    setLocation('');
    setSourceSystem('');
    setArchetypeId('');
    setNotes('');
    setShowForm(false);
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-gray-900">Evidence Items</h4>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="text-sm text-blue-600 hover:text-blue-700"
        >
          {showForm ? 'Cancel' : '+ Add Evidence'}
        </button>
      </div>

      {showForm && (
        <div className="mb-4 p-3 bg-gray-50 rounded border border-gray-200 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Location (file path, URL, etc.)
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="/path/to/evidence.pdf"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Source System</label>
            <input
              type="text"
              value={sourceSystem}
              onChange={(e) => setSourceSystem(e.target.value)}
              placeholder="e.g., Azure AD, SIEM, etc."
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Archetype ID (optional)
            </label>
            <input
              type="text"
              value={archetypeId}
              onChange={(e) => setArchetypeId(e.target.value)}
              placeholder="e.g., access_control_list"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="button"
            onClick={handleAdd}
            className="w-full px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            Add Evidence
          </button>
        </div>
      )}

      <div className="space-y-2">
        {evidence.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No evidence items added</p>
        ) : (
          evidence.map((item) => (
            <div
              key={item.evidence_id}
              className="flex items-start justify-between p-2 bg-gray-50 rounded border border-gray-200"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{item.location}</p>
                <p className="text-xs text-gray-500">
                  {item.source_system} • {item.archetype_id}
                </p>
                {item.notes && <p className="text-xs text-gray-600 mt-1">{item.notes}</p>}
              </div>
              <button
                type="button"
                onClick={() => onRemove(item.evidence_id)}
                className="ml-2 text-red-600 hover:text-red-700"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
