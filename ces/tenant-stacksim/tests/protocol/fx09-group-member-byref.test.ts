// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectStore } from '../../src/store/ObjectStore.js';
import { StackShapeGate } from '../../src/gating/StackShapeGate.js';
import { ResolverTable } from '../../src/resolvers/ResolverTable.js';
import { QueryServer } from '../../src/http/QueryServer.js';

/**
 * FX-09: `New-MgGroupMemberByRef -GroupId {cuiGroupId} ...` failed inside the
 * fake cmdlet with "ConvertTo-Json : An item with the same key has already
 * been added". Root cause: unquoted `{cuiGroupId}` is a [scriptblock] in
 * PowerShell, and Windows PowerShell 5.1's ConvertTo-Json throws that error
 * on a scriptblock. The -BodyParameter hashtable is not the cause (a real id
 * plus the same hashtable serializes fine). Runs the real fake module in
 * powershell.exe against an in-process sim on an ephemeral port.
 */

const SIM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function runPowershell(script: string, env: NodeJS.ProcessEnv): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
    child.stdin.end(script);
  });
}

function marker(stdout: string, name: string): string | undefined {
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith(`${name}::`));
  return line?.slice(name.length + 2).trim();
}

describe('FX-09: New-MgGroupMemberByRef serialization', () => {
  let dir: string;
  let store: ObjectStore;
  let server: QueryServer;
  let port: number;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-fx09-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    await store.create('users', { id: 'user-1', userPrincipalName: 'sim.user1@simtenant.onmicrosoft.us' });
    await store.create('groups', { id: 'group-1', displayName: 'CUI-Authorized-Users' });
    server = new QueryServer({ resolverTable: new ResolverTable(store, new StackShapeGate('m365_azure')) });
    port = await server.start(0);
  });

  afterEach(async () => {
    await server.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('a scriptblock (unquoted {name}) argument is sent as "{name}" and rejected with a 400, not a ConvertTo-Json error; a real id succeeds', async () => {
    const psm1 = path.join(SIM_ROOT, 'psmodules', 'Microsoft.Graph.Authentication', 'Microsoft.Graph.Authentication.psd1');
    const script = `
Import-Module '${psm1}' -Force
$ref = @{ '@odata.id' = 'https://graph.microsoft.us/v1.0/directoryObjects/user-1' }
$safe = & (Get-Module Microsoft.Graph.Authentication) { ConvertTo-StacksimJsonSafe @('-GroupId', {cuiGroupId}) }
$sent = @{ args = $safe } | ConvertTo-Json -Compress
Write-Output ('SENT::' + $sent)
try { New-MgGroupMemberByRef -GroupId {cuiGroupId} -BodyParameter $ref -ErrorAction Stop | Out-Null; Write-Output 'PLACEHOLDER::no-error' } catch { Write-Output ('PLACEHOLDER::' + $_.Exception.Message) }
try { New-MgGroupMemberByRef -GroupId 'group-1' -BodyParameter $ref -ErrorAction Stop | Out-Null; Write-Output 'REAL::ok' } catch { Write-Output ('REAL::' + $_.Exception.Message) }
`;
    const env = { ...process.env, STACKSIM_SERVER_URL: `http://127.0.0.1:${port}` };
    const r = await runPowershell(script, env);
    const placeholder = marker(r.stdout, 'PLACEHOLDER');
    expect(marker(r.stdout, 'SENT'), r.stdout + r.stderr).toBe('{"args":["-GroupId","{cuiGroupId}"]}');
    expect(placeholder, r.stdout + r.stderr).toBeDefined();
    expect(placeholder).not.toMatch(/same key/);
    // Windows PowerShell 5.1's Invoke-RestMethod does not always surface the
    // response body (ErrorDetails), so assert on the status the sim returned.
    expect(placeholder).toMatch(/\(400\)|Request_BadRequest/);
    expect(marker(r.stdout, 'REAL'), r.stdout + r.stderr).toBe('ok');
    expect(await store.read('groupMember', 'group-1|user-1')).toBeDefined();
  }, 60000);
});
