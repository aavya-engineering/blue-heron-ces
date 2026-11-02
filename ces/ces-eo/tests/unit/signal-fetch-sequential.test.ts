// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX-15 (K5): fetchAllSignals keeps exactly one command in flight on the shared session and
 * returns the same signals, in the same order, on back-to-back runs. No live session or sim:
 * the session is a stub that, like the real persistent PowerShell host, corrupts output when
 * two commands overlap on one process.
 */
import { describe, it, expect } from '@jest/globals';
import type { SignalResult } from 'ces-shared/types/signal';
import { ComplianceSignalFetcher } from '../../src/eo/ingestion/ComplianceSignalFetcher';

/** Deterministic per-command jitter so overlapping calls would finish out of order. */
function jitterMs(cmd: string): number {
  let h = 0;
  for (const ch of cmd) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 4;
}

function racySession() {
  let inFlight = 0;
  const stats = { maxInFlight: 0, calls: 0, order: [] as string[] };
  const session = {
    execute: async (_engine: string, cmd: string) => {
      inFlight++;
      stats.calls++;
      stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
      const overlapped = inFlight > 1;
      stats.order.push(cmd.slice(0, 60));
      await new Promise(r => setTimeout(r, jitterMs(cmd)));
      inFlight--;
      // Overlap on one host process interleaves the marker protocol: the caller gets garbage.
      return { stdout: overlapped ? '{"partial":' : '[]', stderr: '', exitCode: 0, durationMs: 0 };
    },
  };
  return { session, stats };
}

function stubPsAdapter(onRun: () => void) {
  return {
    runExchangeCommands: async (): Promise<SignalResult[]> => { onRun(); return []; },
    runPurviewCommands: async (): Promise<SignalResult[]> => { onRun(); return []; },
  };
}

const fingerprint = (signals: SignalResult[]) => signals.map(s => `${s.signalId}:${s.status}`);

describe('FX-15: ComplianceSignalFetcher.fetchAllSignals is sequential and repeatable', () => {
  it('never has more than one session command in flight', async () => {
    const { session, stats } = racySession();
    const f = new ComplianceSignalFetcher(session as any, stubPsAdapter(() => {}) as any);
    const signals = await f.fetchAllSignals();
    expect(stats.calls).toBeGreaterThan(20);
    expect(stats.maxInFlight).toBe(1);
    expect(signals.every(s => s.status === 'success')).toBe(true);
  });

  it('does not start the PowerShell adapter batches while a session command is running', async () => {
    const { session } = racySession();
    let sessionBusy = 0;
    const wrapped = {
      execute: async (engine: string, cmd: string) => {
        sessionBusy++;
        try { return await session.execute(engine, cmd); } finally { sessionBusy--; }
      },
    };
    const overlaps: number[] = [];
    const f = new ComplianceSignalFetcher(wrapped as any, stubPsAdapter(() => overlaps.push(sessionBusy)) as any);
    await f.fetchAllSignals();
    expect(overlaps).toEqual([0, 0]);
  });

  it('three back-to-back runs give identical signal ids, order and statuses', async () => {
    const runs: string[][] = [];
    const orders: string[][] = [];
    for (let i = 0; i < 3; i++) {
      const { session, stats } = racySession();
      const f = new ComplianceSignalFetcher(session as any, stubPsAdapter(() => {}) as any);
      runs.push(fingerprint(await f.fetchAllSignals()));
      orders.push(stats.order);
    }
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
    expect(orders[1]).toEqual(orders[0]);
    expect(orders[2]).toEqual(orders[0]);
    // Identity batch first, CA policy read first of all (the K5 signal).
    expect(runs[0][0]).toBe('conditionalAccess:success');
  });
});
