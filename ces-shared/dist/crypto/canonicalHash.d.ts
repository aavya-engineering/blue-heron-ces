/**
 * Deterministic JSON serialization: object keys sorted recursively. For a value with no objects
 * (string/number/array-of-scalars) this equals JSON.stringify, so it is back-compatible for those.
 */
export declare function canonicalJsonStringify(value: unknown): string;
/** SHA-256 (lowercase hex) of the canonical JSON form of `value` — order-stable object hashing. */
export declare function canonicalSha256(value: unknown): string;
//# sourceMappingURL=canonicalHash.d.ts.map