// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-31 (closes LOG-FIN-12 open item 2): HTTP surface of the EC uploader-token issuer.
//
//   GET  /api/uploader-tokens/config               public: is the issuer configured, which operator
//                                                  sign-in mode, the TTL limits (no secrets)
//   POST /api/uploader-tokens?tenant=<slug>        body { uploaderUpn, uploaderDisplayName?, ttlSeconds? }
//   GET  /api/uploader-tokens/mints?tenant=<slug>  this tenant's mint evidence (never tokens)
//
// Tokens gate access, as the approver-token issuer does (approver-token-router.ts): the mint and
// mint-list routes need a BHD operator in `x-ces-principal` — a passkey operator session (loopback,
// FC-EO-G), a validated Entra ID token (FC-EO-E), or the loopback-only HS256 dev fallback. EO's
// service bearer (authMiddleware) still runs in front. The passkey service MUST be the same instance
// the approver-token router uses (sessions are in memory), so EoServer passes one to both.

import express, { type Request, type Response, type NextFunction } from 'express';
import { requirePrincipal, getRequestPrincipal, type PrincipalVerifier } from 'ces-shared/http/principal';
import { isLoopbackRequest } from 'ces-shared/http';
import { secretEnv } from 'ces-shared/secrets';
import { resolveTenantScope } from '../tenant-resolve.js';
import {
  ApproverTokenRefusal,
  BHD_OPERATOR_ROLE,
  operatorAuthFromEnv,
  type OperatorAuth,
} from '../../approver-tokens/ApproverTokenIssuer.js';
import {
  EntraSigningKeyStore,
  createEntraOperatorVerifier,
  defaultFetchJson,
  peekKid,
  type FetchJson,
} from '../../approver-tokens/EntraOperatorVerifier.js';
import { PasskeyOperatorService } from '../../approver-tokens/PasskeyOperatorService.js';
import {
  DEFAULT_UPLOADER_TOKEN_TTL_SECONDS,
  MAX_UPLOADER_TOKEN_TTL_SECONDS,
  mintUploaderToken,
  uploaderIssuerConfigured,
} from '../../uploader-tokens/UploaderTokenIssuer.js';
import { UploaderTokenMintLog } from '../../uploader-tokens/UploaderTokenMintLog.js';

export interface UploaderTokenRouterDeps {
  stamperRoot: string;
  env?: Record<string, string | undefined>;
  mintLog?: UploaderTokenMintLog;
  now?: () => number;
  fetchJson?: FetchJson;
  /** The SAME instance the approver-token router uses (passkey sessions live in memory). */
  passkeys?: PasskeyOperatorService;
}

const OPERATOR_HEADER = 'x-ces-principal';
const AUTH_MODE = new WeakMap<object, OperatorAuth['mode']>();
const PASSKEY_SESSION = new WeakMap<object, { credentialId: string }>();

export function createUploaderTokenRouter(deps: UploaderTokenRouterDeps): express.Router {
  const router = express.Router();
  const env = () => deps.env ?? secretEnv();
  const mintLog = deps.mintLog ?? new UploaderTokenMintLog();
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
  const refuse = (res: Response, e: ApproverTokenRefusal) => res.status(e.status).json({ error: e.code, detail: e.message });

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
      if (!isLoopbackRequest(req as any)) {
        return res.status(403).json({ error: 'passkey_not_loopback', detail: 'passkey operator sign-in and the issuers it unlocks are on-box only (loopback requests)' });
      }
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
    requirePrincipal({
      verifier,
      header: OPERATOR_HEADER,
      apiPrefix: '/',
      requiredRoles: [BHD_OPERATOR_ROLE],
      service: 'evidenceops uploader-token issuer',
    })(req as any, res as any, next);
  };

  const scopeOf = (req: Request, res: Response) => {
    const scope = resolveTenantScope(req.query.tenant, deps.stamperRoot);
    if (!scope.ok) {
      res.status(scope.status).json({ error: scope.status === 404 ? 'tenant_unknown' : 'tenant_required', detail: scope.message });
      return null;
    }
    return scope;
  };

  router.get('/api/uploader-tokens/config', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    let operatorAuth: string;
    try {
      operatorAuth = operatorAuthFromEnv(env()).mode;
    } catch {
      operatorAuth = 'not_configured';
    }
    res.json({
      issuerConfigured: uploaderIssuerConfigured(env()),
      operatorAuth,
      defaultTtlSeconds: DEFAULT_UPLOADER_TOKEN_TTL_SECONDS,
      maxTtlSeconds: MAX_UPLOADER_TOKEN_TTL_SECONDS,
    });
  });

  router.post('/api/uploader-tokens', requireOperator, (req: Request, res: Response) => {
    const scope = scopeOf(req, res);
    if (!scope) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mode = AUTH_MODE.get(req);
    try {
      const minted = mintUploaderToken(
        {
          operator: getRequestPrincipal(req),
          tenant: { slug: scope.slug, tenantId: scope.tenantId },
          uploaderUpn: body.uploaderUpn,
          uploaderDisplayName: body.uploaderDisplayName,
          ttlSeconds: body.ttlSeconds,
          ...(mode === 'entra' ? { operatorAuthMode: 'entra' as const } : {}),
          ...(mode === 'passkey' ? { operatorAuthMode: 'passkey' as const, operatorCredentialId: PASSKEY_SESSION.get(req)?.credentialId } : {}),
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

  router.get('/api/uploader-tokens/mints', requireOperator, (req: Request, res: Response) => {
    const scope = scopeOf(req, res);
    if (!scope) return;
    res.json({ tenant: scope.slug, mints: mintLog.list({ slug: scope.slug, tenantId: scope.tenantId }) });
  });

  return router;
}
