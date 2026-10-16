export interface PolicyDocument {
    template_id: string;
    title: string;
    markdown: string;
    completeness: number;
    domain: string;
    nist_controls: string[];
    /** Unique document identifier (e.g., "ORG-AC-001") */
    documentId?: string;
    /** ISO 8601 date of policy approval */
    approvalDate?: string;
    /** Name of approving authority (AO, ISSO, etc.) */
    approverName?: string;
    /** Revision version (e.g., "1.2") */
    version?: string;
    /** Human-readable summary of covered controls */
    nistControlSummary?: string;
}
//# sourceMappingURL=policy.types.d.ts.map