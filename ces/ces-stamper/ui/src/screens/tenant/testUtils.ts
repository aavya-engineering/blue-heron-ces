// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Test helpers for the W8-SPA1 unit tests (cards 0-2): a routed fake transport that records
// every request in order, a fake EventSource factory whose streams the test drives, and a
// reset of the stores these cards touch (W8-SPAW: including the one console, execute and
// translate stores they now share with cards 3-4). Fixture data is fictional.

import { createElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import axe from 'axe-core';
import type { EventSourceLike } from 'ces-ui-kit';
import { createTestRouter } from '../../router';
import { setFetcher } from '../../api';
import type { Fetcher } from '../../api';
import { setEventSourceFactory, useTenantStore } from '../../store/tenant';
import { useConfigureStore } from '../../store/configure';
import { resetRunLog, useConsoleStore } from '../../store/console';
import { resetExecution } from '../../store/execute';
import { useAssessStore } from '../../store/assess';
import { useWorkflowStore } from '../../store/workflow';

export interface RecordedCall {
  method: string;
  url: string;
  body: unknown;
}

/** A routed reply: `body` is sent as JSON, or `text` as is (an event-stream reply). */
export type Route = (call: RecordedCall) => { status?: number; body: unknown; text?: string } | undefined;

export class FakeStream implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {}
  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
  fail(): void {
    this.onerror?.(new Event('error'));
  }
  close(): void {
    this.closed = true;
  }
}

export interface Harness {
  calls: RecordedCall[];
  streams: FakeStream[];
  /** `METHOD url` lines, in order (fetches and streams). */
  lines: () => string[];
  restore: () => void;
}

/** Installs the fake transport and stream factory. Unrouted requests answer `{ ok: false }`. */
export function installHarness(routes: Route[] = []): Harness {
  const calls: RecordedCall[] = [];
  const streams: FakeStream[] = [];
  const order: string[] = [];
  const fetcher: Fetcher = async (url, init) => {
    const call: RecordedCall = {
      method: init?.method ?? 'GET',
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    order.push(`${call.method} ${url}`);
    for (const route of routes) {
      const reply = route(call);
      if (reply) return new Response(reply.text ?? JSON.stringify(reply.body), { status: reply.status ?? 200 });
    }
    return new Response(JSON.stringify({ ok: false }), { status: 200 });
  };
  const previousFetcher = setFetcher(fetcher);
  const previousFactory = setEventSourceFactory((url) => {
    const s = new FakeStream(url);
    streams.push(s);
    order.push(`SSE ${url}`);
    return s;
  });
  return {
    calls,
    streams,
    lines: () => [...order],
    restore: () => {
      setFetcher(previousFetcher);
      setEventSourceFactory(previousFactory);
    },
  };
}

/** Route helper: `METHOD path` answered with server-sent `data:` frames (an event-stream reply). */
export function onStream(method: string, path: string, frames: unknown[]): Route {
  const text = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');
  return (call) => (call.method === method && call.url.split('?')[0] === path ? { body: null, text } : undefined);
}

/** The console store's #taskList log messages, in order. */
export function consoleMessages(): string[] {
  return useConsoleStore
    .getState()
    .items.flatMap((it) => (it.kind === 'log' ? [it.message] : []));
}

/** The console store's #statusBar as `{ message, type }` (null when hidden). */
export function statusBar(): { message: string; type: string } | null {
  const st = useConsoleStore.getState().status;
  return st ? { message: st.text, type: st.tone } : null;
}

/** Route helper: exact `METHOD path` (query ignored) or a predicate. */
export function on(method: string, path: string, body: unknown, status = 200): Route {
  return (call) => {
    const p = call.url.split('?')[0];
    return call.method === method && p === path ? { status, body } : undefined;
  };
}

export function resetStores(): void {
  useTenantStore.getState().reset();
  useConfigureStore.getState().reset();
  useAssessStore.getState().reset();
  useWorkflowStore.getState().reset();
  resetExecution();
  resetRunLog();
  try {
    window.localStorage.clear();
  } catch {
    /* no storage */
  }
}

export const flush = () => new Promise((r) => setTimeout(r, 0));

/** Fictional tenant list (Ridgeline Machining, Larkspur Avionics). */
export const TENANTS = [
  { slug: 'dev', client_name: 'Dev Mode (no credentials)', environment: 'dev' },
  { slug: 'ridgeline', client_name: 'Ridgeline Machining', environment: 'gcchigh' },
  { slug: 'larkspur', client_name: 'Larkspur Avionics', environment: 'gcc' },
];

export const TENANT_CONFIG = {
  client: { slug: 'ridgeline', name: 'Ridgeline Machining' },
  tenant: { tenant_id: '00000000-0000-4000-8000-000000000001', environment: 'gcchigh' },
  auth: { app_id: '00000000-0000-4000-8000-000000000002', cert_thumbprint: 'ABCDEF0123456789', cert_path: 'C:\\certs\\ridgeline.pfx' },
};

/** A small fictional cmmc_status in directive mode. */
export const CMMC_STATUS = {
  total: 110,
  hasDirectives: true,
  satisfiedControls: [
    { control_id: 'AC.L2-3.1.1', automationType: 'automated', entryDetails: [{ entry_id: 'ac-001', label: 'Conditional access', status: 'exists', engine: 'mgraph' }] },
    { control_id: 'AC.L2-3.1.2', automationType: 'excluded' },
    { control_id: 'AU.L2-3.3.1', automationType: 'inherit-fedramp' },
  ],
  provisionalControls: [{ control_id: 'CM.L2-3.4.1', automationType: 'nonstack' }],
  wontBeControls: [{ control_id: 'IA.L2-3.5.3', automationType: 'automated', sprsWeight: 5 }],
  willBeControls: [{ control_id: 'SC.L2-3.13.11', automationType: 'document-absence', sprsWeight: 3 }],
  notVerifiedControls: [{ control_id: 'SI.L2-3.14.1', automationType: 'automated', sprsWeight: 1 }],
  sprsByCategory: { satisfied: 0, provisional: 0, not_satisfied: 9 },
  byFamily: {
    AC: { name: 'Access Control', total: 22, satisfied: 1, excluded: 1, provisional: 0, wontBe: 0 },
    AU: { name: 'Audit and Accountability', total: 9, satisfied: 1 },
  },
};

export const CMMC_REFERENCE = {
  controls: [
    { control_id: 'AC.L2-3.1.1', family: 'AC', practice: 'Limit system access', cmmc_level: 'L1', nist_ref: '3.1.1' },
    { control_id: 'AC.L2-3.1.2', family: 'AC', practice: 'Limit transactions', cmmc_level: 'L1', nist_ref: '3.1.2' },
    { control_id: 'AU.L2-3.3.1', family: 'AU', practice: 'System auditing', cmmc_level: 'L2', nist_ref: '3.3.1' },
    { control_id: 'CM.L2-3.4.1', family: 'CM', practice: 'System baselining', cmmc_level: 'L2', nist_ref: '3.4.1' },
    { control_id: 'IA.L2-3.5.3', family: 'IA', practice: 'Multifactor authentication', cmmc_level: 'L2', nist_ref: '3.5.3' },
    { control_id: 'SC.L2-3.13.11', family: 'SC', practice: 'CUI encryption', cmmc_level: 'L2', nist_ref: '3.13.11' },
    { control_id: 'SI.L2-3.14.1', family: 'SI', practice: 'Flaw remediation', cmmc_level: 'L1', nist_ref: '3.14.1' },
  ],
};

export const HEALTH = {
  status: 'ok',
  registries: { m365: true, infra: true, merged: true },
  evidenceCollector: { autostart: 'not_checked' },
  ui: { mode: 'legacy', spaPath: '/app/', spaBuilt: true },
  simulator: { active: false, serverUrl: null },
  timestamp: '2026-10-29T00:00:00.000Z',
};

export const SCREEN_ROUTES_FIXTURE = [
  on('GET', '/health', HEALTH),
  on('GET', '/api/cmmc-controls', CMMC_REFERENCE),
  on('GET', '/api/tenants', TENANTS),
  on('GET', '/api/tenants/ridgeline', { ok: true, config: TENANT_CONFIG }),
  on('PUT', '/api/tenants/ridgeline', { ok: true }),
  on('GET', '/api/tenants/ridgeline/variables', { ok: true, variables: {} }),
  on('GET', '/api/last-translate', { ok: true, paths: { missionPlan: 'C:\\plans\\manual-mission-plan-ridgeline.json' } }),
  on('GET', '/api/assess-state', { accomplishedIds: [], cmmcStatus: CMMC_STATUS, timestamp: '2026-10-28T00:00:00.000Z' }),
  on('GET', '/api/plan-data-paths', { ok: false }),
  on('GET', '/api/read-plan-file', {}),
];

/** Renders the app router at `path` (memory router, as App.test.tsx does). */
export function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createTestRouter(path);
  render(createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router })));
  return router;
}

/** axe with no serious or critical findings (colour contrast off: jsdom cannot compute it). */

export async function seriousAxe(root: Element) {
  const result = await axe.run(root, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.length}`);
}
