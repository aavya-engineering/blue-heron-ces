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

// Set CES_PIPELINE_ROOT before any ces-shared imports resolve the default, so the real route's
// writeJsonArtifact lands under a throwaway tmp dir, never a real tenant tree.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-gaps-ui-'));
process.env.CES_PIPELINE_ROOT = tmpRoot;

import { createGapsRouter } from '../../src/server/routes/gaps.routes';
import { CommandRegistry } from '../../src/registry/CommandRegistry';

const FIXTURES = path.resolve(__dirname, '..', 'fixtures');
const ASSESS_STATE_PATH = path.join(FIXTURES, 'assess-state.json');
const INDEX_HTML_PATH = path.resolve(__dirname, '..', '..', 'public', 'index.html');

/**
 * ST-11 acceptance test: extracts the ACTUAL "Compute Gaps" script block from public/index.html
 * (no hand-copied re-implementation) and executes it against a real Node http fetch shim hitting
 * the real createGapsRouter — i.e. drives the production browser code, through the production
 * route, through the real GapAnalyzer, over the network. This is the "no UI caller" gap closing:
 * before this button+script existed, no code path from the GUI reached /api/compute-gaps at all.
 *
 * Kept alongside GapsUiWiring.test.ts (a cheap syntactic grep) and GapsRoute.test.ts (proves the
 * route/analyzer alone). This file is the one that proves the UI *drives* the real handler.
 */
function extractComputeGapsScript(html: string): string {
  const start = html.indexOf('// ---- Compute Gaps (ST-11');
  if (start === -1) throw new Error('Compute Gaps script block not found in public/index.html');
  const endMarker = '\n  var assessTotalEntries = 0;';
  const end = html.indexOf(endMarker, start);
  if (end === -1) throw new Error('End marker for Compute Gaps script block not found');
  return html.slice(start, end);
}

/** A minimal fake DOM element: enough state for the extracted code to read/write. */
function makeEl(initial: Record<string, any> = {}) {
  return Object.assign({ value: '', disabled: false, textContent: '', innerHTML: '', style: {} }, initial);
}

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

describe('Compute Gaps button drives the real handler through the UI path (ST-11)', () => {
  let server: http.Server;
  let baseUrl: string;
  let registry: CommandRegistry;
  const fixtureState = JSON.parse(fs.readFileSync(ASSESS_STATE_PATH, 'utf-8'));

  beforeAll(async () => {
    registry = CommandRegistry.load();
    const loadAssessState = (slug: string): Record<string, any> | null =>
      slug === 'fixture-tenant' ? fixtureState : null;
    const app = express();
    app.use(express.json());
    app.use(createGapsRouter(() => [registry], () => {}, loadAssessState));
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

  it('populates the GUI panel from the real /api/compute-gaps response when clicked', async () => {
    const html = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
    const script = extractComputeGapsScript(html);

    const elements: Record<string, ReturnType<typeof makeEl>> = {
      tenantSelect: makeEl({ value: 'fixture-tenant' }),
      btnComputeGaps: makeEl({ textContent: 'Compute Gaps' }),
      gapPlanSection: makeEl({ style: { display: 'none' } }),
      gapPlanCount: makeEl(),
      gapPlanSummary: makeEl(),
      gapPlanControls: makeEl(),
    };
    const document = { getElementById: (id: string) => elements[id] || null };
    const statusCalls: Array<{ message: string; level: string }> = [];
    const showStatus = (message: string, level: string) => statusCalls.push({ message, level });
    // Real network fetch (Node 18+ global) redirected at the real route server, not a stub response.
    const fetchShim = (url: string) => get(baseUrl + url).then((res) => ({ ok: res.status >= 200 && res.status < 300, json: res.json }));

    // eslint-disable-next-line no-new-func
    const factory = new Function(
      'document',
      'fetch',
      'showStatus',
      script + '\n  return { doComputeGaps: doComputeGaps, renderGapPlan: renderGapPlan };'
    );
    const { doComputeGaps } = factory(document, fetchShim, showStatus);

    await doComputeGaps();

    // Real production route was hit and its real response rendered — not a canned fixture render.
    expect(elements.gapPlanSection.style.display).toBe('block');
    expect(elements.gapPlanCount.textContent).toMatch(/controls with gaps/);
    expect(elements.gapPlanControls.innerHTML.length).toBeGreaterThan(0);
    expect(elements.gapPlanControls.innerHTML).toMatch(/AC\.L2-3\.1\.[23]/); // control ids from the missing/error fixture entries
    expect(statusCalls.some((c) => c.level === 'success' && /gap entries/.test(c.message))).toBe(true);
    expect(elements.btnComputeGaps.disabled).toBe(false); // re-enabled after completion
  });

  it('shows the server error (does not silently swallow it) when the tenant has no cached assess state', async () => {
    const html = fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
    const script = extractComputeGapsScript(html);

    const elements: Record<string, ReturnType<typeof makeEl>> = {
      tenantSelect: makeEl({ value: 'no-such-tenant' }),
      btnComputeGaps: makeEl({ textContent: 'Compute Gaps' }),
      gapPlanSection: makeEl({ style: { display: 'none' } }),
      gapPlanCount: makeEl(),
      gapPlanSummary: makeEl(),
      gapPlanControls: makeEl(),
    };
    const document = { getElementById: (id: string) => elements[id] || null };
    const statusCalls: Array<{ message: string; level: string }> = [];
    const showStatus = (message: string, level: string) => statusCalls.push({ message, level });
    const fetchShim = (url: string) => get(baseUrl + url).then((res) => ({ ok: res.status >= 200 && res.status < 300, json: res.json }));

    // eslint-disable-next-line no-new-func
    const factory = new Function(
      'document',
      'fetch',
      'showStatus',
      script + '\n  return { doComputeGaps: doComputeGaps, renderGapPlan: renderGapPlan };'
    );
    const { doComputeGaps } = factory(document, fetchShim, showStatus);

    await doComputeGaps();

    expect(elements.gapPlanSection.style.display).toBe('none'); // panel never opened
    expect(statusCalls.some((c) => c.level === 'error' && /assess/i.test(c.message))).toBe(true);
  });
});
