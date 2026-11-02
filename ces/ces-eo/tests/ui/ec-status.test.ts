// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-F (M4a) — the EC status page must show 'degraded' as its own state, never folded
 * into 'unavailable'/'unreachable'. Lifts `refreshEcStatus` out of the served HTML
 * (unmodified) and runs it against a stubbed fetch, exactly the pattern
 * tests/ui/index-tenant-calls.test.ts uses for `buildPackage`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const HTML_PATH = path.resolve(__dirname, '../../public/index.html');
const html = fs.readFileSync(HTML_PATH, 'utf-8');

function liftFunction(name: string): string {
  const start = html.indexOf(`async function ${name}(`);
  expect(start).toBeGreaterThan(0);
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`unbalanced ${name}`);
}

function el() {
  return { innerHTML: '' };
}

async function run(fetchImpl: (url: string) => Promise<{ status: number; json: () => Promise<any> }>) {
  const els: Record<string, ReturnType<typeof el>> = {};
  const $ = (sel: string) => (els[sel] ??= el());
  // eslint-disable-next-line no-new-func
  const factory = new Function('$', 'fetch', `${liftFunction('refreshEcStatus')}\nreturn refreshEcStatus;`);
  const refreshEcStatus = factory($, fetchImpl);
  await refreshEcStatus();
  return els['#ecDetailHealth'].innerHTML;
}

describe('EO-22: the EC page is reachable from the nav (was an orphan page with no link)', () => {
  it('has a nav-tab button targeting page-ec', () => {
    expect(html).toMatch(/<button class="nav-tab"[^>]*data-page="ec"/);
  });

  it('the nav click handler loads EC status/runs/findings when that tab is selected', () => {
    const handlerStart = html.indexOf("$$('.nav-tab').forEach(tab => {");
    expect(handlerStart).toBeGreaterThan(0);
    const handlerEnd = html.indexOf('});', handlerStart);
    const handler = html.slice(handlerStart, handlerEnd);
    expect(handler).toContain("tab.dataset.page === 'ec'");
    expect(handler).toContain('refreshEcStatus()');
  });
});

describe('refreshEcStatus (lifted from served HTML)', () => {
  it('renders "Online" for status:ok', async () => {
    const html2 = await run(async () => ({ status: 200, json: async () => ({ status: 'ok', mode: 'sim', startedAt: 't', version: '1.0.0' }) }));
    expect(html2).toContain('Online');
  });

  it('renders a distinct "Degraded" state (not "Unavailable") for status:degraded, with reasons', async () => {
    const html2 = await run(async () => ({
      status: 200,
      json: async () => ({ status: 'degraded', mode: 'sim', reasons: ['EVIDENCE_OPS_SECRET not set'] }),
    }));
    expect(html2).toContain('Degraded');
    expect(html2).not.toContain('Unavailable');
    expect(html2).not.toContain('Unreachable');
    expect(html2).toContain('EVIDENCE_OPS_SECRET not set');
  });

  it('renders "Unreachable" (not "Degraded") when the proxy 503s', async () => {
    const html2 = await run(async () => ({ status: 503, json: async () => ({ status: 'unreachable' }) }));
    expect(html2).toContain('Unreachable');
    expect(html2).not.toContain('Degraded');
  });

  it('renders "Unreachable" when fetch itself throws (EC/EO connection failure)', async () => {
    const html2 = await run(async () => { throw new Error('network error'); });
    expect(html2).toContain('Unreachable');
  });
});
