// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-EO-G (2026-09-28, founder decisions 16-19): passkey (WebAuthn) sign-in for BHD operators.
//
// Configuration (read per request, so a change needs no restart):
//   CES_EO_OPERATOR_PASSKEY_ORIGIN   the exact origin the issuer page is served from on the EO box,
//                                    e.g. http://localhost:5004. Setting it turns passkey sign-in on.
//   CES_EO_OPERATOR_PASSKEY_RP_ID    optional relying-party id; default = the origin's host name.
//   CES_EO_OPERATOR_SESSION_TTL_SECONDS  optional operator session lifetime; default and max 900 (15 min).
//
// Flow:
//   1. Enrollment code (one-time, 10 min): the first operator's comes from the local command
//      (`npm run operator:enroll`), later ones from an enrolled operator on the issuer page. Only the
//      code's SHA-256 is stored.
//   2. Enrollment: the code buys registration options; the passkey's attestation is verified
//      (origin, RP id, user verification REQUIRED); the credential is stored; the code is consumed.
//   3. Sign-in: single-use challenge -> assertion verified against the stored public key (origin,
//      RP id, user verification REQUIRED, signature counter must advance) -> a short-lived operator
//      session (<= 15 min), opaque, held in this process's memory by hash only.
//   4. The session is the operator credential for the mint route (in place of the Entra token). Every
//      use re-reads the passkey record, so a revocation takes effect immediately.
//
// Verification is done by @simplewebauthn/server; no WebAuthn crypto is written here.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { PrincipalVerifier, RequestPrincipal } from 'ces-shared/http/principal';
import {
  PasskeyOperatorStore,
  type EventActor,
  type OperatorIdentity,
  type OperatorPasskeyRecord,
} from './PasskeyOperatorStore.js';

type Env = Record<string, string | undefined>;

export const OPERATOR_ROLE = 'bhd-operator';
export const ENROLLMENT_CODE_TTL_SECONDS = 10 * 60;
export const MAX_OPERATOR_SESSION_TTL_SECONDS = 15 * 60;
export const PASSKEY_CHALLENGE_TTL_SECONDS = 5 * 60;
export const OPERATOR_SESSION_PREFIX = 'eo-op-session.';
export const RP_NAME = 'CES EvidenceOps operator sign-in';

export const PASSKEY_ENV_KEYS = [
  'CES_EO_OPERATOR_PASSKEY_ORIGIN',
  'CES_EO_OPERATOR_PASSKEY_RP_ID',
] as const;

export interface PasskeyOperatorConfig {
  origin: string;
  rpId: string;
  sessionTtlSeconds: number;
}

export type PasskeyRefusalCode =
  | 'passkey_config_invalid'
  | 'passkey_not_loopback'
  | 'operator_name_required'
  | 'operator_upn_invalid'
  | 'enrollment_code_invalid'
  | 'enrollment_code_expired'
  | 'enrollment_code_used'
  | 'passkey_challenge_invalid'
  | 'passkey_verification_failed'
  | 'passkey_already_registered'
  | 'passkey_unknown'
  | 'passkey_revoked'
  | 'session_invalid'
  | 'session_expired';

export class PasskeyRefusal extends Error {
  constructor(readonly code: PasskeyRefusalCode, readonly status: number, message: string) {
    super(message);
    this.name = 'PasskeyRefusal';
  }
}

export function passkeyOperatorConfigured(env: Env): boolean {
  return PASSKEY_ENV_KEYS.some((k) => typeof env[k] === 'string' && env[k]!.trim() !== '');
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Parse the passkey settings; fail closed on anything a browser would not accept as an RP. */
export function passkeyOperatorConfigFromEnv(env: Env): { ok: true; config: PasskeyOperatorConfig } | { ok: false; error: string } {
  const rawOrigin = env.CES_EO_OPERATOR_PASSKEY_ORIGIN?.trim();
  if (!rawOrigin) return { ok: false, error: 'CES_EO_OPERATOR_PASSKEY_ORIGIN must be set (e.g. http://localhost:5004)' };
  let url: URL;
  try { url = new URL(rawOrigin); } catch { return { ok: false, error: 'CES_EO_OPERATOR_PASSKEY_ORIGIN is not a valid URL' }; }
  if (url.origin !== rawOrigin.replace(/\/+$/, '')) {
    return { ok: false, error: 'CES_EO_OPERATOR_PASSKEY_ORIGIN must be an origin only (scheme://host[:port]), no path' };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && host === 'localhost')) {
    return { ok: false, error: 'passkeys need https, or http://localhost on the EO machine' };
  }
  const rpId = (env.CES_EO_OPERATOR_PASSKEY_RP_ID?.trim() || host).toLowerCase();
  if (IPV4_RE.test(rpId) || rpId.includes(':') || rpId.startsWith('[')) {
    return { ok: false, error: 'the passkey relying-party id must be a host name (e.g. localhost), not an IP address' };
  }
  if (host !== rpId && !host.endsWith(`.${rpId}`)) {
    return { ok: false, error: `the passkey relying-party id '${rpId}' must be the origin's host name or a parent domain of it` };
  }
  let sessionTtlSeconds = MAX_OPERATOR_SESSION_TTL_SECONDS;
  const rawTtl = env.CES_EO_OPERATOR_SESSION_TTL_SECONDS?.trim();
  if (rawTtl) {
    const n = Number(rawTtl);
    if (!Number.isInteger(n) || n <= 0 || n > MAX_OPERATOR_SESSION_TTL_SECONDS) {
      return { ok: false, error: `CES_EO_OPERATOR_SESSION_TTL_SECONDS must be a whole number from 1 to ${MAX_OPERATOR_SESSION_TTL_SECONDS}` };
    }
    sessionTtlSeconds = n;
  }
  return { ok: true, config: { origin: url.origin, rpId, sessionTtlSeconds } };
}

const UPN_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeIdentity(displayName: unknown, upn: unknown): { displayName: string; upn: string } {
  if (typeof displayName !== 'string' || !displayName.trim()) {
    throw new PasskeyRefusal('operator_name_required', 400, 'the operator display name is required');
  }
  if (typeof upn !== 'string' || !UPN_RE.test(upn.trim()) || upn.trim().length > 256) {
    throw new PasskeyRefusal('operator_upn_invalid', 400,
      "the operator's own sign-in address (name@domain) is required; the no-self-issue mint rule compares against it");
  }
  return { displayName: displayName.trim().slice(0, 128), upn: upn.trim() };
}

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');
const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url');

/** The public view of a passkey (no public key). */
export interface OperatorPasskeyView {
  credentialId: string;
  operatorId: string;
  displayName: string;
  upn: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface OperatorSession {
  operator: OperatorIdentity;
  credentialId: string;
  issuedAt: number;
  expiresAt: number;
}

interface PendingChallenge {
  challenge: string;
  expiresAt: number;
}

export interface PasskeyOperatorServiceDeps {
  store?: PasskeyOperatorStore;
  /** Clock (epoch ms). */
  now?: () => number;
}

export class PasskeyOperatorService {
  readonly store: PasskeyOperatorStore;
  private readonly now: () => number;
  /** Enrollment challenges, keyed by the enrollment code's hash (one outstanding per code). */
  private readonly enrollChallenges = new Map<string, PendingChallenge>();
  /** Sign-in challenges, keyed by a random challenge id; single use. */
  private readonly signInChallenges = new Map<string, PendingChallenge>();
  /** Operator sessions, keyed by SHA-256 of the session token. */
  private readonly sessions = new Map<string, OperatorSession>();

  constructor(deps: PasskeyOperatorServiceDeps = {}) {
    this.store = deps.store ?? new PasskeyOperatorStore();
    this.now = deps.now ?? Date.now;
  }

  private iso(ms: number) { return new Date(ms).toISOString(); }

  private sweep() {
    const t = this.now();
    for (const m of [this.enrollChallenges, this.signInChallenges]) for (const [k, v] of m) if (v.expiresAt <= t) m.delete(k);
    for (const [k, s] of this.sessions) if (s.expiresAt <= t) this.sessions.delete(k);
  }

  // ---- enrollment codes ------------------------------------------------------------------------

  /**
   * Issue a one-time enrollment code (10 minutes) for an operator. An address that already has a
   * live passkey keeps its operator id (a second device); otherwise a new operator is created on
   * enrollment. Recorded as evidence. Returns the code (shown once) and the enrollment link.
   */
  issueEnrollmentCode(cfg: PasskeyOperatorConfig, input: { displayName: unknown; upn: unknown; issuedBy: EventActor }) {
    const { displayName, upn } = normalizeIdentity(input.displayName, input.upn);
    const existing = this.store.listPasskeys().find((p) => !p.revokedAt && p.upn.toLowerCase() === upn.toLowerCase());
    const operatorId = existing?.operatorId ?? randomUUID();
    const code = randomBytes(18).toString('base64url');
    const nowMs = this.now();
    const expiresAt = this.iso(nowMs + ENROLLMENT_CODE_TTL_SECONDS * 1000);
    const operator: OperatorIdentity = { operatorId, displayName, upn };
    this.store.addEnrollmentCode({ ...operator, codeHash: sha256hex(code), issuedAt: this.iso(nowMs), expiresAt, issuedBy: input.issuedBy });
    this.store.recordEvent({ kind: 'operator-enrollment-code-issued', at: this.iso(nowMs), operator, by: input.issuedBy, expiresAt });
    return { code, expiresAt, operatorId, link: `${cfg.origin}/approver-tokens.html#enroll=${code}` };
  }

  private liveCode(code: unknown) {
    if (typeof code !== 'string' || !code.trim()) {
      throw new PasskeyRefusal('enrollment_code_invalid', 401, 'an enrollment code is required');
    }
    const codeHash = sha256hex(code.trim());
    const rec = this.store.getEnrollmentCode(codeHash);
    if (!rec) throw new PasskeyRefusal('enrollment_code_invalid', 401, 'unknown enrollment code');
    if (rec.usedAt) throw new PasskeyRefusal('enrollment_code_used', 401, 'this enrollment code has already been used');
    if (Date.parse(rec.expiresAt) <= this.now()) {
      throw new PasskeyRefusal('enrollment_code_expired', 401, 'this enrollment code has expired; ask for a new one');
    }
    return { codeHash, rec };
  }

  /** Registration options for the operator named by the code. User verification required. */
  async enrollmentOptions(cfg: PasskeyOperatorConfig, code: unknown) {
    this.sweep();
    const { codeHash, rec } = this.liveCode(code);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: cfg.rpId,
      userName: rec.upn,
      userDisplayName: rec.displayName,
      userID: new Uint8Array(Buffer.from(rec.operatorId, 'utf8')),
      attestationType: 'none',
      timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: this.store.listPasskeys()
        .filter((p) => p.operatorId === rec.operatorId && !p.revokedAt)
        .map((p) => ({ id: p.credentialId, ...(p.transports ? { transports: p.transports } : {}) })),
    });
    this.enrollChallenges.set(codeHash, { challenge: options.challenge, expiresAt: this.now() + PASSKEY_CHALLENGE_TTL_SECONDS * 1000 });
    return options;
  }

  /** Verify the new passkey, store it, consume the code, record evidence. */
  async completeEnrollment(cfg: PasskeyOperatorConfig, code: unknown, response: unknown) {
    this.sweep();
    const { codeHash } = this.liveCode(code);
    const pending = this.enrollChallenges.get(codeHash);
    this.enrollChallenges.delete(codeHash); // single use, whatever the outcome
    if (!pending) throw new PasskeyRefusal('passkey_challenge_invalid', 401, 'no enrollment in progress for this code; start again');
    let info;
    try {
      const v = await verifyRegistrationResponse({
        response: response as any,
        expectedChallenge: pending.challenge,
        expectedOrigin: cfg.origin,
        expectedRPID: cfg.rpId,
        requireUserVerification: true,
      });
      if (!v.verified) throw new Error('registration not verified');
      info = v.registrationInfo;
    } catch (e) {
      throw new PasskeyRefusal('passkey_verification_failed', 401, `passkey registration refused: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Re-check and consume the code synchronously (no await between check and mark).
    const { rec } = this.liveCode(code);
    const credentialId = info.credential.id;
    if (this.store.getPasskey(credentialId)) {
      throw new PasskeyRefusal('passkey_already_registered', 409, 'this passkey is already registered');
    }
    const nowIso = this.iso(this.now());
    this.store.updateEnrollmentCode(codeHash, { usedAt: nowIso, credentialId });
    const operator: OperatorIdentity = { operatorId: rec.operatorId, displayName: rec.displayName, upn: rec.upn };
    this.store.addPasskey({
      ...operator,
      credentialId,
      publicKey: b64url(info.credential.publicKey),
      counter: info.credential.counter,
      ...(info.credential.transports ? { transports: info.credential.transports } : {}),
      createdAt: nowIso,
    });
    this.store.recordEvent({ kind: 'operator-passkey-enrolled', at: nowIso, operator, by: rec.issuedBy, credentialId });
    return { ...operator, credentialId };
  }

  // ---- sign-in ---------------------------------------------------------------------------------

  /** Authentication options with a single-use challenge. Discoverable credentials; UV required. */
  async signInOptions(cfg: PasskeyOperatorConfig) {
    this.sweep();
    const options = await generateAuthenticationOptions({
      rpID: cfg.rpId,
      userVerification: 'required',
      timeout: PASSKEY_CHALLENGE_TTL_SECONDS * 1000,
    });
    const challengeId = randomUUID();
    this.signInChallenges.set(challengeId, { challenge: options.challenge, expiresAt: this.now() + PASSKEY_CHALLENGE_TTL_SECONDS * 1000 });
    return { challengeId, options };
  }

  /** Verify an assertion and open a short-lived operator session. */
  async completeSignIn(cfg: PasskeyOperatorConfig, challengeId: unknown, response: unknown) {
    this.sweep();
    const pending = typeof challengeId === 'string' ? this.signInChallenges.get(challengeId) : undefined;
    if (typeof challengeId === 'string') this.signInChallenges.delete(challengeId); // single use
    if (!pending) throw new PasskeyRefusal('passkey_challenge_invalid', 401, 'unknown, used or expired sign-in challenge; start again');
    const credentialId = (response as { id?: unknown } | null)?.id;
    if (typeof credentialId !== 'string' || !credentialId) {
      throw new PasskeyRefusal('passkey_verification_failed', 401, 'the sign-in response names no passkey');
    }
    const stored = this.store.getPasskey(credentialId);
    if (!stored) throw new PasskeyRefusal('passkey_unknown', 401, 'this passkey is not registered as a BHD operator');
    if (stored.revokedAt) throw new PasskeyRefusal('passkey_revoked', 401, 'this passkey has been revoked');
    let newCounter: number;
    try {
      const v = await verifyAuthenticationResponse({
        response: response as any,
        expectedChallenge: pending.challenge,
        expectedOrigin: cfg.origin,
        expectedRPID: cfg.rpId,
        credential: {
          id: stored.credentialId,
          publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64url')),
          counter: stored.counter,
          ...(stored.transports ? { transports: stored.transports } : {}),
        },
        requireUserVerification: true,
      });
      if (!v.verified) throw new Error('assertion not verified');
      newCounter = v.authenticationInfo.newCounter;
    } catch (e) {
      throw new PasskeyRefusal('passkey_verification_failed', 401, `passkey sign-in refused: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Re-read after the await: a revocation that landed meanwhile wins.
    const current = this.store.getPasskey(credentialId);
    if (!current || current.revokedAt) throw new PasskeyRefusal('passkey_revoked', 401, 'this passkey has been revoked');
    if ((newCounter > 0 || current.counter > 0) && newCounter <= current.counter) {
      throw new PasskeyRefusal('passkey_verification_failed', 401, `passkey sign-in refused: signature counter ${newCounter} did not advance past ${current.counter}`);
    }
    const nowMs = this.now();
    this.store.updatePasskey(credentialId, { counter: newCounter, lastUsedAt: this.iso(nowMs) });
    const token = OPERATOR_SESSION_PREFIX + randomBytes(32).toString('base64url');
    const operator: OperatorIdentity = { operatorId: current.operatorId, displayName: current.displayName, upn: current.upn };
    const session: OperatorSession = { operator, credentialId, issuedAt: nowMs, expiresAt: nowMs + cfg.sessionTtlSeconds * 1000 };
    this.sessions.set(sha256hex(token), session);
    return { sessionToken: token, expiresAt: this.iso(session.expiresAt), operator, credentialId };
  }

  // ---- sessions --------------------------------------------------------------------------------

  /** Resolve a session token. Re-reads the passkey, so a revocation is effective immediately. */
  resolveSession(token: unknown): { ok: true; session: OperatorSession } | { ok: false; code: 'session_invalid' | 'session_expired' | 'passkey_revoked' } {
    if (typeof token !== 'string' || !token.startsWith(OPERATOR_SESSION_PREFIX)) return { ok: false, code: 'session_invalid' };
    const key = sha256hex(token);
    const s = this.sessions.get(key);
    if (!s) return { ok: false, code: 'session_invalid' };
    if (s.expiresAt <= this.now()) {
      this.sessions.delete(key);
      return { ok: false, code: 'session_expired' };
    }
    const pk = this.store.getPasskey(s.credentialId);
    if (!pk || pk.revokedAt) {
      this.sessions.delete(key);
      return { ok: false, code: 'passkey_revoked' };
    }
    return { ok: true, session: s };
  }

  endSession(token: unknown): void {
    if (typeof token === 'string') this.sessions.delete(sha256hex(token));
  }

  /** A PrincipalVerifier over operator sessions: an enrolled, unrevoked passkey => role bhd-operator. */
  verifier(): PrincipalVerifier {
    return {
      verify: (token: string) => {
        const r = this.resolveSession(token);
        if (!r.ok) return { ok: false as const, reason: r.code === 'session_expired' ? 'expired' as const : 'malformed' as const };
        const s = r.session;
        const principal: RequestPrincipal = Object.freeze({
          subjectId: `bhd-operator:${s.operator.operatorId}`,
          upn: s.operator.upn,
          displayName: s.operator.displayName,
          roles: Object.freeze([OPERATOR_ROLE]),
          verified: true,
          source: 'token' as const,
          expiresAt: Math.floor(s.expiresAt / 1000),
        });
        return { ok: true as const, principal };
      },
    };
  }

  // ---- list / revoke ---------------------------------------------------------------------------

  listPasskeys(): OperatorPasskeyView[] {
    return this.store.listPasskeys().map((p: OperatorPasskeyRecord) => ({
      credentialId: p.credentialId,
      operatorId: p.operatorId,
      displayName: p.displayName,
      upn: p.upn,
      createdAt: p.createdAt,
      ...(p.lastUsedAt ? { lastUsedAt: p.lastUsedAt } : {}),
      ...(p.revokedAt ? { revokedAt: p.revokedAt } : {}),
    }));
  }

  /** Revoke a passkey: no further sign-in, and its open sessions end now. Recorded as evidence. */
  revoke(credentialId: unknown, by: EventActor): OperatorPasskeyView {
    const p = typeof credentialId === 'string' ? this.store.getPasskey(credentialId) : undefined;
    if (!p) throw new PasskeyRefusal('passkey_unknown', 404, 'no such passkey');
    if (p.revokedAt) throw new PasskeyRefusal('passkey_revoked', 409, 'this passkey is already revoked');
    const at = this.iso(this.now());
    this.store.updatePasskey(p.credentialId, { revokedAt: at, revokedBy: by });
    for (const [k, s] of this.sessions) if (s.credentialId === p.credentialId) this.sessions.delete(k);
    this.store.recordEvent({
      kind: 'operator-passkey-revoked', at,
      operator: { operatorId: p.operatorId, displayName: p.displayName, upn: p.upn },
      by, credentialId: p.credentialId,
    });
    return this.listPasskeys().find((v) => v.credentialId === p.credentialId)!;
  }
}
