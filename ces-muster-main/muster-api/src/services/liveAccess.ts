// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// liveAccess.ts — FC-MU-2 (MU-03 / MU-06 live, founder decision 2026-09-27):
// the gate every live (non-sim) tenant read goes through.
//
//   1. OFF by default. A live read needs the engagement's explicit
//      `live_access_enabled` flag (Prisma column, recorded with who + when).
//   2. Device-code sign-in only (OAuth 2.0 device authorization grant, public
//      client). No client secret exists on this path.
//   3. Read-only scopes only (LIVE_READ_SCOPES, enforced by
//      assertReadOnlyScopes on what we ASK for and on what the token GRANTS).
//      No offline_access: no refresh token, nothing long-lived to store.
//   4. Tenant-scoped: the authority is `<login>/<tenantId>/…` (never /common or
//      /organizations) and the id_token `tid` must equal that tenant.
//      FC-MU-3: the id_token is VERIFIED first (idTokenVerifier.ts): RS256
//      signature against the cloud's published keys, issuer, audience = the
//      client id, exp/nbf. An unverified token records nothing.
//   5. The customer's consent (who, when, scopes, tenant) is recorded on the
//      engagement (live_consent) and carried into the readiness record
//      (readiness-result manifest.consent). The access token lives only in
//      this process's memory until it expires — never persisted.
//   6. A refused, expired or aborted consent leaves nothing behind: the pending
//      entry is dropped and no engagement write happens.
//
// Test safety: the default HTTP transport refuses any non-localhost host while
// running under vitest (assertNotLiveUnderTest). Tests inject a fake
// transport; no test can reach a Microsoft endpoint through this module.
import { randomUUID } from 'node:crypto';
import { withTenant } from '../lib/prisma.js';
import { assertNotLiveUnderTest } from '../lib/liveGuard.js';
import { verifyIdToken, IdTokenError, type JwksFetcher } from './idTokenVerifier.js';

export { assertNotLiveUnderTest };

/** GCC High login authority (the platform's target cloud). Override per deployment. */
export const DEFAULT_LIVE_LOGIN_BASE = 'https://login.microsoftonline.us';
/** GCC High Microsoft Graph resource. */
export const LIVE_GRAPH_RESOURCE = 'https://graph.microsoft.us';

/**
 * The delegated scopes the live path asks for. Every Graph scope is a
 * `.Read` / `.Read.All` permission; openid + profile only identify who signed
 * in (the consent's "who"). Covers the harvest probes (conditional access,
 * managed devices, compliance policies) and the discovery walk's Graph reads.
 */
export const LIVE_READ_SCOPES: readonly string[] = [
  'openid',
  'profile',
  `${LIVE_GRAPH_RESOURCE}/Policy.Read.All`,
  `${LIVE_GRAPH_RESOURCE}/Directory.Read.All`,
  `${LIVE_GRAPH_RESOURCE}/DeviceManagementManagedDevices.Read.All`,
  `${LIVE_GRAPH_RESOURCE}/DeviceManagementConfiguration.Read.All`,
];

const IDENTITY_SCOPES = new Set(['openid', 'profile', 'email']);
const READ_SCOPE_RE = /^(?:https:\/\/graph\.microsoft\.(?:us|com)\/)?[A-Za-z]+(?:\.[A-Za-z]+)*\.Read(?:\.All)?$/;

/** True when `scope` is an identity scope or a read-only Graph permission. */
export function isReadOnlyScope(scope: string): boolean {
  return IDENTITY_SCOPES.has(scope) || READ_SCOPE_RE.test(scope);
}

// ── Live areas (FC-MU-3 step 5, founder decision 2026-09-28 #14) ─────────────
//
// A delegated token is issued for ONE resource, so each Microsoft surface the
// sim covers gets its own device-code consent: Graph (FC-MU-2), Exchange
// Online, Purview (Security & Compliance PowerShell) and Azure Resource
// Manager. Every consent is recorded separately.
//
// Read-only basis differs by area — stated, not papered over:
//   - graph: every permission is a `.Read` / `.Read.All` scope.
//   - exchange / purview / azure: Microsoft publishes NO read-only delegated
//     permission for EXO PowerShell (`Exchange.Manage`), Security & Compliance
//     PowerShell (same permission) or ARM (`user_impersonation`). What the
//     account can do is its directory role / Azure RBAC. Muster's read-only
//     guarantee for these areas is the get-only executor plus the write-verb
//     command gate (liveDiscoveryRun.writeCommandReason); the customer should
//     sign in with a reader role (Global Reader / Azure Reader). Recorded as a
//     founder decision in the FC-MU-3 report.
// Resource URLs default to GCC High and can be overridden per deployment
// (MUSTER_LIVE_<AREA>_RESOURCE). The Purview resource is UNCONFIRMED until the
// founder smoke run.
//
// FC-MU-5 step 3 (founder decision 2026-09-28, round 4): Teams is a fifth
// area. Its resource is the "Skype and Teams Tenant Admin API" (app id
// 48ac35b8-…, cloud-agnostic id form), permission `user_impersonation` —
// again no read-only delegated scope, so the basis is the command gate plus
// the reader role (step 1). The resource id form for GCC High is UNCONFIRMED
// until the founder smoke run (MUSTER_LIVE_TEAMS_RESOURCE overrides).

export type LiveArea = 'graph' | 'exchange' | 'purview' | 'azure' | 'teams';
export const LIVE_AREA_NAMES: readonly LiveArea[] = ['graph', 'exchange', 'purview', 'azure', 'teams'];

export interface LiveAreaSpec {
  /** The resource (token audience) the consent is for. */
  resource: string;
  /** The resource permissions asked for (identity scopes are added). */
  scopes: readonly string[];
  /** Where the read-only guarantee comes from. */
  readOnlyBasis: 'read-scopes' | 'command-gate';
}

function areaResource(area: Exclude<LiveArea, 'graph'>, def: string): string {
  return (process.env[`MUSTER_LIVE_${area.toUpperCase()}_RESOURCE`] ?? def).replace(/\/+$/, '');
}

const EXO_RESOURCE = areaResource('exchange', 'https://outlook.office365.us');
const PURVIEW_RESOURCE = areaResource('purview', 'https://outlook.office365.us');
const ARM_RESOURCE = areaResource('azure', 'https://management.usgovcloudapi.net');
/** Skype and Teams Tenant Admin API (the Teams PowerShell module's admin resource). */
export const TEAMS_ADMIN_API_APP_ID = '48ac35b8-9aa8-4d74-927d-1f4a14a0b239';
const TEAMS_RESOURCE = areaResource('teams', TEAMS_ADMIN_API_APP_ID);

export const LIVE_AREAS: Record<LiveArea, LiveAreaSpec> = {
  graph: {
    resource: LIVE_GRAPH_RESOURCE,
    scopes: LIVE_READ_SCOPES.filter((s) => !IDENTITY_SCOPES.has(s)),
    readOnlyBasis: 'read-scopes',
  },
  exchange: { resource: EXO_RESOURCE, scopes: [`${EXO_RESOURCE}/Exchange.Manage`], readOnlyBasis: 'command-gate' },
  purview: { resource: PURVIEW_RESOURCE, scopes: [`${PURVIEW_RESOURCE}/Exchange.Manage`], readOnlyBasis: 'command-gate' },
  azure: { resource: ARM_RESOURCE, scopes: [`${ARM_RESOURCE}/user_impersonation`], readOnlyBasis: 'command-gate' },
  teams: { resource: TEAMS_RESOURCE, scopes: [`${TEAMS_RESOURCE}/user_impersonation`], readOnlyBasis: 'command-gate' },
};

export function isLiveArea(v: unknown): v is LiveArea {
  return typeof v === 'string' && (LIVE_AREA_NAMES as readonly string[]).includes(v);
}

/** The full scope list one area's device-code sign-in asks for. */
export function areaScopes(area: LiveArea): string[] {
  return ['openid', 'profile', ...LIVE_AREAS[area].scopes];
}

/**
 * True when `scope` may appear in `area`'s grant: an identity scope, or (graph)
 * a read-only Graph permission, or (other areas) exactly one of that area's
 * listed permissions. `.default`, `offline_access` and other resources never pass.
 */
export function isAllowedAreaScope(area: LiveArea, scope: string): boolean {
  if (IDENTITY_SCOPES.has(scope)) return true;
  if (area === 'graph') return READ_SCOPE_RE.test(scope);
  return LIVE_AREAS[area].scopes.includes(scope);
}

export class LiveScopeError extends Error {
  constructor(readonly offending: string[]) {
    super(`live path is read-only: refusing non-read scope(s): ${offending.join(', ')}`);
    this.name = 'LiveScopeError';
  }
}

/** Throw unless every scope is read-only (rejects .default, offline_access, *.ReadWrite*). */
export function assertReadOnlyScopes(scopes: readonly string[]): void {
  const bad = scopes.filter((s) => !isReadOnlyScope(s));
  if (bad.length > 0) throw new LiveScopeError(bad);
}

// ── Device-code transport ────────────────────────────────────────────────────

export interface TransportResponse {
  status: number;
  json: unknown;
}
/** POST an x-www-form-urlencoded body; resolve status + parsed JSON. */
export type DeviceCodeTransport = (url: string, form: Record<string, string>) => Promise<TransportResponse>;

export const fetchTransport: DeviceCodeTransport = async (url, form) => {
  assertNotLiveUnderTest('device-code HTTP call', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
};

// ── Reader role (FC-MU-5 step 1, founder decision 2026-09-28, round 4) ───────
//
// The command-gate areas (exchange, purview, azure, teams) have no read-only
// delegated scope, so their consent is recorded ONLY when the signed-in admin
// holds Entra Global Reader: the role template id must be in the VERIFIED ID
// token's `wids` claim (Entra emits `wids` only when the app registration's
// groupMembershipClaims includes DirectoryRole — a smoke-run setting; a token
// without the claim fails closed). Azure additionally needs read on the whole
// subscription: the consent's own ARM token asks ARM for the caller's
// effective permissions there, and `*/read` (the Azure Reader role, or any
// role that includes it) must survive notActions. Strict as written: holding
// Global Reader is required; other roles held alongside are not refused.

/** Entra "Global Reader" role template id (overridable per deployment). */
export const GLOBAL_READER_ROLE_ID = process.env.MUSTER_LIVE_GLOBAL_READER_ROLE_ID ?? 'f2ef992c-3afb-46b9-b7cf-a126ee74c451';
/** ARM Microsoft.Authorization/permissions api-version (UNCONFIRMED for GCC High until the smoke run). */
export const AZURE_PERMISSIONS_API_VERSION = process.env.MUSTER_LIVE_AZ_PERMISSIONS_API_VERSION ?? '2022-04-01';

/** A GET with a bearer token; resolve status + parsed JSON. */
export type ArmGet = (url: string, accessToken: string) => Promise<TransportResponse>;

/** The production ARM GET. Refused under vitest (tests inject a fake). */
export const fetchArmGet: ArmGet = async (url, accessToken) => {
  assertNotLiveUnderTest('ARM reader-role check', url);
  const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
};

const READ_ALL = new Set(['*', '*/read']);

/** True when ARM's permissions reply grants read on everything in scope (`*` or `*` + `/read`, not removed by notActions). */
export function grantsSubscriptionRead(json: unknown): boolean {
  const value = (json as { value?: unknown } | null)?.value;
  if (!Array.isArray(value)) return false;
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return value.some((p: { actions?: unknown; notActions?: unknown } | null) => {
    const actions = strs(p?.actions).map((a) => a.toLowerCase());
    const notActions = strs(p?.notActions).map((a) => a.toLowerCase());
    return actions.some((a) => READ_ALL.has(a)) && !notActions.some((a) => READ_ALL.has(a));
  });
}

// ── Consent record + store ───────────────────────────────────────────────────

/** The customer's consent — who, when, which scopes, which tenant. */
export interface LiveConsentRecord {
  consented_by: string;
  consented_at: string;
  scopes: string[];
  tenant_id: string;
  auth_tier: 'device-code';
  client_id: string;
  /** FC-MU-3: which area this consent covers (FC-MU-2 records without it are graph). */
  area?: LiveArea;
  /** FC-MU-5: the reader roles proven at consent time (command-gate areas only). */
  reader_roles?: string[];
  /** FC-MU-5: the Azure subscription the reader check covered (azure only). */
  subscription_id?: string;
}

export interface LiveAccessState {
  enabled: boolean;
  /** The Graph consent (the FC-MU-2 column). */
  consent: LiveConsentRecord | null;
  /** FC-MU-3: the Exchange / Purview / Azure (FC-MU-5: + Teams) consents, by area. */
  areaConsents: Partial<Record<Exclude<LiveArea, 'graph'>, LiveConsentRecord>>;
}

/** Where the per-engagement flag and consent are recorded (the engagement row). */
export interface LiveAccessStore {
  /** null when the engagement does not exist in the caller's (SaaS) tenant. */
  get(saasTenantId: string, engagementId: string): Promise<LiveAccessState | null>;
  setEnabled(saasTenantId: string, engagementId: string, enabled: boolean, by: string): Promise<boolean>;
  recordConsent(saasTenantId: string, engagementId: string, consent: LiveConsentRecord): Promise<void>;
}

/** The production store: columns on the Prisma `engagements` row (migration 006). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prismaLiveAccessStore(db: any): LiveAccessStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const find = (saasTenantId: string, id: string): Promise<any> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withTenant(saasTenantId, (tx: any) => tx.engagement.findUnique({ where: { id } }), db);
  return {
    async get(saasTenantId, engagementId) {
      const e = await find(saasTenantId, engagementId);
      if (!e || e.tenant_id !== saasTenantId) return null;
      return {
        enabled: e.live_access_enabled === true,
        consent: (e.live_consent as LiveConsentRecord | null) ?? null,
        areaConsents: (e.live_area_consents as LiveAccessState['areaConsents'] | null) ?? {},
      };
    },
    async setEnabled(saasTenantId, engagementId, enabled, by) {
      const e = await find(saasTenantId, engagementId);
      if (!e || e.tenant_id !== saasTenantId) return false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await withTenant(saasTenantId, (tx: any) =>
        tx.engagement.update({
          where: { id: engagementId },
          data: { live_access_enabled: enabled, live_access_set_by: by, live_access_set_at: new Date() },
        })
      , db);
      return true;
    },
    async recordConsent(saasTenantId, engagementId, consent) {
      // FC-MU-3: Graph stays in live_consent (migration 006); every other area
      // lands in live_area_consents[area] (migration 007).
      const area = consent.area ?? 'graph';
      let data: Record<string, unknown>;
      if (area === 'graph') {
        data = { live_consent: consent };
      } else {
        const e = await find(saasTenantId, engagementId);
        const prior = (e?.live_area_consents as Record<string, unknown> | null) ?? {};
        data = { live_area_consents: { ...prior, [area]: consent } };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await withTenant(saasTenantId, (tx: any) =>
        tx.engagement.update({ where: { id: engagementId }, data })
      , db);
    },
  };
}

// ── Device-code consent service ──────────────────────────────────────────────

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LiveConsentConfig {
  /** Public client id (device-code flow; no secret). Default env MUSTER_LIVE_CLIENT_ID. */
  clientId?: string;
  /** Default env MUSTER_LIVE_LOGIN_BASE, else GCC High login. */
  loginBase?: string;
  transport?: DeviceCodeTransport;
  now?: () => Date;
  scopes?: readonly string[];
  /** FC-MU-3: the JWKS fetcher for ID-token verification (default: Microsoft's endpoint; refused under vitest). */
  fetchKeys?: JwksFetcher;
  /** FC-MU-5: the ARM GET for the Azure reader check (default: fetch; refused under vitest). */
  armGet?: ArmGet;
}

export interface StartedConsent {
  consent_id: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message?: string;
}

export type PollOutcome =
  | { status: 'pending' }
  | { status: 'granted'; consent: LiveConsentRecord }
  | { status: 'refused'; reason: string };

interface PendingConsent {
  saasTenantId: string;
  engagementId: string;
  tenantId: string;
  area: LiveArea;
  /** FC-MU-5: azure only — the subscription the reader check covers. */
  subscriptionId?: string;
  deviceCode: string;
  expiresAt: number;
  state: 'pending' | 'granted';
  consent?: LiveConsentRecord;
  accessToken?: string;
  tokenExpiresAt?: number;
}

export class LiveConsentError extends Error {
  constructor(
    readonly code: 'not_configured' | 'bad_tenant' | 'bad_area' | 'subscription_required' | 'device_code_failed',
    message: string
  ) {
    super(message);
    this.name = 'LiveConsentError';
  }
}

/** A granted live session: what a live read may use. */
export interface LiveGrant {
  accessToken: string;
  consent: LiveConsentRecord;
}

/**
 * The device-code consent service. Pending and granted consents live ONLY in
 * this in-memory map (keyed by an unguessable consent id); a granted access
 * token is dropped at its expiry, on abort, or when the flag is turned off.
 */
export class LiveConsentService {
  private readonly pending = new Map<string, PendingConsent>();
  private readonly transport: DeviceCodeTransport;
  private readonly now: () => Date;
  private readonly scopes: readonly string[];

  constructor(private readonly store: LiveAccessStore, private readonly cfg: LiveConsentConfig = {}) {
    this.transport = cfg.transport ?? fetchTransport;
    this.now = cfg.now ?? (() => new Date());
    this.scopes = cfg.scopes ?? LIVE_READ_SCOPES;
    assertReadOnlyScopes(this.scopes);
  }

  private clientId(): string | undefined {
    return this.cfg.clientId ?? process.env.MUSTER_LIVE_CLIENT_ID;
  }
  private loginBase(): string {
    return (this.cfg.loginBase ?? process.env.MUSTER_LIVE_LOGIN_BASE ?? DEFAULT_LIVE_LOGIN_BASE).replace(/\/+$/, '');
  }

  /** The scopes one area's sign-in asks for (graph honours cfg.scopes). */
  private scopesFor(area: LiveArea): readonly string[] {
    return area === 'graph' ? this.scopes : areaScopes(area);
  }

  /** Start the device-code sign-in for one engagement + customer tenant + area (default graph). */
  async start(
    saasTenantId: string,
    engagementId: string,
    tenantId: string,
    area: LiveArea = 'graph',
    opts: { subscriptionId?: string } = {}
  ): Promise<StartedConsent> {
    const clientId = this.clientId();
    if (!clientId) throw new LiveConsentError('not_configured', 'MUSTER_LIVE_CLIENT_ID is not set');
    if (!GUID_RE.test(tenantId)) throw new LiveConsentError('bad_tenant', 'tenant_id must be the customer tenant GUID');
    if (!isLiveArea(area)) throw new LiveConsentError('bad_area', `area must be one of ${LIVE_AREA_NAMES.join(', ')}`);
    // FC-MU-5 step 1: the Azure reader check needs the subscription it covers.
    if (area === 'azure' && !(opts.subscriptionId && GUID_RE.test(opts.subscriptionId))) {
      throw new LiveConsentError('subscription_required', 'an azure consent needs subscription_id (the subscription GUID)');
    }
    const r = await this.transport(`${this.loginBase()}/${tenantId}/oauth2/v2.0/devicecode`, {
      client_id: clientId,
      scope: this.scopesFor(area).join(' '),
    });
    const j = (r.json ?? {}) as Record<string, unknown>;
    if (r.status !== 200 || typeof j.device_code !== 'string' || typeof j.user_code !== 'string') {
      throw new LiveConsentError('device_code_failed', `device-code request failed (HTTP ${r.status})`);
    }
    const id = randomUUID();
    const expiresIn = typeof j.expires_in === 'number' ? j.expires_in : 900;
    this.pending.set(id, {
      saasTenantId,
      engagementId,
      tenantId,
      area,
      ...(area === 'azure' ? { subscriptionId: opts.subscriptionId } : {}),
      deviceCode: j.device_code,
      expiresAt: this.now().getTime() + expiresIn * 1000,
      state: 'pending',
    });
    return {
      consent_id: id,
      user_code: j.user_code,
      verification_uri: typeof j.verification_uri === 'string' ? j.verification_uri : '',
      expires_in: expiresIn,
      interval: typeof j.interval === 'number' ? j.interval : 5,
      ...(typeof j.message === 'string' ? { message: j.message } : {}),
    };
  }

  /** Poll the token endpoint once. A terminal refusal drops the entry. */
  async poll(consentId: string, saasTenantId: string): Promise<PollOutcome | null> {
    const p = this.pending.get(consentId);
    if (!p || p.saasTenantId !== saasTenantId) return null;
    if (p.state === 'granted') return { status: 'granted', consent: p.consent! };
    if (this.now().getTime() >= p.expiresAt) return this.refuse(consentId, 'expired_token');

    const r = await this.transport(`${this.loginBase()}/${p.tenantId}/oauth2/v2.0/token`, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      client_id: this.clientId() ?? '',
      device_code: p.deviceCode,
    });
    const j = (r.json ?? {}) as Record<string, unknown>;
    if (r.status !== 200) {
      const err = typeof j.error === 'string' ? j.error : `http_${r.status}`;
      if (err === 'authorization_pending' || err === 'slow_down') return { status: 'pending' };
      return this.refuse(consentId, err);
    }
    if (typeof j.access_token !== 'string') return this.refuse(consentId, 'no_access_token');

    // Read-only: the scopes actually GRANTED (the token's `scope`) must pass
    // too. Graph: every scope read-only. Other areas (FC-MU-3): every scope in
    // that area's exact allowlist, and the area permission itself present.
    const granted = (typeof j.scope === 'string' ? j.scope : '').split(/\s+/).filter(Boolean);
    const spec = LIVE_AREAS[p.area];
    const grantedFull = granted.map((s) => (IDENTITY_SCOPES.has(s) || s.includes('/') ? s : `${spec.resource}/${s}`));
    if (p.area === 'graph') {
      if (grantedFull.length === 0 || grantedFull.some((s) => !isReadOnlyScope(s))) {
        return this.refuse(consentId, 'non_read_scope_granted');
      }
    } else if (!grantedFull.some((s) => spec.scopes.includes(s)) || grantedFull.some((s) => !isAllowedAreaScope(p.area, s))) {
      return this.refuse(consentId, 'non_area_scope_granted');
    }
    // FC-MU-3: the ID token must VERIFY (signature, issuer, audience, expiry)
    // before anything is recorded; tenant-scoped: its `tid` must be the
    // declared tenant.
    if (typeof j.id_token !== 'string') return this.refuse(consentId, 'id_token_missing');
    let claims: Record<string, unknown>;
    try {
      claims = await verifyIdToken(j.id_token, {
        tenantId: p.tenantId,
        clientId: this.clientId() ?? '',
        loginBase: this.loginBase(),
        now: this.now,
        ...(this.cfg.fetchKeys ? { fetchKeys: this.cfg.fetchKeys } : {}),
      });
    } catch (e) {
      if (e instanceof IdTokenError) return this.refuse(consentId, `id_token_${e.code}`);
      return this.refuse(consentId, 'id_token_keys_unavailable');
    }
    const who =
      (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
      (typeof claims.upn === 'string' && claims.upn) ||
      '';
    if (!who) return this.refuse(consentId, 'no_signed_in_identity');

    // FC-MU-5 step 1: command-gate areas need a reader role before anything
    // is recorded; a refusal drops the pending entry (nothing left behind).
    let readerRoles: string[] | undefined;
    if (spec.readOnlyBasis === 'command-gate') {
      const wids = claims.wids;
      if (!Array.isArray(wids)) return this.refuse(consentId, 'reader_role_unverifiable');
      const want = GLOBAL_READER_ROLE_ID.toLowerCase();
      if (!wids.some((w) => typeof w === 'string' && w.toLowerCase() === want)) {
        return this.refuse(consentId, 'global_reader_required');
      }
      readerRoles = ['Global Reader'];
      if (p.area === 'azure') {
        const url = `${spec.resource}/subscriptions/${p.subscriptionId}/providers/Microsoft.Authorization/permissions?api-version=${AZURE_PERMISSIONS_API_VERSION}`;
        let ok = false;
        try {
          const r = await (this.cfg.armGet ?? fetchArmGet)(url, j.access_token);
          ok = r.status === 200 && grantsSubscriptionRead(r.json);
        } catch {
          ok = false;
        }
        if (!ok) return this.refuse(consentId, 'azure_reader_required');
        readerRoles.push('Azure Reader (subscription)');
      }
    }

    const consent: LiveConsentRecord = {
      consented_by: who,
      consented_at: this.now().toISOString(),
      scopes: grantedFull,
      tenant_id: p.tenantId,
      auth_tier: 'device-code',
      client_id: this.clientId() ?? '',
      area: p.area,
      ...(readerRoles ? { reader_roles: readerRoles } : {}),
      ...(p.subscriptionId ? { subscription_id: p.subscriptionId } : {}),
    };
    await this.store.recordConsent(p.saasTenantId, p.engagementId, consent);
    const ttl = typeof j.expires_in === 'number' ? j.expires_in : 3600;
    p.state = 'granted';
    p.consent = consent;
    p.accessToken = j.access_token;
    p.tokenExpiresAt = this.now().getTime() + ttl * 1000;
    p.deviceCode = '';
    return { status: 'granted', consent };
  }

  /** Abort a pending or granted consent. Nothing is recorded for a pending one. */
  abort(consentId: string, saasTenantId: string): boolean {
    const p = this.pending.get(consentId);
    if (!p || p.saasTenantId !== saasTenantId) return false;
    this.pending.delete(consentId);
    return true;
  }

  /** Drop every in-memory consent for an engagement (flag turned off). */
  revokeEngagement(engagementId: string): void {
    for (const [id, p] of this.pending) if (p.engagementId === engagementId) this.pending.delete(id);
  }

  /** The granted token for (engagement, consent) — null if absent, pending, or expired. */
  grant(consentId: string, saasTenantId: string, engagementId: string): LiveGrant | null {
    const p = this.pending.get(consentId);
    if (!p || p.saasTenantId !== saasTenantId || p.engagementId !== engagementId) return null;
    if (p.state !== 'granted' || !p.accessToken || !p.consent) return null;
    if (this.now().getTime() >= (p.tokenExpiresAt ?? 0)) {
      this.pending.delete(consentId);
      return null;
    }
    return { accessToken: p.accessToken, consent: p.consent };
  }

  /** Test/introspection: how many consents are held in memory. */
  get size(): number {
    return this.pending.size;
  }

  private refuse(consentId: string, reason: string): PollOutcome {
    this.pending.delete(consentId);
    return { status: 'refused', reason };
  }
}

// ── The gate the live routes share ──────────────────────────────────────────

export interface LiveGate {
  store: LiveAccessStore;
  consent: LiveConsentService;
}

export type LiveAuthorization =
  | { ok: true; grant: LiveGrant; grants: LiveGrant[] }
  | { ok: false; status: number; code: 'engagement_required' | 'not_found' | 'live_access_disabled' | 'consent_required' };

const areaOf = (g: LiveGrant): LiveArea => g.consent.area ?? 'graph';

/**
 * The one check a live read passes: engagement exists in the caller's tenant,
 * its live flag is ON, and EVERY consent id given is a granted, unexpired
 * device-code consent for THAT engagement. Anything else refuses.
 *
 * FC-MU-3: `consentIds` may be one id or a list (one per area). `grant` is the
 * Graph grant when present, else the first. `requireArea` (harvest: 'graph')
 * refuses unless a grant for that area is among them.
 */
export async function authorizeLive(
  gate: LiveGate | undefined,
  saasTenantId: string,
  engagementId: unknown,
  consentIds: unknown,
  opts: { requireArea?: LiveArea } = {}
): Promise<LiveAuthorization> {
  if (!gate) return { ok: false, status: 403, code: 'live_access_disabled' };
  if (typeof engagementId !== 'string' || engagementId === '') {
    return { ok: false, status: 400, code: 'engagement_required' };
  }
  const state = await gate.store.get(saasTenantId, engagementId);
  if (!state) return { ok: false, status: 404, code: 'not_found' };
  if (!state.enabled) return { ok: false, status: 403, code: 'live_access_disabled' };
  const ids = (Array.isArray(consentIds) ? consentIds : [consentIds]).filter((c) => c !== undefined);
  if (ids.length === 0 || ids.some((c) => typeof c !== 'string')) return { ok: false, status: 403, code: 'consent_required' };
  const grants: LiveGrant[] = [];
  for (const id of ids as string[]) {
    const g = gate.consent.grant(id, saasTenantId, engagementId);
    if (!g) return { ok: false, status: 403, code: 'consent_required' };
    if (!grants.some((x) => areaOf(x) === areaOf(g))) grants.push(g);
  }
  const primary = opts.requireArea
    ? grants.find((g) => areaOf(g) === opts.requireArea)
    : (grants.find((g) => areaOf(g) === 'graph') ?? grants[0]);
  if (!primary) return { ok: false, status: 403, code: 'consent_required' };
  return { ok: true, grant: primary, grants };
}
