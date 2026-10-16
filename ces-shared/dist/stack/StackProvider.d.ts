export type StackId = string;
/** Cloud service endpoints for a stack's APIs (Microsoft GCC High differs from commercial, etc.). */
export interface StackCloudEndpoints {
    graph: string;
    login: string;
    exchange?: string;
    arm?: string;
    compliance?: string;
}
/** Infra/identity conventions a stack assumes (naming, default region, identity model). */
export interface StackConventions {
    /** e.g. 'gcc_high' | 'gcc' | 'commercial'. */
    cloudEnvironment: string;
    /** Default deployment region, e.g. 'usgovvirginia'. */
    defaultLocation: string;
    /** Identity platform, e.g. 'entra-id'. */
    identityModel: string;
    /** Infrastructure-model variants this stack supports (reuses the existing G1/G2 selector). */
    infrastructureModels: string[];
}
/**
 * The capability contract a stack MUST supply to be registered (DONE-WHEN #3). All values are
 * references/metadata (ids, endpoints, conventions) — the stack's actual domain content lives behind
 * those ids and is authored separately (capability, not content).
 */
export interface StackCapabilities {
    id: StackId;
    displayName: string;
    cloudEndpoints: StackCloudEndpoints;
    /** Id of the control→signal registry this stack uses (resolved to data by the subsystem). */
    controlSignalRegistryId: string;
    /** Id of the evaluator set this stack uses. */
    evaluatorSetId: string;
    /** Id of the vendor playbook this stack uses. */
    vendorPlaybookId: string;
    /** Id of the tech-stack→control mapping this stack uses. */
    techStackMapId: string;
    /** Id of the SSP narrative-source strategy this stack uses. */
    sspNarrativeSourceId: string;
    conventions: StackConventions;
}
/** A registered stack = its capabilities. (Subsystems bind behavior by the capability ids above.) */
export interface StackProvider {
    capabilities: StackCapabilities;
}
export declare class StackCapabilityError extends Error {
    constructor(message: string);
}
/** Validate a declared capability object. Throws StackCapabilityError listing what's missing. */
export declare function validateStackCapabilities(raw: unknown): StackCapabilities;
/** A registry of stack providers keyed by stack id. */
export declare class StackRegistry {
    private providers;
    /** Register a provider (validates its capabilities first). Last registration for an id wins. */
    register(provider: StackProvider): void;
    has(id: StackId): boolean;
    get(id: StackId): StackProvider;
    ids(): StackId[];
}
/** The reference stack id. Used as the default so existing (Microsoft-only) deployments are unchanged. */
export declare const DEFAULT_STACK_ID = "microsoft-gcc-high";
/**
 * Resolve the active stack id from existing config (reuses the TenantConfig seam that already
 * carries infrastructure_model — does NOT introduce a parallel selector). Absent → Microsoft.
 */
export declare function resolveStackId(config: {
    stack?: string;
} | undefined): StackId;
//# sourceMappingURL=StackProvider.d.ts.map