import { type ChildProcess, type SpawnOptions } from 'child_process';
export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
export type HealthCheckFn = (ecUrl: string, timeoutMs?: number) => Promise<boolean>;
export type SleepFn = (ms: number) => Promise<void>;
export interface EnsureEcRunningOptions {
    /** EC health-check base URL. Default 'http://localhost:4001'. */
    ecUrl?: string;
    /**
     * EC module working directory. Precedence: this field, then `env.CES_EC_CWD`, then
     * `../ces-ec` resolved relative to `process.cwd()` (the caller's module root).
     */
    cwd?: string;
    /** Spawn command. Default 'npx'. */
    command?: string;
    /** Spawn args. Default ['tsx', 'src/index.ts'] — the real ces-ec entry point. */
    args?: string[];
    /** Environment consulted for CES_EC_CWD / CES_EC_AUTOSTART and passed to the spawned process. Default process.env. */
    env?: NodeJS.ProcessEnv;
    /** Injectable for tests — never touches the network or spawns a process when supplied. */
    spawnFn?: SpawnFn;
    healthCheckFn?: HealthCheckFn;
    sleepFn?: SleepFn;
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
}
export type EnsureEcRunningResult = 'already_running' | 'started' | 'autostart_disabled' | 'failed';
/**
 * Ensure EC is reachable. Always health-checks first (works whether or not autostart is enabled).
 * Spawns EC only when it is unhealthy AND `env.CES_EC_AUTOSTART === '1'`.
 *
 * Backward-compatible: `ensureEcRunning(ecUrl, ecCwd)` (both optional strings) is still accepted; it
 * is equivalent to `ensureEcRunning({ ecUrl, cwd: ecCwd })`. Existing callers that `await` the
 * promise without inspecting its value are unaffected by the new resolved type.
 */
export declare function ensureEcRunning(ecUrlOrOptions?: string | EnsureEcRunningOptions, ecCwd?: string): Promise<EnsureEcRunningResult>;
//# sourceMappingURL=EcLauncher.d.ts.map