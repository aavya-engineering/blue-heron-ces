// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set CES_PIPELINE_ROOT before any ces-shared imports resolve the default, so
// writeJsonArtifact / tenantPlansDir land under a throwaway tmp dir, never a real tenant tree.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-gaps-route-'));
process.env.CES_PIPELINE_ROOT = tmpRoot;

import { createGapsRouter } from '../../src/server/routes/gaps.routes';
import { CommandRegistry } from '../../src/registry/CommandRegistry';

const FIXTURES = path.resolve(__dirname, '..', 'fixtures');
const ASSESS_STATE_PATH = path.join(FIXTURES, 'assess-state.json');

function get(url: string): Promise<{ status: number; json: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode!, json: () => Promise.resolve(JSON.parse(buf)) }));
      })
      .on('error', reject);
  });
}

describe('GET /api/compute-gaps — route tests (ST-11)', () => {
  let server: http.Server;
  let baseUrl: string;
  let registry: CommandRegistry;
  const fixtureState = JSON.parse(fs.readFileSync(ASSESS_STATE_PATH, 'utf-8'));

  beforeAll(async () => {
    registry = CommandRegistry.load(); // real default CMMC L2 registry — production data, not a stub

    const loadAssessState = (slug: string): Record<string, any> | null => {
      if (slug === 'no-state-tenant') return null;
      if (slug === 'no-discovery-tenant') return { infrastructureModel: 'gcc-high' };
      if (slug === 'fixture-tenant') return fixtureState;
      return null;
    };
    const saveAssessState = (_slug: string, _data: object): void => {
      // route under test never calls this (compute-gaps only reads assess state); kept as a no-op stub
    };

    const app = express();
    app.use(express.json());
    app.use(createGapsRouter(() => [registry], saveAssessState, loadAssessState));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server?.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns 400 when tenant query param is missing', async () => {
    const res = await get(`${baseUrl}/api/compute-gaps`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/tenant/i);
  });

  it('returns 404 when no cached assess state exists for the tenant', async () => {
    const res = await get(`${baseUrl}/api/compute-gaps?tenant=no-state-tenant`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/assess/i);
  });

  it('returns 400 when the cached assess state has no discoveryResults', async () => {
    const res = await get(`${baseUrl}/api/compute-gaps?tenant=no-discovery-tenant`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/discoveryResults/i);
  });

  it('computes a real gap-remediation plan end-to-end through the actual GapAnalyzer and persists it to disk', async () => {
    const res = await get(`${baseUrl}/api/compute-gaps?tenant=fixture-tenant`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.plan.tenant_slug).toBe('fixture-tenant');
    expect(body.plan.infrastructure_model).toBe('gcc-high');

    // Shape asserted per VERIFY-stamper.md's acceptance criteria for gapPlan.summary
    expect(body.plan.summary).toEqual(
      expect.objectContaining({
        total_controls_with_gaps: expect.any(Number),
        total_gap_entries: expect.any(Number),
        by_priority: expect.objectContaining({
          critical: expect.any(Number),
          high: expect.any(Number),
          medium: expect.any(Number),
          low: expect.any(Number),
        }),
        by_status: expect.any(Object),
        manual_only_count: expect.any(Number),
        automated_count: expect.any(Number),
      })
    );
    expect(Array.isArray(body.plan.gap_controls)).toBe(true);
    expect(body.plan.summary.total_gap_entries).toBeGreaterThan(0);

    // The route calls the real GapAnalyzer + writeJsonArtifact, not a mock — the file must actually exist.
    expect(typeof body.saved_to).toBe('string');
    expect(fs.existsSync(body.saved_to)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(body.saved_to, 'utf-8'));
    expect(onDisk.tenant_slug).toBe('fixture-tenant');
  });
});
