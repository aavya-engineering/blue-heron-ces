// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Unit tests for the pure parts of the Playwright parity harness (e2e/parity), and the
// selectors mirror of ces-tester's STAMPER_SELECTORS.

// @vitest-environment node

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  compareRecordings,
  isLocalUrl,
  normalizeRequest,
  scanBundleForExternalUrls,
  signature,
  watchOptions,
} from '../e2e/parity/harness';
import type { RecordedRequest } from '../e2e/parity/harness';
import { STAMPER_SELECTORS, railNodeInState } from '../e2e/parity/selectors';

const req = (method: string, url: string, postData: string | null = null): RecordedRequest =>
  normalizeRequest({ method, url, resourceType: 'fetch', postData })!;

describe('normalizeRequest / signature', () => {
  it('keeps only /health and /api/*, sorts query and body keys', () => {
    expect(normalizeRequest({ method: 'GET', url: 'http://localhost:5102/app/assets/a.js', resourceType: 'script', postData: null })).toBeNull();
    expect(normalizeRequest({ method: 'GET', url: 'http://localhost:5102/ces-ui.css', resourceType: 'stylesheet', postData: null })).toBeNull();
    const r = req('post', 'http://localhost:5102/api/execute?tenant=a&plan=b&tenant=c', '{"z":1,"a":2}');
    expect(r).toEqual({ method: 'POST', path: '/api/execute', queryKeys: ['plan', 'tenant'], bodyKeys: ['a', 'z'], resourceType: 'fetch' });
    expect(signature(r)).toBe('POST /api/execute ?plan&tenant {a,z}');
    expect(signature(req('GET', 'http://localhost:5102/health'))).toBe('GET /health');
  });

  it('non-object or non-JSON bodies have no body keys', () => {
    expect(req('POST', 'http://localhost/api/x', '[1,2]').bodyKeys).toBeNull();
    expect(req('POST', 'http://localhost/api/x', 'not json').bodyKeys).toBeNull();
  });
});

describe('compareRecordings (AD-4: ordered method, path, query keys, body keys)', () => {
  const legacy = [req('GET', 'http://h/api/tenants'), req('GET', 'http://h/api/assess-state?tenant=x')];

  it('equal when the ordered signatures match; values do not matter', () => {
    const react = [req('GET', 'http://h/api/tenants'), req('GET', 'http://h/api/assess-state?tenant=y')];
    expect(compareRecordings(legacy, react).equal).toBe(true);
  });

  it('order matters and differences name the index', () => {
    const react = [req('GET', 'http://h/api/assess-state?tenant=x'), req('GET', 'http://h/api/tenants')];
    const result = compareRecordings(legacy, react);
    expect(result.equal).toBe(false);
    expect(result.differences[0]).toBe('#0: legacy GET /api/tenants | react GET /api/assess-state ?tenant');
  });

  it('routes limits scope; spaOnly removes declared SPA-only requests', () => {
    const react = [req('GET', 'http://h/health'), req('GET', 'http://h/api/tenants')];
    expect(compareRecordings(legacy, react, { routes: ['/health'] }).equal).toBe(false);
    expect(compareRecordings(legacy, react, { routes: ['/health'], spaOnly: ['GET /health'] }).equal).toBe(true);
    expect(compareRecordings(legacy, react, { routes: ['/api/tenants'] }).equal).toBe(true);
  });

  it('a missing request shows as (none)', () => {
    const result = compareRecordings(legacy, legacy.slice(0, 1));
    expect(result.differences).toEqual(['#1: legacy GET /api/assess-state ?tenant | react (none)']);
  });
});

describe('PC-00 helpers', () => {
  it('isLocalUrl', () => {
    expect(isLocalUrl('http://localhost:5102/app/')).toBe(true);
    expect(isLocalUrl('http://127.0.0.1:4390/x')).toBe(true);
    expect(isLocalUrl('data:image/png;base64,AA')).toBe(true);
    expect(isLocalUrl('https://fonts.googleapis.com/css2')).toBe(false);
  });

  it('scanBundleForExternalUrls flags external URLs, skips source maps, allows namespace/doc strings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-spa0-scan-'));
    try {
      fs.mkdirSync(path.join(dir, 'assets'));
      fs.writeFileSync(path.join(dir, 'index.html'), '<script src="/app/assets/a.js"></script>');
      fs.writeFileSync(
        path.join(dir, 'assets', 'a.js'),
        'const ns="http://www.w3.org/2000/svg";const e="https://reactjs.org/docs/error-decoder.html?invariant=1";fetch("https://cdn.example.test/x.js");fetch("http://localhost:5102/api/x")',
      );
      fs.writeFileSync(path.join(dir, 'assets', 'a.js.map'), '{"sources":["https://cdn.example.test/src.ts"]}');
      fs.writeFileSync(path.join(dir, 'assets', 'a.css'), '@import url(https://fonts.example.test/f.css);');
      const hits = scanBundleForExternalUrls(dir).map((h) => `${h.file.replace(/\\/g, '/')} ${h.url}`).sort();
      expect(hits).toEqual(['assets/a.css https://fonts.example.test/f.css', 'assets/a.js https://cdn.example.test/x.js']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('watchOptions (PLAN §8b: headed unless asked otherwise)', () => {
  it('headed and paced by default; headless only with CES_UI_HEADLESS=1; CES_UI_SLOWMO overrides', () => {
    expect(watchOptions({})).toEqual({ headless: false, slowMo: 400 });
    expect(watchOptions({ CES_UI_HEADLESS: '1' })).toEqual({ headless: true, slowMo: 0 });
    expect(watchOptions({ CES_UI_SLOWMO: '900' })).toEqual({ headless: false, slowMo: 900 });
    expect(watchOptions({ CES_UI_HEADLESS: 'true' }).headless).toBe(false);
  });
});

describe('selectors', () => {
  it('railNodeInState: legacy class vs kit data-state', () => {
    expect(railNodeInState('legacy', 3, 'locked')).toBe('#railNode3.rail-locked');
    expect(railNodeInState('react', 3, 'locked')).toBe('#railNode3[data-state="locked"]');
  });

  // The demo driver lives in the separate ces-tester repo; compare when it is checked out alongside.
  const driver = fileURLToPath(new URL('../../../ces-tester/src/demo/stamper-ui-driver.ts', import.meta.url));
  const block = (text: string) => {
    const start = text.indexOf('export const STAMPER_SELECTORS = {');
    const end = text.indexOf('} as const;', start);
    return text
      .slice(start, end)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('/**') && !l.startsWith('*') && !l.startsWith('//'));
  };

  it.skipIf(!fs.existsSync(driver))('STAMPER_SELECTORS mirrors ces-tester stamper-ui-driver.ts verbatim', () => {
    const ours = fs.readFileSync(fileURLToPath(new URL('../e2e/parity/selectors.ts', import.meta.url)), 'utf-8');
    expect(block(ours)).toEqual(block(fs.readFileSync(driver, 'utf-8')));
    expect(Object.keys(STAMPER_SELECTORS)).toHaveLength(18);
    expect(STAMPER_SELECTORS.card(4)).toBe('#workflowCard4');
    expect(STAMPER_SELECTORS.tenantOption('s1-mach')).toBe('#tenantSelect option[value="s1-mach"]');
  });
});

describe('screens-ready marker (W8-SPAW)', () => {
  it('public/screens-ready.json lists the five SPA slices; the Vite build copies it to public/app/', () => {
    const marker = fs.readFileSync(fileURLToPath(new URL('../public/screens-ready.json', import.meta.url)), 'utf-8');
    expect(JSON.parse(marker)).toEqual({ ready: true, slices: ['SPA0', 'SPA1', 'SPA2', 'SPA3', 'SPAW'] });
    const viteConfig = fs.readFileSync(fileURLToPath(new URL('../vite.config.ts', import.meta.url)), 'utf-8');
    expect(viteConfig).toContain("publicDir: fileURLToPath(new URL('./public', import.meta.url))");
  });
});
