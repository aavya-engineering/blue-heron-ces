import { type AuthRequest, type AuthResponse } from './bearerAuth.js';
/** Version of the request-principal surface (shape of RequestPrincipal + token claims). */
export declare const REQUEST_PRINCIPAL_VERSION = "1.1.0";
/** Default header carrying the per-user principal token. */
export declare const DEFAULT_PRINCIPAL_HEADER = "x-ces-principal";
export interface RequestPrincipal {
    /** Stable subject id (Entra `oid`, else `sub`). */
    readonly subjectId: string;
    /** User principal name / login (Entra `upn`, else `preferred_username`). */
    readonly upn: string;
    readonly displayName?: string;
    readonly roles: readonly string[];
    /** Tenant id claim (`tid`) when present. */
    readonly tenantId?: string;
    /** True only when the principal was proven by a verifier. False for the explicit dev principal. */
    readonly verified: boolean;
    /** Where the principal came from. */
    readonly source: 'token' | 'dev-unverified';
    /** Token expiry (epoch seconds), when verified from a token. */
    readonly expiresAt?: number;
    /**
     * The token's id (`jti`), when present. FC-SH step 2 (REQ-ces-shared-principal-token-id, ces-ao
     * FC-AO-2): lets a verifier (e.g. AdminOps approver-token consumers) link a decision back to the
     * EvidenceOps mint record it came from, without decoding the JWT a second time. Never set for a
     * dev-unverified principal.
     */
    readonly tokenId?: string;
}
export type PrincipalVerifyFailure = 'malformed' | 'bad_signature' | 'unsupported_alg' | 'expired' | 'not_yet_valid' | 'wrong_issuer' | 'wrong_audience' | 'missing_claims';
export type PrincipalVerifyResult = {
    ok: true;
    principal: RequestPrincipal;
} | {
    ok: false;
    reason: PrincipalVerifyFailure;
};
/** Pluggable verifier. The HS256 one below is local-only; an Entra verifier can implement the same shape. */
export interface PrincipalVerifier {
    verify(token: string): PrincipalVerifyResult;
}
export interface Hs256VerifierOptions {
    /** Shared HMAC secret. Must be non-empty (at least 16 chars). */
    secret: string;
    /** If set, the token's `iss` must equal it. */
    issuer?: string;
    /** If set, the token's `aud` (string or array) must contain it. */
    audience?: string;
    /** Allowed clock skew for exp/nbf, seconds. Default 30. */
    clockSkewSeconds?: number;
    /** Clock (epoch ms). Default Date.now. Injectable for tests. */
    now?: () => number;
}
export interface PrincipalClaims {
    sub: string;
    oid?: string;
    upn?: string;
    preferred_username?: string;
    name?: string;
    roles?: string[];
    tid?: string;
    jti?: string;
    iss?: string;
    aud?: string | string[];
    exp?: number;
    nbf?: number;
    iat?: number;
}
/**
 * Sign a principal token (HS256, JWT-shaped). For local issuers, dev tooling and tests — it requires the same
 * secret the verifier holds, so it is not a bypass. `ttlSeconds` (default 3600) sets `exp` from `now`.
 */
export declare function signPrincipalToken(claims: PrincipalClaims, opts: {
    secret: string;
    ttlSeconds?: number;
    now?: () => number;
}): string;
/** Local-only HS256 verifier. Algorithm is pinned: any header alg other than HS256 (incl. `none`) is rejected. */
export declare function createHs256PrincipalVerifier(opts: Hs256VerifierOptions): PrincipalVerifier;
export interface DevPrincipalConfig {
    subjectId: string;
    upn: string;
    displayName?: string;
    roles?: string[];
}
export interface RequirePrincipalOptions {
    /** Verifier for principal tokens. Omit only together with devPrincipal (or to refuse everything). */
    verifier?: PrincipalVerifier;
    /**
     * EXPLICIT local-dev principal. Applied only to loopback requests that carry no principal token; marked
     * `verified: false, source: 'dev-unverified'`. Never set this in a deployed configuration.
     */
    devPrincipal?: DevPrincipalConfig;
    /** Header carrying the principal token. Default `x-ces-principal`. Value may be the raw token or `Bearer <token>`. */
    header?: string;
    /** Path prefix to guard. Default '/api/'. Other paths pass through with no principal attached. */
    apiPrefix?: string;
    /** If set, the principal must hold at least one of these roles (else 403). */
    requiredRoles?: string[];
    /** Service name, for messages. */
    service?: string;
}
export type RequirePrincipalMiddleware = (req: AuthRequest, res: AuthResponse, next: () => void) => void;
/** The verified (or explicitly dev) principal attached by requirePrincipal, or undefined. Never reads req fields. */
export declare function getRequestPrincipal(req: object): RequestPrincipal | undefined;
/** True if the request's principal holds `role`. */
export declare function principalHasRole(req: object, role: string): boolean;
/** Express-compatible middleware that authenticates the per-user principal. See the model at the top of this file. */
export declare function requirePrincipal(opts: RequirePrincipalOptions): RequirePrincipalMiddleware;
/** One-line description of the principal posture, for a startup log. */
export declare function principalPostureLine(opts: RequirePrincipalOptions): string;
//# sourceMappingURL=requestPrincipal.d.ts.map