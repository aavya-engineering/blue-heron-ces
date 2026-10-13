// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// discoveryService.ts — G-MUSTER-DISCOVERY-1: the read-only discovery executor
// (muster-api lane, FD-DISCOVERY-OWNER: "that is what Muster does").
//
// Walks Stamper's command registries AS DATA, runs each entry's get_command
// READ-ONLY through an injected ces-tenant session, and emits
// readiness-result.v1 observations[]. Structurally read-only: this module has
// NO code path that touches a set_command — it only ever reads get_command /
// evidence_commands. Live/sim parity is free (the injected session is opened
// per tenant kind by the caller, exactly as ces-tenant prescribes).
//
// The engine is PURE + dependency-injected (session + capture sink + registry
// entries as params), so it is fully unit-testable with a mock session and the
// real ces-tenant PersistentSessionFactory wires in unchanged at the call site.

/** The subset of a Stamper registry entry the discovery walk consumes. */
export interface RegistryGetEntry {
  entry_id: string;
  control_ids: string[];
  engine: string;
  /** Absent/empty for entries with no readable surface. */
  get_command?: string;
  manual_only?: boolean;
}

/** PSResult, narrowed to what the executor reads (matches ces-tenant PSResult). */
export interface DiscoveryExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * The narrow session surface the executor needs — satisfied by ces-tenant's
 * TenantSessionFactory (execute). Injected so the engine never hand-rolls
 * session/auth (the surviving must-NOT) and stays testable.
 */
export interface DiscoverySession {
  execute(engine: string, command: string): Promise<DiscoveryExecResult>;
}

/** Persists raw command output off-line and returns a raw_capture_ref pointer;
 * raw output is NEVER inlined into the observation (schema rule). */
export interface CaptureSink {
  write(entryId: string, stdout: string): Promise<string> | string;
}

export type DerivedPosture = 'met' | 'not_met' | 'partial' | 'unknown';

export interface DiscoveryObservation {
  control_id: string;
  objective_ids: string[];
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  ran_entry_ids: string[];
  raw_capture_ref?: string;
  derived_posture: DerivedPosture;
}

/**
 * The recorded fact-status for a degraded command — the literal wording is
 * normative (residual-elicitation-ladder: record "unavailable at this auth
 * tier" as a fact-status rather than silently skipping).
 */
export const AUTH_TIER_UNAVAILABLE = 'unavailable at this auth tier';

export type EntryStatus =
  | 'ok'
  | 'empty'
  | 'manual_only'
  | 'no_get_command'
  | 'failed'
  | typeof AUTH_TIER_UNAVAILABLE;

/** Per-command run record: every entry gets exactly one status row, in walk order. */
export interface DiscoveryEntryStatus {
  entry_id: string;
  status: EntryStatus;
}

export interface DiscoveryRunResult {
  observations: DiscoveryObservation[];
  /** One status row per entry — degradation is recorded, never silent. */
  statuses: DiscoveryEntryStatus[];
  /** Bookkeeping for the run summary (not part of the payload). */
  stats: {
    entries: number;
    ran: number;
    manual_only_skipped: number;
    degraded: number;
    failed: number;
  };
}

export interface DiscoveryOptions {
  /**
   * When true (a restricted auth tier), execution errors are recorded as
   * per-command degradation ("unavailable at this auth tier") — confidence
   * 'unknown', posture 'unknown' — instead of failing the walk. Degradation is
   * ALWAYS per-command regardless of this flag; the flag only labels intent.
   */
  restrictedTier?: boolean;
}

/**
 * Is a session/auth-shaped failure (degradation) rather than a hard error?
 * Cmdlet-not-recognized, auth/permission, and connection failures are the
 * degradation signatures (per the residual-elicitation-ladder). Everything is
 * degradation-tolerant here anyway — the walk never throws — but this decides
 * the recorded status wording.
 */
function isDegradation(r: DiscoveryExecResult): boolean {
  const hay = `${r.stderr} ${r.stdout}`.toLowerCase();
  return (
    /is not recognized as the name of a cmdlet|is not recognized|authentication needed|unauthorized|forbidden|access denied|token|not connected|could not connect|insufficient privileges|authorization_requestdenied/.test(
      hay
    )
  );
}

/**
 * Run the read-only discovery walk over the given registry entries.
 * - manual_only OR no get_command  -> skipped, recorded as posture 'unknown'
 *   (no readable surface), NEVER omitted.
 * - get_command success (exit 0, non-empty) -> posture 'met', confidence per output.
 * - get_command empty/exit0        -> posture 'unknown' (read succeeded, nothing there).
 * - get_command error              -> per-command degradation, posture 'unknown'.
 * The walk NEVER throws and NEVER runs a set_command (there is no such path here).
 */
export async function runDiscovery(
  entries: RegistryGetEntry[],
  session: DiscoverySession,
  capture: CaptureSink,
  opts: DiscoveryOptions = {}
): Promise<DiscoveryRunResult> {
  // The restrictedTier flag labels intent only — degradation is per-command
  // always (see DiscoveryOptions); the recorded statuses are identical either way.
  void opts.restrictedTier;
  const observations: DiscoveryObservation[] = [];
  const statuses: DiscoveryEntryStatus[] = [];
  const stats = { entries: entries.length, ran: 0, manual_only_skipped: 0, degraded: 0, failed: 0 };

  for (const entry of entries) {
    const controlIds = entry.control_ids ?? [];

    // No readable surface: manual_only or missing get_command. Recorded, not omitted.
    if (entry.manual_only || !entry.get_command || entry.get_command.trim() === '') {
      if (entry.manual_only) stats.manual_only_skipped++;
      statuses.push({
        entry_id: entry.entry_id,
        status: entry.manual_only ? 'manual_only' : 'no_get_command',
      });
      pushForEntry(observations, entry, controlIds, {
        confidence: 'unknown',
        posture: 'unknown',
      });
      continue;
    }

    let result: DiscoveryExecResult;
    try {
      result = await session.execute(entry.engine, entry.get_command);
    } catch (e) {
      // A thrown session error is treated as degradation, never a walk failure.
      stats.degraded++;
      statuses.push({ entry_id: entry.entry_id, status: AUTH_TIER_UNAVAILABLE });
      pushForEntry(observations, entry, controlIds, { confidence: 'unknown', posture: 'unknown' });
      void e;
      continue;
    }

    stats.ran++;
    const strippedOut = result.stdout?.trim() ?? '';

    if (result.exitCode !== 0 || isDegradation(result)) {
      const degraded = isDegradation(result);
      if (degraded) stats.degraded++;
      else stats.failed++;
      statuses.push({
        entry_id: entry.entry_id,
        status: degraded ? AUTH_TIER_UNAVAILABLE : 'failed',
      });
      pushForEntry(observations, entry, controlIds, { confidence: 'unknown', posture: 'unknown' });
      continue;
    }

    // Read succeeded. Non-empty output => observed evidence => posture 'met'.
    const ref = strippedOut ? await capture.write(entry.entry_id, result.stdout) : undefined;
    statuses.push({ entry_id: entry.entry_id, status: strippedOut ? 'ok' : 'empty' });
    pushForEntry(observations, entry, controlIds, {
      confidence: strippedOut ? 'high' : 'low',
      posture: strippedOut ? 'met' : 'unknown',
      raw_capture_ref: ref,
    });
  }

  return { observations, statuses, stats };
}

function pushForEntry(
  out: DiscoveryObservation[],
  entry: RegistryGetEntry,
  controlIds: string[],
  o: { confidence: DiscoveryObservation['confidence']; posture: DerivedPosture; raw_capture_ref?: string }
): void {
  // One observation per covered control; ran_entry_ids records provenance.
  const ids = controlIds.length > 0 ? controlIds : [entry.entry_id];
  for (const controlId of ids) {
    out.push({
      control_id: controlId,
      objective_ids: [],
      confidence: o.confidence,
      ran_entry_ids: [entry.entry_id],
      ...(o.raw_capture_ref ? { raw_capture_ref: o.raw_capture_ref } : {}),
      derived_posture: o.posture,
    });
  }
}

/** Filter a raw registry entries array to the get-walkable subset shape. */
export function toGetEntries(rawEntries: unknown[]): RegistryGetEntry[] {
  return (rawEntries as Array<Record<string, unknown>>)
    .filter((e) => e && typeof e === 'object' && typeof e.entry_id === 'string')
    .map((e) => ({
      entry_id: e.entry_id as string,
      control_ids: Array.isArray(e.control_ids) ? (e.control_ids as string[]) : [],
      engine: typeof e.engine === 'string' ? (e.engine as string) : 'mgraph',
      get_command: typeof e.get_command === 'string' ? (e.get_command as string) : undefined,
      manual_only: e.manual_only === true,
    }));
}
