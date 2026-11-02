// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SP-4: the real DPAPI path. The round trips run ONLY on Windows, CurrentUser scope, on random
// in-memory data or temp folders; nothing persistent is created and no value is printed.

import { describe, it, expect } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dpapiArgv, DPAPI_SCRIPT, powershellPath, windowsDpapiProtector, DpapiError } from './dpapi.js';
import { loadModuleSecrets, buildModuleSecretsStore } from './moduleSecrets.js';

const win = process.platform === 'win32';
const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(here, '..', '..', 'scripts', 'New-CesModuleSecrets.ps1');

describe('dpapi argv and script (static)', () => {
  it('argv is constant: flags plus the encoded fixed script, no data', () => {
    const a = dpapiArgv();
    expect(a.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    expect(a).toHaveLength(4);
    expect(Buffer.from(a[3], 'base64').toString('utf16le')).toBe(DPAPI_SCRIPT);
    expect(dpapiArgv()).toEqual(a);
  });

  it('script reads stdin, writes base64 only, reports type names only', () => {
    expect(DPAPI_SCRIPT).toContain('[Console]::In.ReadToEnd()');
    expect(DPAPI_SCRIPT).toContain('ProtectedData]::Protect(');
    expect(DPAPI_SCRIPT).toContain('Exception.GetType().Name');
    expect(DPAPI_SCRIPT).not.toMatch(/Write-Host|Write-Output|\$_\.Exception\.Message/);
  });

  it('powershell is called by absolute path', () => {
    expect(powershellPath({ SystemRoot: 'C:\\Windows' })).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  });

  it.skipIf(win)('off Windows the protector refuses', () => {
    expect(() => windowsDpapiProtector.protect(Buffer.from('x'), 'CurrentUser')).toThrow(DpapiError);
  });
});

describe.skipIf(!win)('dpapi real round trip (Windows, CurrentUser, temp data)', () => {
  it('protect / unprotect / tamper refused', () => {
    const plain = crypto.randomBytes(32);
    const blob = windowsDpapiProtector.protect(plain, 'CurrentUser');
    expect(blob.length).toBeGreaterThan(plain.length);
    expect(blob.includes(plain)).toBe(false);
    expect(blob.subarray(4, 20).toString('hex')).toBe('d08c9ddf0115d1118c7a00c04fc297eb');
    expect(windowsDpapiProtector.unprotect(blob, 'CurrentUser').equals(plain)).toBe(true);
    const bad = Buffer.from(blob);
    bad[bad.length - 5] ^= 0xff;
    expect(() => windowsDpapiProtector.unprotect(bad, 'CurrentUser')).toThrow(DpapiError);
  }, 60_000);

  it('Node writer -> Node loader through real DPAPI', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-fin42-dp-'));
    try {
      const values = { CES_AO_AUTH_TOKEN: crypto.randomBytes(24).toString('base64url') };
      const p = path.join(dir, 'm.dpapi');
      fs.writeFileSync(p, buildModuleSecretsStore(values, 'CurrentUser'));
      expect(fs.readFileSync(p, 'utf8')).not.toContain(values.CES_AO_AUTH_TOKEN);
      const s = loadModuleSecrets({ path: p, env: {} });
      expect(s.get('CES_AO_AUTH_TOKEN') === values.CES_AO_AUTH_TOKEN).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('New-CesModuleSecrets.ps1 (-NoAcl, temp path) -> Node loader: cross-language round trip, no value printed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-fin42-ps-'));
    try {
      const p = path.join(dir, 'sub', 'module-secrets.dpapi');
      const run = () =>
        spawnSync(
          powershellPath(),
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH, '-Path', p, '-NoAcl'],
          { encoding: 'utf8', windowsHide: true, timeout: 90_000 },
        );
      const r = run();
      expect(r.status, String(r.stderr).slice(0, 300)).toBe(0);
      const s = loadModuleSecrets({ path: p, env: {} });
      expect(s.source).toBe('store');
      expect(s.names).toEqual([
        'CES_AO_AUTH_TOKEN', 'CES_AO_PRINCIPAL_SECRET', 'CES_EC_PRINCIPAL_SECRET', 'CES_EO_AUTH_TOKEN',
        'CES_EO_OPERATOR_SECRET', 'CES_MUSTER_SECRETS_TOKEN', 'CES_STAMPER_AUTH_TOKEN', 'EVIDENCE_OPS_SECRET', 'JWT_SECRET',
      ]);
      const vals = s.names.map((n) => s.get(n) as string);
      const fileText = fs.readFileSync(p, 'utf8');
      for (const [i, v] of vals.entries()) {
        // PH7-SEC: CES_MUSTER_SECRETS_TOKEN is a minted muster-api JWT; every other value is 32 random bytes.
        if (s.names[i] === 'CES_MUSTER_SECRETS_TOKEN') expect(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(v)).toBe(true);
        else expect(/^[A-Za-z0-9_-]{43}$/.test(v)).toBe(true);
        expect(r.stdout.includes(v)).toBe(false);
        expect(r.stderr.includes(v)).toBe(false);
        expect(fileText.includes(v)).toBe(false);
      }
      expect(new Set(vals).size).toBe(vals.length);
      expect(r.stdout).toContain('CES_MUSTER_SECRETS_TOKEN is a muster-api JWT (tenant_id mx-sim-tenant, role bhd_operator, expires in 8 h)');
      // A second run without -Force refuses to replace the store, and leaves no temp file.
      const again = run();
      expect(again.status).not.toBe(0);
      expect(fs.readdirSync(path.dirname(p))).toEqual(['module-secrets.dpapi']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

// PH7-SEC (KI-02): the muster token must be what muster-api's POST /api/plan/secrets/resolve accepts:
// an HS256 JWT signed with the store's own JWT_SECRET, role bhd_operator, with tenant_id and exp.
function verifyHs256(token: string, secret: string): Record<string, unknown> {
  const [h, p, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  expect(sig).toBe(expected);
  expect(JSON.parse(Buffer.from(h, 'base64url').toString('utf8'))).toEqual({ alg: 'HS256', typ: 'JWT' });
  return JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe.skipIf(!win)('New-CesModuleSecrets.ps1 mints the muster-api token (PH7-SEC, Windows, temp path)', () => {
  // -Command (not -File) so -Names binds as a string array.
  const runScript = (p: string, extra: string) =>
    spawnSync(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `& '${SCRIPT_PATH}' -Path '${p}' -NoAcl ${extra}`],
      { encoding: 'utf8', windowsHide: true, timeout: 90_000 },
    );

  it('CES_MUSTER_SECRETS_TOKEN is an HS256 JWT signed with the stored JWT_SECRET, with the requested claims', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-ph7-mt-'));
    try {
      const p = path.join(dir, 'module-secrets.dpapi');
      const before = Math.floor(Date.now() / 1000);
      const r = runScript(p, "-Names 'JWT_SECRET','CES_MUSTER_SECRETS_TOKEN' -MusterTenantId 'tid-ph7' -MusterTokenSubject 'sub-ph7' -MusterTokenHours 2");
      expect(r.status, String(r.stderr).slice(0, 300)).toBe(0);
      const s = loadModuleSecrets({ path: p, env: {} });
      const token = s.get('CES_MUSTER_SECRETS_TOKEN') as string;
      const claims = verifyHs256(token, s.get('JWT_SECRET') as string);
      expect(claims).toMatchObject({ sub: 'sub-ph7', tenant_id: 'tid-ph7', party_id: null, role: 'bhd_operator' });
      const iat = claims.iat as number;
      expect(iat).toBeGreaterThanOrEqual(before - 5);
      expect(claims.exp).toBe(iat + 2 * 3600);
      expect(r.stdout.includes(token)).toBe(false);
      expect(r.stdout).toContain('tenant_id tid-ph7');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('refuses CES_MUSTER_SECRETS_TOKEN without JWT_SECRET, and writes nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-ph7-mt-'));
    try {
      const p = path.join(dir, 'module-secrets.dpapi');
      const r = runScript(p, "-Names 'CES_MUSTER_SECRETS_TOKEN'");
      expect(r.status).not.toBe(0);
      expect(String(r.stderr) + String(r.stdout)).toMatch(/include JWT_SECRET/);
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('New-CesModuleSecrets.ps1 (static)', () => {
  const text = fs.readFileSync(SCRIPT_PATH, 'utf8');
  it('uses a CSPRNG and DPAPI, with the shared entropy and format', () => {
    expect(text).toContain('RandomNumberGenerator]::Create()');
    expect(text).toContain('ProtectedData]::Protect(');
    expect(text).toContain("'CES-MODULE-SECRETS-v1'");
    expect(text).toContain("'ces-module-secrets/1'");
  });
  it('never prints values: the only output line names path, scope and names', () => {
    const outs = text.split(/\r?\n/).filter((l) => /Write-(Host|Output|Verbose|Information)|Out-Host/.test(l));
    expect(outs).toHaveLength(1);
    expect(outs[0]).not.toMatch(/\$values|\$plain|\$blob|\$bytes/);
  });
  it('PH7-SEC: mints the muster token with HMACSHA256 over the JWT_SECRET it just made, role bhd_operator', () => {
    expect(text).toContain('System.Security.Cryptography.HMACSHA256');
    expect(text).toContain("$values['JWT_SECRET']");
    expect(text).toContain("role      = 'bhd_operator'");
    expect(text).toContain('{"alg":"HS256","typ":"JWT"}');
  });
  it('protects the ACL (no inheritance) unless -NoAcl', () => {
    expect(text).toContain('SetAccessRuleProtection($true, $false)');
    expect(text).toMatch(/if \(-not \$NoAcl\)/);
  });
});
