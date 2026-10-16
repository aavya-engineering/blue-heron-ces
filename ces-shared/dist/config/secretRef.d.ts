export declare class SecretRefError extends Error {
    constructor(message: string);
}
/** The env var name a value references, or null if the value is a literal (not a reference). */
export declare function secretRefName(value: string): string | null;
export declare function isSecretRef(value: unknown): boolean;
export interface ResolvedSecret {
    value: string;
    /** True if the input was a reference (vs a literal). */
    wasRef: boolean;
}
/**
 * Resolve a possibly-referenced secret. Literals return unchanged (wasRef=false). References
 * resolve from `env`; a reference whose env var is unset/empty throws (fail closed).
 */
export declare function resolveSecretRef(value: string, env?: Record<string, string | undefined>): ResolvedSecret;
/**
 * Resolve any referenced secret fields on a record in place-free fashion (returns a shallow copy).
 * Non-string / absent fields are left untouched. Throws if a referenced field can't resolve.
 */
export declare function resolveSecretFields<T extends Record<string, unknown>>(record: T, fields: ReadonlyArray<keyof T>, env?: Record<string, string | undefined>): T;
/**
 * Strict guard (opt-in): throws if any designated secret field holds an inline literal rather than
 * a reference. Use in hardened deployments that forbid inline secrets entirely.
 */
export declare function assertNoInlineSecrets<T extends Record<string, unknown>>(record: T, fields: ReadonlyArray<keyof T>): void;
//# sourceMappingURL=secretRef.d.ts.map