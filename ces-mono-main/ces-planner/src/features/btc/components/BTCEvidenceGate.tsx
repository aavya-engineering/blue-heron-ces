// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { BTCEvidenceRef } from '@/shared/types/artifacts';

interface BTCEvidenceGateProps {
  evidenceType?: string;
  evidenceSource?: string;
  attachedEvidence: BTCEvidenceRef[];
  evidenceGuidance?: string;
}

export function BTCEvidenceGate({
  evidenceType,
  evidenceSource,
  attachedEvidence,
  evidenceGuidance,
}: BTCEvidenceGateProps) {
  const met = attachedEvidence.length > 0;

  return (
    <div
      className={`rounded-md border p-3 ${
        met
          ? 'bg-green-50 border-green-200'
          : 'bg-amber-50 border-amber-300'
      }`}
    >
      <div className="flex items-center gap-2">
        {met ? (
          <svg className="w-5 h-5 text-green-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg className="w-5 h-5 text-amber-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
              clipRule="evenodd"
            />
          </svg>
        )}
        <div>
          <p className={`text-sm font-medium ${met ? 'text-green-800' : 'text-amber-800'}`}>
            {met
              ? `Evidence attached (${attachedEvidence.length})`
              : 'Evidence required'}
          </p>
          {(evidenceType || evidenceSource) && (
            <p className="text-xs text-gray-600 mt-0.5">
              {evidenceType && <span>Type: {evidenceType}</span>}
              {evidenceType && evidenceSource && <span> &middot; </span>}
              {evidenceSource && <span>Source: {evidenceSource}</span>}
            </p>
          )}
        </div>
      </div>
      {evidenceGuidance && (
        <p className="text-xs text-gray-600 mt-2 pl-7">{evidenceGuidance}</p>
      )}
    </div>
  );
}
