// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState } from 'react';
import { DEV_MODE } from '@/shared/config';
import type { BTCDecisionLogEntry } from '@/shared/types/artifacts';

interface DecisionLogViewerProps {
  entries: BTCDecisionLogEntry[];
}

export function DecisionLogViewer({ entries }: DecisionLogViewerProps) {
  const [expanded, setExpanded] = useState(false);

  if (!DEV_MODE) return null;
  if (entries.length === 0) return null;

  const matchedCount = entries.filter((e) => e.result === 'matched').length;
  const skippedCount = entries.filter((e) => e.result === 'skipped').length;

  return (
    <div className="bg-gray-800 text-gray-200 rounded-lg border border-gray-700">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-gray-700 rounded-lg"
      >
        <span className="flex items-center gap-2">
          <span className="text-xs bg-gray-600 px-1.5 py-0.5 rounded">DEV</span>
          Decision Log ({matchedCount} matched, {skippedCount} skipped)
        </span>
        <span className="text-xs text-gray-400">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2">
          {entries.map((entry, idx) => (
            <details key={idx} className="border border-gray-600 rounded">
              <summary className="px-3 py-2 text-xs cursor-pointer flex items-center gap-2 hover:bg-gray-700">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                    entry.result === 'matched'
                      ? 'bg-green-800 text-green-200'
                      : 'bg-gray-600 text-gray-300'
                  }`}
                >
                  {entry.result}
                </span>
                <span className="font-mono text-gray-300">{entry.rule_id}</span>
                <span className="text-gray-400 truncate">{entry.description}</span>
              </summary>
              <div className="px-3 py-2 text-xs font-mono bg-gray-900 rounded-b">
                <p className="text-gray-400 mb-1">Inputs evaluated:</p>
                <pre className="text-gray-300 whitespace-pre-wrap">
                  {JSON.stringify(entry.inputs_evaluated, null, 2)}
                </pre>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
