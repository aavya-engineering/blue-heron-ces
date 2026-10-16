export interface SignalResult {
    signalId: string;
    source: 'graph' | 'powershell' | 'manual';
    endpoint: string;
    timestamp: string;
    rawData: unknown;
    status: 'success' | 'error' | 'not_assessed';
    error?: string;
    parsed?: Record<string, unknown>;
    complianceState?: 'compliant' | 'non_compliant' | 'unknown';
    findings?: string[];
    metadata?: {
        threshold?: number;
        compliantCount?: number;
        totalCount?: number;
        [key: string]: unknown;
    };
}
//# sourceMappingURL=signal.types.d.ts.map