// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Same-origin transport for the EvidenceOps API (modelled on ces-stamper/ui/src/api/http.ts). Paths
// are absolute (`/api/...`), so the SPA at /app/ calls the same URLs as the legacy console.
//
// Tokens gate access (founder ruling: no module is loopback-only). EO's /api/* needs
// `Authorization: Bearer <CES_EO_AUTH_TOKEN>` from any non-loopback browser, so every call here can
// carry the service token the operator entered on the Access screen. It is held in memory only.
// Event streams (/api/assess) are read with fetch, not EventSource, because EventSource cannot send
// that header. Downloads (DOCX, ZIP) are fetched as blobs for the same reason.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type QueryValue = string | number | boolean | undefined | null;
export type Query = Readonly<Record<string, QueryValue>>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** Extra headers (for example `x-ces-principal`). */
  headers?: Record<string, string>;
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

  /** The server's `error` code, when the body has one. */
  get code(): string | undefined {
    const p = this.payload as { error?: unknown } | null;
    return p && typeof p === 'object' && typeof p.error === 'string' ? p.error : undefined;
  }

  /** A one-line human message: detail, else error code, else the HTTP status. */
  get detail(): string {
    const p = this.payload as { detail?: unknown; error?: unknown; reason?: unknown } | null;
    if (p && typeof p === 'object') {
      const parts = [p.error, p.reason, p.detail].filter((x) => typeof x === 'string' && x) as string[];
      if (parts.length) return parts.join(': ');
    }
    if (typeof this.payload === 'string' && this.payload) return this.payload.slice(0, 200);
    return `HTTP ${this.status}`;
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
let serviceToken: string | null = null;

/** Test seam: replace the transport (returns the previous one). */
export function setFetcher(next: Fetcher): Fetcher {
  const previous = fetcher;
  fetcher = next;
  return previous;
}

/** The EO service bearer token (CES_EO_AUTH_TOKEN) the operator entered; null for none. */
export function setServiceToken(token: string | null): void {
  serviceToken = token && token.trim() ? token.trim() : null;
}

function baseHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...(serviceToken ? { Authorization: `Bearer ${serviceToken}` } : {}), ...(extra ?? {}) };
}

async function readPayload(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiRequest<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path, options.query);
  const headers = baseHeaders(options.headers);
  const init: RequestInit = { method, signal: options.signal, headers };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const res = await fetcher(url, init);
  const payload = await readPayload(res);
  if (!res.ok) throw new ApiError(method, path, res.status, payload);
  return payload as T;
}

/** Multipart POST (no Content-Type header: the browser sets the boundary). */
export async function apiUpload<T>(path: string, form: FormData, options: Omit<RequestOptions, 'body'> = {}): Promise<T> {
  const url = buildUrl(path, options.query);
  const res = await fetcher(url, { method: 'POST', body: form, headers: baseHeaders(options.headers), signal: options.signal });
  const payload = await readPayload(res);
  if (!res.ok) throw new ApiError('POST', path, res.status, payload);
  return payload as T;
}

export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

/** GET a file as a blob; the filename comes from Content-Disposition, else `fallbackName`. */
export async function apiDownload(path: string, query: Query | undefined, fallbackName: string): Promise<DownloadedFile> {
  const res = await fetcher(buildUrl(path, query), { method: 'GET', headers: baseHeaders() });
  if (!res.ok) throw new ApiError('GET', path, res.status, await readPayload(res));
  const cd = res.headers.get('content-disposition') ?? '';
  const m = /filename="?([^";]+)"?/i.exec(cd);
  return { blob: await res.blob(), filename: m ? m[1] : fallbackName };
}

/** Hand a downloaded file to the browser (object URL plus a temporary anchor). */
export function saveFile(file: DownloadedFile): void {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export type StreamFrame = Record<string, any>;

/**
 * GET a server-sent event stream with fetch (so the bearer header is sent) and pass each JSON
 * `data:` frame to `onEvent`. Lines that are not JSON are skipped, as legacy's handler does.
 * Resolves when the stream ends; rejects with ApiError on a non-2xx status.
 */
export async function apiEventStream(path: string, query: Query, onEvent: (frame: StreamFrame) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetcher(buildUrl(path, query), { method: 'GET', headers: baseHeaders({ Accept: 'text/event-stream' }), signal });
  if (!res.ok) throw new ApiError('GET', path, res.status, await readPayload(res));
  const emit = (line: string) => {
    if (!line.startsWith('data:')) return;
    try {
      onEvent(JSON.parse(line.slice(5).trim()) as StreamFrame);
    } catch {
      /* skip bad lines */
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
  if (buffer) emit(buffer);
}
