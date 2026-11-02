// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import type { Engagement, AssessedParty, InterviewSession, InterviewFact, TimingSegment, EngagementKind } from '@/shared/types/engagement';
import type { ReadinessPosture } from '@/vendored/ces-spine/types/artifacts';

export interface StatusPayload {
  schema_version: '1.0.0';
  engagement_kind: EngagementKind;
  party: { name: string; uei?: string; cage?: string };
  on_prem_ot: 'yes' | 'no' | 'unsure';
  /**
   * G-MUSTER-PL-1 C3: the three AssessmentPage profile answers. Optional — the
   * block is present only when the party carries at least one answer, and each
   * field is present only when answered.
   */
  profile?: {
    employee_count?: '<50' | '50-250' | '250+';
    has_ssp?: 'yes' | 'no' | 'unsure';
    covers_m365?: 'yes' | 'no';
  };
  interview_facts: InterviewFact[];
  posture_summary: {
    conservative_score: number;
    control_status_summary: {
      level: string;
      met: number;
      partial: number;
      not_met: number;
      unknown: number;
    };
  };
  timing_segments: TimingSegment[];
}

export function buildStatusPayload(
  engagement: Engagement,
  party: AssessedParty,
  session: InterviewSession,
  score: number,
  posture: ReadinessPosture
): StatusPayload {
  const summary = posture.ces.control_status_summary;
  // C3: emit the profile block only when the party carries at least one answer.
  const profile = {
    ...(party.employee_count ? { employee_count: party.employee_count } : {}),
    ...(party.has_ssp ? { has_ssp: party.has_ssp } : {}),
    ...(party.covers_m365 ? { covers_m365: party.covers_m365 } : {}),
  };
  return {
    schema_version: '1.0.0',
    engagement_kind: engagement.engagement_kind,
    party: {
      name: party.name,
      ...(party.uei ? { uei: party.uei } : {}),
      ...(party.cage ? { cage: party.cage } : {}),
    },
    on_prem_ot: party.on_prem_ot,
    ...(Object.keys(profile).length > 0 ? { profile } : {}),
    interview_facts: session.facts,
    posture_summary: {
      conservative_score: score,
      control_status_summary: {
        level: summary.level,
        met: summary.met,
        partial: summary.partial,
        not_met: summary.not_met,
        unknown: summary.unknown,
      },
    },
    timing_segments: session.timing_segments,
  };
}

export function downloadStatusPayload(payload: StatusPayload): void {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `status-payload-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
