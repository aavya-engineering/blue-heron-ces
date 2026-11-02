// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W0.3 (EO-collection plan; REVIEW P0 #2; critique G14/PE-11): the never-called expanded read
 * set is gone. The survivors (registered and GA in L4) run in fetchAuditSignals on the capture
 * path: directoryAudits and signInLogs (30-day window), riskDetections (90-day window), all pages,
 * one read at a time; crossTenantPolicy (AC.L1-3.1.20, a singleton) by its cmdlet.
 */
import { describe, it, expect } from '@jest/globals';
import type { SignalResult } from 'ces-shared/types/signal';
import { ComplianceSignalFetcher } from '../ComplianceSignalFetcher.js';

const NOW = Date.parse('2026-10-27T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function recordingSession(reply: (cmd: string) => string) {
  let inFlight = 0;
  const stats = { maxInFlight: 0, cmds: [] as string[] };
  return {
    stats,
    execute: async (_engine: string, cmd: string) => {
      inFlight++;
      stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
      stats.cmds.push(cmd);
      await new Promise(r => setTimeout(r, 1));
      inFlight--;
      return { stdout: reply(cmd), stderr: '', exitCode: 0, durationMs: 0 };
    },
  };
}
const stubPs = { runExchangeCommands: async (): Promise<SignalResult[]> => [], runPurviewCommands: async (): Promise<SignalResult[]> => [] };

describe('W0.3 fetchAuditSignals', () => {
  it('reads the four survivors in order, with the window in the URI', async () => {
    const s = recordingSession(() => '{"value":[]}');
    const f = new ComplianceSignalFetcher(s as any, stubPs as any);
    const out = await f.fetchAuditSignals(NOW);
    expect(out.map(x => x.signalId)).toEqual(['directoryAudits', 'signInLogs', 'riskDetections', 'crossTenantPolicy']);
    expect(out.map(x => x.endpoint)).toEqual([
      '/auditLogs/directoryAudits', '/auditLogs/signIns', '/identityProtection/riskDetections', '/policies/crossTenantAccessPolicy/default',
    ]);
    const since30 = new Date(NOW - 30 * DAY).toISOString();
    const since90 = new Date(NOW - 90 * DAY).toISOString();
    expect(s.stats.cmds[0]).toContain(`/v1.0/auditLogs/directoryAudits?$filter=activityDateTime%20ge%20${since30}`);
    expect(s.stats.cmds[1]).toContain(`/v1.0/auditLogs/signIns?$filter=createdDateTime%20ge%20${since30}`);
    expect(s.stats.cmds[2]).toContain(`/v1.0/identityProtection/riskDetections?$filter=detectedDateTime%20ge%20${since90}`);
    expect(s.stats.cmds[3]).toContain('Get-MgPolicyCrossTenantAccessPolicyDefault');
  });

  it('collection reads follow @odata.nextLink (all pages)', async () => {
    const s = recordingSession(() => '{"value":[{"id":"a"},{"id":"b"}]}');
    const f = new ComplianceSignalFetcher(s as any, stubPs as any);
    await f.fetchAuditSignals(NOW);
    for (const cmd of s.stats.cmds.slice(0, 3)) {
      expect(cmd).toContain("$u = $r.'@odata.nextLink'");
      expect(cmd).toContain('-Method GET');
    }
    const out = await f.fetchAuditSignals(NOW);
    expect(out[0].status).toBe('success');
    expect(out[0].rawData).toEqual({ value: [{ id: 'a' }, { id: 'b' }] });
  });

  it('runs one read at a time', async () => {
    const s = recordingSession(() => '{"value":[]}');
    await new ComplianceSignalFetcher(s as any, stubPs as any).fetchAuditSignals(NOW);
    expect(s.stats.maxInFlight).toBe(1);
  });

  it('is on the capture path (fetchAllSignals), after the coverage batch; the expanded set is gone', async () => {
    const s = recordingSession(() => '[]');
    const f = new ComplianceSignalFetcher(s as any, stubPs as any);
    const ids = (await f.fetchAllSignals()).map(x => x.signalId);
    expect(ids.slice(-4)).toEqual(['directoryAudits', 'signInLogs', 'riskDetections', 'crossTenantPolicy']);
    expect(ids.indexOf('tvmAssessmentRecency')).toBe(ids.length - 5);
    expect((f as any).fetchExpandedSignals).toBeUndefined();
    // W5c1 EO-fetch: configurationPolicies is back as its own read ($expand=settings, after deviceConfigurations).
    for (const gone of ['authMethodsUsers', 'deviceIntents', 'encryptionStates', 'vulnerabilitiesExpanded', 'attackSimulations', 'secureScore']) {
      expect(ids).not.toContain(gone);
    }
  });

  it('a failed read is an error signal, not an exception', async () => {
    const s = { execute: async () => { throw new Error('ResolverTable: no resolver registered for URI'); } };
    const out = await new ComplianceSignalFetcher(s as any, stubPs as any).fetchAuditSignals(NOW);
    expect(out[2].signalId).toBe('riskDetections');
    expect(out[2].status).toBe('error');
  });
});
