// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Same-origin JSON transport for the Stamper GUI API (GuiServer routes). Paths are absolute
// (`/api/...`, `/health`), so the SPA at /app/ calls the same URLs as the legacy console (AD-4).

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type QueryValue = string | number | boolean | undefined | null;
export type Query = Readonly<Record<string, QueryValue>>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  constructor(
    readonly method: HttpMethod,
    readonly path: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(`${method} ${path} failed with HTTP ${status}`);
    this.name = 'ApiError';
  }
}

/** Builds `path?k=v` with keys in the given order; undefined and null values are left out. */
export function buildUrl(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

let fetcher: Fetcher = (input, init) => fetch(input, init);

/** Test seam: replace the transport (returns the previous one). */
export function setFetcher(next: Fetcher): Fetcher {
  const previous = fetcher;
  fetcher = next;
  return previous;
}

export async function apiRequest<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path, options.query);
  const init: RequestInit = { method, signal: options.signal };
  if (options.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }
  const res = await fetcher(url, init);
  const text = await res.text();
  let payload: unknown = text;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!res.ok) throw new ApiError(method, path, res.status, payload);
  return payload as T;
}

/** A `data: {json}` frame of a POST whose reply is an event stream. */
export type StreamFrame = Record<string, any>;

/**
 * POST a JSON body and read the reply as server-sent `data: ` lines (legacy importPrereqCert
 * L6513: fetch, then the body reader). Each frame is passed to `onEvent`; lines that are not
 * JSON are skipped, as legacy does. The HTTP status is not checked (legacy does not).
 */
export async function apiEventStream(path: string, body: unknown, onEvent: (frame: StreamFrame) => void): Promise<void> {
  const res = await fetcher(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const emit = (line: string) => {
    if (!line.startsWith('data: ')) return;
    try {
      onEvent(JSON.parse(line.substring(6)) as StreamFrame);
    } catch {
      /* legacy ignores bad lines */
    }
  };
  if (!res.body) {
    for (const line of (await res.text()).split('\n')) emit(line);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) emit(line);
  }
}
