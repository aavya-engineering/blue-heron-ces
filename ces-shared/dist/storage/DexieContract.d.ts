import type { PlannerArtifactPathOptions } from './contract.js';
/** Dexie database name — must match the literal in AppDatabase constructor exactly. */
export declare const PLANNER_DEXIE_DB_NAME = "CMMCComplianceTool";
/** Current schema version — matches the highest .version() call in AppDatabase. */
export declare const PLANNER_DEXIE_DB_VERSION = 6;
/**
 * Maps each Dexie store name to a deterministic FS sub-path under
 * getPlannerCustomerRoot(customerName). The actual absolute path is resolved
 * at runtime by Node-side helpers (see node.ts) and must not be computed here.
 */
export declare const PLANNER_DEXIE_STORE_TO_FS_PATH: Record<string, string>;
export type { PlannerArtifactPathOptions };
//# sourceMappingURL=DexieContract.d.ts.map