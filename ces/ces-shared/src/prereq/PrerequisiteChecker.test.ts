// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SP-2 (SECRETS-PLAN.md): the PFX import password and path go through the child's environment,
// never its command line.

import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import {
  IMPORT_PFX_SCRIPT,
  PrerequisiteChecker,
  encodePowerShellCommand,
  type PrereqSpawnFn,
} from './PrerequisiteChecker.js';

interface Captured { cmd: string; args: string[]; opts: { env?: NodeJS.ProcessEnv } }

function fakeSpawn(captured: Captured[], exitCode = 0): PrereqSpawnFn {
  return ((cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
    captured.push({ cmd, args, opts });
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    setImmediate(() => proc.emit('close', exitCode));
    return proc;
  }) as unknown as PrereqSpawnFn;
}

describe('PrerequisiteChecker.importCertificate (SP-2)', () => {
  const PASSWORD = "S3cr'et-Pa$$word";
  const PFX = "C:\\certs\\o'brien tenant.pfx";

  it('puts the password and path only in env, never in args or the decoded command', async () => {
    const captured: Captured[] = [];
    const checker = new PrerequisiteChecker({ spawnFn: fakeSpawn(captured) });
    const { promise } = checker.importCertificate(PFX, PASSWORD, () => {});
    expect(await promise).toBe(0);

    expect(captured).toHaveLength(1);
    const { cmd, args, opts } = captured[0];
    expect(cmd).toBe('powershell.exe');
    const joined = args.join(' ');
    expect(joined).not.toContain(PASSWORD);
    expect(joined).not.toContain(PFX);
    expect(args).not.toContain('-Command');

    const encIdx = args.indexOf('-EncodedCommand');
    expect(encIdx).toBeGreaterThan(-1);
    const decoded = Buffer.from(args[encIdx + 1], 'base64').toString('utf16le');
    expect(decoded).toBe(IMPORT_PFX_SCRIPT);
    expect(decoded).not.toContain(PASSWORD);
    expect(decoded).not.toContain(PFX);
    expect(decoded).toContain('$env:CES_PFX_PASSWORD');
    expect(decoded).toContain('$env:CES_PFX_PATH');

    expect(opts.env?.CES_PFX_PASSWORD).toBe(PASSWORD);
    expect(opts.env?.CES_PFX_PATH).toBe(PFX);
  });

  it('reports the child exit code', async () => {
    const captured: Captured[] = [];
    const checker = new PrerequisiteChecker({ spawnFn: fakeSpawn(captured, 1) });
    expect(await checker.importCertificate(PFX, PASSWORD, () => {}).promise).toBe(1);
  });

  it('progress lines carry no password', async () => {
    const lines: string[] = [];
    const checker = new PrerequisiteChecker({ spawnFn: fakeSpawn([]) });
    await checker.importCertificate(PFX, PASSWORD, (l) => lines.push(l)).promise;
    expect(lines.join('\n')).not.toContain(PASSWORD);
  });

  it('encodes as base64 UTF-16LE', () => {
    expect(encodePowerShellCommand('ab')).toBe(Buffer.from('a\0b\0', 'binary').toString('base64'));
  });
});

// FIN-42 (SP-4): every PowerShell child of the checker gets a scrubbed env (no CES module secrets).
describe('PrerequisiteChecker child env scrub (FIN-42 / SP-4)', () => {
  const PLANTED = { CES_AO_AUTH_TOKEN: 'x', CES_EO_PRINCIPAL_SECRET: 'x', jwt_secret: 'x', ANTHROPIC_API_KEY: 'x', FIN42_KEEP_ME: 'kept' };
  const SECRET_KEYS = ['CES_AO_AUTH_TOKEN', 'CES_EO_PRINCIPAL_SECRET', 'JWT_SECRET', 'ANTHROPIC_API_KEY'];

  async function withPlanted(fn: () => Promise<void>): Promise<void> {
    const had = new Set(Object.keys(process.env));
    Object.assign(process.env, PLANTED);
    try { await fn(); } finally { for (const k of Object.keys(PLANTED)) if (!had.has(k)) delete process.env[k]; }
  }
  function assertScrubbed(opts: { env?: NodeJS.ProcessEnv }): void {
    expect(opts.env).toBeDefined();
    const keys = Object.keys(opts.env ?? {}).map((k) => k.toUpperCase());
    for (const k of SECRET_KEYS) expect(keys).not.toContain(k);
    expect(opts.env?.FIN42_KEEP_ME).toBe('kept');
  }

  it('installModule, getPSVersion (execPS) and importCertificate spawn through spawnFn with a scrubbed env', async () => {
    await withPlanted(async () => {
      const captured: Captured[] = [];
      const checker = new PrerequisiteChecker({ spawnFn: fakeSpawn(captured) });
      await checker.installModule('Microsoft.Graph', () => {}).promise;
      await checker.getPSVersion();
      await checker.importCertificate('C:\t.pfx', 'pw', () => {}).promise;
      expect(captured.map((c) => c.cmd)).toEqual(['powershell.exe', 'powershell.exe', 'powershell.exe']);
      for (const c of captured) assertScrubbed(c.opts);
      expect(captured[2].opts.env?.CES_PFX_PASSWORD).toBe('pw');
      expect(process.env.CES_AO_AUTH_TOKEN).toBe('x'); // the parent env is not mutated
    });
  });
});
