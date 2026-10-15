// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Test harness: every test gets a throwaway CES_PIPELINE_ROOT + tenant-registry root under
// the OS temp dir, so nothing reads or writes a real pipeline root, registry or home dir.
// All tenants are registry records whose endpoints are loopback (sim) — no test ever
// reaches a real tenant or a Microsoft endpoint (the live fixture uses a non-routable
// .invalid host that is never contacted; EC does not make outbound calls at all).

import * as fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp, type AppDeps } from '../src/app.js';
import { registryTenantResolver, type TenantResolver } from '../src/simRail.js';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
export const SECRET = 'test-secret-value-0123456789';

const ENV_KEYS = [
  'CES_PIPELINE_ROOT',
  'CES_TENANT_ROOT',
  'CES_EC_SIM_ONLY',
  'EVIDENCE_OPS_SECRET',
  'EC_STALE_DAYS',
  'EC_INDEX_INTERVAL_MIN',
  'EC_PORT',
  'EC_HOST',
] as const;

export interface Sandbox {
  dir: string;
  pipelineRoot: string;
  registryRoot: string;
  homeDir: string;
  resolver: TenantResolver;
  restore(): void;
}

export function makeSandbox(): Sandbox {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-ec-test-'));
  const pipelineRoot = path.join(dir, 'pipeline');
  const registryRoot = path.join(dir, 'tenants');
  const homeDir = path.join(dir, 'home');
  for (const d of [pipelineRoot, registryRoot, homeDir]) fs.mkdirSync(d, { recursive: true });
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.CES_PIPELINE_ROOT = pipelineRoot;
  process.env.CES_TENANT_ROOT = registryRoot;
  process.env.EVIDENCE_OPS_SECRET = SECRET;
  return {
    dir,
    pipelineRoot,
    registryRoot,
    homeDir,
    resolver: registryTenantResolver({ registryRoot, cesPipelineRoot: pipelineRoot, homeDir }),
    restore() {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Write a ces-tenant registry record (kind-namespaced, as FileTenantRegistry reads it). */
export function registerTenant(sb: Sandbox, slug: string, kind: 'sim' | 'live', graph?: string): void {
  const base = kind === 'sim' ? 'http://localhost:4390' : 'https://graph.example.invalid';
  const rec = {
    kind,
    client: { slug, name: `fixture ${slug}` },
    tenant: { tenant_id: '00000000-0000-0000-0000-000000000000', domain: `${slug}.example.invalid`, ...(kind === 'sim' ? { environment: 'gcc-high-sim' } : {}) },
    auth: { app_id: '00000000-0000-0000-0000-000000000001', cert_path: 'fixture.pfx', cert_thumbprint: 'FIXTURETHUMBPRINT' },
    endpoints: { graph: graph ?? `${base}/graph`, login: `${base}/login` },
  };
  const dir = path.join(sb.registryRoot, kind);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify(rec, null, 2));
}

export function stamperTenantDir(sb: Sandbox, slug: string): string {
  return path.join(sb.pipelineRoot, 'Stamper', 'plan-data', slug);
}

export function ecTenantDir(sb: Sandbox, slug: string): string {
  return path.join(sb.pipelineRoot, 'EvidenceCollector', 'storage', slug);
}

/** Seed a Stamper tenant tree from fixtures. Returns the tenant dir. */
export function seedStamper(
  sb: Sandbox,
  slug: string,
  files: Record<string, string>, // relPath -> fixture filename OR literal content prefixed with 'raw:'
): string {
  const root = stamperTenantDir(sb, slug);
  for (const [rel, src] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (src.startsWith('raw:')) fs.writeFileSync(abs, src.slice(4));
    else fs.copyFileSync(path.join(FIXTURES, src), abs);
  }
  return root;
}

export interface Running {
  base: string;
  server: Server;
  close(): Promise<void>;
}

export async function startApp(deps: AppDeps): Promise<Running> {
  const app = createApp(deps);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    server,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export function auth(token: string = SECRET): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export function ingestBody(slug: string, content: Buffer | string, extra: Record<string, unknown> = {}): string {
  const buf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
  return JSON.stringify({
    tenantSlug: slug,
    controlIds: ['PE.L1-3.10.1'],
    source: 'manual_upload',
    filename: 'badge-reader-photo.png',
    mediaType: 'image/png',
    contentBase64: buf.toString('base64'),
    submittedByRole: 'compliance_officer',
    ...extra,
  });
}
