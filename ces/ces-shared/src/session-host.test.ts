// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W8-SES (2026-10-30): scripts/session-host.ps1 renders output objects the way a fresh
 * `powershell.exe -Command` does (Out-String default formatting), so a capture such as
 * namedLocationId (`id : ...`) is read the same on the GUI session path and the CLI path.
 * Spawns real powershell.exe, so it runs on Windows only.
 */

import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = path.resolve(__dirname, '../scripts/session-host.ps1');
const STAMPER_COPY = path.resolve(__dirname, '../../ces-stamper/scripts/session-host.ps1');
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
const isWindows = process.platform === 'win32';

/** Runs each command through one session-host process; returns each command's stdout (CRLF -> LF). */
function runInHost(commands: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', [...PS_ARGS, '-File', HOST], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    p.on('error', reject);
    p.on('close', () => {
      const body = out.replace(/\r\n/g, '\n').replace(/^STAMPER_HOST_READY\n/, '');
      const replies = body.split(/STAMPER_EXIT:\d+\n/).slice(0, commands.length);
      resolve(replies.map((r) => r.split('STAMPER_STDOUT_END\n')[0]));
    });
    for (const c of commands) p.stdin.write(`$ErrorActionPreference = "Stop"\n${c}\nSTAMPER_CMD_END\n`);
    p.stdin.end();
  });
}

/** The CLI path: a fresh powershell.exe -Command per command (PowerShellAdapter.executePowerShell). */
function runFresh(command: string): string {
  const r = spawnSync('powershell.exe', [...PS_ARGS, '-Command', `$ErrorActionPreference = "Stop"\n${command}`], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return r.stdout.replace(/\r\n/g, '\n');
}

describe.skipIf(!isWindows)('session-host.ps1 output rendering (W8-SES)', () => {
  const NAMED_LOCATION = "[pscustomobject]@{id='namedLocation-1'; displayName='CMMC Trusted'; isTrusted=$true; createdDateTime='2026-10-30'; modifiedDateTime='2026-10-30'}";
  const commands = [
    NAMED_LOCATION,
    "[pscustomobject]@{a=1;b=2},[pscustomobject]@{a=3;b=4}",
    "@{ id = 'j1'; v = ('y' * 300) } | ConvertTo-Json -Compress",
    "@(@{ id = 'caPolicy-1'; state = 'enabled' }, @{ id = 'caPolicy-2'; state = 'disabled' }) | ConvertTo-Json -Depth 10",
    "'plain'; [pscustomobject]@{Id='after-string'}",
  ];

  it('prints a [pscustomobject] in list form (id : ...), not as a blank line', async () => {
    const [named] = await runInHost([NAMED_LOCATION]);
    expect(named).toMatch(/^id\s*:\s*namedLocation-1\s*$/m);
  }, 60_000);

  it('matches the fresh powershell.exe output for the same commands', async () => {
    const session = await runInHost(commands);
    commands.forEach((c, i) => expect(session[i]).toBe(runFresh(c)));
  }, 120_000);

  it('passes a long single-line string (compressed JSON) through whole', async () => {
    const [json] = await runInHost(["@{ id = 'j1'; v = ('y' * 300) } | ConvertTo-Json -Compress"]);
    expect(JSON.parse(json)).toEqual({ id: 'j1', v: 'y'.repeat(300) });
  }, 60_000);
});

/** The CLI path without blocking the event loop (the in-test HTTP server below must answer while it runs). */
function runFreshAsync(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', [...PS_ARGS, '-Command', `$ErrorActionPreference = "Stop"\n${command}`], { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    p.on('error', reject);
    p.on('close', () => resolve(out.replace(/\r\n/g, '\n')));
  });
}

/** A local HTTP sink that keeps each request body's raw bytes, keyed by the x-path header. */
function startSink(): Promise<{ port: number; bodies: Map<string, Buffer>; close: () => void }> {
  return new Promise((resolve) => {
    const bodies = new Map<string, Buffer>();
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        bodies.set(String(req.headers['x-path']), Buffer.concat(chunks));
        res.setHeader('Content-Type', 'application/json');
        res.end('{}');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ port, bodies, close: () => server.close() });
    });
  });
}

describe.skipIf(!isWindows)('session-host.ps1 non-ASCII text (W8-ENC)', () => {
  // em dash, e-acute, u-umlaut, n-tilde, curly double quotes, ellipsis, euro, en dash, CJK, an astral emoji
  const TEXT = 'x—y é ü ñ “q” … € – 中 😀';
  // A here-string keeps the curly quotes literal; the output is ASCII char codes, so stdout encoding plays no part.
  const charCodes = (s: string) => `$s = @"\n${s}\n"@\n($s.ToCharArray() | ForEach-Object { [int]$_ }) -join ','`;
  const expected = Array.from({ length: TEXT.length }, (_, i) => TEXT.charCodeAt(i)).join(',');

  it('reads an em dash from stdin as U+2014, not as code-page mojibake', async () => {
    const [codes] = await runInHost([charCodes('CMMC boundary protection — enable')]);
    expect(codes.trim().split(',').map(Number)).toContain(0x2014);
  }, 60_000);

  it('runs the same string as a fresh powershell.exe -Command', async () => {
    const [session] = await runInHost([charCodes(TEXT)]);
    expect(session.trim()).toBe(expected);
    expect(session).toBe(await runFreshAsync(charCodes(TEXT)));
  }, 120_000);

  it('sends the same request-body bytes as the CLI (Invoke-RestMethod, as the stacksim shim calls it)', async () => {
    const sink = await startSink();
    try {
      const post = (tag: string, text: string) =>
        `$b = @{ description = @"\n${text}\n"@ } | ConvertTo-Json -Compress\n` +
        `$null = Invoke-RestMethod -Uri 'http://127.0.0.1:${sink.port}/' -Method Post -Headers @{ 'x-path' = '${tag}' } -Body $b -ContentType 'application/json'\n'ok'`;
      const firewall = 'CMMC boundary protection — enable Windows Firewall';
      await runInHost([post('session-fw', firewall), post('session-all', TEXT)]);
      await runFreshAsync(post('cli-fw', firewall));
      await runFreshAsync(post('cli-all', TEXT));
      const fw = sink.bodies.get('session-fw');
      expect(fw).toBeDefined();
      expect(fw!.equals(sink.bodies.get('cli-fw')!)).toBe(true);
      expect(fw!.toString('latin1')).toContain('CMMC boundary protection - enable');
      expect(sink.bodies.get('session-all')!.equals(sink.bodies.get('cli-all')!)).toBe(true);
    } finally {
      sink.close();
    }
  }, 120_000);
});

describe('session-host.ps1 has one copy (DUP-3)', () => {
  it('ces-stamper/scripts/session-host.ps1 is gone; ces-shared/scripts holds the only copy', () => {
    expect(fs.existsSync(HOST)).toBe(true);
    expect(fs.existsSync(STAMPER_COPY)).toBe(false);
  });
});
