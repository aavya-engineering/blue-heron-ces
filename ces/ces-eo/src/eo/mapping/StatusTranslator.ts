// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { ControlStatus } from 'ces-shared/types/controls';
import type { SignalResult } from 'ces-shared/types/signal';
import { hasValues, describeRead } from './evaluators/helpers.js';

/**
 * W1.0 — unread is not absent. Returns a `not_assessed` verdict (which SignalToControlMapper
 * records as a `no_query` source) when none of `signalIds` was read with data:
 *   - the signal was never fetched (no result with that id);
 *   - the fetch errored or came back not_assessed (the error is printed);
 *   - with `requireValues` (the default), the read succeeded but returned no objects — an empty
 *     read is not counted as a negative finding (founder decision B7, class C), the read is printed.
 * Returns null when at least one of the signals was read with data, so the caller evaluates it.
 */
export function unreadSignalVerdict(
  signals: SignalResult[],
  signalIds: string | string[],
  what: string,
  requireValues = true,
): { status: ControlStatus; evidence: string } | null {
  const ids = Array.isArray(signalIds) ? signalIds : [signalIds];
  const states: string[] = [];
  for (const id of ids) {
    const sig = signals.find(s => s.signalId === id && s.status === 'success') ?? signals.find(s => s.signalId === id);
    if (!sig) {
      states.push(`'${id}' was not read`);
    } else if (sig.status !== 'success' || sig.rawData == null) {
      states.push(`read of '${id}' failed (${sig.error ?? sig.status})`);
    } else if (requireValues && !hasValues(sig.rawData)) {
      states.push(`'${id}' was read (${sig.endpoint}) and returned 0 objects`);
    } else {
      return null;
    }
  }
  return { status: 'not_assessed', evidence: `${what}: ${states.join('; ')} — not assessed (unread or empty reads are not a negative finding)` };
}

/**
 * Presence-only label (founder decision 2026-10-27). SignalToControlMapper appends it to the
 * discovery source detail of a met verdict from an evaluator declared `presenceOnly` in the
 * registry; ControlAssessor, the ledger and the SSP read it back with the helpers below
 * (the same carrier pattern as B8's "(state not verified)").
 */
export const PRESENCE_ONLY_LABEL = 'presence only';

/** What the presence-only evaluator read: every successful read that returned objects. */
export function presenceReadOf(signals: SignalResult[]): string {
  const withData = signals.filter(s => s.status === 'success' && hasValues(s.rawData));
  return (withData.length > 0 ? withData : signals).map(s => describeRead(signals, s.signalId)).join('; ') || 'no read recorded';
}

export const presenceOnlyDetail = (evidence: string, read: string): string => `${evidence} (${PRESENCE_ONLY_LABEL}: ${read})`;

const PRESENCE_RE = new RegExp(` \\(${PRESENCE_ONLY_LABEL}: (.*)\\)$`, 's');

export function isPresenceOnlySource(s: { type: string; result: string; detail: string }): boolean {
  return s.type === 'discovery' && PRESENCE_RE.test(s.detail);
}

/** The read carried by a presence-only source label, or undefined. */
export function presenceReadFromSource(s: { type: string; result: string; detail: string }): string | undefined {
  return s.type === 'discovery' ? PRESENCE_RE.exec(s.detail)?.[1] : undefined;
}

/** The source detail without its presence-only label. */
export const withoutPresenceLabel = (detail: string): string => detail.replace(PRESENCE_RE, '');

export interface PartialCreditRule {
  nist_ref: string;
  threshold: number;
  metric: string;
}

/**
 * Maps Graph API compliance states to CMMC ControlStatus values.
 */
export function translateGraphStatus(
  graphState: string,
  partialRules?: PartialCreditRule
): ControlStatus {
  switch (graphState.toLowerCase()) {
    case 'compliant':
      return 'met';
    case 'notcompliant':
    case 'not_compliant':
      return 'not_met';
    case 'conflict':
      return 'partial';
    case 'notapplicable':
    case 'not_applicable':
      return 'not_assessed';
    case 'unknown':
    default:
      return 'not_assessed';
  }
}

/**
 * Applies partial credit rules for controls that require coverage thresholds.
 * For example, SC.L2-3.13.11 requires 100% device coverage for full credit.
 */
export function applyPartialCredit(
  baseStatus: ControlStatus,
  coveragePercent: number,
  rule: PartialCreditRule
): ControlStatus {
  if (baseStatus === 'not_met') return 'not_met';

  if (coveragePercent >= rule.threshold) {
    return 'met';
  } else if (coveragePercent > 0) {
    return 'partial';
  }
  return 'not_met';
}
