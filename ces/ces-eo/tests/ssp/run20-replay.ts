// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Run 20 (`muster-partial`) offline replay, shared by the W3 tests.
 * - `replayRun20Snapshot()`: the 26 stored signal reads re-run through the real
 *   SignalToControlMapper and evaluator registry, plus each control's stored non-discovery
 *   sources (Stamper files, Stamper task results, the EC upload), through the real
 *   ControlAssessor.merge. Stored run 20: 80 / 6 / 0 / 24, SPRS 33.
 * - `run20Paths`: the pushed TM / IM / MP copies (scrubbed; TM and MP trimmed to the fields EO reads).
 * Callers fake Date to the snapshot time so the date-windowed evaluators replay deterministically.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type { AssessmentSnapshot, AssessmentSource, ControlAssessment } from 'ces-shared/types/controls';
import type { SignalResult } from 'ces-shared/types/signal';
import { SignalToControlMapper } from '../../src/eo/mapping/SignalToControlMapper.js';
import { evaluatorRegistry } from '../../src/eo/mapping/evaluators/index.js';
import { ControlAssessor } from '../../src/eo/assessment/ControlAssessor.js';

const _require = createRequire(__filename);
export const controlsRefPath = _require.resolve('ces-shared/data/cmmc-l2-controls');
export const sprsWeightsPath = _require.resolve('ces-shared/data/sprs-weights');

const FIXTURES = path.resolve(__dirname, '../fixtures/ssp-uplift');
export const run20Paths = {
  tm: path.join(FIXTURES, 'tm-run20.json'),
  im: path.join(FIXTURES, 'im-run20.json'),
  mp: path.join(FIXTURES, 'mp-run20.json'),
};

interface Run20Fixture {
  tenantId: string;
  generatedAt: string;
  stored: { met: number; notMet: number; partial: number; notAssessed: number; sprs: number; status_by_control: Record<string, string> };
  signals: SignalResult[];
  nonDiscoverySources: Record<string, AssessmentSource[]>;
}

export const run20Fixture = (): Run20Fixture =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, 'snapshot-run20-replay.json'), 'utf-8')) as Run20Fixture;

export const readJson = (p: string): Record<string, unknown> => JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;

export function replayRun20Snapshot(): AssessmentSnapshot {
  const fx = run20Fixture();
  const mapper = new SignalToControlMapper();
  const signalAssessments = new Map<string, ControlAssessment>();
  for (const a of mapper.mapSignalsToControls(fx.signals, evaluatorRegistry)) signalAssessments.set(a.control_id, a);
  const stamperSources = new Map<string, AssessmentSource[]>(Object.entries(fx.nonDiscoverySources));
  return new ControlAssessor(controlsRefPath).merge(fx.tenantId, [], [], [], [], stamperSources, signalAssessments);
}
