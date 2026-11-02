// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30: the AO SPA's HTTP transport, modelled on Stamper's ui/src/api/http.ts. The SPA at /app/
// calls the same root-relative URLs as the legacy page (/api/...), and only AO's own API (ADR
// addendum rule 1). Unlike Stamper's apiRequest, a non-2xx reply is returned, not thrown: AO's
// execute route answers 202 / 400 / 403 / 428 / 500 with a body the result panel must show.

export type HttpMethod = 'GET' | 'POST';

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiReply<T> {
  status: number;
  ok: boolean;
  body: T;
}

let fetcher: Fetcher = (input, init) => fetch(input, init);

/** Test seam: replace the transport (returns the previous one). */
export function setFetcher(next: Fetcher): Fetcher {
  const previous = fetcher;
  fetcher = next;
  return previous;
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
}

/** One JSON request. The body is parsed when it is JSON; otherwise `{}` (as the legacy page tolerates). */
export async function apiCall<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<ApiReply<T>> {
  const init: RequestInit = { method };
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  if (Object.keys(headers).length) init.headers = headers;
  const res = await fetcher(path, init);
  const text = await res.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
  }
  return { status: res.status, ok: res.ok, body: body as T };
}

/** `path?k=v` with undefined and empty values left out. */
export function withQuery(path: string, query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.append(k, v);
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}
