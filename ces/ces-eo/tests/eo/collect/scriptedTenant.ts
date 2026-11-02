// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Test double for a tenant session, behaving like the simulator does today:
 *  - Graph collections ignore `$filter … ge` and return every row (W2.1 not landed);
 *  - Search-UnifiedAuditLog honours -StartDate/-EndDate and numbers rows ResultIndex/ResultCount;
 *  - `(Get-MgContext).ClientId` answers a fixed ClientId;
 *  - W2 part 2: identityProtection, security (alerts_v2, incidents, secureScores) and managedDevices
 *    collections, and advanced hunting answered by the KQL table the query starts with;
 *  - W2 part 3: security/secureScoreControlProfiles (C8b, read with no query string).
 * Rows come from the recorded fixtures under tests/fixtures/collect/.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CLIENT_ID_PROBE } from '../../../src/eo/evidence/store/collectorIdentity';

export const FIX = path.resolve(__dirname, '../../fixtures/collect');
export const fixture = (f: string): any => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf-8'));
export const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
/** The instant the fixtures' dates are relative to. */
export const FIXTURE_NOW = Date.parse('2026-10-27T12:00:00.000Z');

export class ScriptedTenant {
  calls: Array<{ engine: string; cmd: string }> = [];
  graph: Record<string, unknown[]> = {
    directoryAudits: fixture('directory-audits.json').value,
    signIns: fixture('sign-ins.json').value,
    roleAssignmentScheduleRequests: fixture('pim-activations.json').value,
    // W2 part 2 (C5–C9)
    riskDetections: fixture('risk-detections.json').value,
    riskyUsers: fixture('risky-users.json').value,
    alerts_v2: fixture('alerts-v2.json').value,
    incidents: fixture('incidents.json').value,
    secureScores: fixture('secure-scores.json').value,
    // W2 part 3 (C8b)
    secureScoreControlProfiles: fixture('secure-score-control-profiles.json').value,
    managedDevices: fixture('managed-devices.json').value,
  };
  /** Advanced-hunting results by the KQL table the query names (the sim's W2.2 routing). */
  hunting: Record<string, unknown[]> = {
    DeviceTvmInfoGathering: fixture('hunting-tvm-recency.json').results,
    DeviceTvmSoftwareVulnerabilities: fixture('hunting-tvm-vulnerabilities.json').results,
  };
  ual: Array<Record<string, unknown>> = fixture('ual-rows.json').rows;
  /** Graph collections answering 403. */
  denied = new Set<string>();
  /** Graph collections with no resolver (the sim's "no resolver registered" error). */
  missing = new Set<string>();
  /** Number of Search-UnifiedAuditLog calls still to fail. */
  ualFailures = 0;
  ualDenied = false;
  boundTenantSlug: string | undefined;
  boundTenantId: string | undefined;

  constructor(slug?: string, tenantId?: string) {
    this.boundTenantSlug = slug;
    this.boundTenantId = tenantId;
  }

  async ensureConnected(): Promise<void> { /* connected */ }

  async execute(engine: string, cmd: string): Promise<{ stdout: string }> {
    this.calls.push({ engine, cmd });
    if (cmd === CLIENT_ID_PROBE) return { stdout: `${CLIENT}\nEO_EXECUTION_SUCCESS` };
    if (engine === 'exchange' && cmd.includes('Search-UnifiedAuditLog')) {
      if (this.ualDenied) throw new Error('Search-UnifiedAuditLog: 403 Forbidden (role not assigned)');
      if (this.ualFailures > 0) { this.ualFailures--; throw new Error('Search-UnifiedAuditLog: the operation has timed out'); }
      const start = Date.parse(/-StartDate '([^']+)'/.exec(cmd)![1]);
      const end = Date.parse(/-EndDate '([^']+)'/.exec(cmd)![1]);
      const rows = this.ual.filter((r) => { const t = Date.parse(String(r.CreationDate)); return t >= start && t <= end; });
      return { stdout: JSON.stringify(rows.map((r, i) => ({ ...r, ResultIndex: i + 1, ResultCount: rows.length }))) };
    }
    if (engine === 'mgraph' && cmd.includes('/v1.0/security/runHuntingQuery')) {
      const q = /Query = '((?:[^']|'')*)'/.exec(cmd)?.[1] ?? '';
      const table = Object.keys(this.hunting).find((t) => q.startsWith(t));
      if (this.denied.has('runHuntingQuery')) throw new Error('Graph returned 403 Forbidden');
      if (this.missing.has('runHuntingQuery')) throw new Error('no resolver registered for URI /v1.0/security/runHuntingQuery');
      return { stdout: JSON.stringify({ schema: [], results: table ? this.hunting[table] : [] }) };
    }
    const m = /\$u = '\/v1\.0\/(?:auditLogs|roleManagement\/directory|identityProtection|security|deviceManagement)\/(\w+)[?']/.exec(cmd);
    if (engine === 'mgraph' && m) {
      const name = m[1];
      if (this.denied.has(name)) throw new Error('Graph returned 403 Forbidden');
      if (this.missing.has(name)) throw new Error(`no resolver registered for URI /v1.0/${name}`);
      return { stdout: JSON.stringify({ value: this.graph[name] ?? [] }) };
    }
    throw new Error(`unscripted: ${cmd.slice(0, 80)}`);
  }

  /**
   * Shift every fixture time so the fixtures' reference instant (FIXTURE_NOW) becomes `nowMs`, for
   * tests that run against the real clock.
   */
  rebase(nowMs: number): this {
    const d = nowMs - FIXTURE_NOW;
    const shift = (row: Record<string, unknown>) => {
      const out = { ...row };
      for (const k of ['activityDateTime', 'createdDateTime', 'CreationDate', 'lastUpdateDateTime', 'detectedDateTime',
        'lastUpdatedDateTime', 'riskLastUpdatedDateTime', 'lastSyncDateTime', 'LastAssessed']) {
        if (typeof out[k] === 'string') out[k] = new Date(Date.parse(out[k] as string) + d).toISOString();
      }
      return out;
    };
    for (const k of Object.keys(this.graph)) this.graph[k] = (this.graph[k] as Array<Record<string, unknown>>).map(shift);
    for (const k of Object.keys(this.hunting)) this.hunting[k] = (this.hunting[k] as Array<Record<string, unknown>>).map(shift);
    this.ual = this.ual.map(shift);
    return this;
  }

  ualCalls(): string[] {
    return this.calls.filter((c) => c.engine === 'exchange').map((c) => c.cmd);
  }
}
