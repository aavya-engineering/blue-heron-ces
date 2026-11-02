// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-A / EO-16 — the policy store (`GET /api/policies`) had no UI surface at all. This test
 * proves the served HTML now has a "Policy Store" nav tab and page, and that its load function
 * (lifted out of the served HTML unmodified) lists a seeded policy through the REAL
 * policies-router for tenant A, and never tenant B's policy when asked as tenant A.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { createPoliciesRouter } from '../../src/eo/server/routers/policies-router';
import { PolicyStore } from '../../src/eo/policies/PolicyStore';
import type { PolicyDocument } from 'ces-shared/types/policy';

const HTML_PATH = path.resolve(__dirname, '../../public/index.html');
const html = fs.readFileSync(HTML_PATH, 'utf-8');

const T = {
  A: { slug: 'eo16-tenant-a', guid: '00000000-0000-4000-8000-0000000e16aa' },
  B: { slug: 'eo16-tenant-b', guid: '00000000-0000-4000-8000-0000000e16bb' },
};

function policy(domain: string, title: string): PolicyDocument {
  return {
    template_id: `POL-${domain}`,
    title,
    markdown: `# ${title}`,
    completeness: 87,
    domain,
    nist_controls: ['AC.L2-3.1.1'],
  };
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

describe('EO-16: Policy Store screen', () => {
  it('has a Policy Store nav tab and page section', () => {
    expect(html).toMatch(/data-page="policy-store"/);
    expect(html).toMatch(/id="page-policy-store"/);
    expect(html).toMatch(/id="policyStoreBody"/);
  });

  it('the nav-tab click handler loads policies when the Policy Store tab is selected', () => {
    const navSection = html.slice(html.indexOf("$$('.nav-tab').forEach"), html.indexOf("$$('.nav-tab').forEach") + 1500);
    expect(navSection).toMatch(/policy-store[\s\S]{0,80}loadPolicyStore\(\)/);
  });

  describe('loadPolicyStore() against the real route', () => {
    let tmp: string;
    let server: Server;
    let base: string;

    beforeAll(async () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo16-'));
      const storageRoot = path.join(tmp, 'eo-storage');
      fs.mkdirSync(storageRoot, { recursive: true });
      const stamperRoot = path.join(tmp, 'stamper');
      for (const t of [T.A, T.B]) {
        fs.mkdirSync(path.join(stamperRoot, 'plan-data', t.slug), { recursive: true });
        fs.writeFileSync(path.join(stamperRoot, 'plan-data', t.slug, `${t.slug}.json`),
          JSON.stringify({ tenant: { tenant_id: t.guid, domain: `${t.slug}.example.test` } }));
      }
      const policyStore = new PolicyStore(storageRoot);
      // Seed BOTH tenants with distinct policies so isolation is checked in both directions --
      // seeding only one tenant would let a cross-tenant leak pass silently for the other query.
      policyStore.save(T.A.slug, [policy('AC', 'Access Control Policy (Tenant A)')]);
      policyStore.save(T.B.slug, [policy('IR', 'Incident Response Policy (Tenant B)')]);

      const app = express();
      app.use(express.json());
      app.use(createPoliciesRouter({ config: { storageRoot } as any, stamperRoot, policyStore }));
      server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      closeAllCesRepositories();
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    /** Run the lifted loadPolicyStore() exactly as the served page would, with a real fetch to the real server. */
    async function invokeLoadPolicyStore(currentTenant: string) {
      const el = { innerHTML: '' };
      const $ = (_sel: string) => el;
      // eslint-disable-next-line no-new-func
      const factory = new Function('fetch', 'currentTenant', '$', 'encodeURIComponent',
        `return (async () => { ${liftFunction('loadPolicyStore')}\nreturn loadPolicyStore(); })();`);
      await factory(
        (url: string, init?: any) => fetch(base + url, init),
        currentTenant, $, encodeURIComponent,
      );
      return el.innerHTML;
    }

    it("lists tenant A's seeded policy through the real route, and never tenant B's", async () => {
      const rendered = await invokeLoadPolicyStore(T.A.slug);
      expect(rendered).toContain('Access Control Policy (Tenant A)');
      expect(rendered).toContain('POL-AC');
      expect(rendered).not.toContain('Incident Response Policy (Tenant B)');
    });

    it("lists tenant B's seeded policy through the real route, and never tenant A's", async () => {
      const rendered = await invokeLoadPolicyStore(T.B.slug);
      expect(rendered).toContain('Incident Response Policy (Tenant B)');
      expect(rendered).toContain('POL-IR');
      expect(rendered).not.toContain('Access Control Policy (Tenant A)');
    });

    it('with no tenant selected, does nothing (no fetch, no crash)', async () => {
      const el = { innerHTML: 'unchanged' };
      const $ = (_sel: string) => el;
      let fetchCalled = false;
      // eslint-disable-next-line no-new-func
      const factory = new Function('fetch', 'currentTenant', '$', 'encodeURIComponent',
        `return (async () => { ${liftFunction('loadPolicyStore')}\nreturn loadPolicyStore(); })();`);
      await factory((..._args: unknown[]) => { fetchCalled = true; return Promise.reject(new Error('should not be called')); }, '', $, encodeURIComponent);
      expect(fetchCalled).toBe(false);
      expect(el.innerHTML).toBe('unchanged');
    });
  });
});
