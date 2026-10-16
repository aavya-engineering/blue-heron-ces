export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogFields {
    [key: string]: unknown;
}
/** Emit one structured JSON line. error/warn -> stderr, else stdout. Never throws. */
export declare function structuredLog(level: LogLevel, message: string, fields?: LogFields): void;
interface ReqLike {
    method?: string;
    originalUrl?: string;
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
    requestId?: string;
}
interface ResLike {
    statusCode?: number;
    setHeader?(name: string, value: string): void;
    on(event: 'finish', cb: () => void): void;
}
/**
 * Express-compatible middleware: assigns/propagates a request id (honoring an inbound
 * `x-request-id`), echoes it on the response header, stashes it on `req.requestId`, and logs a
 * structured completion line with method, path, status, and duration.
 */
export interface RequestLoggerOptions {
    /**
     * Exact request paths (query string ignored) whose completion log line is suppressed — e.g. a health
     * poller. Skipped requests still get the request id assigned and echoed on `x-request-id`.
     */
    skipPaths?: string[];
}
export declare function requestLogger(service: string, options?: RequestLoggerOptions): (req: ReqLike, res: ResLike, next: () => void) => void;
export {};
//# sourceMappingURL=requestLogger.d.ts.map