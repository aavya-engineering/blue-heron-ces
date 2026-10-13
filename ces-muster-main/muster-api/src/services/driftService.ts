// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// driftService.ts — Drift detection for continuous re-assessment (Tier-3 annuity).
//
// Drift is a machine-evidence concept: only facts with provenance 'auto_detected'
// (re-harvested via Graph probes) or 'captured' (re-ingested via CaptureRecipes)
// trigger drift analysis. Interview-provenance (B) changes are NOT drift alerts.
// [validate with BHD: machine-evidence-only drift scope]
//
// Drift direction (failing): previous='yes' → current='no'  → ALERT
// Benign direction:          previous='no'  → current='yes' → IMPROVEMENT, no alert
//
// Each drift alert:
//   1. Routes to the advisor HIL queue via hilService with confidence='low' weight=3,
//      which triggers the exact low_confidence_high_weight routing rule without
//      setting sub_flagged=true. This reuse ensures drift alerts ALWAYS route.
//      [validate with BHD: routing weight for drift alerts]
//   2. Records a mode-c TouchEvent kind='drift_alert' with minutes=0 via touchService.
//      Advisor resolution timing comes from the existing HIL resolve (advisor_minutes).
//      DONE-WHEN #9: each drift-alert escalation produces a queryable touch record.

import { createHilService } from './hilService.js';
import { createTouchService } from './touchService.js';

// Provenances that qualify as machine evidence for drift detection.
const MACHINE_PROVENANCES = new Set<string>(['auto_detected', 'captured']);

export interface FactSnapshot {
  question_id: string;
  answer: string;
  provenance: string;
  source?: string;
}

export interface DriftAlert {
  question_id: string;
  previous_answer: string;
  current_answer: string;
  provenance: string;
  hil_item_id: string;
}

export interface DriftImprovement {
  question_id: string;
  previous_answer: string;
  current_answer: string;
}

export interface DetectDriftParams {
  partyId: string;
  sessionId?: string;
  previousFacts: FactSnapshot[];
  currentFacts: FactSnapshot[];
  now?: Date;
}

export interface DriftResult {
  alerts: DriftAlert[];
  improvements: DriftImprovement[];
}

interface DriftDb {
  party: {
    findUnique(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  };
  hilItem: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findUnique(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    findMany(args?: {
      where?: Record<string, unknown>;
      orderBy?: unknown;
    }): Promise<Record<string, unknown>[]>;
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
  };
  touchEvent: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findMany(args?: {
      where?: Record<string, unknown>;
      orderBy?: unknown;
    }): Promise<Record<string, unknown>[]>;
  };
}

export function createDriftService(db: DriftDb, nowFn: () => Date = () => new Date()) {
  return {
    /**
     * Detects drift between previously recorded facts and re-captured/re-harvested facts.
     *
     * For each currentFact with machine provenance ('auto_detected' | 'captured'):
     *   - If a previousFact with the same question_id exists and the answer changed
     *     from 'yes' → 'no' (failing direction): fire a drift alert.
     *   - If the answer changed from 'no' → 'yes' (improvement): record improvement only.
     *   - Interview-provenance (B) currentFacts: skipped entirely — drift is machine-evidence only.
     *
     * @param partyId       - Party being re-assessed.
     * @param sessionId     - Optional re-assessment session ID (passed to HIL items).
     * @param previousFacts - Facts from the prior assessment snapshot.
     * @param currentFacts  - Facts from the current re-capture/re-harvest run.
     * @param now           - Simulated clock for testing; defaults to nowFn().
     */
    async detectDrift({
      partyId,
      sessionId,
      previousFacts,
      currentFacts,
      now = nowFn(),
    }: DetectDriftParams): Promise<DriftResult> {
      const hilSvc = createHilService(db, () => now);
      const touchSvc = createTouchService(db, () => now);

      // Look up party to resolve tenant_id and engagement_id for HIL and touch records.
      const party = await db.party.findUnique({ where: { id: partyId } });
      if (!party) throw new Error(`Party not found: ${partyId}`);

      const tenantId = party['tenant_id'] as string;
      const engagementId = party['engagement_id'] as string;

      // Build an index of previous facts by question_id for O(1) lookup.
      const prevMap = new Map<string, FactSnapshot>();
      for (const f of previousFacts) {
        prevMap.set(f.question_id, f);
      }

      const alerts: DriftAlert[] = [];
      const improvements: DriftImprovement[] = [];

      for (const curr of currentFacts) {
        // Drift is a machine-evidence concept — skip interview-provenance (B) facts.
        if (!MACHINE_PROVENANCES.has(curr.provenance)) continue;

        const prev = prevMap.get(curr.question_id);
        if (!prev) continue; // No previous fact to compare — no drift determination possible.

        const prevAnswer = prev.answer;
        const currAnswer = curr.answer;

        if (prevAnswer === currAnswer) continue; // No change.

        if (prevAnswer === 'yes' && currAnswer === 'no') {
          // Failing direction — drift alert.
          //
          // Route to the advisor HIL queue using confidence='low' weight=3.
          // This reuses the exact low_confidence_high_weight routing rule (the same rule
          // that triggers for low-confidence sub answers), without setting sub_flagged=true,
          // ensuring drift alerts ALWAYS route to the advisor queue.
          // [validate with BHD: confidence/weight values for drift alert routing]
          const hilItem = await hilSvc.routeFact({
            tenant_id: tenantId,
            party_id: partyId,
            session_id: sessionId,
            question_id: curr.question_id,
            answer: currAnswer,
            confidence: 'low',
            weight: 3,
          });

          // Record mode-c touch at alert creation; minutes=0 (advisor resolution timing
          // comes from hilService.resolve advisor_minutes — DONE-WHEN #9).
          await touchSvc.record('c', 'drift_alert', engagementId, tenantId, 0);

          alerts.push({
            question_id: curr.question_id,
            previous_answer: prevAnswer,
            current_answer: currAnswer,
            provenance: curr.provenance,
            hil_item_id: (hilItem as Record<string, unknown>)['id'] as string,
          });
        } else if (prevAnswer === 'no' && currAnswer === 'yes') {
          // Benign improvement — record without alert, no HIL item, no touch event.
          improvements.push({
            question_id: curr.question_id,
            previous_answer: prevAnswer,
            current_answer: currAnswer,
          });
        }
        // Other answer-value combinations are not tracked.
      }

      return { alerts, improvements };
    },
  };
}
