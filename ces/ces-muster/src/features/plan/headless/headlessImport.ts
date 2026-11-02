// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// headlessImport.ts — the headless runner's import steps (scripts/mx/plan-from-discovery.ts),
// in the browser app's order:
//   BoundaryConfirmPanel.handleContinue: synthesized discovery facts, boundary
//     drafts (no decisions), payload facts last;
//   AssessmentPage mount: the harvest pre-fill (readiness probes + tenant-fact
//     reads, the harvest route's facts), then the discovery pre-fill; a harvest
//     fact wins over a discovery one, a discovery verdict wins over 'unsure'
//     (applyDiscoveryFacts);
//   finishInterview: factsFromAnswers over the stack-filtered graph (FC-MU-3).
import type { ReadinessResult } from '@/shared/types/readinessResult';
import type { DiscoveryResult } from '@/shared/types/discovery';
import type { InterviewFact } from '@/shared/types/engagement';
import { discoveryResultsFromPayload, factsFromPayload } from '@/features/discovery/importReadinessResult';
import { synthesizeFactsFromDiscovery } from '@/features/interview/discoveryFactJoin';
import { inferBoundaryDrafts } from '@/features/interview/boundaryInference';
import { processBoundaryDecisions } from '@/features/discovery/boundaryConfirm';
import { QUESTION_GRAPH } from '@/features/interview/questionGraph';
import { stackFilteredGraph } from '@/features/interview/questionGraphService';
import {
  applyDiscoveryFacts,
  applyHarvestFacts,
  factsFromAnswers,
  type HarvestFact,
} from '@/features/assessment/assessmentHelpers';

export interface HeadlessStagedFacts {
  results: DiscoveryResult[];
  facts: InterviewFact[];
}

/** Stage the session facts a discovery payload plus a harvest payload produce. */
export function stageHeadlessFacts(
  payload: ReadinessResult,
  harvestFacts: HarvestFact[],
  stacks: string[]
): HeadlessStagedFacts {
  const results = discoveryResultsFromPayload(payload);
  const staged = [
    ...synthesizeFactsFromDiscovery(results, QUESTION_GRAPH),
    ...processBoundaryDecisions(inferBoundaryDrafts(results), {}, ''),
    ...factsFromPayload(payload),
  ];
  const harvest = applyHarvestFacts(harvestFacts, {});
  const prefill = applyDiscoveryFacts(staged, {});
  const facts = factsFromAnswers(
    stackFilteredGraph(stacks),
    { ...prefill.answers, ...harvest.answers },
    { ...prefill.provenances, ...harvest.provenances },
    { ...prefill.confidences, ...harvest.confidences },
    prefill.attestations,
    harvest.sources
  );
  return { results, facts };
}
