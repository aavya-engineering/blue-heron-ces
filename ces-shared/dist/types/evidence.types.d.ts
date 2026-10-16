export interface DirectiveMetadata {
    control_id: string;
    directive: string;
    readiness: string;
    platform_inherited: boolean;
    enforcement_verified: boolean;
    narrative_stub: string;
    reasoning_trace: string;
    evidence_artifacts: string[];
}
export interface ArtifactRecord {
    artifactId: string;
    capturedAt: string;
    tenantId: string;
    capturedBy: string;
    sourceEndpoint: string;
    checkId: string;
    controlIds: string[];
    rawValue: unknown;
    sha256: string;
    runId: string;
    source: 'stamp_capture' | 'drift_check' | 'evidence_collection' | 'manual' | 'graph_query';
}
export interface EvidenceManifest {
    manifestId: string;
    runId: string;
    tenantId: string;
    generatedAt: string;
    controls: Array<{
        controlId: string;
        artifactIds: string[];
        complianceStatus: 'compliant' | 'non_compliant' | 'unknown';
    }>;
    artifactCount: number;
    storageEndpoint: string;
}
//# sourceMappingURL=evidence.types.d.ts.map