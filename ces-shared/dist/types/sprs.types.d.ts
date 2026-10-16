import type { ControlStatus } from './controls.types.js';
export interface SprsWeight {
    nist_ref: string;
    weight: number;
    poam_allowed: boolean;
    /** Full CMMC control id, e.g. "AC.L2-3.1.5" (sprs-weights/2.0.0). */
    control_id?: string;
    family?: string;
    level?: 'L1' | 'L2' | 'L3';
    /** True for CA.L2-3.12.4 (SSP) — weight 0, prerequisite not arithmetic. */
    unscored?: boolean;
    note?: string;
}
export interface SprsPartialCredit {
    nist_ref: string;
    full_weight: number;
    partial_weight: number;
    partial_condition: string;
    poam_allowed_at_partial?: boolean;
}
export interface SprsWeightsFile {
    version: string;
    source: string;
    controls: SprsWeight[];
    partial_credit: SprsPartialCredit[];
    poam_prohibited: string[];
}
export interface SprsDeduction {
    nist_ref: string;
    control_id: string;
    weight: number;
    status: ControlStatus;
}
export interface PoamCandidate {
    nist_ref: string;
    control_id: string;
    weight: number;
}
export interface SprsResult {
    score: number;
    maxScore: 110;
    controlsMet: number;
    controlsNotMet: number;
    controlsPartial: number;
    controlsNotAssessed: number;
    deductions: SprsDeduction[];
    partialCredits: SprsPartialCredit[];
    poamEligible: boolean;
    poamBlockers: string[];
    poamCandidates: PoamCandidate[];
    certificationPath: 'full' | 'conditional' | 'blocked';
}
//# sourceMappingURL=sprs.types.d.ts.map