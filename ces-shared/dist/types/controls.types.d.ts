export interface CmmcControl {
    control_id: string;
    family: string;
    cmmc_level: number;
    nist_ref: string;
    practice: string;
}
export type ControlStatus = 'met' | 'not_met' | 'partial' | 'not_assessed';
export type ControlClassification = 'automated' | 'manual' | 'nonstack';
export interface ControlAssessment {
    control_id: string;
    nist_ref: string;
    status: ControlStatus;
    classification: ControlClassification;
    sources: AssessmentSource[];
    implementation_narrative?: string;
    last_assessed: string;
    signals: import('./signal.types.js').SignalResult[];
    evidenceArtifactIds: string[];
    automationSource: 'graph' | 'powershell' | 'manual' | 'imported';
    lastFetchedAt: string;
    directiveMetadata?: import('./evidence.types.js').DirectiveMetadata;
}
export interface AssessmentSource {
    type: 'discovery' | 'blob_artifact' | 'ec_capture' | 'ec_drift' | 'manual' | 'policy_doc' | 'evidence_import' | 'adminops_execution';
    timestamp: string;
    detail: string;
    result: 'exists' | 'missing' | 'error' | 'no_query' | 'imported' | 'enforced';
    rawOutput?: string;
}
export interface AssessmentSnapshot {
    snapshotId: string;
    tenantId: string;
    /** G1/T2: CES identity (customer↔tenant lineage), when resolvable from CES config. */
    ces?: import('../config/cesConfig.contract.js').CesIdentity;
    generatedAt: string;
    controls: ControlAssessment[];
    sources_merged: string[];
    sprs_score: number;
    controls_met: number;
    controls_not_met: number;
    controls_partial: number;
    controls_not_assessed: number;
    liveAssessmentCount?: number;
}
//# sourceMappingURL=controls.types.d.ts.map