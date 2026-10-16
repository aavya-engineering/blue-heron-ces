import { CesModuleName, PlannerArtifactPathOptions } from './contract.js';
export declare const DEFAULT_CES_PIPELINE_ROOT: string;
export declare function getCesPipelineRoot(): string;
export declare function getCesModuleRoot(moduleName: CesModuleName): string;
export declare function getModuleStorageRoot(moduleName: Exclude<CesModuleName, 'Planner'>): string;
export declare function getPlannerCustomersRoot(): string;
export declare function sanitizeCustomerName(name: string): string;
export declare function getPlannerCustomerRoot(customerName: string): string;
export declare function getPlannerArtifactDirectory(options: PlannerArtifactPathOptions): string;
export declare function getPlannerArtifactPath(options: PlannerArtifactPathOptions): string;
export declare function getStamperPlanDataRoot(): string;
/**
 * Canonical root for a tenant's Stamper data. This is the SINGLE read path
 * for any module that needs Stamper output (plans, evidence, logs, state).
 * EvidenceOps and any future consumer must resolve through this helper,
 * never via repo-relative paths or hard-coded locations.
 */
export declare function getStamperTenantRoot(tenantSlug: string): string;
/**
 * Subdirectory under a tenant's Stamper root. Use 'evidence' for Stamper-written
 * evidence files, 'state' for execution-results manifests, 'plans' for executable
 * plans, 'logs' for run logs. Consumers resolve through getStamperTenantRoot.
 */
export declare function getStamperTenantSubdir(tenantSlug: string, subdir: 'plans' | 'evidence' | 'logs' | 'state'): string;
/**
 * Canonical root for EC's own module storage (its item store + ledger). EC never
 * writes into another tool's tree; this is its own root, distinct from
 * getStamperTenantRoot (which EC reads from, read-only, during an index pass).
 */
export declare function getEcModuleRoot(): string;
/**
 * Per-tenant root under EC's module storage, keyed by tenant slug. Guards against
 * path traversal: a slug containing separators or a `..` segment (or one that
 * otherwise resolves outside the EC module root) is rejected rather than silently
 * escaping the module root.
 */
export declare function getEcTenantRoot(tenantSlug: string): string;
export declare function getTimestampedJsonFilename(type: string, artifactId?: string): string;
//# sourceMappingURL=node.d.ts.map