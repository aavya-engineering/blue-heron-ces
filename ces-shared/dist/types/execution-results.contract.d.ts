import { z } from 'zod';
export declare const EXECUTION_RESULTS_CONTRACT_VERSION = "1.1.0";
export declare const SUPPORTED_EXECUTION_RESULTS_VERSIONS: readonly ["1.0.0", "1.1.0"];
export declare const ExecutionVerdict: z.ZodEnum<["sat", "not_sat", "provisional", "not_applicable"]>;
export type ExecutionVerdictType = z.infer<typeof ExecutionVerdict>;
export declare const ExecutionDirective: z.ZodEnum<["automated", "validation", "manual_gate", "document-absence", "document-prohibition", "document-renderable", "inherit-fedramp", "eo-tooled", "nonstack", "skip"]>;
export type ExecutionDirectiveType = z.infer<typeof ExecutionDirective>;
export declare const ControlExecutionResultSchema: z.ZodObject<{
    controlId: z.ZodString;
    directive: z.ZodEnum<["automated", "validation", "manual_gate", "document-absence", "document-prohibition", "document-renderable", "inherit-fedramp", "eo-tooled", "nonstack", "skip"]>;
    verdict: z.ZodEnum<["sat", "not_sat", "provisional", "not_applicable"]>;
    outcome: z.ZodString;
    evidencePath: z.ZodOptional<z.ZodString>;
    timestampUtc: z.ZodString;
}, "strip", z.ZodTypeAny, {
    outcome: string;
    verdict: "sat" | "not_sat" | "provisional" | "not_applicable";
    controlId: string;
    directive: "validation" | "skip" | "automated" | "nonstack" | "manual_gate" | "document-absence" | "document-prohibition" | "document-renderable" | "inherit-fedramp" | "eo-tooled";
    timestampUtc: string;
    evidencePath?: string | undefined;
}, {
    outcome: string;
    verdict: "sat" | "not_sat" | "provisional" | "not_applicable";
    controlId: string;
    directive: "validation" | "skip" | "automated" | "nonstack" | "manual_gate" | "document-absence" | "document-prohibition" | "document-renderable" | "inherit-fedramp" | "eo-tooled";
    timestampUtc: string;
    evidencePath?: string | undefined;
}>;
export type ControlExecutionResult = z.infer<typeof ControlExecutionResultSchema>;
export declare const ExecutionResultsManifestSchema: z.ZodObject<{
    contractVersion: z.ZodEnum<["1.0.0", "1.1.0"]>;
    runId: z.ZodString;
    planId: z.ZodString;
    executablePlanId: z.ZodOptional<z.ZodString>;
    cesId: z.ZodOptional<z.ZodString>;
    tenantSlug: z.ZodString;
    completedAt: z.ZodString;
    totalControls: z.ZodNumber;
    results: z.ZodArray<z.ZodObject<{
        controlId: z.ZodString;
        directive: z.ZodEnum<["automated", "validation", "manual_gate", "document-absence", "document-prohibition", "document-renderable", "inherit-fedramp", "eo-tooled", "nonstack", "skip"]>;
        verdict: z.ZodEnum<["sat", "not_sat", "provisional", "not_applicable"]>;
        outcome: z.ZodString;
        evidencePath: z.ZodOptional<z.ZodString>;
        timestampUtc: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        outcome: string;
        verdict: "sat" | "not_sat" | "provisional" | "not_applicable";
        controlId: string;
        directive: "validation" | "skip" | "automated" | "nonstack" | "manual_gate" | "document-absence" | "document-prohibition" | "document-renderable" | "inherit-fedramp" | "eo-tooled";
        timestampUtc: string;
        evidencePath?: string | undefined;
    }, {
        outcome: string;
        verdict: "sat" | "not_sat" | "provisional" | "not_applicable";
        controlId: string;
        directive: "validation" | "skip" | "automated" | "nonstack" | "manual_gate" | "document-absence" | "document-prohibition" | "document-renderable" | "inherit-fedramp" | "eo-tooled";
        timestampUtc: string;
        evidencePath?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    runId: string;
    tenantSlug: string;
    contractVersion: "1.0.0" | "1.1.0";
    planId: string;
    completedAt: string;
    totalControls: number;
    results: {
        outcome: string;
        verdict: "sat" | "not_sat" | "provisional" | "not_applicable";
        controlId: string;
        directive: "validation" | "skip" | "automated" | "nonstack" | "manual_gate" | "document-absence" | "document-prohibition" | "document-renderable" | "inherit-fedramp" | "eo-tooled";
        timestampUtc: string;
        evidencePath?: string | undefined;
    }[];
    executablePlanId?: string | undefined;
    cesId?: string | undefined;
}, {
    runId: string;
    tenantSlug: string;
    contractVersion: "1.0.0" | "1.1.0";
    planId: string;
    completedAt: string;
    totalControls: number;
    results: {
        outcome: string;
        verdict: "sat" | "not_sat" | "provisional" | "not_applicable";
        controlId: string;
        directive: "validation" | "skip" | "automated" | "nonstack" | "manual_gate" | "document-absence" | "document-prohibition" | "document-renderable" | "inherit-fedramp" | "eo-tooled";
        timestampUtc: string;
        evidencePath?: string | undefined;
    }[];
    executablePlanId?: string | undefined;
    cesId?: string | undefined;
}>;
export type ExecutionResultsManifest = z.infer<typeof ExecutionResultsManifestSchema>;
export interface ExecutionSummary {
    sat: number;
    notSat: number;
    provisional: number;
    notApplicable: number;
    total: number;
}
export declare function summarizeResults(manifest: ExecutionResultsManifest): ExecutionSummary;
//# sourceMappingURL=execution-results.contract.d.ts.map