// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// M2 — Discovery offer screen. Presents the Discovery pitch (copy sourced
// entirely from discoveryOfferCopy.ts) and transitions to either the
// Discovery sub-tab flow (Run Discovery) or straight to the manual interview
// (Skip — M5 manual-branch parity, empty discovery fact set).
//
// GO-2 M3 adds the third path: import an admin-run script's results file
// (auth-ladder tier 2; script-upload == import-file, ONE mechanism). The file
// is read locally (FileReader — zero network) and, when valid, flows through
// the SAME boundary confirm/correct step a fixture run uses.
import { useState } from 'react';
import { DISCOVERY_OFFER_COPY } from './discoveryOfferCopy';
import type { DiscoveryResult } from '@/__fixtures__/discoveryResults';
import type { InterviewFact } from '@/shared/types/engagement';
import { parseDiscoveryResultsFile } from './importResultsFile';
import {
  looksLikeReadinessResult,
  parseReadinessResultFile,
  discoveryResultsFromPayload,
  factsFromPayload,
  consentsFromPayload,
} from './importReadinessResult';
import type { ReadinessConsent } from '@/shared/types/readinessResult';

export default function DiscoveryOffer({
  onRunDiscovery,
  onSkip,
  onImportResults,
  runBusy = false,
  runError = '',
  onHarvestFromTenant,
  harvestBusy = false,
  harvestError = '',
}: {
  /** W4-MU2 (MU-06): prefill the interview from the tenant's Graph (sim). */
  onHarvestFromTenant?: () => void;
  harvestBusy?: boolean;
  harvestError?: string;
  onRunDiscovery: () => void;
  /** W4-MU2: a real discovery run is in progress (muster-api sim job). */
  runBusy?: boolean;
  /** W4-MU2: why the last run failed — shown honestly; file import stays available. */
  runError?: string;
  onSkip: () => void;
  /** PLAN-2 M1: payloadFacts present only for a readiness-result.v1 import. */
  onImportResults: (results: DiscoveryResult[], payloadFacts?: InterviewFact[], payloadConsents?: ReadinessConsent[]) => void;
}) {
  const [importError, setImportError] = useState('');

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        // PLAN-2 M1: one input, two flavors, ONE downstream seam. A
        // readiness-result payload contributes its observations AND its
        // already-recorded facts; a bare results file contributes rows only.
        let sniffed: unknown = null;
        try { sniffed = JSON.parse(text); } catch { /* parseDiscoveryResultsFile reports */ }
        if (looksLikeReadinessResult(sniffed)) {
          const payload = parseReadinessResultFile(text);
          onImportResults(discoveryResultsFromPayload(payload), factsFromPayload(payload), consentsFromPayload(payload));
        } else {
          onImportResults(parseDiscoveryResultsFile(text));
        }
        setImportError('');
      } catch (e) {
        setImportError(e instanceof Error ? e.message : String(e));
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="page" data-testid="discovery-offer">
      <div className="ces-titleblock" style={{ marginBottom: 16 }}>
        <span className="tb-title">{DISCOVERY_OFFER_COPY.heading}</span>
      </div>

      <p>{DISCOVERY_OFFER_COPY.body}</p>

      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button
          className="btn btn-primary"
          data-testid="discovery-run-btn"
          onClick={onRunDiscovery}
          disabled={runBusy}
        >
          {runBusy ? 'Running discovery…' : DISCOVERY_OFFER_COPY.runButtonLabel}
        </button>
        <button
          className="btn"
          data-testid="discovery-skip-btn"
          onClick={onSkip}
        >
          {DISCOVERY_OFFER_COPY.skipButtonLabel}
        </button>
      </div>

      {onHarvestFromTenant && (
        <div style={{ marginTop: 12 }}>
          <button
            className="btn"
            data-testid="harvest-sim-btn"
            onClick={onHarvestFromTenant}
            disabled={harvestBusy}
          >
            {harvestBusy ? 'Reading the tenant…' : 'Prefill from tenant (Graph, sim)'}
          </button>
          {harvestError && (
            <p className="badge badge-violation" data-testid="harvest-error">
              Prefill did not run: {harvestError}
            </p>
          )}
        </div>
      )}

      {runError && (
        <p className="badge badge-violation" data-testid="discovery-run-error" style={{ marginTop: 12 }}>
          Discovery did not run: {runError}
        </p>
      )}

      <div style={{ marginTop: 20 }}>
        <label>
          Or import an admin-run script's results file:{' '}
          <input
            type="file"
            accept="application/json,.json"
            data-testid="discovery-import-input"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>
        {importError && (
          <p className="badge badge-violation" data-testid="discovery-import-error">
            {importError}
          </p>
        )}
      </div>
    </div>
  );
}