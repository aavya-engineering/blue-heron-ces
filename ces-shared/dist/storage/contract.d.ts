export type CesModuleName = 'Planner' | 'Stamper' | 'EvidenceOps' | 'AdminOps' | 'EvidenceCollector';
export type PlannerArtifactCategory = 'inputs' | 'outputs';
export interface PlannerArtifactPathOptions {
    customerName: string;
    category?: PlannerArtifactCategory;
    filename?: string;
}
/** Env var that overrides the pipeline storage root on all platforms. */
export declare const CES_PIPELINE_ROOT_ENV = "CES_PIPELINE_ROOT";
/** Default pipeline root used when CES_PIPELINE_ROOT is not set (Windows). */
export declare const DEFAULT_CES_PIPELINE_ROOT_WIN32 = "C:\\CES_Pipeline";
/** Default pipeline root used when CES_PIPELINE_ROOT is not set (POSIX). */
export declare const DEFAULT_CES_PIPELINE_ROOT_POSIX = "ces-pipeline";
/** Reserved-character pattern stripped by sanitizeCustomerName. */
export declare const CUSTOMER_NAME_RESERVED_RE: RegExp;
/** Fallback customer name when the sanitized result is empty. */
export declare const CUSTOMER_NAME_FALLBACK = "unknown";
export { PLANNER_DEXIE_DB_NAME, PLANNER_DEXIE_DB_VERSION, PLANNER_DEXIE_STORE_TO_FS_PATH, } from './DexieContract.js';
//# sourceMappingURL=contract.d.ts.map