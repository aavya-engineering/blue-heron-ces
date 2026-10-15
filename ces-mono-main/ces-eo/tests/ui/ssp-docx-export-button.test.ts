// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-A / EO-07 — the SSP DOCX export route (`GET /api/ssp/export/:sspId`) worked but had no
 * UI affordance (public/index.html only had "Export JSON"). This test proves the served HTML
 * has a real button wired to a real handler, and that clicking it (its lifted onclick function,
 * executed unmodified) resolves against the REAL documents-router/SspDocxExporter for the
 * currently-selected tenant and returns an actual DOCX (not a stub).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createDocumentsRouter } from '../../src/eo/server/routers/documents-router';
import { AssessmentStore } from '../../src/eo/assessment/AssessmentStore';
import { PoamStore } from '../../src/eo/poam/PoamStore';

const HTML_PATH = path.resolve(__dirname, '../../public/index.html');
const html = fs.readFileSync(HTML_PATH, 'utf-8');

const REGISTRY = path.resolve(__dirname, '../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json');
const T = {
  A: { slug: 'eo07-tenant-a', guid: '00000000-0000-4000-8000-0000000e07aa', snap: '7aaaaaaa-0000-4000-8000-000000000001' },
  B: { slug: 'eo07-tenant-b', guid: '00000000-0000-4000-8000-0000000e07bb', snap: '7bbbbbbb-0000-4000-8000-000000000001' },
};

function snapshot(tenantId: string, snapshotId: string, generatedAt: string) {
  return {
    snapshotId, tenantId, generatedAt, sprs_score: 105,
    controls: [
      { control_id: 'AC.L2-3.1.1', status: 'met', sources: [] },
      { control_id: 'AU.L2-3.3.1', status: 'not_met', sources: [] },
    ],
  } as any;
}

/** Lift a top-level `function <name>() {...}` (or `async function`) out of the served HTML, unmodified. */
function liftFunction(name: string): string {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  expect(start).toBeGreaterThan(0);
  const asyncIdx = html.lastIndexOf('async ', start);
  const realStart = (asyncIdx >= 0 && start - asyncIdx <= 6) ? asyncIdx : start;
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(realStart, i + 1); }
  }
  throw new Error(`unbalanced function ${name}`);
}

describe('EO-07: SSP DOCX export button', () => {
  it('the SSP page has a DOCX export button distinct from the JSON export button', () => {
    expect(html).toMatch(/id="sspExportDocxBtn"[^>]*onclick="exportSspDocx\(\)"/);
    // Starts disabled, same as the JSON export button, until an SSP has been generated.
    expect(html).toMatch(/id="sspExportDocxBtn"[^>]*disabled/);
  });

  it('generateSsp() enables the DOCX button alongside the JSON export button', () => {
    const fn = liftFunction('generateSsp');
    expect(fn).toContain("$('#sspExportDocxBtn').disabled = false;");
  });

  describe('exportSspDocx() against the real route', () => {
    let tmp: string;
    let server: Server;
    let base: string;
    const prevPipeline = process.env.CES_PIPELINE_ROOT;
    const prevTenantRoot = process.env.CES_TENANT_ROOT;

    beforeAll(async () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo07-'));
      process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
      process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
      fs.mkdirSync(process.env.CES_PIPELINE_ROOT, { recursive: true });
      const stamperRoot = path.join(tmp, 'stamper');
      for (const t of [T.A, T.B]) {
        fs.mkdirSync(path.join(stamperRoot, 'plan-data', t.slug), { recursive: true });
        fs.writeFileSync(path.join(stamperRoot, 'plan-data', t.slug, `${t.slug}.json`),
          JSON.stringify({ tenant: { tenant_id: t.guid, domain: `${t.slug}.example.test` } }));
      }
      const storageRoot = path.join(tmp, 'eo-storage');
      fs.mkdirSync(storageRoot, { recursive: true });
      const assessmentStore = new AssessmentStore(storageRoot);
      assessmentStore.save(snapshot(T.A.guid, T.A.snap, '2026-09-27T10:00:00Z'));
      assessmentStore.save(snapshot(T.B.guid, T.B.snap, '2026-09-27T11:00:00Z'));

      const app = express();
      app.use(express.json());
      app.use(createDocumentsRouter({
        config: { storageRoot, tenantSlug: T.A.slug, registryPath: REGISTRY } as any,
        stamperRoot,
        assessmentStore,
        poamStore: new PoamStore(storageRoot),
        policyStore: { load: () => [] } as any,
        personnelStore: { load: () => [] } as any,
        trainingStore: {} as any,
        screeningElementStore: {} as any,
        riskAssessmentStore: {
          loadConfig: () => null, loadRegister: () => ({ entries: [] }), listSnapshots: () => [], loadSnapshot: () => null,
        } as any,
        cleanupService: {} as any,
      }));
      server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      closeAllCesRepositories();
      fs.rmSync(tmp, { recursive: true, force: true });
      if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
      if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
    });

    /** Run the lifted exportSspDocx() exactly as the served page would, with a real window.open stub. */
    function invokeExportSspDocx(currentTenant: string, sspData: { sspId: string } | null) {
      const opened: string[] = [];
      const alerts: string[] = [];
      // eslint-disable-next-line no-new-func
      const factory = new Function('window', 'currentTenant', 'sspData', 'alert', 'encodeURIComponent',
        `${liftFunction('exportSspDocx')}\nreturn exportSspDocx;`);
      const fn = factory(
        { open: (u: string) => opened.push(u) },
        currentTenant, sspData,
        (m: string) => alerts.push(m),
        encodeURIComponent,
      );
      fn();
      return { opened, alerts };
    }

    it('clicking the button (with a tenant selected) opens the real DOCX route and gets back a real DOCX', async () => {
      const genResp = await fetch(`${base}/api/ssp/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantSlug: T.A.slug, assessmentId: T.A.snap }),
      });
      expect(genResp.status).toBe(200);
      const ssp = await genResp.json();

      const { opened, alerts } = invokeExportSspDocx(T.A.slug, { sspId: ssp.sspId });
      expect(alerts).toEqual([]);
      expect(opened).toHaveLength(1);
      expect(opened[0]).toBe(`/api/ssp/export/${ssp.sspId}?tenant=${T.A.slug}`);

      // The button opens a real URL against the real server: fetch it for real and check the payload.
      const docxResp = await fetch(base + opened[0]);
      expect(docxResp.status).toBe(200);
      expect(docxResp.headers.get('content-type')).toContain('wordprocessingml');
      const buf = Buffer.from(await docxResp.arrayBuffer());
      // DOCX is a zip container: magic bytes "PK".
      expect(buf.subarray(0, 2).toString('ascii')).toBe('PK');
      expect(buf.length).toBeGreaterThan(1000);
    });

    it("tenant B cannot download tenant A's SSP through the same button flow", async () => {
      const genResp = await fetch(`${base}/api/ssp/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantSlug: T.A.slug, assessmentId: T.A.snap }),
      });
      const ssp = await genResp.json();
      const { opened } = invokeExportSspDocx(T.B.slug, { sspId: ssp.sspId });
      const docxResp = await fetch(base + opened[0]);
      expect(docxResp.status).toBe(404);
    });

    it('with no tenant selected it asks for one and never opens a route', () => {
      const { opened, alerts } = invokeExportSspDocx('', { sspId: 'whatever' });
      expect(opened).toEqual([]);
      expect(alerts).toEqual(['Select a tenant first']);
    });

    it('with no SSP generated yet it does nothing', () => {
      const { opened, alerts } = invokeExportSspDocx(T.A.slug, null);
      expect(opened).toEqual([]);
      expect(alerts).toEqual([]);
    });
  });
});
