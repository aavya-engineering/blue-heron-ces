export interface AuthRequest {
    path?: string;
    method?: string;
    headers?: Record<string, string | string[] | undefined>;
    /** Express's per-header accessor; used as a fallback when `headers` is absent. */
    header?: (name: string) => string | undefined;
    query?: Record<string, unknown>;
    body?: unknown;
    ip?: string;
    socket?: {
        remoteAddress?: string;
    };
}
export interface AuthResponse {
    status(code: number): AuthResponse;
    json(body: unknown): void;
}
/** The Express-compatible middleware returned by createBearerAuthMiddleware. */
export type BearerAuthMiddleware = (req: AuthRequest, res: AuthResponse, next: () => void) => void;
export interface BearerAuthOptions {
    /** Required bearer token. Empty/undefined ⇒ dev mode (loopback-only, no token required). */
    token?: string;
    /** Optional: only allow requests whose tenant (query `tenant` or body `tenantSlug`) matches. */
    tenant?: string;
    /** Service name, for messages. */
    service?: string;
    /** Path prefix to guard. Default '/api/'. */
    apiPrefix?: string;
}
/** True if the request originates from the loopback interface. */
export declare function isLoopbackRequest(req: AuthRequest): boolean;
/**
 * Express-compatible middleware factory. See the security model at the top of this file.
 */
export declare function createBearerAuthMiddleware(opts: BearerAuthOptions): BearerAuthMiddleware;
/** One-line description of the current auth posture, for a startup log. */
export declare function authPostureLine(opts: BearerAuthOptions): string;
//# sourceMappingURL=bearerAuth.d.ts.map