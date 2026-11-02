// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-21 (2026-10-31): Stamper's side of the clean-tenant simulator path.
//  - preflight: case-tolerant parse (SDK PascalCase vs simulator/REST camelCase), held items and the
//    break-glass check in the summary;
//  - the prerequisites routes no longer kill their own child (REQ-STAMPER-PREREQ-ROUTES-KILL-OWN-CHILD);
//  - New-TenantBootstrap.ps1: licence check + assignment, -Simulator, FD-1 guard, parse-clean under pwsh.
// The end-to-end bootstrap run against the simulator lives in tenant-stacksim
// (tests/integration/fin21-bootstrap-pwsh.test.ts); the in-process call sequence in fin21-clean-g5.test.ts.
import * as fs from 'fs';
import * as path from 'path';
import http from 'http';
import { EventEmitter } from 'events';
import { spawnSync } from 'child_process';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { withPascalAliases, buildPreflightHeldReport, summarizeBreakGlass } from '../../src/server/routes/preflightReport';
import { killOnClientDisconnect } from '../../src/server/routes/connect.routes';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'New-TenantBootstrap.ps1');
const ps1 = fs.readFileSync(SCRIPT, 'utf-8');
const execRoutes = fs.readFileSync(path.join(ROOT, 'src', 'server', 'routes', 'execute.routes.ts'), 'utf-8');
const connectRoutes = fs.readFileSync(path.join(ROOT, 'src', 'server', 'routes', 'connect.routes.ts'), 'utf-8');

describe('preflight: case-tolerant parse', () => {
  it('adds PascalCase aliases recursively and never overwrites an existing key', () => {
    const sim = withPascalAliases({ id: 'sp-1', displayName: 'Microsoft Graph', appRoles: [{ id: 'r1', value: 'Directory.ReadWrite.All' }] }) as any;
    expect(sim.Id).toBe('sp-1');
    expect(sim.DisplayName).toBe('Microsoft Graph');
    expect(sim.AppRoles[0].Value).toBe('Directory.ReadWrite.All');
    expect(sim.AppRoles[0].Id).toBe('r1');
    expect(sim.id).toBe('sp-1');
    const sdk = withPascalAliases({ Id: 'A', id: 'b' }) as any;
    expect(sdk.Id).toBe('A');
    expect(withPascalAliases([{ appRoleId: 'x' }])).toEqual([{ appRoleId: 'x', AppRoleId: 'x' }]);
    expect(withPascalAliases('text')).toBe('text');
    expect(withPascalAliases(null)).toBeNull();
  });

  it('the preflight block parses every PowerShell result through the aliasing parse', () => {
    expect(execRoutes).toMatch(/function psJsonParse\(raw: string\): any \{\s*return withPascalAliases\(psJsonParseRaw\(raw\)\);/);
  });
});

describe('preflight: held items and break-glass in the summary (V117)', () => {
  it('names each held item with its phase and the release flag', () => {
    const r = buildPreflightHeldReport(
      [{ permission: 'Sites.FullControl.All', resourceName: 'Office 365 SharePoint Online' }],
      ['Teams Administrator'],
      'founder decision pending',
    );
    expect(r.count).toBe(2);
    expect(r.items).toEqual([
      { phase: 'graph_permission', name: 'Sites.FullControl.All (Office 365 SharePoint Online)', detail: 'founder decision pending' },
      { phase: 'directory_role', name: 'Teams Administrator', detail: 'founder decision pending' },
    ]);
    expect(r.release_flag).toBe('CES_HELD_STANDING_GRANTS_ENABLED');
    expect(buildPreflightHeldReport([], [], 'x')).toEqual({ items: [], count: 0, release_flag: 'CES_HELD_STANDING_GRANTS_ENABLED' });
  });

  it('break-glass is verified only when the check found every account', () => {
    expect(summarizeBreakGlass('exists', ['a@x', 'b@x'], 'ok')).toEqual({ status: 'exists', verified: true, upns: ['a@x', 'b@x'], detail: 'ok' });
    for (const s of ['missing', 'error', 'not_run'] as const) expect(summarizeBreakGlass(s, [], 'd').verified).toBe(false);
  });

  it('the summary event carries both, and every break-glass outcome sets the report', () => {
    const s = execRoutes.indexOf("type: 'preflight_summary'");
    const block = execRoutes.slice(s, s + 600);
    expect(block).toMatch(/held: buildPreflightHeldReport\(HELD_RESOURCE_APP_ROLES, HELD_DIRECTORY_ROLES, HELD_DETAIL\)/);
    expect(block).toMatch(/breakGlass,/);
    const bg = execRoutes.slice(execRoutes.indexOf('Phase 5c: Break-glass VERIFY'), execRoutes.indexOf('---- Summary + done ----'));
    expect(bg.match(/breakGlass = summarizeBreakGlass\(/g)).toHaveLength(3);
    expect(bg).not.toMatch(/New-MgUser|Update-MgUser/);
  });
});

describe('prerequisites routes: the child is killed only on a client disconnect', () => {
  function fakeRes(writableEnded = false) {
    const em = new EventEmitter() as EventEmitter & { writableEnded: boolean };
    em.writableEnded = writableEnded;
    return em;
  }

  it('does not kill after the child finished, or once the response ended', async () => {
    let kills = 0;
    const res = fakeRes();
    killOnClientDisconnect(res as any, Promise.resolve(0), () => { kills++; });
    await new Promise((r) => setImmediate(r));
    res.emit('close');
    expect(kills).toBe(0);

    const ended = fakeRes(true);
    killOnClientDisconnect(ended as any, new Promise(() => {}), () => { kills++; });
    ended.emit('close');
    expect(kills).toBe(0);
  });

  it('kills a still-running child when the client goes away', () => {
    let kills = 0;
    const res = fakeRes();
    killOnClientDisconnect(res as any, new Promise(() => {}), () => { kills++; });
    res.emit('close');
    expect(kills).toBe(1);
  });

  it('over real HTTP, a POST with a body runs its child to completion (the old req close fired first)', async () => {
    const app = express();
    app.use(express.json());
    let kills = 0;
    let reqClosedEarly = false;
    app.post('/run', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.flushHeaders();
      let finished = false;
      const done = new Promise<number>((resolve) => setTimeout(() => { finished = true; resolve(0); }, 300));
      req.on('close', () => { if (!finished) reqClosedEarly = true; });
      killOnClientDisconnect(res, done, () => { kills++; });
      done.then((code) => { res.write(`data: ${JSON.stringify({ type: 'install_done', success: code === 0 })}\n\n`); res.end(); });
    });
    const server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const port = (server.address() as { port: number }).port;
    const body = await new Promise<string>((resolve, reject) => {
      const data = JSON.stringify({ certPath: 'x', password: 'y' });
      const r = http.request({ hostname: '127.0.0.1', port, path: '/run', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve(buf));
      });
      r.on('error', reject);
      r.write(data);
      r.end();
    });
    server.close();
    expect(body).toContain('"success":true');
    expect(kills).toBe(0);
    // Documents the defect on this Node version: the request's own 'close' fired before the child finished.
    expect(reqClosedEarly).toBe(true);
  });

  it('both prerequisite routes use it and no longer bind kill to the request close', () => {
    expect(connectRoutes.match(/killOnClientDisconnect\(res, promise, kill\);/g)).toHaveLength(2);
    expect(connectRoutes).not.toMatch(/req\.on\('close', \(\) => \{\s*kill\(\);/);
  });
});

describe('New-TenantBootstrap.ps1: licences, simulator mode, FD-1', () => {
  it('checks the subscribed SKUs and assigns already-owned seats (audit steps 1 and 18), recorded in the result', () => {
    expect(ps1).toMatch(/Get-MgSubscribedSku -All -ErrorAction Stop/);
    expect(ps1).toMatch(/Set-MgUserLicense -UserId \$licUser\.Id -AddLicenses @\(@\{ SkuId = \$licenseSku\.SkuId \}\) -RemoveLicenses @\(\)/);
    expect(ps1).toMatch(/licenses = \$licenseResult/);
    expect(ps1).toMatch(/never buys one/);
    expect(ps1).toMatch(/\[string\[\]\]\$LicenseUpn = @\(\)/);
  });

  it('a scripted Security Defaults answer is refused unless -Simulator (FD-1), and -Simulator needs a sim tenant', () => {
    expect(ps1).toMatch(/if \(\$SecurityDefaultsAnswer -and -not \$Simulator\) \{[\s\S]*?exit 1/);
    expect(ps1).toMatch(/if \(\$TenantId -notlike "sim-tenant-\*"\) \{[\s\S]*?exit 1/);
    expect(ps1).toMatch(/if \(\$Simulator -and \$SecurityDefaultsAnswer\) \{/);
    expect(ps1).toMatch(/Read-Host -Prompt "Type 'yes' to turn Security Defaults OFF now/);
  });

  it('simulator mode refuses a real Graph/Az module and keeps files out of the repo', () => {
    expect(ps1).toMatch(/is not the tenant-stacksim shadow command/);
    expect(ps1).toMatch(/if \(-not \$OutputPath\) \{ \$OutputPath = Join-Path \$CertStorePath "\.env" \}/);
  });

  it('keeps the key non-exportable and writes no PFX', () => {
    expect(ps1).toMatch(/-KeyExportPolicy NonExportable/);
    expect(ps1).not.toMatch(/Export-PfxCertificate/);
  });

  const pwsh = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
    `$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${SCRIPT.replace(/'/g, "''")}',[ref]$t,[ref]$e); Write-Output $e.Count`], { encoding: 'utf-8' });
  (pwsh.status === 0 ? it : it.skip)('parses with 0 errors under PowerShell 7', () => {
    expect(pwsh.stdout.trim()).toBe('0');
  });
});
