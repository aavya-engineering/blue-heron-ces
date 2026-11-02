// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EO-specific building blocks (module components stay in the module's own ui package; the kit is
// not edited this wave). Styling follows Stamper's workflow cards (eo.css, tokens only).

import { useCallback, useState, type ReactNode } from 'react';
import { ApiError } from '../api/http';
import { useSession } from '../store/session';

export function Card({ title, id, children, actions }: { title: string; id?: string; children?: ReactNode; actions?: ReactNode }) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className="workflow-card eo-card" id={id} aria-labelledby={headingId}>
      <div className="workflow-card-header">
        <h2 className="card-title" id={headingId}>{title}</h2>
        {actions ? <div className="eo-card-actions">{actions}</div> : null}
      </div>
      <div className="workflow-card-body">{children}</div>
    </section>
  );
}

export type NoticeKind = 'info' | 'success' | 'error' | 'warn';

export function Notice({ kind = 'info', children, id }: { kind?: NoticeKind; children: ReactNode; id?: string }) {
  return (
    <p className={`eo-notice eo-notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'} id={id}>
      {children}
    </p>
  );
}

const STATUS_CLASS: Record<string, string> = {
  met: 'badge badge-compliant',
  not_met: 'badge badge-violation',
  partial: 'badge badge-risk',
  not_assessed: 'badge badge-review',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={STATUS_CLASS[status] ?? 'badge badge-review'}>{status.replace(/_/g, ' ')}</span>;
}

/** Message for an error thrown by an api call. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return `${e.detail} (HTTP ${e.status})`;
  return e instanceof Error ? e.message : String(e);
}

/** Run an async action with busy / message state (one message line per screen card). */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: NoticeKind; text: string } | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: (r: T) => string): Promise<T | undefined> => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fn();
      if (success) setMessage({ kind: 'success', text: success(r) });
      return r;
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, message, setMessage, run };
}

/** Renders children only when a tenant is selected; otherwise the legacy "Select a tenant first". */
export function TenantRequired({ children }: { children: (tenant: string) => ReactNode }) {
  const tenant = useSession((s) => s.tenant);
  if (!tenant) return <Notice kind="warn">Select a tenant first (Tenant and access screen).</Notice>;
  return <>{children(tenant)}</>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="eo-field">
      <label className="eo-field">
        <span className="eo-field-label">{label}</span>
        {children}
      </label>
      {hint ? <span className="eo-field-hint">{hint}</span> : null}
    </div>
  );
}

/**
 * FIN-31b: an inline two-step confirm (replaces legacy confirm(), which jsdom and assistive tech
 * handle badly). The first click arms it; the second, on "Confirm ...", runs the action.
 */
export function ConfirmButton({ label, confirmLabel, onConfirm, disabled, id, ariaLabel, className = 'btn btn-ghost btn-small' }: {
  label: string; confirmLabel?: string; onConfirm: () => void; disabled?: boolean; id?: string; ariaLabel?: string; className?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return <button type="button" className={className} id={id} aria-label={ariaLabel} disabled={disabled} onClick={() => setArmed(true)}>{label}</button>;
  }
  return (
    <span className="eo-row eo-confirm" role="group" aria-label={`Confirm: ${ariaLabel ?? label}`}>
      <button type="button" className="btn btn-destructive btn-small" id={id ? `${id}-confirm` : undefined} disabled={disabled}
        onClick={() => { setArmed(false); onConfirm(); }}>
        {confirmLabel ?? `Confirm ${label.toLowerCase()}`}
      </button>
      <button type="button" className="btn btn-ghost btn-small" onClick={() => setArmed(false)}>Cancel</button>
    </span>
  );
}

/** Copy text to the clipboard; resolves false when the browser gives no clipboard (the text stays on screen to copy by hand). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  return false;
}

/** "very_high" -> "very high"; empty -> the dash legacy shows. */
export const pretty = (v: string | undefined | null): string => (v ? v.replace(/_/g, ' ') : '—');

/** A date string as a local date, else the dash. */
export const day = (v: string | undefined | null): string => (v ? new Date(v).toLocaleDateString() : '—');

export function Metric({ label, value, id }: { label: string; value: ReactNode; id?: string }) {
  return (
    <div className="eo-metric">
      <span className="eo-metric-value" id={id}>{value}</span>
      <span className="eo-metric-label">{label}</span>
    </div>
  );
}
