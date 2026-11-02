// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX-AO7: loads the REAL served UI code (the inline <script> blocks of public/index.html)
// into a node:vm context against a minimal DOM stub. No jsdom dependency (none in this
// repo, and the monorepo lockfile is shared). The scripts are compiled as-is, so a syntax
// error in index.html fails every test that uses this harness.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const INDEX_HTML_PATH = path.resolve(__dirname, '..', 'public', 'index.html');

export function readIndexHtml(): string {
  return fs.readFileSync(INDEX_HTML_PATH, 'utf-8');
}

/** Inline (no src=) <script> bodies, in document order. */
export function extractInlineScripts(html: string = readIndexHtml()): string[] {
  const out: string[] = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

export class StubClassList {
  set = new Set<string>();
  add(...c: string[]) { c.forEach((x) => this.set.add(x)); }
  remove(...c: string[]) { c.forEach((x) => this.set.delete(x)); }
  contains(c: string) { return this.set.has(c); }
  toggle(c: string) { if (this.set.has(c)) this.set.delete(c); else this.set.add(c); }
}

export class StubElement {
  value = '';
  checked = false;
  textContent = '';
  className = '';
  style: Record<string, string> = {};
  classList = new StubClassList();
  onclick: any = null;
  onchange: any = null;
  private _innerHTML = '';
  private _children = new Map<string, StubElement[]>();
  constructor(public id: string = '') {}
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v: string) { this._innerHTML = v; this._children.clear(); }
  /** Class selectors only: one stub child per occurrence of the class name in innerHTML. */
  querySelectorAll(sel: string): StubElement[] {
    if (!this._children.has(sel)) {
      const cls = sel.startsWith('.') ? sel.slice(1) : sel;
      const n = cls ? this._innerHTML.split(cls).length - 1 : 0;
      this._children.set(sel, Array.from({ length: n }, () => new StubElement()));
    }
    return this._children.get(sel)!;
  }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? new StubElement(); }
  addEventListener() {}
  getBoundingClientRect() { return { bottom: 0, top: 0 }; }
  // W4-AO4: attribute support so data-state / data-* hooks are observable.
  attributes: Record<string, string> = {};
  setAttribute(name: string, value: string) { this.attributes[name] = String(value); }
  getAttribute(name: string) { return name in this.attributes ? this.attributes[name] : null; }
}

export interface FetchCall { url: string; init?: any; body?: any }
export type FetchImpl = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export interface UiHarness {
  ctx: vm.Context;
  el(id: string): StubElement;
  calls: FetchCall[];
  run<T = any>(code: string): T;
  alerts: string[];
  /** Element returned for a document.querySelector selector (stable per selector). */
  selected(sel: string): StubElement;
}

/** JSON-response helper for stub fetch implementations. */
export const jsonResponse = (body: any, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

export function loadUi(fetchImpl: FetchImpl, opts: { withRandomUUID?: boolean } = {}): UiHarness {
  const elements = new Map<string, StubElement>();
  const el = (id: string) => {
    if (!elements.has(id)) elements.set(id, new StubElement(id));
    return elements.get(id)!;
  };
  const calls: FetchCall[] = [];
  const alerts: string[] = [];
  // W4-AO4: stable element per selector (e.g. the family bodies `[data-family="A"]`).
  const bySelector = new Map<string, StubElement>();
  const document = {
    getElementById: (id: string) => el(id),
    querySelector: (sel: string) => {
      if (!bySelector.has(sel)) bySelector.set(sel, new StubElement(sel));
      return bySelector.get(sel)!;
    },
    querySelectorAll: () => [],
  };
  let uuidN = 0;
  const cryptoStub: any = {
    getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + uuidN++) & 0xff; return a; },
  };
  if (opts.withRandomUUID !== false) {
    cryptoStub.randomUUID = () => `00000000-0000-4000-8000-${String(++uuidN).padStart(12, '0')}`;
  }
  const ctx = vm.createContext({
    document,
    window: { addEventListener: () => {}, innerHeight: 800 },
    fetch: (url: string, init?: any) => {
      const call: FetchCall = { url, init };
      if (init && typeof init.body === 'string') call.body = JSON.parse(init.body);
      calls.push(call);
      return fetchImpl(url, init);
    },
    crypto: cryptoStub,
    console,
    alert: (m: string) => { alerts.push(String(m)); },
    prompt: () => 'test reason',
    setTimeout,
  });
  for (const src of extractInlineScripts()) {
    new vm.Script(src, { filename: 'public/index.html' }).runInContext(ctx);
  }
  return { ctx, el, calls, alerts, run: (code: string) => vm.runInContext(code, ctx), selected: (sel: string) => document.querySelector(sel) };
}
