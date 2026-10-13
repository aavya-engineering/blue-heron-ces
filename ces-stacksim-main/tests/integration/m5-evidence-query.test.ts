// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProfile, resolveProfilePath } from '../../src/profiles/ProfileLoader.js';
import { SeedEngine } from '../../src/seed/SeedEngine.js';
import { startServe, type ServeHandle } from '../../src/cli/commands/serve.js';
import { queryLedger } from '../../src/cli/commands/query-ledger.js';
import { queryEvidence, runQueryEvidence } from '../../src/cli/commands/query-evidence.js';

/**
 * M5 gate (PLAN.md Milestone Ladder row M5; File Inventory rows tagged M5;
 * Core Design (c) Evidence hold; Core Design (f) single-writer authority).
 *
 * Test gate (PLAN.md M5 row, verbatim): "Seed tenant, run 5 mixed
 * read/write commands, query evidence by objectType/time range via the CLI
 * (which round-trips through the server), assert correct snapshot
 * count/content."
 *
 * The 5 mixed read/write commands are driven as real HTTP POSTs to the
 * running server's /resolve route — the exact same request shape the
 * generated fake PowerShell modules' wrapper functions send (Core Design
 * (d), confirmed working end-to-end via real spawned powershell.exe at
 * M2-M4). M5's own novel surface is EvidenceHold/EvidenceQuery and the
 * /ledger + /evidence routes + query-ledger/query-evidence CLI commands —
 * exercising that surface via direct HTTP to /resolve is sufficient
 * coverage without re-spawning 5 separate powershell.exe processes for
 * protocol-compatibility already proven at M2-M4 (see
 * IMPLEMENTATION_LOG.md M5 Deviations).
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROFILES_DIR = path.join(SIM_ROOT, 'profiles');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callResolve(baseUrl: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${baseUrl}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { data?: unknown; error?: string };
  if (!res.ok) {
    throw new Error(`resolve failed (${res.status}): ${json.error ?? 'unknown error'}`);
  }
  return json.data;
}

describe('M5: evidence hold + query CLI/HTTP', () => {
  let tenantRoot: string;
  let handle: ServeHandle;
  let baseUrl: string;

  beforeEach(async () => {
    tenantRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-m5-'));

    const profile = await loadProfile(resolveProfilePath('m365_azure', PROFILES_DIR));
    handle = await startServe({
      stance: 'm365_azure',
      slug: 'stacksim-test-m5',
      port: 0,
      profilesDir: PROFILES_DIR,
      tenantRoot,
    });
    baseUrl = `http://127.0.0.1:${handle.port}`;

    const seedEngine = new SeedEngine(handle.store, handle.ledger);
    await seedEngine.seed(profile);
  });

  afterEach(async () => {
    await handle.stop();
    await fs.rm(tenantRoot, { recursive: true, force: true });
  });

  it('5 mixed read/write commands: evidence is held only for the 3 GET-shaped reads, queryable by objectType and time range', async () => {
    // 1. GET (read) — named-cmdlet: Get-MgIdentityConditionalAccessPolicy -> caPolicies (evidence #1)
    const read1 = await callResolve(baseUrl, { kind: 'cmdlet', cmdlet: 'Get-MgIdentityConditionalAccessPolicy' });
    // SIMFIX FIX-S2: 3 generator policies + 5 from the gcc-high-g5 seed set (m365-azure.json seedSets).
    expect(read1).toHaveLength(8);

    await sleep(10);

    // 2. PATCH (write) — AO's A-18 shape: no evidence recorded for a mutation
    await callResolve(baseUrl, {
      kind: 'uri',
      method: 'PATCH',
      uri: '/v1.0/policies/authorizationPolicy',
      body: { defaultUserRolePermissions: { allowedToCreateApps: false } },
    });

    await sleep(10);

    // 3. GET (read) — URI-pattern, OData-enveloped: /v1.0/identity/conditionalAccess/policies -> caPolicies (evidence #2)
    const read2 = await callResolve(baseUrl, {
      kind: 'uri',
      method: 'GET',
      uri: '/v1.0/identity/conditionalAccess/policies',
    });
    expect(read2).toEqual({ value: expect.any(Array) });

    await sleep(10);
    const midBoundary = new Date().toISOString();
    await sleep(10);

    // 4. PATCH (write) — Stamper's Fido2 shape: no evidence recorded for a mutation
    await callResolve(baseUrl, {
      kind: 'uri',
      method: 'PATCH',
      uri: 'https://graph.microsoft.us/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/Fido2',
      body: { state: 'enabled' },
    });

    await sleep(10);

    // 5. GET (read) — named-cmdlet: Get-MgAuditLogDirectoryAudit -> directoryAudits (evidence #3);
    // by now 2 directoryAudits entries exist (from writes #2 and #4 above).
    const read3 = await callResolve(baseUrl, { kind: 'cmdlet', cmdlet: 'Get-MgAuditLogDirectoryAudit' });
    expect(read3).toHaveLength(2);

    // --- Query evidence by objectType, via the CLI's HTTP client (round-trips through the server) ---
    const caPoliciesEvidence = await queryEvidence({ serverUrl: baseUrl, objectType: 'caPolicies' });
    expect(caPoliciesEvidence).toHaveLength(2);
    expect(caPoliciesEvidence.every((s) => s.objectType === 'caPolicies')).toBe(true);
    // Content check: one snapshot is the raw named-cmdlet array, the other the {value:[...]} envelope.
    expect(caPoliciesEvidence.some((s) => Array.isArray(s.response) && (s.response as unknown[]).length === 8)).toBe(
      true,
    );
    expect(
      caPoliciesEvidence.some(
        (s) =>
          typeof s.response === 'object' &&
          s.response !== null &&
          Array.isArray((s.response as { value: unknown[] }).value),
      ),
    ).toBe(true);

    const directoryAuditsEvidence = await queryEvidence({ serverUrl: baseUrl, objectType: 'directoryAudits' });
    expect(directoryAuditsEvidence).toHaveLength(1);
    expect(directoryAuditsEvidence[0].response).toHaveLength(2);

    // No evidence for a mutation-only objectType/request path.
    const mutationEvidence = await queryEvidence({ serverUrl: baseUrl, objectType: 'authorizationPolicy' });
    expect(mutationEvidence).toHaveLength(0);

    // --- Query evidence by time range, via the CLI's HTTP client ---
    const beforeMid = await queryEvidence({ serverUrl: baseUrl, to: midBoundary });
    expect(beforeMid).toHaveLength(2); // evidence #1 and #2 only

    const afterMid = await queryEvidence({ serverUrl: baseUrl, from: midBoundary });
    expect(afterMid).toHaveLength(1); // evidence #3 only
    expect(afterMid[0].objectType).toBe('directoryAudits');

    // --- Same round-trip via the argv-parsing CLI entry point (not just the programmatic one) ---
    const viaArgv = await runQueryEvidence(['--server-url', baseUrl, '--object-type', 'caPolicies']);
    expect(viaArgv).toHaveLength(2);

    // --- query-ledger's HTTP client independently confirms the read-serve/mutate split ---
    const readServeEntries = await queryLedger({ serverUrl: baseUrl, type: 'read-serve' });
    expect(readServeEntries).toHaveLength(3);

    const mutateEntries = await queryLedger({ serverUrl: baseUrl, type: 'mutate' });
    expect(mutateEntries).toHaveLength(2);
  });
});
