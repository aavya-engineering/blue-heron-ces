// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EO-collection W3 (REVIEW §3, decision B19): evidence freshness per objective.
//
// The age of the newest dated evidence behind an objective (an evidence-store record, or a Stamper
// evidence file) is measured at the snapshot's own time (`generatedAt`, never the wall clock, so a
// ledger rebuilt later gives the same answer) against the control family's cadence:
//   fresh  = age <= 1 x cadence
//   aging  = 1 x cadence < age <= 2 x cadence
//   stale  = age >  2 x cadence   (plan W3.4: maxAge = 2 x cadence)
// Family cadences come from the plan's §5 collector table (the slowest collector that feeds the
// family, so a family is not stale while its slowest feed is on time); families with no §5
// collector use the daily cadence of the §5 state sources. A Stamper file is configuration evidence
// written once per execution, so its cadence is never shorter than daily (STAMPER_FILE_FLOOR).
// B19: a satisfied objective whose dated evidence is all stale is not counted (DeterminationLedger).

export type Freshness = 'fresh' | 'aging' | 'stale';
export type EvidenceBasis = 'evidence-store' | 'stamper-file';

const MIN = 1;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Cadence per control family, in minutes (plan §5). */
export const FAMILY_CADENCE_MINUTES: Readonly<Record<string, number>> = Object.freeze({
  AC: 15 * MIN,   // C2 directory audits, C3 sign-ins, C4 PIM activations: 15 min
  AU: 1 * HOUR,   // C1a UAL 60 min (C2, C3, C6 at 15 min)
  IR: 15 * MIN,   // C6 alerts and incidents: 15 min
  SI: 1 * DAY,    // C8 Secure Score, C9 compliance daily (C5 hourly, C6 15 min)
  RA: 1 * DAY,    // C7 vulnerabilities: daily
  CM: 1 * DAY,    // C9 compliance daily (C2 at 15 min)
});

/** Families with no §5 collector (AT, CA, IA, MA, MP, PE, PS, SC): the daily state-source cadence. */
export const DEFAULT_CADENCE_MINUTES = 1 * DAY;

/** A Stamper evidence file's cadence is at least daily. */
export const STAMPER_FILE_FLOOR_MINUTES = 1 * DAY;

/** "AC.L2-3.1.7" or "AC.L2-3.1.7[a]" -> "AC". */
export function familyOf(controlOrObjectiveId: string): string {
  return controlOrObjectiveId.split('.')[0].toUpperCase();
}

export function cadenceMinutesFor(controlOrObjectiveId: string, basis: EvidenceBasis): number {
  const family = FAMILY_CADENCE_MINUTES[familyOf(controlOrObjectiveId)] ?? DEFAULT_CADENCE_MINUTES;
  return basis === 'stamper-file' ? Math.max(family, STAMPER_FILE_FLOOR_MINUTES) : family;
}

export function classifyAge(ageMinutes: number, cadenceMinutes: number): Freshness {
  if (ageMinutes <= cadenceMinutes) return 'fresh';
  if (ageMinutes <= 2 * cadenceMinutes) return 'aging';
  return 'stale';
}

/** 45 -> "45 min"; 125 -> "2 h 5 min"; 4440 -> "3 d 2 h". */
export function formatAge(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < HOUR) return `${m} min`;
  if (m < DAY) { const h = Math.floor(m / HOUR); const r = m % HOUR; return r ? `${h} h ${r} min` : `${h} h`; }
  const d = Math.floor(m / DAY); const h = Math.floor((m % DAY) / HOUR);
  return h ? `${d} d ${h} h` : `${d} d`;
}

export interface DatedEvidence {
  at: string;              // ISO time the evidence was collected or written
  basis: EvidenceBasis;
}

export interface EvidenceAge {
  newestAt: string;        // the evidence that decided the freshness
  minutes: number;         // its age at the snapshot time (never negative)
  text: string;            // formatAge(minutes)
  basis: EvidenceBasis;
  family: string;
  cadenceMinutes: number;
}

const RANK: Record<Freshness, number> = { fresh: 2, aging: 1, stale: 0 };

/**
 * Freshness of the evidence behind one objective at `asOf`. Each dated item is judged against its
 * own cadence; the freshest judgement wins (ties: the newest item). Undated or unparseable items are
 * ignored; with none left the result is null (no dated evidence: freshness not applicable).
 * Evidence dated after `asOf` (a later collection) counts as age 0.
 */
export function evidenceFreshness(
  objectiveId: string,
  evidence: DatedEvidence[],
  asOf: string,
): { freshness: Freshness; evidenceAge: EvidenceAge } | null {
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs)) return null;
  let best: { freshness: Freshness; evidenceAge: EvidenceAge; atMs: number } | null = null;
  for (const e of evidence) {
    const atMs = Date.parse(e.at);
    if (!Number.isFinite(atMs)) continue;
    const minutes = Math.max(0, Math.floor((asOfMs - atMs) / 60000));
    const cadenceMinutes = cadenceMinutesFor(objectiveId, e.basis);
    const freshness = classifyAge(minutes, cadenceMinutes);
    if (!best || RANK[freshness] > RANK[best.freshness] || (RANK[freshness] === RANK[best.freshness] && atMs > best.atMs)) {
      best = {
        freshness, atMs,
        evidenceAge: { newestAt: new Date(atMs).toISOString(), minutes, text: formatAge(minutes), basis: e.basis, family: familyOf(objectiveId), cadenceMinutes },
      };
    }
  }
  return best ? { freshness: best.freshness, evidenceAge: best.evidenceAge } : null;
}
