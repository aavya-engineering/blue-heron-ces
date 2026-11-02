// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-EO-C AO-16 (2026-09-27): tenant-scoped HTTP surface of the AdminOps approver-token issuer.
// FC-EO-E (2026-09-28): operators now sign in with Microsoft Entra ID.
//
//   GET  /api/approver-tokens/config                 public sign-in settings for the issuer page (no secrets)
//   POST /api/approver-tokens?tenant=<slug>          body { approverUpn, approverDisplayName?, ttlSeconds? }
//   GET  /api/approver-tokens/mints?tenant=<slug>    this tenant's mint evidence (never tokens)
//
// The mint and mint-list routes require a BHD operator: header `x-ces-principal: <Entra ID token>`
// from BHD's operator tenant, validated by EntraOperatorVerifier (RS256 signature against the
// tenant's signing keys, issuer, audience, expiry, tenant), with the operator group in `groups`
// (-> role `bhd-operator`). The previous HS256 CES_EO_OPERATOR_SECRET token is accepted ONLY when
// CES_EO_OPERATOR_DEV_FALLBACK=1, no Entra setting is present, and the request is loopback; such
// mints are recorded as `dev-hs256-unverified`. EO's service-level bearer auth (authMiddleware)
// still runs in front of this; it identifies the service, not the operator.
//
// FC-EO-G (2026-09-28, founder decisions 16-19): BHD has no Microsoft tenant, so operators sign in
// with passkeys registered on the EO machine (CES_EO_OPERATOR_PASSKEY_ORIGIN turns it on). In that
// mode every route here is loopback-only (the issuer page stays on-box), and `x-ces-principal`
// carries a short-lived operator session from a passkey sign-in instead of an Entra token:
//
//   POST   /api/approver-tokens/passkeys/enroll/options      body { code }              (the code is the credential)
//   POST   /api/approver-tokens/passkeys/enroll/verify       body { code, response }
//   POST   /api/approver-tokens/passkeys/signin/options      -> { challengeId, options }
//   POST   /api/approver-tokens/passkeys/signin/verify       body { challengeId, response } -> operator session
//   POST   /api/approver-tokens/passkeys/signout             (operator session)
//   GET    /api/approver-tokens/passkeys                     (operator) list passkeys (never public keys)
//   POST   /api/approver-tokens/passkeys/enrollment-codes    (operator) body { displayName, upn } -> one-time code
//   DELETE /api/approver-tokens/passkeys/:credentialId       (operator) revoke, effective immediately

import express, { type Request, type Response, type NextFunction } from 'express';
import { requirePrincipal, getRequestPrincipal, type PrincipalVerifier } from 'ces-shared/http/principal';
import { isLoopbackRequest } from 'ces-shared/http';
import { resolveTenantScope } from '../tenant-resolve.js';
import {
  ApproverTokenRefusal,
  BHD_OPERATOR_ROLE,
  DEFAULT_APPROVER_TOKEN_TTL_SECONDS,
  MAX_APPROVER_TOKEN_TTL_SECONDS,
  mintApproverToken,
  operatorAuthFromEnv,
  type OperatorAuth,
} from '../../approver-tokens/ApproverTokenIssuer.js';
import { ApproverTokenMintLog } from '../../approver-tokens/ApproverTokenMintLog.js';
import {
  EntraSigningKeyStore,
  createEntraOperatorVerifier,
  defaultFetchJson,
  peekKid,
  type FetchJson,
} from '../../approver-tokens/EntraOperatorVerifier.js';
import {
  PasskeyOperatorService,
  PasskeyRefusal,
  type PasskeyOperatorConfig,
} from '../../approver-tokens/PasskeyOperatorService.js';

export interface ApproverTokenRouterDeps {
  /** Stamper root, for slug -> tenant GUID resolution (registry first). */
  stamperRoot: string;
  /** Environment (default process.env), read per request so a rotation needs no restart. */
  env?: Record<string, string | undefined>;
  /** Evidence log (default: the shared CES repository). */
  mintLog?: ApproverTokenMintLog;
  now?: () => number;
  /** Fetches the operator tenant's signing keys (JWKS). Default: global fetch. Tests inject a local one. */
  fetchJson?: FetchJson;
  /** FC-EO-G: passkey operator sign-in (default: one over the shared CES repository). */
  passkeys?: PasskeyOperatorService;
}

function refuse(res: Response, e: ApproverTokenRefusal | PasskeyRefusal) {
  res.status(e.status).json({ error: e.code, detail: e.message });
}

const OPERATOR_HEADER = 'x-ces-principal';

/** Per-request operator auth outcome, kept off the request object. */
const AUTH_MODE = new WeakMap<object, OperatorAuth['mode']>();
/** Per-request passkey session (FC-EO-G), kept off the request object. */
const PASSKEY_SESSION = new WeakMap<object, { credentialId: string }>();

export function createApproverTokenRouter(deps: ApproverTokenRouterDeps): express.Router {
  const router = express.Router();
  const env = () => deps.env ?? process.env;
  const mintLog = deps.mintLog ?? new ApproverTokenMintLog();
  const passkeys = deps.passkeys ?? new PasskeyOperatorService();
  const keyStores = new Map<string, EntraSigningKeyStore>();
  const keyStoreFor = (jwksUri: string) => {
    let ks = keyStores.get(jwksUri);
    if (!ks) {
      ks = new EntraSigningKeyStore(jwksUri, deps.fetchJson ?? defaultFetchJson, deps.now ? { now: deps.now } : {});
      keyStores.set(jwksUri, ks);
    }
    return ks;
  };

  /** Operator authentication: Entra ID (or the explicit loopback dev fallback) + the bhd-operator role. */
  const requireOperator = async (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    let auth: OperatorAuth;
    try {
      auth = operatorAuthFromEnv(env());
    } catch (e) {
      if (e instanceof ApproverTokenRefusal) return refuse(res, e);
      return next(e);
    }

    let verifier: PrincipalVerifier;
    if (auth.mode === 'entra') {
      const store = keyStoreFor(auth.config.jwksUri);
      const kid = peekKid(String(req.headers[OPERATOR_HEADER] ?? ''));
      if (kid) {
        try {
          await store.ensureKey(kid);
        } catch {
          return refuse(res, new ApproverTokenRefusal('operator_keys_unavailable', 503,
            'the operator tenant signing keys could not be loaded; try again shortly'));
        }
      }
      verifier = createEntraOperatorVerifier(auth.config, store, deps.now ? { now: deps.now } : {});
    } else if (auth.mode === 'passkey') {
      if (!isLoopbackRequest(req as any)) return refuse(res, notLoopback());
      const s = passkeys.resolveSession(String(req.headers[OPERATOR_HEADER] ?? '').trim());
      if (!s.ok) return res.status(401).json({ error: 'unauthorized', reason: s.code });
      PASSKEY_SESSION.set(req, { credentialId: s.session.credentialId });
      verifier = passkeys.verifier();
    } else {
      if (!isLoopbackRequest(req as any)) {
        return refuse(res, new ApproverTokenRefusal('dev_operator_not_loopback', 403,
          'the dev operator fallback (CES_EO_OPERATOR_DEV_FALLBACK) accepts loopback requests only'));
      }
      verifier = auth.verifier;
    }

    AUTH_MODE.set(req, auth.mode);
    const guard = requirePrincipal({
      verifier,
      header: OPERATOR_HEADER,
      apiPrefix: '/', // guard every request routed here, whatever the mount path
      requiredRoles: [BHD_OPERATOR_ROLE],
      service: 'evidenceops approver-token issuer',
    });
    guard(req as any, res as any, next);
  };

  /** Passkey routes: passkey mode configured, and loopback only. Returns the config or answers the request. */
  const passkeyConfig = (req: Request, res: Response): PasskeyOperatorConfig | null => {
    res.setHeader('Cache-Control', 'no-store');
    let auth: OperatorAuth;
    try {
      auth = operatorAuthFromEnv(env());
    } catch (e) {
      if (e instanceof ApproverTokenRefusal) { refuse(res, e); return null; }
      throw e;
    }
    if (auth.mode !== 'passkey') {
      res.status(404).json({ error: 'passkey_sign_in_not_enabled', detail: 'passkey operator sign-in is not the configured mode on this server' });
      return null;
    }
    if (!isLoopbackRequest(req as any)) { refuse(res, notLoopback()); return null; }
    return auth.config;
  };

  /** The operator acting through a passkey session (after requireOperator). */
  const passkeyActor = (req: Request) => {
    const p = getRequestPrincipal(req)!;
    const s = PASSKEY_SESSION.get(req);
    return { kind: 'operator' as const, operatorId: p.subjectId.replace(/^bhd-operator:/, ''), upn: p.upn, credentialId: s?.credentialId ?? '' };
  };

  const handle = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await fn(req, res);
      } catch (e) {
        if (e instanceof PasskeyRefusal || e instanceof ApproverTokenRefusal) return refuse(res, e);
        next(e);
      }
    };

  const requirePasskeyOperator = (req: Request, res: Response, next: NextFunction) => {
    if (!passkeyConfig(req, res)) return;
    return requireOperator(req, res, next);
  };

  const scopeOf = (req: Request, res: Response) => {
    const scope = resolveTenantScope(req.query.tenant, deps.stamperRoot);
    if (!scope.ok) {
      res.status(scope.status).json({ error: scope.status === 404 ? 'tenant_unknown' : 'tenant_required', detail: scope.message });
      return null;
    }
    return scope;
  };

  // Public: what the issuer page needs to start an Entra sign-in. Tenant id and client id are not secrets.
  router.get('/api/approver-tokens/config', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const limits = { defaultTtlSeconds: DEFAULT_APPROVER_TOKEN_TTL_SECONDS, maxTtlSeconds: MAX_APPROVER_TOKEN_TTL_SECONDS };
    try {
      const auth = operatorAuthFromEnv(env());
      if (auth.mode === 'entra') {
        const c = auth.config;
        return res.json({
          mode: 'entra',
          entra: {
            tenantId: c.tenantId,
            clientId: c.clientId,
            authorityHost: c.authorityHost,
            authorizeUrl: `https://${c.authorityHost}/${c.tenantId}/oauth2/v2.0/authorize`,
            tokenUrl: `https://${c.authorityHost}/${c.tenantId}/oauth2/v2.0/token`,
            scopes: ['openid', 'profile'],
          },
          ...limits,
        });
      }
      if (auth.mode === 'passkey') {
        return res.json({
          mode: 'passkey',
          passkey: { rpId: auth.config.rpId, origin: auth.config.origin, sessionTtlSeconds: auth.config.sessionTtlSeconds },
          ...limits,
        });
      }
      return res.json({ mode: 'dev-hs256', devFallback: true, ...limits });
    } catch (e) {
      if (e instanceof ApproverTokenRefusal) return res.json({ mode: 'not_configured', error: e.code, detail: e.message, ...limits });
      throw e;
    }
  });

  router.post('/api/approver-tokens', requireOperator, (req: Request, res: Response) => {
    const scope = scopeOf(req, res);
    if (!scope) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mode = AUTH_MODE.get(req);
    try {
      const minted = mintApproverToken(
        {
          operator: getRequestPrincipal(req),
          tenant: { slug: scope.slug, tenantId: scope.tenantId },
          approverUpn: body.approverUpn,
          approverDisplayName: body.approverDisplayName,
          ttlSeconds: body.ttlSeconds,
          ...(mode === 'entra' ? { operatorAuthMode: 'entra' as const } : {}),
          ...(mode === 'passkey' ? { operatorAuthMode: 'passkey' as const, operatorCredentialId: PASSKEY_SESSION.get(req)?.credentialId } : {}),
          // Only reachable for the dev mode after the loopback check above.
          allowDevOperator: mode === 'dev-hs256' && isLoopbackRequest(req as any),
        },
        { env: env(), evidence: mintLog, ...(deps.now ? { now: deps.now } : {}) },
      );
      res.status(201).json(minted);
    } catch (e) {
      if (e instanceof ApproverTokenRefusal) return refuse(res, e);
      throw e;
    }
  });

  router.get('/api/approver-tokens/mints', requireOperator, (req: Request, res: Response) => {
    const scope = scopeOf(req, res);
    if (!scope) return;
    res.json({ tenant: scope.slug, mints: mintLog.list({ slug: scope.slug, tenantId: scope.tenantId }) });
  });

  // ---- FC-EO-G: passkey operator sign-in -------------------------------------------------------

  router.post('/api/approver-tokens/passkeys/enroll/options', handle(async (req, res) => {
    const cfg = passkeyConfig(req, res);
    if (!cfg) return;
    res.json(await passkeys.enrollmentOptions(cfg, (req.body ?? {}).code));
  }));

  router.post('/api/approver-tokens/passkeys/enroll/verify', handle(async (req, res) => {
    const cfg = passkeyConfig(req, res);
    if (!cfg) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.status(201).json(await passkeys.completeEnrollment(cfg, body.code, body.response));
  }));

  router.post('/api/approver-tokens/passkeys/signin/options', handle(async (req, res) => {
    const cfg = passkeyConfig(req, res);
    if (!cfg) return;
    res.json(await passkeys.signInOptions(cfg));
  }));

  router.post('/api/approver-tokens/passkeys/signin/verify', handle(async (req, res) => {
    const cfg = passkeyConfig(req, res);
    if (!cfg) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(await passkeys.completeSignIn(cfg, body.challengeId, body.response));
  }));

  router.post('/api/approver-tokens/passkeys/signout', requirePasskeyOperator, (req: Request, res: Response) => {
    passkeys.endSession(String(req.headers[OPERATOR_HEADER] ?? '').trim());
    res.status(204).end();
  });

  router.get('/api/approver-tokens/passkeys', requirePasskeyOperator, (_req: Request, res: Response) => {
    res.json({ passkeys: passkeys.listPasskeys() });
  });

  router.post('/api/approver-tokens/passkeys/enrollment-codes', requirePasskeyOperator, handle((req, res) => {
    const cfg = passkeyConfig(req, res);
    if (!cfg) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.status(201).json(passkeys.issueEnrollmentCode(cfg, { displayName: body.displayName, upn: body.upn, issuedBy: passkeyActor(req) }));
  }));

  router.delete('/api/approver-tokens/passkeys/:credentialId', requirePasskeyOperator, handle((req, res) => {
    res.json({ revoked: passkeys.revoke(req.params.credentialId, passkeyActor(req)) });
  }));

  return router;
}

function notLoopback() {
  return new PasskeyRefusal('passkey_not_loopback', 403,
    'passkey operator sign-in and the issuer it unlocks are on-box only (loopback requests)');
}
