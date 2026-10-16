export interface EvidenceStorageConfig {
    account_name: string;
    account_key: string;
    container: string;
    base_path: string;
    blob_endpoint: string;
}
/** In-scope boundary for a CMMC assessment (GP-SHARED-M0-1, filed by ces-ao G-AO-CMMC-BOUND-1 M0). */
export interface AssessmentScope {
    subscriptionIds?: string[];
    resourceGroups?: string[];
    ous?: string[];
}
/** CUI boundary: resource allowlist or tag-based match, consumed by ces-ao ParameterMapper. */
export interface CuiBoundary {
    resourceAllowlist?: string[];
    tagKey?: string;
    tagValue?: string;
}
export interface TenantConfig {
    tenantSlug: string;
    tenantId: string;
    appId: string;
    certPath: string;
    certThumbprint: string;
    domain: string;
    endpoints: {
        graph: string;
        login: string;
        compliance_uri?: string;
        exchange_env?: string;
        azure_auth?: string;
        arm?: string;
    };
    subscription?: {
        subscription_id: string;
        resource_group: string;
        location: string;
    };
    subscriptionId?: string;
    resources?: Record<string, string>;
    evidenceStorage?: EvidenceStorageConfig;
    /**
     * Optional for backward compatibility: absent ⇒ pre-migration tenant. Consumers (ces-ao
     * CmmcScopeGate) fail open with a warning during Phase 1 and fail closed in Phase 2.
     */
    cmmcLevel?: 'L1' | 'L2';
    assessmentScope?: AssessmentScope;
    cuiBoundary?: CuiBoundary;
    clientName?: string;
    /**
     * G4: active stack id (multi-stack selector). Reuses this existing config seam — no parallel
     * selector. Absent ⇒ the Microsoft/GCC High reference stack (DEFAULT_STACK_ID).
     */
    stack?: string;
    /**
     * @deprecated Fallback only. Prefer infrastructure_model from Infrastructure Manifest artifact when available.
     * For CMMC scoping, superseded by assessmentScope/cuiBoundary (G-AO-CMMC-BOUND-1 G6).
     */
    infrastructure_model?: 'm365_only' | 'm365_sentinel' | 'm365_azure';
    /** For CMMC scoping, superseded by assessmentScope/cuiBoundary (G-AO-CMMC-BOUND-1 G6). */
    excluded_entries?: string[];
    targetTenantDomain?: string;
}
/**
 * Replaces {placeholder} tokens in an endpoint string with values from
 * TenantConfig.resources. Unresolved placeholders are left as-is.
 */
export declare function resolveEndpointVariables(endpoint: string, resources: Record<string, string>): string;
/**
 * Load and parse a tenant JSON file (e.g. ./plan-data/vfsgov/vfsgov.json).
 * Returns a typed TenantConfig with the fields both EC and EO need,
 * plus optional Stamper-specific fields.
 */
export declare function loadTenantConfig(filePath: string): TenantConfig;
/**
 * Resolve the path to a tenant JSON file by slug.
 * Convention: ./plan-data/<slug>/<slug>.json relative to projectRoot.
 * Falls back to legacy ~/.stamper/tenants/<slug>/<slug>.json (read-only) with warning.
 */
export declare function resolveTenantJsonPath(slug: string, projectRoot: string): string;
//# sourceMappingURL=TenantConfig.d.ts.map