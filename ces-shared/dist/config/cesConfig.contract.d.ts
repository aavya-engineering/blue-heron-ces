/**
 * The CES identity block carried on cross-subsystem outputs (Stamper plans/evidence, EO
 * assessment/SSP/POA&M, AO evidence). All fields optional — each subsystem fills what it knows.
 * See docs/adr/ADR-001-ces-identity-model.md.
 */
export interface CesIdentity {
    cesId?: string;
    customerId?: number;
    siBaselineId?: number;
    customerName?: string;
    tenantSlug?: string;
    tenantId?: string;
}
/** Binds one Planner customer to one Stamper/EO tenant. customerName is the stable cross-system key. */
export interface CesCustomerBinding {
    /** Planner customer name (matches the on-disk customers/<name> directory). */
    customerName: string;
    /** Planner Dexie customer id, when known. Optional — name is authoritative across systems. */
    customerId?: number;
    /** Stamper/EO directory key (e.g. "contoso"). */
    tenantSlug: string;
    /** Azure tenant GUID, when known. */
    tenantId?: string;
}
export interface CesConfigDefaults {
    /** e.g. 'gcc_high' | 'gcc' | 'commercial'. */
    cloudEnvironment?: string;
}
export interface CesConfig {
    /** Config schema version. */
    version: string;
    /** Optional pipeline-root override. The CES_PIPELINE_ROOT env var still takes precedence. */
    pipelineRoot?: string;
    /** Customer↔tenant bindings. */
    customers: CesCustomerBinding[];
    defaults?: CesConfigDefaults;
}
/** The config used when no file is present: empty bindings, current schema version. */
export declare const EMPTY_CES_CONFIG: CesConfig;
/** Env var that points at an explicit CES config file path. */
export declare const CES_CONFIG_PATH_ENV = "CES_CONFIG_PATH";
/** Default config filename, resolved under the pipeline root by the node loader. */
export declare const CES_CONFIG_FILENAME = "ces.config.json";
export declare class CesConfigError extends Error {
    constructor(message: string);
}
/**
 * Validate a parsed object into a CesConfig. Throws CesConfigError on any structural problem,
 * including duplicate tenantSlug or customerName (the bindings must be unambiguous in both
 * directions so the tuple resolves deterministically).
 */
export declare function validateCesConfig(raw: unknown): CesConfig;
export declare function findBindingByCustomerName(config: CesConfig, customerName: string): CesCustomerBinding | undefined;
export declare function findBindingByCustomerId(config: CesConfig, customerId: number): CesCustomerBinding | undefined;
export declare function findBindingByTenantSlug(config: CesConfig, tenantSlug: string): CesCustomerBinding | undefined;
/** Resolve a tenantSlug from a customer key (id preferred, else name). */
export declare function resolveTenantSlug(config: CesConfig, key: {
    customerId?: number;
    customerName?: string;
}): string | undefined;
/**
 * Resolve a CES identity block for a tenant being processed by a downstream subsystem (EO/AO),
 * using the customer↔tenant binding. Matches by tenantSlug first, else tenantId. Returns the
 * identity recoverable from config (customerName/customerId/tenantSlug/tenantId); cesId/siBaselineId
 * are not in the config map and stay undefined here. Always echoes the input tenantSlug/tenantId.
 */
export declare function resolveCesIdentity(config: CesConfig, key: {
    tenantSlug?: string;
    tenantId?: string;
}): CesIdentity;
/**
 * Pipeline-root precedence: env (CES_PIPELINE_ROOT) → config.pipelineRoot → undefined
 * (callers fall back to their platform default). Pure: env value is passed in.
 */
export declare function resolvePipelineRoot(config: CesConfig, envPipelineRoot: string | undefined): string | undefined;
//# sourceMappingURL=cesConfig.contract.d.ts.map