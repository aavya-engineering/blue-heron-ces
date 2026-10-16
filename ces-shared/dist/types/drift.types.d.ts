import type { EvalRule, EvalResult } from './eval.types.js';
export interface CheckDefinition {
    checkId: string;
    controlIds: string[];
    label: string;
    engine: string;
    getCommand: string;
    evidenceCommands: string[];
    variablesRequired: string[];
    variablesRuntime: string[];
    evalRules: EvalRule[];
    severity: 'critical' | 'high' | 'medium' | 'low';
}
export interface DriftFinding {
    findingId: string;
    detectedAt: string;
    runId: string;
    tenantId: string;
    checkId: string;
    controlIds: string[];
    severity: 'critical' | 'high' | 'medium' | 'low';
    layer: 'setting' | 'control';
    settingPath: string;
    beforeValue: unknown;
    afterValue: unknown;
    evalResult?: EvalResult;
    status: 'open' | 'acknowledged' | 'remediated' | 'false_positive';
    notes?: string;
    resolvedAt?: string;
}
export interface DriftRun {
    runId: string;
    tenantId: string;
    startedAt: string;
    completedAt: string;
    runType: 'scheduled_poll' | 'nightly_reconciliation' | 'manual' | 'stamp_triggered';
    checksExecuted: number;
    checksCompliant: number;
    checksNonCompliant: number;
    findingsNew: number;
    findingsTotal: number;
    artifactsWritten: number;
    evidenceCommandsRun: number;
    status: 'success' | 'partial' | 'failed';
    errors: string[];
}
//# sourceMappingURL=drift.types.d.ts.map