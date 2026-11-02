// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Reply helpers for the W8-SPA3 stores. The legacy pages read the JSON body whatever the HTTP
// status (`resp.json()` then `data.ok` / `data.error`); the typed client throws ApiError on a
// non-2xx status, carrying that body. These helpers recover it so the stores branch as legacy does.

import { ApiError } from '../api';

export interface OkReply {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

/** The JSON body of a reply: the resolved value, or the body an ApiError carries. Rethrows anything else. */
export async function replyOf<T extends object = OkReply>(call: () => Promise<unknown>): Promise<T> {
  try {
    const value = await call();
    return (value && typeof value === 'object' ? value : {}) as T;
  } catch (err) {
    if (err instanceof ApiError) {
      const payload = err.payload;
      if (payload && typeof payload === 'object') return payload as T;
      return { ok: false, error: `HTTP ${err.status}` } as unknown as T;
    }
    throw err;
  }
}

/** Legacy error text: the body's `error`, else the HTTP status (legacy: statusText), else the message. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const payload = err.payload as OkReply | null;
    if (payload && typeof payload === 'object' && typeof payload.error === 'string' && payload.error) return payload.error;
    return `HTTP ${err.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}
