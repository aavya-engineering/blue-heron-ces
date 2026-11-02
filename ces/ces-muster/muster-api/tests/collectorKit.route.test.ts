// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// W4-MU2 (MU-19) acceptance: the collector kit has a real entry point.
// GET /api/recipes/collector-kit serves the script the production generator
// builds from the REAL Stamper registry (loadRegistryGetEntries, the same
// source the discovery walk reads), and /manifest serves its signing
// manifest. The served script verifies against the served manifest.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import { createRecipesRouter } from '../src/routes/recipes.js';
import { createApp } from '../src/app.js';
import { mintToken } from '../src/lib/jwt.js';
import { loadRegistryGetEntries } from '../src/services/discoveryWiring.js';
import { buildKitManifest, generateCollectorScript } from '../src/services/collectorKitService.js';
import { sha256Hex } from '../src/lib/recipeSigning.js';

const OPERATOR = mintToken({ sub: 'op', tenant_id: 't-1', party_id: null, role: 'bhd_operator' });
const SUB = mintToken({ sub: 'sub', tenant_id: 't-1', party_id: 'p-1', role: 'sub' });

const ENTRIES = loadRegistryGetEntries();

let server: http.Server;
let base: string;
let emptyServer: http.Server;
let emptyBase: string;

beforeAll(() => {
  // The production app (real route mounting, real registry).
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // A router whose registry is empty -> 503, not an empty script.
  const app = express();
  app.use('/api/recipes', createRecipesRouter(() => []));
  emptyServer = app.listen(0);
  emptyBase = `http://127.0.0.1:${(emptyServer.address() as { port: number }).port}`;
});

afterAll(() => {
  server?.close();
  emptyServer?.close();
});

describe('W4-MU2 MU-19: GET /api/recipes/collector-kit', () => {
  test('the real registry is present (the kit is not built from a fixture)', () => {
    expect(ENTRIES.length).toBeGreaterThan(10);
  });

  test('serves the generator output for the real registry, as a .ps1 download with its sha256', async () => {
    const res = await fetch(`${base}/api/recipes/collector-kit`, {
      headers: { Authorization: `Bearer ${OPERATOR}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('muster-collector-kit.ps1');
    const script = await res.text();
    expect(script).toBe(generateCollectorScript(ENTRIES));
    expect(res.headers.get('x-collector-kit-sha256')).toBe(sha256Hex(script));
    // Every runnable registry get appears, annotated.
    const runnable = ENTRIES.filter((e) => !e.manual_only && e.get_command && e.get_command.trim() !== '');
    for (const e of runnable.slice(0, 25)) expect(script).toContain(`# ── ${e.entry_id} — evidences:`);
  });

  test('the manifest route serves the signing manifest that verifies the served script', async () => {
    const [scriptRes, manRes] = await Promise.all([
      fetch(`${base}/api/recipes/collector-kit`, { headers: { Authorization: `Bearer ${OPERATOR}` } }),
      fetch(`${base}/api/recipes/collector-kit/manifest`, { headers: { Authorization: `Bearer ${OPERATOR}` } }),
    ]);
    const script = await scriptRes.text();
    const manifest = await manRes.json();
    expect(manifest).toEqual(buildKitManifest(script));
    expect(manifest.read_only).toBe(true);
    expect(manifest.sha256).toBe(sha256Hex(script));
  });

  test('role-gated: sub gets 403, no token gets 401', async () => {
    const sub = await fetch(`${base}/api/recipes/collector-kit`, { headers: { Authorization: `Bearer ${SUB}` } });
    expect(sub.status).toBe(403);
    const anon = await fetch(`${base}/api/recipes/collector-kit`);
    expect(anon.status).toBe(401);
  });

  test('no registry entries -> 503, never an empty kit', async () => {
    const res = await fetch(`${emptyBase}/api/recipes/collector-kit`, {
      headers: { Authorization: `Bearer ${OPERATOR}` },
    });
    expect(res.status).toBe(503);
  });
});
