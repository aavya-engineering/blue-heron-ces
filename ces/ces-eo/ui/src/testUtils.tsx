// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Test helpers (imported by tests only): a fake EO behind the fetch seam that records every call,
// a renderer at a route, and the serious/critical axe check Stamper's SPA uses.

import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import axe from 'axe-core';
import { setFetcher, type Fetcher } from './api/http';
import { createTestRouter } from './router';
import { useSession } from './store/session';

export interface Call {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

export type Handler = (call: Call) => { status?: number; body?: unknown; text?: string; headers?: Record<string, string> } | undefined;

/** A route value that is a response descriptor ({ status: <number> } or { text }) rather than a JSON body. */
function isReply(h: unknown): h is { status?: number; body?: unknown; text?: string; headers?: Record<string, string> } {
  return !!h && typeof h === 'object' && !Array.isArray(h) && (typeof (h as { status?: unknown }).status === 'number' || 'text' in (h as object));
}

/** Installs a fake EO. Unmatched requests answer 404 {error:'not_found'}. Returns the call log. */
export function fakeEo(routes: Record<string, Handler | object>): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const prev = setFetcher((async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://eo.test');
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((v, k) => { headers[k] = v; });
    let body: unknown = init?.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* keep text */ } }
    const call: Call = { method: init?.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), headers, body };
    calls.push(call);
    const key = `${call.method} ${call.path}`;
    const h = key in routes ? routes[key] : undefined;
    const out = typeof h === 'function' ? (h as Handler)(call)
      : h === undefined ? { status: 404, body: { error: 'not_found' } }
      : isReply(h) ? h
      : { body: h };
    const r = out ?? { status: 404, body: { error: 'not_found' } };
    return new Response(r.text ?? JSON.stringify(r.body ?? null), { status: r.status ?? 200, headers: r.headers });
  }) as Fetcher);
  return { calls, restore: () => { setFetcher(prev); } };
}

export function renderAt(path: string) {
  const router = createTestRouter(path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, client };
}

export function resetSession(tenant: string | null = null) {
  useSession.getState().reset();
  if (tenant) useSession.getState().setTenant(tenant);
}

/** A JWT-shaped token with the given claims (unsigned: the UI only reads claims). */
export function fakeToken(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.sig`;
}

export async function seriousAxe(container: HTMLElement): Promise<string[]> {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
}

export const BASE_ROUTES = {
  'GET /api/health': { status: 'ok', service: 'evidence-ops', version: '0.1.0' },
  'GET /api/ui/info': { spaPath: '/app/', spaBuilt: true, simulator: { active: true }, twoPersonApproval: false, uploaderTokenIssuer: true },
  'GET /api/tenants': [{ slug: 's1-mach', client_name: 'Sim Machining' }],
};
