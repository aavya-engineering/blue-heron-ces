// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Helpers shared by the editors: legacy id escaping, JSON highlighting, the notice line.
import type { ReactNode } from 'react';

/** Legacy `escId` (index.html L10534): every character outside [A-Za-z0-9_-] becomes '-'. */
export function escId(value: unknown): string {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '-');
}

// Same token pattern as the legacy syntaxHighlight (evidence-popout.html).
const JSON_TOKEN = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;

function tokenClass(match: string): string {
  if (match.startsWith('"')) return /:$/.test(match) ? 'json-key' : 'json-string';
  if (/true|false/.test(match)) return 'json-boolean';
  if (/null/.test(match)) return 'json-null';
  return 'json-number';
}

function highlight(json: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const m of json.matchAll(JSON_TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(json.slice(last, at));
    out.push(
      <span key={index++} className={tokenClass(m[0])}>
        {m[0]}
      </span>,
    );
    last = at + m[0].length;
  }
  if (last < json.length) out.push(json.slice(last));
  return out;
}

function stringify(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  return text === undefined ? String(value) : text;
}

/** Pretty JSON with the legacy token classes (`json-key`, `json-string`, ...). */
export function JsonView({ value, id }: { value: unknown; id?: string }) {
  return (
    <div className="ck-json" id={id}>
      <pre>{highlight(stringify(value))}</pre>
    </div>
  );
}

/** Legacy `formatCmdOutput`: JSON strings are pretty-printed, other strings shown as text. */
export function CommandOutput({ value, id }: { value: unknown; id?: string }) {
  if (typeof value !== 'string') return <JsonView value={value} id={id} />;
  try {
    return <JsonView value={JSON.parse(value)} id={id} />;
  } catch {
    return (
      <div className="ck-json" id={id}>
        <pre>{value}</pre>
      </div>
    );
  }
}

export type NoticeKind = 'success' | 'error';

export interface EditorNotice {
  text: string;
  kind: NoticeKind;
}

/** Inline replacement for the legacy toast (`#toast`, `.toast.success` / `.toast.error`). */
export function Notice({ notice, id }: { notice: EditorNotice | null; id: string }) {
  return (
    <div id={id} className={notice ? `ck-notice ck-notice-${notice.kind}` : 'ck-notice'} role="status" aria-live="polite">
      {notice ? notice.text : null}
    </div>
  );
}
