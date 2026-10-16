import { type CesConfig } from './cesConfig.contract.js';
/**
 * Resolve the CES config file path: CES_CONFIG_PATH env var if set, else
 * {pipelineRoot}/ces.config.json.
 */
export declare function getCesConfigPath(): string;
/**
 * Load + validate the CES config. When the file is absent, returns EMPTY_CES_CONFIG (a system
 * with no bindings yet is valid). A present-but-malformed file throws CesConfigError — we never
 * silently ignore a bad config. Pass an explicit `configPath` to bypass env/default resolution.
 */
export declare function loadCesConfig(configPath?: string): CesConfig;
//# sourceMappingURL=cesConfig.node.d.ts.map