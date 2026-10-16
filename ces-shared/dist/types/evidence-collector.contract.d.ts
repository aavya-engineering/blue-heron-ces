import { z } from 'zod';
export declare const EC_CONTRACT_VERSION = "1.0.0";
export declare const SUPPORTED_EC_CONTRACT_VERSIONS: readonly ["1.0.0"];
export declare const EcHealthStatus: z.ZodEnum<["ok", "degraded"]>;
export type EcHealthStatusType = z.infer<typeof EcHealthStatus>;
export declare const EcMode: z.ZodEnum<["sim", "live"]>;
export type EcModeType = z.infer<typeof EcMode>;
export declare const EcHealthSchema: z.ZodObject<{
    status: z.ZodEnum<["ok", "degraded"]>;
    mode: z.ZodEnum<["sim", "live"]>;
    startedAt: z.ZodString;
    version: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "ok" | "degraded";
    mode: "sim" | "live";
    startedAt: string;
    version: string;
}, {
    status: "ok" | "degraded";
    mode: "sim" | "live";
    startedAt: string;
    version: string;
}>;
export type EcHealth = z.infer<typeof EcHealthSchema>;
export declare const EcRunType: z.ZodEnum<["ingest", "index"]>;
export type EcRunTypeType = z.infer<typeof EcRunType>;
export declare const EcRunStatus: z.ZodEnum<["success", "empty", "failed"]>;
export type EcRunStatusType = z.infer<typeof EcRunStatus>;
export declare const EcRunSchema: z.ZodObject<{
    runId: z.ZodString;
    startedAt: z.ZodString;
    runType: z.ZodEnum<["ingest", "index"]>;
    status: z.ZodEnum<["success", "empty", "failed"]>;
    artifactsWritten: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    status: "failed" | "success" | "empty";
    startedAt: string;
    runId: string;
    runType: "ingest" | "index";
    artifactsWritten: number;
}, {
    status: "failed" | "success" | "empty";
    startedAt: string;
    runId: string;
    runType: "ingest" | "index";
    artifactsWritten: number;
}>;
export type EcRun = z.infer<typeof EcRunSchema>;
export declare const EcFindingSeverity: z.ZodEnum<["critical", "high", "low"]>;
export type EcFindingSeverityType = z.infer<typeof EcFindingSeverity>;
export declare const EcFindingStatus: z.ZodEnum<["open", "resolved"]>;
export type EcFindingStatusType = z.infer<typeof EcFindingStatus>;
export declare const EcFindingSchema: z.ZodObject<{
    findingId: z.ZodString;
    checkId: z.ZodString;
    detectedAt: z.ZodString;
    severity: z.ZodEnum<["critical", "high", "low"]>;
    status: z.ZodEnum<["open", "resolved"]>;
    tenantSlug: z.ZodString;
    detail: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "open" | "resolved";
    findingId: string;
    checkId: string;
    detectedAt: string;
    severity: "critical" | "high" | "low";
    tenantSlug: string;
    detail: string;
}, {
    status: "open" | "resolved";
    findingId: string;
    checkId: string;
    detectedAt: string;
    severity: "critical" | "high" | "low";
    tenantSlug: string;
    detail: string;
}>;
export type EcFinding = z.infer<typeof EcFindingSchema>;
export declare const EcEvidenceSource: z.ZodEnum<["manual_upload", "attestation"]>;
export type EcEvidenceSourceType = z.infer<typeof EcEvidenceSource>;
export declare const EcEvidenceItemSchema: z.ZodObject<{
    contractVersion: z.ZodEnum<["1.0.0"]>;
    itemId: z.ZodString;
    tenantSlug: z.ZodString;
    controlIds: z.ZodArray<z.ZodString, "many">;
    source: z.ZodEnum<["manual_upload", "attestation"]>;
    filename: z.ZodString;
    mediaType: z.ZodString;
    sha256: z.ZodString;
    sizeBytes: z.ZodNumber;
    collectedAt: z.ZodString;
    submittedByRole: z.ZodString;
    mode: z.ZodEnum<["sim", "live"]>;
}, "strict", z.ZodTypeAny, {
    sha256: string;
    mode: "sim" | "live";
    tenantSlug: string;
    contractVersion: "1.0.0";
    itemId: string;
    controlIds: string[];
    source: "manual_upload" | "attestation";
    filename: string;
    mediaType: string;
    sizeBytes: number;
    collectedAt: string;
    submittedByRole: string;
}, {
    sha256: string;
    mode: "sim" | "live";
    tenantSlug: string;
    contractVersion: "1.0.0";
    itemId: string;
    controlIds: string[];
    source: "manual_upload" | "attestation";
    filename: string;
    mediaType: string;
    sizeBytes: number;
    collectedAt: string;
    submittedByRole: string;
}>;
export type EcEvidenceItem = z.infer<typeof EcEvidenceItemSchema>;
export declare const EcLedgerOrigin: z.ZodEnum<["stamper", "ec"]>;
export type EcLedgerOriginType = z.infer<typeof EcLedgerOrigin>;
export declare const EcLedgerEntrySchema: z.ZodObject<{
    tenantSlug: z.ZodString;
    path: z.ZodString;
    sha256: z.ZodString;
    firstSeen: z.ZodString;
    lastSeen: z.ZodString;
    origin: z.ZodEnum<["stamper", "ec"]>;
}, "strip", z.ZodTypeAny, {
    sha256: string;
    path: string;
    origin: "stamper" | "ec";
    tenantSlug: string;
    firstSeen: string;
    lastSeen: string;
}, {
    sha256: string;
    path: string;
    origin: "stamper" | "ec";
    tenantSlug: string;
    firstSeen: string;
    lastSeen: string;
}>;
export type EcLedgerEntry = z.infer<typeof EcLedgerEntrySchema>;
//# sourceMappingURL=evidence-collector.contract.d.ts.map