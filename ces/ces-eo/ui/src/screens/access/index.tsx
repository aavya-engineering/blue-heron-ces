// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Tenant and access: pick the tenant (legacy tenantConnectSelect), and hold the tokens that gate
// access. FIN-31 closes LOG-FIN-12 open item 2 here: a browser user gets an uploader token from a
// BHD operator, who signs in (passkey session, Entra token, or the loopback dev fallback) and mints
// one for the named uploader through POST /api/uploader-tokens. A token handed over out of band
// can be pasted instead. The approver token for reviews is minted the same way (existing issuer).

import { useRef, useState } from 'react';
import { ConsoleView, type ConsoleEntry, type LogLevel } from 'ces-ui-kit';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { eoApi } from '../../api/eo';
import { readClaims } from '../../api/token';
import { useSession } from '../../store/session';
import { Card, Field, Notice, errorText, useAction } from '../../components/common';
import type { StreamFrame } from '../../api/http';

/** One /api/connect frame -> the session connection state (legacy handleConnectEvent), or null for no change. */
export function connectFrameState(f: StreamFrame): { state: 'connected' | 'error'; text: string } | null {
  if (f.type === 'connection_log' && f.phase === 'connected_graph') return { state: 'connected', text: `${f.tenant} — connected` };
  if (f.type === 'connection_log' && (f.phase === 'error_graph' || f.phase === 'error')) return { state: 'error', text: f.phase === 'error_graph' ? 'Graph connection failed' : String(f.message ?? 'Connection failed') };
  if (f.type === 'error') return { state: 'error', text: String(f.message ?? 'Connection failed') };
  return null;
}

/**
 * FIN-31b: the legacy optional live connect (Connect (Optional), GET /api/connect). It opens this
 * tenant's Graph session on EO so the Evidence Explorer can fetch live signals; assessment and
 * every other screen work without it (local-only mode).
 */
function ConnectPanel({ tenant }: { tenant: string }) {
  const connection = useSession((x) => x.connection);
  const connectionText = useSession((x) => x.connectionText);
  const setConnection = useSession((x) => x.setConnection);
  const qc = useQueryClient();
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const seq = useRef(0);
  const push = (level: LogLevel, message: string) =>
    setEntries((e) => [...e, { key: String(seq.current++), time: new Date().toLocaleTimeString('en-GB', { hour12: false }), level, message }]);
  const run = async () => {
    setEntries([]);
    setConnection('connecting', `Connecting to ${tenant}...`);
    let final: 'connected' | 'error' | null = null;
    try {
      await eoApi.connect(tenant, (f) => {
        if (typeof f.message === 'string') {
          const phase = String(f.phase ?? f.type ?? '');
          push(phase.startsWith('error') ? 'error' : phase.startsWith('connected') ? 'success' : 'info', f.message);
        }
        const next = connectFrameState(f);
        if (next) { final = next.state; setConnection(next.state, next.text); }
      });
      if (!final) setConnection('error', 'Connection check ended without a Graph session');
      // The Evidence Explorer reads this tenant's connection state from its index: refresh it.
      void qc.invalidateQueries({ queryKey: ['evidence-index', tenant] });
    } catch (e) {
      setConnection('error', errorText(e));
    }
  };
  return (
    <div className="eo-connect" id="eo-connect">
      <div className="eo-row">
        <button type="button" className="btn btn-secondary btn-small" id="connectBtn" disabled={connection === 'connecting'} onClick={() => void run()}>
          {connection === 'connecting' ? 'Connecting...' : 'Connect (optional)'}
        </button>
        <span id="connectionStatus" className={`eo-conn eo-conn-${connection}`} role="status">{connectionText}</span>
      </div>
      <p className="eo-muted">Optional. Opens this tenant's Microsoft Graph session on EO for live signals in the Evidence Explorer. Without it EO works in local-only mode.</p>
      {entries.length ? <ConsoleView entries={entries} id="connectConsole" label="Connection log" /> : null}
    </div>
  );
}

function TokenSummary({ token, label }: { token: string; label: string }) {
  if (!token.trim()) return <span className="eo-muted">{label}: none</span>;
  const c = readClaims(token);
  if (!c) return <span className="eo-muted">{label}: set (not a readable token)</span>;
  const exp = typeof c.exp === 'number' ? new Date(c.exp * 1000).toLocaleString() : 'unknown';
  return (
    <span data-testid={`${label.toLowerCase().replace(/\s+/g, '-')}-summary`}>
      {label}: names <strong>{c.upn ?? c.sub ?? 'unknown'}</strong>, expires {exp}
    </span>
  );
}

export default function AccessScreen() {
  const s = useSession();
  const tenants = useQuery({ queryKey: ['tenants', s.serviceToken], queryFn: eoApi.tenants });
  const uploaderCfg = useQuery({ queryKey: ['uploader-issuer', s.serviceToken], queryFn: eoApi.uploaderIssuerConfig });
  const [uploaderUpn, setUploaderUpn] = useState('');
  const [approverUpn, setApproverUpn] = useState('');
  const mintUp = useAction();
  const mintAp = useAction();

  return (
    <div className="eo-screen">
      <div className="eo-columns">
        <Card title="Tenant" id="eo-tenant-card">
          <Field label="Tenant">
            <select id="tenantSelect" value={s.tenant ?? ''} onChange={(e) => s.setTenant(e.target.value || null)}>
              <option value="">Select tenant...</option>
              {(tenants.data ?? []).map((t) => (
                <option key={t.slug} value={t.slug}>{`${t.client_name} (${t.slug})`}</option>
              ))}
            </select>
          </Field>
          {tenants.isError ? <Notice kind="error">Tenants could not be loaded. If EO requires a service token, enter it below.</Notice> : null}
          {s.tenant ? <ConnectPanel tenant={s.tenant} /> : null}
        </Card>

        <Card title="Service access" id="eo-service-card">
          <Field label="EO service token" hint="CES_EO_AUTH_TOKEN. Needed from any non-loopback browser; held in memory only.">
            <input id="serviceToken" type="password" autoComplete="off" value={s.serviceToken} onChange={(e) => s.setServiceToken(e.target.value)} />
          </Field>
          <Field label="Operator sign-in" hint="A BHD operator session (passkey sign-in), Entra ID token or dev operator token. Sent only to the token issuers.">
            <input id="operatorToken" type="password" autoComplete="off" value={s.operatorToken} onChange={(e) => s.setOperatorToken(e.target.value)} />
          </Field>
          <p className="eo-muted">
            Passkey sign-in and enrolment stay on the issuer page on the EO machine (<a href="/approver-tokens.html">approver-tokens.html</a>).
          </p>
        </Card>
      </div>

      <div className="eo-columns">
        <Card title="Uploader token" id="eo-uploader-card">
          <p>
            EC records who uploaded a document only from a verified uploader token. Without one, no review can credit the upload (GD-b).
          </p>
          {uploaderCfg.data && !uploaderCfg.data.issuerConfigured ? (
            <Notice kind="warn">This EO cannot mint uploader tokens: CES_EC_PRINCIPAL_SECRET is not set in its environment.</Notice>
          ) : null}
          <Field label="Uploader (UPN)">
            <input id="uploaderUpn" type="email" value={uploaderUpn} onChange={(e) => setUploaderUpn(e.target.value)} placeholder="name@customer.example" />
          </Field>
          <div className="eo-row">
            <button
              type="button"
              className="btn btn-primary btn-small"
              id="mintUploaderBtn"
              disabled={!s.tenant || !s.operatorToken.trim() || !uploaderUpn.trim() || mintUp.busy}
              onClick={() =>
                void mintUp.run(async () => {
                  const m = await eoApi.mintUploaderToken(s.tenant!, s.operatorToken, uploaderUpn.trim());
                  s.setUploaderToken(m.token);
                  return m;
                }, (m) => `Uploader token minted for ${m.uploaderUpn}, expires ${new Date(m.expiresAt).toLocaleString()}.`)
              }
            >
              Mint uploader token
            </button>
          </div>
          {mintUp.message ? <Notice kind={mintUp.message.kind}>{mintUp.message.text}</Notice> : null}
          <Field label="Or paste an uploader token">
            <textarea id="uploaderToken" rows={2} value={s.uploaderToken} onChange={(e) => s.setUploaderToken(e.target.value)} />
          </Field>
          <TokenSummary token={s.uploaderToken} label="Uploader token" />
        </Card>

        <Card title="Approver token (reviews)" id="eo-approver-card">
          <p>
            A review counts only with a minted approver token, and never from the person who uploaded the document (GD-b). This is
            separation of duties, not two-person approval, so it stays on while two-person approval is off.
          </p>
          <Field label="Reviewer (UPN)">
            <input id="approverUpn" type="email" value={approverUpn} onChange={(e) => setApproverUpn(e.target.value)} placeholder="name@customer.example" />
          </Field>
          <div className="eo-row">
            <button
              type="button"
              className="btn btn-primary btn-small"
              id="mintApproverBtn"
              disabled={!s.tenant || !s.operatorToken.trim() || !approverUpn.trim() || mintAp.busy}
              onClick={() =>
                void mintAp.run(async () => {
                  const m = await eoApi.mintApproverToken(s.tenant!, s.operatorToken, approverUpn.trim());
                  s.setApproverToken(m.token);
                  return m;
                }, (m) => `Approver token minted for ${m.approverUpn}, expires ${new Date(m.expiresAt).toLocaleString()}.`)
              }
            >
              Mint approver token
            </button>
          </div>
          {mintAp.message ? <Notice kind={mintAp.message.kind}>{mintAp.message.text}</Notice> : null}
          <Field label="Or paste an approver token">
            <textarea id="approverToken" rows={2} value={s.approverToken} onChange={(e) => s.setApproverToken(e.target.value)} />
          </Field>
          <TokenSummary token={s.approverToken} label="Approver token" />
        </Card>
      </div>
    </div>
  );
}
