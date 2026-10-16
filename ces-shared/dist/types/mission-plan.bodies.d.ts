import { z } from 'zod';
export declare const TaskTypeEnum: z.ZodEnum<["policy", "configuration", "process", "monitoring", "training", "assessment", "evidence_collection"]>;
export declare const PriorityEnum: z.ZodEnum<["p0", "p1", "p2", "p3"]>;
export declare const SupportTypeEnum: z.ZodEnum<["Overt", "Configurable", "Inherited", "Partial", "None"]>;
export declare const ArtifactTypeEnum: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
export declare const CheckMethodEnum: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
export declare const CollectionMethodEnum: z.ZodEnum<["api_poll", "event_stream", "scheduled_export", "manual"]>;
export declare const SourceOfTruthEnum: z.ZodEnum<["iac", "policy_doc", "platform_setting", "manual"]>;
export declare const QueryMethodEnum: z.ZodEnum<["api", "export", "log_query", "manual"]>;
export declare const SeverityEnum: z.ZodEnum<["low", "medium", "high", "critical"]>;
export declare const GapClassificationEnum: z.ZodEnum<["configure", "customize", "manual", "auto_generate"]>;
export declare const ControlCoverageSchema: z.ZodObject<{
    control_id: z.ZodString;
    support_type: z.ZodEnum<["Overt", "Configurable", "Inherited", "Partial", "None"]>;
    gap_rationale: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    control_id: z.ZodString;
    support_type: z.ZodEnum<["Overt", "Configurable", "Inherited", "Partial", "None"]>;
    gap_rationale: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    control_id: z.ZodString;
    support_type: z.ZodEnum<["Overt", "Configurable", "Inherited", "Partial", "None"]>;
    gap_rationale: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
export declare const EvidenceArtifactRefSchema: z.ZodObject<{
    artifact_id: z.ZodString;
    artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
    description: z.ZodString;
    collector: z.ZodString;
    retention_days: z.ZodNumber;
    storage_location_ref: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    artifact_id: z.ZodString;
    artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
    description: z.ZodString;
    collector: z.ZodString;
    retention_days: z.ZodNumber;
    storage_location_ref: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    artifact_id: z.ZodString;
    artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
    description: z.ZodString;
    collector: z.ZodString;
    retention_days: z.ZodNumber;
    storage_location_ref: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
export declare const VendorHelpRefSchema: z.ZodObject<{
    vendor: z.ZodString;
    product: z.ZodString;
    title: z.ZodString;
    url: z.ZodOptional<z.ZodString>;
    path_hint: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    vendor: z.ZodString;
    product: z.ZodString;
    title: z.ZodString;
    url: z.ZodOptional<z.ZodString>;
    path_hint: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    vendor: z.ZodString;
    product: z.ZodString;
    title: z.ZodString;
    url: z.ZodOptional<z.ZodString>;
    path_hint: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export declare const VendorBlockSchema: z.ZodObject<{
    m365_service: z.ZodOptional<z.ZodString>;
    implementation: z.ZodOptional<z.ZodString>;
    portal_path: z.ZodOptional<z.ZodString>;
    powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    notes: z.ZodOptional<z.ZodString>;
    tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    m365_service: z.ZodOptional<z.ZodString>;
    implementation: z.ZodOptional<z.ZodString>;
    portal_path: z.ZodOptional<z.ZodString>;
    powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    notes: z.ZodOptional<z.ZodString>;
    tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    m365_service: z.ZodOptional<z.ZodString>;
    implementation: z.ZodOptional<z.ZodString>;
    portal_path: z.ZodOptional<z.ZodString>;
    powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    notes: z.ZodOptional<z.ZodString>;
    tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, z.ZodTypeAny, "passthrough">>;
export declare const StepActionSchema: z.ZodObject<{
    action_id: z.ZodString;
    action: z.ZodString;
    action_type: z.ZodString;
    evidence_outputs: z.ZodArray<z.ZodString, "many">;
    vendor: z.ZodOptional<z.ZodObject<{
        m365_service: z.ZodOptional<z.ZodString>;
        implementation: z.ZodOptional<z.ZodString>;
        portal_path: z.ZodOptional<z.ZodString>;
        powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        notes: z.ZodOptional<z.ZodString>;
        tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        m365_service: z.ZodOptional<z.ZodString>;
        implementation: z.ZodOptional<z.ZodString>;
        portal_path: z.ZodOptional<z.ZodString>;
        powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        notes: z.ZodOptional<z.ZodString>;
        tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        m365_service: z.ZodOptional<z.ZodString>;
        implementation: z.ZodOptional<z.ZodString>;
        portal_path: z.ZodOptional<z.ZodString>;
        powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        notes: z.ZodOptional<z.ZodString>;
        tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    action_id: z.ZodString;
    action: z.ZodString;
    action_type: z.ZodString;
    evidence_outputs: z.ZodArray<z.ZodString, "many">;
    vendor: z.ZodOptional<z.ZodObject<{
        m365_service: z.ZodOptional<z.ZodString>;
        implementation: z.ZodOptional<z.ZodString>;
        portal_path: z.ZodOptional<z.ZodString>;
        powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        notes: z.ZodOptional<z.ZodString>;
        tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        m365_service: z.ZodOptional<z.ZodString>;
        implementation: z.ZodOptional<z.ZodString>;
        portal_path: z.ZodOptional<z.ZodString>;
        powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        notes: z.ZodOptional<z.ZodString>;
        tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        m365_service: z.ZodOptional<z.ZodString>;
        implementation: z.ZodOptional<z.ZodString>;
        portal_path: z.ZodOptional<z.ZodString>;
        powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        notes: z.ZodOptional<z.ZodString>;
        tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    action_id: z.ZodString;
    action: z.ZodString;
    action_type: z.ZodString;
    evidence_outputs: z.ZodArray<z.ZodString, "many">;
    vendor: z.ZodOptional<z.ZodObject<{
        m365_service: z.ZodOptional<z.ZodString>;
        implementation: z.ZodOptional<z.ZodString>;
        portal_path: z.ZodOptional<z.ZodString>;
        powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        notes: z.ZodOptional<z.ZodString>;
        tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        m365_service: z.ZodOptional<z.ZodString>;
        implementation: z.ZodOptional<z.ZodString>;
        portal_path: z.ZodOptional<z.ZodString>;
        powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        notes: z.ZodOptional<z.ZodString>;
        tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        m365_service: z.ZodOptional<z.ZodString>;
        implementation: z.ZodOptional<z.ZodString>;
        portal_path: z.ZodOptional<z.ZodString>;
        powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        notes: z.ZodOptional<z.ZodString>;
        tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">>>;
}, z.ZodTypeAny, "passthrough">>;
export declare const EffortEstimateSchema: z.ZodObject<{
    one_time_dev_loe: z.ZodNumber;
    one_time_config_manual: z.ZodNumber;
    one_time_config_automated: z.ZodNumber;
    recurring_evidence_manual: z.ZodNumber;
    recurring_evidence_automated: z.ZodNumber;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    one_time_dev_loe: z.ZodNumber;
    one_time_config_manual: z.ZodNumber;
    one_time_config_automated: z.ZodNumber;
    recurring_evidence_manual: z.ZodNumber;
    recurring_evidence_automated: z.ZodNumber;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    one_time_dev_loe: z.ZodNumber;
    one_time_config_manual: z.ZodNumber;
    one_time_config_automated: z.ZodNumber;
    recurring_evidence_manual: z.ZodNumber;
    recurring_evidence_automated: z.ZodNumber;
}, z.ZodTypeAny, "passthrough">>;
export declare const RequirementContextSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    requirement_text: z.ZodOptional<z.ZodString>;
    domain: z.ZodOptional<z.ZodString>;
    level: z.ZodOptional<z.ZodString>;
    nist_reference: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    title: z.ZodOptional<z.ZodString>;
    requirement_text: z.ZodOptional<z.ZodString>;
    domain: z.ZodOptional<z.ZodString>;
    level: z.ZodOptional<z.ZodString>;
    nist_reference: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    title: z.ZodOptional<z.ZodString>;
    requirement_text: z.ZodOptional<z.ZodString>;
    domain: z.ZodOptional<z.ZodString>;
    level: z.ZodOptional<z.ZodString>;
    nist_reference: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export declare const ManualStepSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    task_type: z.ZodEnum<["policy", "configuration", "process", "monitoring", "training", "assessment", "evidence_collection"]>;
    priority: z.ZodEnum<["p0", "p1", "p2", "p3"]>;
    control_coverage: z.ZodArray<z.ZodObject<{
        control_id: z.ZodString;
        support_type: z.ZodEnum<["Overt", "Configurable", "Inherited", "Partial", "None"]>;
        gap_rationale: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        control_id: z.ZodString;
        support_type: z.ZodEnum<["Overt", "Configurable", "Inherited", "Partial", "None"]>;
        gap_rationale: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        control_id: z.ZodString;
        support_type: z.ZodEnum<["Overt", "Configurable", "Inherited", "Partial", "None"]>;
        gap_rationale: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    what_to_do: z.ZodArray<z.ZodString, "many">;
    how_to_verify: z.ZodArray<z.ZodString, "many">;
    vendor_help_refs: z.ZodArray<z.ZodObject<{
        vendor: z.ZodString;
        product: z.ZodString;
        title: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
        path_hint: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        vendor: z.ZodString;
        product: z.ZodString;
        title: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
        path_hint: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        vendor: z.ZodString;
        product: z.ZodString;
        title: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
        path_hint: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    expected_artifacts: z.ZodArray<z.ZodObject<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    manual_completion_criteria: z.ZodArray<z.ZodString, "many">;
    owner_role: z.ZodOptional<z.ZodString>;
    estimated_effort_hours: z.ZodOptional<z.ZodNumber>;
    effort_estimate: z.ZodOptional<z.ZodObject<{
        one_time_dev_loe: z.ZodNumber;
        one_time_config_manual: z.ZodNumber;
        one_time_config_automated: z.ZodNumber;
        recurring_evidence_manual: z.ZodNumber;
        recurring_evidence_automated: z.ZodNumber;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        one_time_dev_loe: z.ZodNumber;
        one_time_config_manual: z.ZodNumber;
        one_time_config_automated: z.ZodNumber;
        recurring_evidence_manual: z.ZodNumber;
        recurring_evidence_automated: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        one_time_dev_loe: z.ZodNumber;
        one_time_config_manual: z.ZodNumber;
        one_time_config_automated: z.ZodNumber;
        recurring_evidence_manual: z.ZodNumber;
        recurring_evidence_automated: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">>>;
    dependencies: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    actions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        action_id: z.ZodString;
        action: z.ZodString;
        action_type: z.ZodString;
        evidence_outputs: z.ZodArray<z.ZodString, "many">;
        vendor: z.ZodOptional<z.ZodObject<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        action_id: z.ZodString;
        action: z.ZodString;
        action_type: z.ZodString;
        evidence_outputs: z.ZodArray<z.ZodString, "many">;
        vendor: z.ZodOptional<z.ZodObject<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        action_id: z.ZodString;
        action: z.ZodString;
        action_type: z.ZodString;
        evidence_outputs: z.ZodArray<z.ZodString, "many">;
        vendor: z.ZodOptional<z.ZodObject<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>;
    notes: z.ZodOptional<z.ZodString>;
    gap_classifications: z.ZodOptional<z.ZodArray<z.ZodEnum<["configure", "customize", "manual", "auto_generate"]>, "many">>;
    requirement_context: z.ZodOptional<z.ZodObject<{
        title: z.ZodOptional<z.ZodString>;
        requirement_text: z.ZodOptional<z.ZodString>;
        domain: z.ZodOptional<z.ZodString>;
        level: z.ZodOptional<z.ZodString>;
        nist_reference: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        title: z.ZodOptional<z.ZodString>;
        requirement_text: z.ZodOptional<z.ZodString>;
        domain: z.ZodOptional<z.ZodString>;
        level: z.ZodOptional<z.ZodString>;
        nist_reference: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        title: z.ZodOptional<z.ZodString>;
        requirement_text: z.ZodOptional<z.ZodString>;
        domain: z.ZodOptional<z.ZodString>;
        level: z.ZodOptional<z.ZodString>;
        nist_reference: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>>;
    section: z.ZodOptional<z.ZodString>;
    resource_type: z.ZodOptional<z.ZodString>;
    layer: z.ZodOptional<z.ZodNumber>;
    tech_ref: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    id: z.ZodString;
    title: z.ZodString;
    task_type: z.ZodEnum<["policy", "configuration", "process", "monitoring", "training", "assessment", "evidence_collection"]>;
    priority: z.ZodEnum<["p0", "p1", "p2", "p3"]>;
    control_coverage: z.ZodArray<z.ZodObject<{
        control_id: z.ZodString;
        support_type: z.ZodEnum<["Overt", "Configurable", "Inherited", "Partial", "None"]>;
        gap_rationale: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        control_id: z.ZodString;
        support_type: z.ZodEnum<["Overt", "Configurable", "Inherited", "Partial", "None"]>;
        gap_rationale: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        control_id: z.ZodString;
        support_type: z.ZodEnum<["Overt", "Configurable", "Inherited", "Partial", "None"]>;
        gap_rationale: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    what_to_do: z.ZodArray<z.ZodString, "many">;
    how_to_verify: z.ZodArray<z.ZodString, "many">;
    vendor_help_refs: z.ZodArray<z.ZodObject<{
        vendor: z.ZodString;
        product: z.ZodString;
        title: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
        path_hint: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        vendor: z.ZodString;
        product: z.ZodString;
        title: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
        path_hint: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        vendor: z.ZodString;
        product: z.ZodString;
        title: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
        path_hint: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    expected_artifacts: z.ZodArray<z.ZodObject<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    manual_completion_criteria: z.ZodArray<z.ZodString, "many">;
    owner_role: z.ZodOptional<z.ZodString>;
    estimated_effort_hours: z.ZodOptional<z.ZodNumber>;
    effort_estimate: z.ZodOptional<z.ZodObject<{
        one_time_dev_loe: z.ZodNumber;
        one_time_config_manual: z.ZodNumber;
        one_time_config_automated: z.ZodNumber;
        recurring_evidence_manual: z.ZodNumber;
        recurring_evidence_automated: z.ZodNumber;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        one_time_dev_loe: z.ZodNumber;
        one_time_config_manual: z.ZodNumber;
        one_time_config_automated: z.ZodNumber;
        recurring_evidence_manual: z.ZodNumber;
        recurring_evidence_automated: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        one_time_dev_loe: z.ZodNumber;
        one_time_config_manual: z.ZodNumber;
        one_time_config_automated: z.ZodNumber;
        recurring_evidence_manual: z.ZodNumber;
        recurring_evidence_automated: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">>>;
    dependencies: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    actions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        action_id: z.ZodString;
        action: z.ZodString;
        action_type: z.ZodString;
        evidence_outputs: z.ZodArray<z.ZodString, "many">;
        vendor: z.ZodOptional<z.ZodObject<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        action_id: z.ZodString;
        action: z.ZodString;
        action_type: z.ZodString;
        evidence_outputs: z.ZodArray<z.ZodString, "many">;
        vendor: z.ZodOptional<z.ZodObject<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        action_id: z.ZodString;
        action: z.ZodString;
        action_type: z.ZodString;
        evidence_outputs: z.ZodArray<z.ZodString, "many">;
        vendor: z.ZodOptional<z.ZodObject<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>;
    notes: z.ZodOptional<z.ZodString>;
    gap_classifications: z.ZodOptional<z.ZodArray<z.ZodEnum<["configure", "customize", "manual", "auto_generate"]>, "many">>;
    requirement_context: z.ZodOptional<z.ZodObject<{
        title: z.ZodOptional<z.ZodString>;
        requirement_text: z.ZodOptional<z.ZodString>;
        domain: z.ZodOptional<z.ZodString>;
        level: z.ZodOptional<z.ZodString>;
        nist_reference: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        title: z.ZodOptional<z.ZodString>;
        requirement_text: z.ZodOptional<z.ZodString>;
        domain: z.ZodOptional<z.ZodString>;
        level: z.ZodOptional<z.ZodString>;
        nist_reference: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        title: z.ZodOptional<z.ZodString>;
        requirement_text: z.ZodOptional<z.ZodString>;
        domain: z.ZodOptional<z.ZodString>;
        level: z.ZodOptional<z.ZodString>;
        nist_reference: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>>;
    section: z.ZodOptional<z.ZodString>;
    resource_type: z.ZodOptional<z.ZodString>;
    layer: z.ZodOptional<z.ZodNumber>;
    tech_ref: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    id: z.ZodString;
    title: z.ZodString;
    task_type: z.ZodEnum<["policy", "configuration", "process", "monitoring", "training", "assessment", "evidence_collection"]>;
    priority: z.ZodEnum<["p0", "p1", "p2", "p3"]>;
    control_coverage: z.ZodArray<z.ZodObject<{
        control_id: z.ZodString;
        support_type: z.ZodEnum<["Overt", "Configurable", "Inherited", "Partial", "None"]>;
        gap_rationale: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        control_id: z.ZodString;
        support_type: z.ZodEnum<["Overt", "Configurable", "Inherited", "Partial", "None"]>;
        gap_rationale: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        control_id: z.ZodString;
        support_type: z.ZodEnum<["Overt", "Configurable", "Inherited", "Partial", "None"]>;
        gap_rationale: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    what_to_do: z.ZodArray<z.ZodString, "many">;
    how_to_verify: z.ZodArray<z.ZodString, "many">;
    vendor_help_refs: z.ZodArray<z.ZodObject<{
        vendor: z.ZodString;
        product: z.ZodString;
        title: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
        path_hint: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        vendor: z.ZodString;
        product: z.ZodString;
        title: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
        path_hint: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        vendor: z.ZodString;
        product: z.ZodString;
        title: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
        path_hint: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    expected_artifacts: z.ZodArray<z.ZodObject<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    manual_completion_criteria: z.ZodArray<z.ZodString, "many">;
    owner_role: z.ZodOptional<z.ZodString>;
    estimated_effort_hours: z.ZodOptional<z.ZodNumber>;
    effort_estimate: z.ZodOptional<z.ZodObject<{
        one_time_dev_loe: z.ZodNumber;
        one_time_config_manual: z.ZodNumber;
        one_time_config_automated: z.ZodNumber;
        recurring_evidence_manual: z.ZodNumber;
        recurring_evidence_automated: z.ZodNumber;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        one_time_dev_loe: z.ZodNumber;
        one_time_config_manual: z.ZodNumber;
        one_time_config_automated: z.ZodNumber;
        recurring_evidence_manual: z.ZodNumber;
        recurring_evidence_automated: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        one_time_dev_loe: z.ZodNumber;
        one_time_config_manual: z.ZodNumber;
        one_time_config_automated: z.ZodNumber;
        recurring_evidence_manual: z.ZodNumber;
        recurring_evidence_automated: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">>>;
    dependencies: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    actions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        action_id: z.ZodString;
        action: z.ZodString;
        action_type: z.ZodString;
        evidence_outputs: z.ZodArray<z.ZodString, "many">;
        vendor: z.ZodOptional<z.ZodObject<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        action_id: z.ZodString;
        action: z.ZodString;
        action_type: z.ZodString;
        evidence_outputs: z.ZodArray<z.ZodString, "many">;
        vendor: z.ZodOptional<z.ZodObject<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        action_id: z.ZodString;
        action: z.ZodString;
        action_type: z.ZodString;
        evidence_outputs: z.ZodArray<z.ZodString, "many">;
        vendor: z.ZodOptional<z.ZodObject<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            m365_service: z.ZodOptional<z.ZodString>;
            implementation: z.ZodOptional<z.ZodString>;
            portal_path: z.ZodOptional<z.ZodString>;
            powershell: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            evidence_commands: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            notes: z.ZodOptional<z.ZodString>;
            tech_ref_guidance: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, z.ZodTypeAny, "passthrough">>>;
    }, z.ZodTypeAny, "passthrough">>, "many">>;
    notes: z.ZodOptional<z.ZodString>;
    gap_classifications: z.ZodOptional<z.ZodArray<z.ZodEnum<["configure", "customize", "manual", "auto_generate"]>, "many">>;
    requirement_context: z.ZodOptional<z.ZodObject<{
        title: z.ZodOptional<z.ZodString>;
        requirement_text: z.ZodOptional<z.ZodString>;
        domain: z.ZodOptional<z.ZodString>;
        level: z.ZodOptional<z.ZodString>;
        nist_reference: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        title: z.ZodOptional<z.ZodString>;
        requirement_text: z.ZodOptional<z.ZodString>;
        domain: z.ZodOptional<z.ZodString>;
        level: z.ZodOptional<z.ZodString>;
        nist_reference: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        title: z.ZodOptional<z.ZodString>;
        requirement_text: z.ZodOptional<z.ZodString>;
        domain: z.ZodOptional<z.ZodString>;
        level: z.ZodOptional<z.ZodString>;
        nist_reference: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>>;
    section: z.ZodOptional<z.ZodString>;
    resource_type: z.ZodOptional<z.ZodString>;
    layer: z.ZodOptional<z.ZodNumber>;
    tech_ref: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, z.ZodTypeAny, "passthrough">>;
export type ManualStep = z.infer<typeof ManualStepSchema>;
export declare const CheckSchema: z.ZodObject<{
    id: z.ZodString;
    description: z.ZodString;
    method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
    expected: z.ZodString;
    on_fail: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    id: z.ZodString;
    description: z.ZodString;
    method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
    expected: z.ZodString;
    on_fail: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    id: z.ZodString;
    description: z.ZodString;
    method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
    expected: z.ZodString;
    on_fail: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
export declare const NormativeControlSchema: z.ZodObject<{
    control_id: z.ZodString;
    required_state: z.ZodString;
    verification: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        description: z.ZodString;
        method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
        expected: z.ZodString;
        on_fail: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodString;
        description: z.ZodString;
        method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
        expected: z.ZodString;
        on_fail: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodString;
        description: z.ZodString;
        method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
        expected: z.ZodString;
        on_fail: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    evidence_artifacts: z.ZodArray<z.ZodObject<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    control_id: z.ZodString;
    required_state: z.ZodString;
    verification: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        description: z.ZodString;
        method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
        expected: z.ZodString;
        on_fail: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodString;
        description: z.ZodString;
        method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
        expected: z.ZodString;
        on_fail: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodString;
        description: z.ZodString;
        method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
        expected: z.ZodString;
        on_fail: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    evidence_artifacts: z.ZodArray<z.ZodObject<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    control_id: z.ZodString;
    required_state: z.ZodString;
    verification: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        description: z.ZodString;
        method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
        expected: z.ZodString;
        on_fail: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodString;
        description: z.ZodString;
        method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
        expected: z.ZodString;
        on_fail: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodString;
        description: z.ZodString;
        method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
        expected: z.ZodString;
        on_fail: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    evidence_artifacts: z.ZodArray<z.ZodObject<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        artifact_id: z.ZodString;
        artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
        description: z.ZodString;
        collector: z.ZodString;
        retention_days: z.ZodNumber;
        storage_location_ref: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
}, z.ZodTypeAny, "passthrough">>;
export declare const AssetSchema: z.ZodObject<{
    asset_id: z.ZodString;
    asset_type: z.ZodString;
    scope_category: z.ZodString;
    tags: z.ZodArray<z.ZodString, "many">;
    owner: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    asset_id: z.ZodString;
    asset_type: z.ZodString;
    scope_category: z.ZodString;
    tags: z.ZodArray<z.ZodString, "many">;
    owner: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    asset_id: z.ZodString;
    asset_type: z.ZodString;
    scope_category: z.ZodString;
    tags: z.ZodArray<z.ZodString, "many">;
    owner: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export declare const ConfigIntentSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    control_ids: z.ZodArray<z.ZodString, "many">;
    desired_config: z.ZodRecord<z.ZodString, z.ZodAny>;
    source_of_truth: z.ZodEnum<["iac", "policy_doc", "platform_setting", "manual"]>;
    query_method: z.ZodEnum<["api", "export", "log_query", "manual"]>;
    notes: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    id: z.ZodString;
    title: z.ZodString;
    control_ids: z.ZodArray<z.ZodString, "many">;
    desired_config: z.ZodRecord<z.ZodString, z.ZodAny>;
    source_of_truth: z.ZodEnum<["iac", "policy_doc", "platform_setting", "manual"]>;
    query_method: z.ZodEnum<["api", "export", "log_query", "manual"]>;
    notes: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    id: z.ZodString;
    title: z.ZodString;
    control_ids: z.ZodArray<z.ZodString, "many">;
    desired_config: z.ZodRecord<z.ZodString, z.ZodAny>;
    source_of_truth: z.ZodEnum<["iac", "policy_doc", "platform_setting", "manual"]>;
    query_method: z.ZodEnum<["api", "export", "log_query", "manual"]>;
    notes: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export declare const EvidenceMonitorSchema: z.ZodObject<{
    id: z.ZodString;
    control_ids: z.ZodArray<z.ZodString, "many">;
    signal: z.ZodString;
    collection_method: z.ZodEnum<["api_poll", "event_stream", "scheduled_export", "manual"]>;
    cadence: z.ZodString;
    retention_days: z.ZodNumber;
    on_drift: z.ZodString;
    sentinel_workspace: z.ZodOptional<z.ZodString>;
    sentinel_resource_group: z.ZodOptional<z.ZodString>;
    log_analytics_workspace_id: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    id: z.ZodString;
    control_ids: z.ZodArray<z.ZodString, "many">;
    signal: z.ZodString;
    collection_method: z.ZodEnum<["api_poll", "event_stream", "scheduled_export", "manual"]>;
    cadence: z.ZodString;
    retention_days: z.ZodNumber;
    on_drift: z.ZodString;
    sentinel_workspace: z.ZodOptional<z.ZodString>;
    sentinel_resource_group: z.ZodOptional<z.ZodString>;
    log_analytics_workspace_id: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    id: z.ZodString;
    control_ids: z.ZodArray<z.ZodString, "many">;
    signal: z.ZodString;
    collection_method: z.ZodEnum<["api_poll", "event_stream", "scheduled_export", "manual"]>;
    cadence: z.ZodString;
    retention_days: z.ZodNumber;
    on_drift: z.ZodString;
    sentinel_workspace: z.ZodOptional<z.ZodString>;
    sentinel_resource_group: z.ZodOptional<z.ZodString>;
    log_analytics_workspace_id: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export declare const DriftPolicySchema: z.ZodObject<{
    id: z.ZodString;
    scope: z.ZodString;
    severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
    detection: z.ZodArray<z.ZodString, "many">;
    response_playbook: z.ZodArray<z.ZodString, "many">;
    control_id: z.ZodOptional<z.ZodString>;
    config_key: z.ZodOptional<z.ZodString>;
    approval_status: z.ZodOptional<z.ZodEnum<["approved", "pending", "rejected"]>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    id: z.ZodString;
    scope: z.ZodString;
    severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
    detection: z.ZodArray<z.ZodString, "many">;
    response_playbook: z.ZodArray<z.ZodString, "many">;
    control_id: z.ZodOptional<z.ZodString>;
    config_key: z.ZodOptional<z.ZodString>;
    approval_status: z.ZodOptional<z.ZodEnum<["approved", "pending", "rejected"]>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    id: z.ZodString;
    scope: z.ZodString;
    severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
    detection: z.ZodArray<z.ZodString, "many">;
    response_playbook: z.ZodArray<z.ZodString, "many">;
    control_id: z.ZodOptional<z.ZodString>;
    config_key: z.ZodOptional<z.ZodString>;
    approval_status: z.ZodOptional<z.ZodEnum<["approved", "pending", "rejected"]>>;
}, z.ZodTypeAny, "passthrough">>;
export declare const SecretReferenceFormEnum: z.ZodEnum<["one_time_operator_held", "key_vault_secret"]>;
export type SecretReferenceForm = z.infer<typeof SecretReferenceFormEnum>;
export declare const OneTimeOperatorHeldSecretRefSchema: z.ZodObject<{
    variable: z.ZodString;
    form: z.ZodLiteral<"one_time_operator_held">;
    ref: z.ZodString;
}, "strict", z.ZodTypeAny, {
    variable: string;
    form: "one_time_operator_held";
    ref: string;
}, {
    variable: string;
    form: "one_time_operator_held";
    ref: string;
}>;
export declare const KeyVaultSecretRefSchema: z.ZodObject<{
    variable: z.ZodString;
    form: z.ZodLiteral<"key_vault_secret">;
    vault: z.ZodString;
    name: z.ZodString;
}, "strict", z.ZodTypeAny, {
    name: string;
    variable: string;
    form: "key_vault_secret";
    vault: string;
}, {
    name: string;
    variable: string;
    form: "key_vault_secret";
    vault: string;
}>;
export declare const SecretReferenceSchema: z.ZodDiscriminatedUnion<"form", [z.ZodObject<{
    variable: z.ZodString;
    form: z.ZodLiteral<"one_time_operator_held">;
    ref: z.ZodString;
}, "strict", z.ZodTypeAny, {
    variable: string;
    form: "one_time_operator_held";
    ref: string;
}, {
    variable: string;
    form: "one_time_operator_held";
    ref: string;
}>, z.ZodObject<{
    variable: z.ZodString;
    form: z.ZodLiteral<"key_vault_secret">;
    vault: z.ZodString;
    name: z.ZodString;
}, "strict", z.ZodTypeAny, {
    name: string;
    variable: string;
    form: "key_vault_secret";
    vault: string;
}, {
    name: string;
    variable: string;
    form: "key_vault_secret";
    vault: string;
}>]>;
export type SecretReference = z.infer<typeof SecretReferenceSchema>;
/**
 * Variable names that must NEVER carry a plain value in stamper_variable_map — they may only be
 * resolved via a SecretReference (secret_references[] / provisioning_inputs). Extend as new secret
 * variables are introduced.
 */
export declare const SECRET_VARIABLE_NAMES: readonly ["initialPassword"];
export declare const ProvisioningInputsSchema: z.ZodObject<{
    approver_upn: z.ZodString;
    terms_of_use_file: z.ZodObject<{
        file_name: z.ZodString;
        content_base64: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        file_name: z.ZodString;
        content_base64: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        file_name: z.ZodString;
        content_base64: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>;
    initial_password_ref: z.ZodDiscriminatedUnion<"form", [z.ZodObject<{
        variable: z.ZodString;
        form: z.ZodLiteral<"one_time_operator_held">;
        ref: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        variable: string;
        form: "one_time_operator_held";
        ref: string;
    }, {
        variable: string;
        form: "one_time_operator_held";
        ref: string;
    }>, z.ZodObject<{
        variable: z.ZodString;
        form: z.ZodLiteral<"key_vault_secret">;
        vault: z.ZodString;
        name: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        name: string;
        variable: string;
        form: "key_vault_secret";
        vault: string;
    }, {
        name: string;
        variable: string;
        form: "key_vault_secret";
        vault: string;
    }>]>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    approver_upn: z.ZodString;
    terms_of_use_file: z.ZodObject<{
        file_name: z.ZodString;
        content_base64: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        file_name: z.ZodString;
        content_base64: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        file_name: z.ZodString;
        content_base64: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>;
    initial_password_ref: z.ZodDiscriminatedUnion<"form", [z.ZodObject<{
        variable: z.ZodString;
        form: z.ZodLiteral<"one_time_operator_held">;
        ref: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        variable: string;
        form: "one_time_operator_held";
        ref: string;
    }, {
        variable: string;
        form: "one_time_operator_held";
        ref: string;
    }>, z.ZodObject<{
        variable: z.ZodString;
        form: z.ZodLiteral<"key_vault_secret">;
        vault: z.ZodString;
        name: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        name: string;
        variable: string;
        form: "key_vault_secret";
        vault: string;
    }, {
        name: string;
        variable: string;
        form: "key_vault_secret";
        vault: string;
    }>]>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    approver_upn: z.ZodString;
    terms_of_use_file: z.ZodObject<{
        file_name: z.ZodString;
        content_base64: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        file_name: z.ZodString;
        content_base64: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        file_name: z.ZodString;
        content_base64: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>;
    initial_password_ref: z.ZodDiscriminatedUnion<"form", [z.ZodObject<{
        variable: z.ZodString;
        form: z.ZodLiteral<"one_time_operator_held">;
        ref: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        variable: string;
        form: "one_time_operator_held";
        ref: string;
    }, {
        variable: string;
        form: "one_time_operator_held";
        ref: string;
    }>, z.ZodObject<{
        variable: z.ZodString;
        form: z.ZodLiteral<"key_vault_secret">;
        vault: z.ZodString;
        name: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        name: string;
        variable: string;
        form: "key_vault_secret";
        vault: string;
    }, {
        name: string;
        variable: string;
        form: "key_vault_secret";
        vault: string;
    }>]>;
}, z.ZodTypeAny, "passthrough">>;
export type ProvisioningInputs = z.infer<typeof ProvisioningInputsSchema>;
export declare const TenantIdentitySchema: z.ZodObject<{
    tenant_id: z.ZodString;
    primary_domain: z.ZodString;
    cloud_environment: z.ZodString;
    display_name: z.ZodString;
    primary_sku: z.ZodString;
    license_count: z.ZodNumber;
    custom_domains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    addon_skus: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    service_activations: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    tenant_id: z.ZodString;
    primary_domain: z.ZodString;
    cloud_environment: z.ZodString;
    display_name: z.ZodString;
    primary_sku: z.ZodString;
    license_count: z.ZodNumber;
    custom_domains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    addon_skus: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    service_activations: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    tenant_id: z.ZodString;
    primary_domain: z.ZodString;
    cloud_environment: z.ZodString;
    display_name: z.ZodString;
    primary_sku: z.ZodString;
    license_count: z.ZodNumber;
    custom_domains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    addon_skus: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    service_activations: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, z.ZodTypeAny, "passthrough">>;
export declare const BoundaryZoneDefinitionSchema: z.ZodObject<{
    key: z.ZodString;
    value: z.ZodAny;
    type: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    key: z.ZodString;
    value: z.ZodAny;
    type: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    key: z.ZodString;
    value: z.ZodAny;
    type: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
export declare const BoundaryZonesSchema: z.ZodObject<{
    cui_boundary_version: z.ZodString;
    definitions: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodAny;
        type: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        key: z.ZodString;
        value: z.ZodAny;
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        key: z.ZodString;
        value: z.ZodAny;
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    cui_boundary_version: z.ZodString;
    definitions: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodAny;
        type: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        key: z.ZodString;
        value: z.ZodAny;
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        key: z.ZodString;
        value: z.ZodAny;
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    cui_boundary_version: z.ZodString;
    definitions: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodAny;
        type: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        key: z.ZodString;
        value: z.ZodAny;
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        key: z.ZodString;
        value: z.ZodAny;
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
}, z.ZodTypeAny, "passthrough">>;
export declare const TenantManifestBodySchema: z.ZodObject<{
    manifest_id: z.ZodString;
    tech_stack_id: z.ZodNumber;
    normative_controls: z.ZodArray<z.ZodObject<{
        control_id: z.ZodString;
        required_state: z.ZodString;
        verification: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        evidence_artifacts: z.ZodArray<z.ZodObject<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        control_id: z.ZodString;
        required_state: z.ZodString;
        verification: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        evidence_artifacts: z.ZodArray<z.ZodObject<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        control_id: z.ZodString;
        required_state: z.ZodString;
        verification: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        evidence_artifacts: z.ZodArray<z.ZodObject<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    assets: z.ZodArray<z.ZodObject<{
        asset_id: z.ZodString;
        asset_type: z.ZodString;
        scope_category: z.ZodString;
        tags: z.ZodArray<z.ZodString, "many">;
        owner: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        asset_id: z.ZodString;
        asset_type: z.ZodString;
        scope_category: z.ZodString;
        tags: z.ZodArray<z.ZodString, "many">;
        owner: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        asset_id: z.ZodString;
        asset_type: z.ZodString;
        scope_category: z.ZodString;
        tags: z.ZodArray<z.ZodString, "many">;
        owner: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    config_intents: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        desired_config: z.ZodRecord<z.ZodString, z.ZodAny>;
        source_of_truth: z.ZodEnum<["iac", "policy_doc", "platform_setting", "manual"]>;
        query_method: z.ZodEnum<["api", "export", "log_query", "manual"]>;
        notes: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodString;
        title: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        desired_config: z.ZodRecord<z.ZodString, z.ZodAny>;
        source_of_truth: z.ZodEnum<["iac", "policy_doc", "platform_setting", "manual"]>;
        query_method: z.ZodEnum<["api", "export", "log_query", "manual"]>;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodString;
        title: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        desired_config: z.ZodRecord<z.ZodString, z.ZodAny>;
        source_of_truth: z.ZodEnum<["iac", "policy_doc", "platform_setting", "manual"]>;
        query_method: z.ZodEnum<["api", "export", "log_query", "manual"]>;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    evidence_monitors: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        signal: z.ZodString;
        collection_method: z.ZodEnum<["api_poll", "event_stream", "scheduled_export", "manual"]>;
        cadence: z.ZodString;
        retention_days: z.ZodNumber;
        on_drift: z.ZodString;
        sentinel_workspace: z.ZodOptional<z.ZodString>;
        sentinel_resource_group: z.ZodOptional<z.ZodString>;
        log_analytics_workspace_id: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        signal: z.ZodString;
        collection_method: z.ZodEnum<["api_poll", "event_stream", "scheduled_export", "manual"]>;
        cadence: z.ZodString;
        retention_days: z.ZodNumber;
        on_drift: z.ZodString;
        sentinel_workspace: z.ZodOptional<z.ZodString>;
        sentinel_resource_group: z.ZodOptional<z.ZodString>;
        log_analytics_workspace_id: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        signal: z.ZodString;
        collection_method: z.ZodEnum<["api_poll", "event_stream", "scheduled_export", "manual"]>;
        cadence: z.ZodString;
        retention_days: z.ZodNumber;
        on_drift: z.ZodString;
        sentinel_workspace: z.ZodOptional<z.ZodString>;
        sentinel_resource_group: z.ZodOptional<z.ZodString>;
        log_analytics_workspace_id: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    drift_policies: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        scope: z.ZodString;
        severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
        detection: z.ZodArray<z.ZodString, "many">;
        response_playbook: z.ZodArray<z.ZodString, "many">;
        control_id: z.ZodOptional<z.ZodString>;
        config_key: z.ZodOptional<z.ZodString>;
        approval_status: z.ZodOptional<z.ZodEnum<["approved", "pending", "rejected"]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodString;
        scope: z.ZodString;
        severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
        detection: z.ZodArray<z.ZodString, "many">;
        response_playbook: z.ZodArray<z.ZodString, "many">;
        control_id: z.ZodOptional<z.ZodString>;
        config_key: z.ZodOptional<z.ZodString>;
        approval_status: z.ZodOptional<z.ZodEnum<["approved", "pending", "rejected"]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodString;
        scope: z.ZodString;
        severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
        detection: z.ZodArray<z.ZodString, "many">;
        response_playbook: z.ZodArray<z.ZodString, "many">;
        control_id: z.ZodOptional<z.ZodString>;
        config_key: z.ZodOptional<z.ZodString>;
        approval_status: z.ZodOptional<z.ZodEnum<["approved", "pending", "rejected"]>>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    tenant_identity: z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        tenant_id: z.ZodString;
        primary_domain: z.ZodString;
        cloud_environment: z.ZodString;
        display_name: z.ZodString;
        primary_sku: z.ZodString;
        license_count: z.ZodNumber;
        custom_domains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        addon_skus: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        service_activations: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        tenant_id: z.ZodString;
        primary_domain: z.ZodString;
        cloud_environment: z.ZodString;
        display_name: z.ZodString;
        primary_sku: z.ZodString;
        license_count: z.ZodNumber;
        custom_domains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        addon_skus: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        service_activations: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        tenant_id: z.ZodString;
        primary_domain: z.ZodString;
        cloud_environment: z.ZodString;
        display_name: z.ZodString;
        primary_sku: z.ZodString;
        license_count: z.ZodNumber;
        custom_domains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        addon_skus: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        service_activations: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">>, z.ZodRecord<z.ZodString, z.ZodAny>]>>;
    boundary_zones: z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        cui_boundary_version: z.ZodString;
        definitions: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        cui_boundary_version: z.ZodString;
        definitions: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        cui_boundary_version: z.ZodString;
        definitions: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, z.ZodTypeAny, "passthrough">>, z.ZodArray<z.ZodRecord<z.ZodString, z.ZodAny>, "many">]>>;
    provisioning_inputs: z.ZodOptional<z.ZodObject<{
        approver_upn: z.ZodString;
        terms_of_use_file: z.ZodObject<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>;
        initial_password_ref: z.ZodDiscriminatedUnion<"form", [z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"one_time_operator_held">;
            ref: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }>, z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"key_vault_secret">;
            vault: z.ZodString;
            name: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }>]>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        approver_upn: z.ZodString;
        terms_of_use_file: z.ZodObject<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>;
        initial_password_ref: z.ZodDiscriminatedUnion<"form", [z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"one_time_operator_held">;
            ref: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }>, z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"key_vault_secret">;
            vault: z.ZodString;
            name: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }>]>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        approver_upn: z.ZodString;
        terms_of_use_file: z.ZodObject<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>;
        initial_password_ref: z.ZodDiscriminatedUnion<"form", [z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"one_time_operator_held">;
            ref: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }>, z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"key_vault_secret">;
            vault: z.ZodString;
            name: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }>]>;
    }, z.ZodTypeAny, "passthrough">>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    manifest_id: z.ZodString;
    tech_stack_id: z.ZodNumber;
    normative_controls: z.ZodArray<z.ZodObject<{
        control_id: z.ZodString;
        required_state: z.ZodString;
        verification: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        evidence_artifacts: z.ZodArray<z.ZodObject<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        control_id: z.ZodString;
        required_state: z.ZodString;
        verification: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        evidence_artifacts: z.ZodArray<z.ZodObject<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        control_id: z.ZodString;
        required_state: z.ZodString;
        verification: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        evidence_artifacts: z.ZodArray<z.ZodObject<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    assets: z.ZodArray<z.ZodObject<{
        asset_id: z.ZodString;
        asset_type: z.ZodString;
        scope_category: z.ZodString;
        tags: z.ZodArray<z.ZodString, "many">;
        owner: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        asset_id: z.ZodString;
        asset_type: z.ZodString;
        scope_category: z.ZodString;
        tags: z.ZodArray<z.ZodString, "many">;
        owner: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        asset_id: z.ZodString;
        asset_type: z.ZodString;
        scope_category: z.ZodString;
        tags: z.ZodArray<z.ZodString, "many">;
        owner: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    config_intents: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        desired_config: z.ZodRecord<z.ZodString, z.ZodAny>;
        source_of_truth: z.ZodEnum<["iac", "policy_doc", "platform_setting", "manual"]>;
        query_method: z.ZodEnum<["api", "export", "log_query", "manual"]>;
        notes: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodString;
        title: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        desired_config: z.ZodRecord<z.ZodString, z.ZodAny>;
        source_of_truth: z.ZodEnum<["iac", "policy_doc", "platform_setting", "manual"]>;
        query_method: z.ZodEnum<["api", "export", "log_query", "manual"]>;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodString;
        title: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        desired_config: z.ZodRecord<z.ZodString, z.ZodAny>;
        source_of_truth: z.ZodEnum<["iac", "policy_doc", "platform_setting", "manual"]>;
        query_method: z.ZodEnum<["api", "export", "log_query", "manual"]>;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    evidence_monitors: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        signal: z.ZodString;
        collection_method: z.ZodEnum<["api_poll", "event_stream", "scheduled_export", "manual"]>;
        cadence: z.ZodString;
        retention_days: z.ZodNumber;
        on_drift: z.ZodString;
        sentinel_workspace: z.ZodOptional<z.ZodString>;
        sentinel_resource_group: z.ZodOptional<z.ZodString>;
        log_analytics_workspace_id: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        signal: z.ZodString;
        collection_method: z.ZodEnum<["api_poll", "event_stream", "scheduled_export", "manual"]>;
        cadence: z.ZodString;
        retention_days: z.ZodNumber;
        on_drift: z.ZodString;
        sentinel_workspace: z.ZodOptional<z.ZodString>;
        sentinel_resource_group: z.ZodOptional<z.ZodString>;
        log_analytics_workspace_id: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        signal: z.ZodString;
        collection_method: z.ZodEnum<["api_poll", "event_stream", "scheduled_export", "manual"]>;
        cadence: z.ZodString;
        retention_days: z.ZodNumber;
        on_drift: z.ZodString;
        sentinel_workspace: z.ZodOptional<z.ZodString>;
        sentinel_resource_group: z.ZodOptional<z.ZodString>;
        log_analytics_workspace_id: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    drift_policies: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        scope: z.ZodString;
        severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
        detection: z.ZodArray<z.ZodString, "many">;
        response_playbook: z.ZodArray<z.ZodString, "many">;
        control_id: z.ZodOptional<z.ZodString>;
        config_key: z.ZodOptional<z.ZodString>;
        approval_status: z.ZodOptional<z.ZodEnum<["approved", "pending", "rejected"]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodString;
        scope: z.ZodString;
        severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
        detection: z.ZodArray<z.ZodString, "many">;
        response_playbook: z.ZodArray<z.ZodString, "many">;
        control_id: z.ZodOptional<z.ZodString>;
        config_key: z.ZodOptional<z.ZodString>;
        approval_status: z.ZodOptional<z.ZodEnum<["approved", "pending", "rejected"]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodString;
        scope: z.ZodString;
        severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
        detection: z.ZodArray<z.ZodString, "many">;
        response_playbook: z.ZodArray<z.ZodString, "many">;
        control_id: z.ZodOptional<z.ZodString>;
        config_key: z.ZodOptional<z.ZodString>;
        approval_status: z.ZodOptional<z.ZodEnum<["approved", "pending", "rejected"]>>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    tenant_identity: z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        tenant_id: z.ZodString;
        primary_domain: z.ZodString;
        cloud_environment: z.ZodString;
        display_name: z.ZodString;
        primary_sku: z.ZodString;
        license_count: z.ZodNumber;
        custom_domains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        addon_skus: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        service_activations: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        tenant_id: z.ZodString;
        primary_domain: z.ZodString;
        cloud_environment: z.ZodString;
        display_name: z.ZodString;
        primary_sku: z.ZodString;
        license_count: z.ZodNumber;
        custom_domains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        addon_skus: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        service_activations: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        tenant_id: z.ZodString;
        primary_domain: z.ZodString;
        cloud_environment: z.ZodString;
        display_name: z.ZodString;
        primary_sku: z.ZodString;
        license_count: z.ZodNumber;
        custom_domains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        addon_skus: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        service_activations: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">>, z.ZodRecord<z.ZodString, z.ZodAny>]>>;
    boundary_zones: z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        cui_boundary_version: z.ZodString;
        definitions: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        cui_boundary_version: z.ZodString;
        definitions: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        cui_boundary_version: z.ZodString;
        definitions: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, z.ZodTypeAny, "passthrough">>, z.ZodArray<z.ZodRecord<z.ZodString, z.ZodAny>, "many">]>>;
    provisioning_inputs: z.ZodOptional<z.ZodObject<{
        approver_upn: z.ZodString;
        terms_of_use_file: z.ZodObject<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>;
        initial_password_ref: z.ZodDiscriminatedUnion<"form", [z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"one_time_operator_held">;
            ref: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }>, z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"key_vault_secret">;
            vault: z.ZodString;
            name: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }>]>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        approver_upn: z.ZodString;
        terms_of_use_file: z.ZodObject<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>;
        initial_password_ref: z.ZodDiscriminatedUnion<"form", [z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"one_time_operator_held">;
            ref: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }>, z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"key_vault_secret">;
            vault: z.ZodString;
            name: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }>]>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        approver_upn: z.ZodString;
        terms_of_use_file: z.ZodObject<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>;
        initial_password_ref: z.ZodDiscriminatedUnion<"form", [z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"one_time_operator_held">;
            ref: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }>, z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"key_vault_secret">;
            vault: z.ZodString;
            name: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }>]>;
    }, z.ZodTypeAny, "passthrough">>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    manifest_id: z.ZodString;
    tech_stack_id: z.ZodNumber;
    normative_controls: z.ZodArray<z.ZodObject<{
        control_id: z.ZodString;
        required_state: z.ZodString;
        verification: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        evidence_artifacts: z.ZodArray<z.ZodObject<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        control_id: z.ZodString;
        required_state: z.ZodString;
        verification: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        evidence_artifacts: z.ZodArray<z.ZodObject<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        control_id: z.ZodString;
        required_state: z.ZodString;
        verification: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            id: z.ZodString;
            description: z.ZodString;
            method: z.ZodEnum<["api_query", "config_export", "log_query", "event_stream", "manual"]>;
            expected: z.ZodString;
            on_fail: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
        evidence_artifacts: z.ZodArray<z.ZodObject<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            artifact_id: z.ZodString;
            artifact_type: z.ZodEnum<["policy", "procedure", "ssp", "diagram", "config_export", "log_export", "ticket_export", "training_record", "scan_report", "attestation", "other"]>;
            description: z.ZodString;
            collector: z.ZodString;
            retention_days: z.ZodNumber;
            storage_location_ref: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    assets: z.ZodArray<z.ZodObject<{
        asset_id: z.ZodString;
        asset_type: z.ZodString;
        scope_category: z.ZodString;
        tags: z.ZodArray<z.ZodString, "many">;
        owner: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        asset_id: z.ZodString;
        asset_type: z.ZodString;
        scope_category: z.ZodString;
        tags: z.ZodArray<z.ZodString, "many">;
        owner: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        asset_id: z.ZodString;
        asset_type: z.ZodString;
        scope_category: z.ZodString;
        tags: z.ZodArray<z.ZodString, "many">;
        owner: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    config_intents: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        desired_config: z.ZodRecord<z.ZodString, z.ZodAny>;
        source_of_truth: z.ZodEnum<["iac", "policy_doc", "platform_setting", "manual"]>;
        query_method: z.ZodEnum<["api", "export", "log_query", "manual"]>;
        notes: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodString;
        title: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        desired_config: z.ZodRecord<z.ZodString, z.ZodAny>;
        source_of_truth: z.ZodEnum<["iac", "policy_doc", "platform_setting", "manual"]>;
        query_method: z.ZodEnum<["api", "export", "log_query", "manual"]>;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodString;
        title: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        desired_config: z.ZodRecord<z.ZodString, z.ZodAny>;
        source_of_truth: z.ZodEnum<["iac", "policy_doc", "platform_setting", "manual"]>;
        query_method: z.ZodEnum<["api", "export", "log_query", "manual"]>;
        notes: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    evidence_monitors: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        signal: z.ZodString;
        collection_method: z.ZodEnum<["api_poll", "event_stream", "scheduled_export", "manual"]>;
        cadence: z.ZodString;
        retention_days: z.ZodNumber;
        on_drift: z.ZodString;
        sentinel_workspace: z.ZodOptional<z.ZodString>;
        sentinel_resource_group: z.ZodOptional<z.ZodString>;
        log_analytics_workspace_id: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        signal: z.ZodString;
        collection_method: z.ZodEnum<["api_poll", "event_stream", "scheduled_export", "manual"]>;
        cadence: z.ZodString;
        retention_days: z.ZodNumber;
        on_drift: z.ZodString;
        sentinel_workspace: z.ZodOptional<z.ZodString>;
        sentinel_resource_group: z.ZodOptional<z.ZodString>;
        log_analytics_workspace_id: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        signal: z.ZodString;
        collection_method: z.ZodEnum<["api_poll", "event_stream", "scheduled_export", "manual"]>;
        cadence: z.ZodString;
        retention_days: z.ZodNumber;
        on_drift: z.ZodString;
        sentinel_workspace: z.ZodOptional<z.ZodString>;
        sentinel_resource_group: z.ZodOptional<z.ZodString>;
        log_analytics_workspace_id: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    drift_policies: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        scope: z.ZodString;
        severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
        detection: z.ZodArray<z.ZodString, "many">;
        response_playbook: z.ZodArray<z.ZodString, "many">;
        control_id: z.ZodOptional<z.ZodString>;
        config_key: z.ZodOptional<z.ZodString>;
        approval_status: z.ZodOptional<z.ZodEnum<["approved", "pending", "rejected"]>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        id: z.ZodString;
        scope: z.ZodString;
        severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
        detection: z.ZodArray<z.ZodString, "many">;
        response_playbook: z.ZodArray<z.ZodString, "many">;
        control_id: z.ZodOptional<z.ZodString>;
        config_key: z.ZodOptional<z.ZodString>;
        approval_status: z.ZodOptional<z.ZodEnum<["approved", "pending", "rejected"]>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        id: z.ZodString;
        scope: z.ZodString;
        severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
        detection: z.ZodArray<z.ZodString, "many">;
        response_playbook: z.ZodArray<z.ZodString, "many">;
        control_id: z.ZodOptional<z.ZodString>;
        config_key: z.ZodOptional<z.ZodString>;
        approval_status: z.ZodOptional<z.ZodEnum<["approved", "pending", "rejected"]>>;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    tenant_identity: z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        tenant_id: z.ZodString;
        primary_domain: z.ZodString;
        cloud_environment: z.ZodString;
        display_name: z.ZodString;
        primary_sku: z.ZodString;
        license_count: z.ZodNumber;
        custom_domains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        addon_skus: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        service_activations: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        tenant_id: z.ZodString;
        primary_domain: z.ZodString;
        cloud_environment: z.ZodString;
        display_name: z.ZodString;
        primary_sku: z.ZodString;
        license_count: z.ZodNumber;
        custom_domains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        addon_skus: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        service_activations: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        tenant_id: z.ZodString;
        primary_domain: z.ZodString;
        cloud_environment: z.ZodString;
        display_name: z.ZodString;
        primary_sku: z.ZodString;
        license_count: z.ZodNumber;
        custom_domains: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        addon_skus: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        service_activations: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, z.ZodTypeAny, "passthrough">>, z.ZodRecord<z.ZodString, z.ZodAny>]>>;
    boundary_zones: z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        cui_boundary_version: z.ZodString;
        definitions: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        cui_boundary_version: z.ZodString;
        definitions: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        cui_boundary_version: z.ZodString;
        definitions: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            key: z.ZodString;
            value: z.ZodAny;
            type: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>, "many">;
    }, z.ZodTypeAny, "passthrough">>, z.ZodArray<z.ZodRecord<z.ZodString, z.ZodAny>, "many">]>>;
    provisioning_inputs: z.ZodOptional<z.ZodObject<{
        approver_upn: z.ZodString;
        terms_of_use_file: z.ZodObject<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>;
        initial_password_ref: z.ZodDiscriminatedUnion<"form", [z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"one_time_operator_held">;
            ref: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }>, z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"key_vault_secret">;
            vault: z.ZodString;
            name: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }>]>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        approver_upn: z.ZodString;
        terms_of_use_file: z.ZodObject<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>;
        initial_password_ref: z.ZodDiscriminatedUnion<"form", [z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"one_time_operator_held">;
            ref: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }>, z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"key_vault_secret">;
            vault: z.ZodString;
            name: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }>]>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        approver_upn: z.ZodString;
        terms_of_use_file: z.ZodObject<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            file_name: z.ZodString;
            content_base64: z.ZodString;
        }, z.ZodTypeAny, "passthrough">>;
        initial_password_ref: z.ZodDiscriminatedUnion<"form", [z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"one_time_operator_held">;
            ref: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }, {
            variable: string;
            form: "one_time_operator_held";
            ref: string;
        }>, z.ZodObject<{
            variable: z.ZodString;
            form: z.ZodLiteral<"key_vault_secret">;
            vault: z.ZodString;
            name: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }, {
            name: string;
            variable: string;
            form: "key_vault_secret";
            vault: string;
        }>]>;
    }, z.ZodTypeAny, "passthrough">>>;
}, z.ZodTypeAny, "passthrough">>;
export type TenantManifestBody = z.infer<typeof TenantManifestBodySchema>;
export declare const InfraResourceSpecSchema: z.ZodObject<{
    resource_id: z.ZodString;
    resource_type: z.ZodString;
    name: z.ZodString;
    control_ids: z.ZodArray<z.ZodString, "many">;
    registry_entry_ids: z.ZodArray<z.ZodString, "many">;
    properties: z.ZodRecord<z.ZodString, z.ZodAny>;
    depends_on: z.ZodArray<z.ZodString, "many">;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    resource_id: z.ZodString;
    resource_type: z.ZodString;
    name: z.ZodString;
    control_ids: z.ZodArray<z.ZodString, "many">;
    registry_entry_ids: z.ZodArray<z.ZodString, "many">;
    properties: z.ZodRecord<z.ZodString, z.ZodAny>;
    depends_on: z.ZodArray<z.ZodString, "many">;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    resource_id: z.ZodString;
    resource_type: z.ZodString;
    name: z.ZodString;
    control_ids: z.ZodArray<z.ZodString, "many">;
    registry_entry_ids: z.ZodArray<z.ZodString, "many">;
    properties: z.ZodRecord<z.ZodString, z.ZodAny>;
    depends_on: z.ZodArray<z.ZodString, "many">;
}, z.ZodTypeAny, "passthrough">>;
export declare const InfraVariableMapSchema: z.ZodObject<{
    subscriptionId: z.ZodString;
    resourceGroup: z.ZodString;
    location: z.ZodString;
    lawWorkspaceName: z.ZodString;
    eoAppDisplayName: z.ZodString;
    storageAccountName: z.ZodString;
    keyVaultName: z.ZodString;
    cmkKeyName: z.ZodString;
    vnetName: z.ZodString;
    vnetCidr: z.ZodString;
    subnetPeName: z.ZodString;
    subnetPeCidr: z.ZodString;
    nsgPeName: z.ZodString;
    automationAccountName: z.ZodString;
    mgmtSubnetCidr: z.ZodOptional<z.ZodString>;
    workloadSubnetCidr: z.ZodOptional<z.ZodString>;
    bastionSubnetCidr: z.ZodOptional<z.ZodString>;
    firewallSubnetCidr: z.ZodOptional<z.ZodString>;
    identitySubnetCidr: z.ZodOptional<z.ZodString>;
    peSubnetCidr: z.ZodOptional<z.ZodString>;
    /** @deprecated Muster's name for `firewallSubnetCidr`; normalized onto it by InfraManifestSchema. */
    fwSubnetCidr: z.ZodOptional<z.ZodString>;
    firewallName: z.ZodOptional<z.ZodString>;
    publicIpName: z.ZodOptional<z.ZodString>;
    vmName: z.ZodOptional<z.ZodString>;
    vmImage: z.ZodOptional<z.ZodString>;
    vmSize: z.ZodOptional<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    subscriptionId: z.ZodString;
    resourceGroup: z.ZodString;
    location: z.ZodString;
    lawWorkspaceName: z.ZodString;
    eoAppDisplayName: z.ZodString;
    storageAccountName: z.ZodString;
    keyVaultName: z.ZodString;
    cmkKeyName: z.ZodString;
    vnetName: z.ZodString;
    vnetCidr: z.ZodString;
    subnetPeName: z.ZodString;
    subnetPeCidr: z.ZodString;
    nsgPeName: z.ZodString;
    automationAccountName: z.ZodString;
    mgmtSubnetCidr: z.ZodOptional<z.ZodString>;
    workloadSubnetCidr: z.ZodOptional<z.ZodString>;
    bastionSubnetCidr: z.ZodOptional<z.ZodString>;
    firewallSubnetCidr: z.ZodOptional<z.ZodString>;
    identitySubnetCidr: z.ZodOptional<z.ZodString>;
    peSubnetCidr: z.ZodOptional<z.ZodString>;
    /** @deprecated Muster's name for `firewallSubnetCidr`; normalized onto it by InfraManifestSchema. */
    fwSubnetCidr: z.ZodOptional<z.ZodString>;
    firewallName: z.ZodOptional<z.ZodString>;
    publicIpName: z.ZodOptional<z.ZodString>;
    vmName: z.ZodOptional<z.ZodString>;
    vmImage: z.ZodOptional<z.ZodString>;
    vmSize: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    subscriptionId: z.ZodString;
    resourceGroup: z.ZodString;
    location: z.ZodString;
    lawWorkspaceName: z.ZodString;
    eoAppDisplayName: z.ZodString;
    storageAccountName: z.ZodString;
    keyVaultName: z.ZodString;
    cmkKeyName: z.ZodString;
    vnetName: z.ZodString;
    vnetCidr: z.ZodString;
    subnetPeName: z.ZodString;
    subnetPeCidr: z.ZodString;
    nsgPeName: z.ZodString;
    automationAccountName: z.ZodString;
    mgmtSubnetCidr: z.ZodOptional<z.ZodString>;
    workloadSubnetCidr: z.ZodOptional<z.ZodString>;
    bastionSubnetCidr: z.ZodOptional<z.ZodString>;
    firewallSubnetCidr: z.ZodOptional<z.ZodString>;
    identitySubnetCidr: z.ZodOptional<z.ZodString>;
    peSubnetCidr: z.ZodOptional<z.ZodString>;
    /** @deprecated Muster's name for `firewallSubnetCidr`; normalized onto it by InfraManifestSchema. */
    fwSubnetCidr: z.ZodOptional<z.ZodString>;
    firewallName: z.ZodOptional<z.ZodString>;
    publicIpName: z.ZodOptional<z.ZodString>;
    vmName: z.ZodOptional<z.ZodString>;
    vmImage: z.ZodOptional<z.ZodString>;
    vmSize: z.ZodOptional<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
/**
 * W4-SH2: deprecated variable-name aliases → canonical name Stamper resolves.
 * InfraManifestSchema copies an alias value onto its canonical key when the canonical key is absent/empty
 * and rejects a manifest where both are set to different non-empty values.
 */
export declare const INFRA_VARIABLE_ALIASES: {
    readonly fwSubnetCidr: "firewallSubnetCidr";
};
/** Variables Stamper's BaselineProvisioner requires to be NON-EMPTY before it will provision (m365_azure). */
export declare const STAMPER_PROVISIONING_REQUIRED_VARIABLES: readonly ["subscriptionId", "resourceGroup", "location", "lawWorkspaceName", "storageAccountName", "keyVaultName", "cmkKeyName", "vnetName", "vnetCidr", "subnetPeName", "subnetPeCidr", "nsgPeName", "automationAccountName", "eoAppDisplayName"];
/** Return a copy of a variable map with deprecated aliases copied onto their canonical names (alias kept). */
export declare function normalizeInfraVariableMap<T extends Record<string, unknown>>(map: T): T;
export declare const InfraProvenanceEntrySchema: z.ZodObject<{
    field: z.ZodString;
    value: z.ZodUnknown;
    source: z.ZodEnum<["si_baseline", "tcp", "convention", "default", "policy_odp"]>;
    rule: z.ZodString;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    field: z.ZodString;
    value: z.ZodUnknown;
    source: z.ZodEnum<["si_baseline", "tcp", "convention", "default", "policy_odp"]>;
    rule: z.ZodString;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    field: z.ZodString;
    value: z.ZodUnknown;
    source: z.ZodEnum<["si_baseline", "tcp", "convention", "default", "policy_odp"]>;
    rule: z.ZodString;
}, z.ZodTypeAny, "passthrough">>;
export declare const RegistryCoverageSchema: z.ZodObject<{
    total_infra_entries: z.ZodNumber;
    covered_entry_ids: z.ZodArray<z.ZodString, "many">;
    uncovered_entry_ids: z.ZodArray<z.ZodString, "many">;
    coverage_pct: z.ZodNumber;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    total_infra_entries: z.ZodNumber;
    covered_entry_ids: z.ZodArray<z.ZodString, "many">;
    uncovered_entry_ids: z.ZodArray<z.ZodString, "many">;
    coverage_pct: z.ZodNumber;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    total_infra_entries: z.ZodNumber;
    covered_entry_ids: z.ZodArray<z.ZodString, "many">;
    uncovered_entry_ids: z.ZodArray<z.ZodString, "many">;
    coverage_pct: z.ZodNumber;
}, z.ZodTypeAny, "passthrough">>;
export declare const InfrastructureBodySchema: z.ZodObject<{
    identity: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    logging: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    security: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    storage: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    network: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    automation: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    diagnostics: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    stamper_variable_map: z.ZodObject<{
        subscriptionId: z.ZodString;
        resourceGroup: z.ZodString;
        location: z.ZodString;
        lawWorkspaceName: z.ZodString;
        eoAppDisplayName: z.ZodString;
        storageAccountName: z.ZodString;
        keyVaultName: z.ZodString;
        cmkKeyName: z.ZodString;
        vnetName: z.ZodString;
        vnetCidr: z.ZodString;
        subnetPeName: z.ZodString;
        subnetPeCidr: z.ZodString;
        nsgPeName: z.ZodString;
        automationAccountName: z.ZodString;
        mgmtSubnetCidr: z.ZodOptional<z.ZodString>;
        workloadSubnetCidr: z.ZodOptional<z.ZodString>;
        bastionSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallSubnetCidr: z.ZodOptional<z.ZodString>;
        identitySubnetCidr: z.ZodOptional<z.ZodString>;
        peSubnetCidr: z.ZodOptional<z.ZodString>;
        /** @deprecated Muster's name for `firewallSubnetCidr`; normalized onto it by InfraManifestSchema. */
        fwSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallName: z.ZodOptional<z.ZodString>;
        publicIpName: z.ZodOptional<z.ZodString>;
        vmName: z.ZodOptional<z.ZodString>;
        vmImage: z.ZodOptional<z.ZodString>;
        vmSize: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        subscriptionId: z.ZodString;
        resourceGroup: z.ZodString;
        location: z.ZodString;
        lawWorkspaceName: z.ZodString;
        eoAppDisplayName: z.ZodString;
        storageAccountName: z.ZodString;
        keyVaultName: z.ZodString;
        cmkKeyName: z.ZodString;
        vnetName: z.ZodString;
        vnetCidr: z.ZodString;
        subnetPeName: z.ZodString;
        subnetPeCidr: z.ZodString;
        nsgPeName: z.ZodString;
        automationAccountName: z.ZodString;
        mgmtSubnetCidr: z.ZodOptional<z.ZodString>;
        workloadSubnetCidr: z.ZodOptional<z.ZodString>;
        bastionSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallSubnetCidr: z.ZodOptional<z.ZodString>;
        identitySubnetCidr: z.ZodOptional<z.ZodString>;
        peSubnetCidr: z.ZodOptional<z.ZodString>;
        /** @deprecated Muster's name for `firewallSubnetCidr`; normalized onto it by InfraManifestSchema. */
        fwSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallName: z.ZodOptional<z.ZodString>;
        publicIpName: z.ZodOptional<z.ZodString>;
        vmName: z.ZodOptional<z.ZodString>;
        vmImage: z.ZodOptional<z.ZodString>;
        vmSize: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        subscriptionId: z.ZodString;
        resourceGroup: z.ZodString;
        location: z.ZodString;
        lawWorkspaceName: z.ZodString;
        eoAppDisplayName: z.ZodString;
        storageAccountName: z.ZodString;
        keyVaultName: z.ZodString;
        cmkKeyName: z.ZodString;
        vnetName: z.ZodString;
        vnetCidr: z.ZodString;
        subnetPeName: z.ZodString;
        subnetPeCidr: z.ZodString;
        nsgPeName: z.ZodString;
        automationAccountName: z.ZodString;
        mgmtSubnetCidr: z.ZodOptional<z.ZodString>;
        workloadSubnetCidr: z.ZodOptional<z.ZodString>;
        bastionSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallSubnetCidr: z.ZodOptional<z.ZodString>;
        identitySubnetCidr: z.ZodOptional<z.ZodString>;
        peSubnetCidr: z.ZodOptional<z.ZodString>;
        /** @deprecated Muster's name for `firewallSubnetCidr`; normalized onto it by InfraManifestSchema. */
        fwSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallName: z.ZodOptional<z.ZodString>;
        publicIpName: z.ZodOptional<z.ZodString>;
        vmName: z.ZodOptional<z.ZodString>;
        vmImage: z.ZodOptional<z.ZodString>;
        vmSize: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>;
    registry_coverage: z.ZodObject<{
        total_infra_entries: z.ZodNumber;
        covered_entry_ids: z.ZodArray<z.ZodString, "many">;
        uncovered_entry_ids: z.ZodArray<z.ZodString, "many">;
        coverage_pct: z.ZodNumber;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        total_infra_entries: z.ZodNumber;
        covered_entry_ids: z.ZodArray<z.ZodString, "many">;
        uncovered_entry_ids: z.ZodArray<z.ZodString, "many">;
        coverage_pct: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        total_infra_entries: z.ZodNumber;
        covered_entry_ids: z.ZodArray<z.ZodString, "many">;
        uncovered_entry_ids: z.ZodArray<z.ZodString, "many">;
        coverage_pct: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">>;
    provenance: z.ZodArray<z.ZodObject<{
        field: z.ZodString;
        value: z.ZodUnknown;
        source: z.ZodEnum<["si_baseline", "tcp", "convention", "default", "policy_odp"]>;
        rule: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        field: z.ZodString;
        value: z.ZodUnknown;
        source: z.ZodEnum<["si_baseline", "tcp", "convention", "default", "policy_odp"]>;
        rule: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        field: z.ZodString;
        value: z.ZodUnknown;
        source: z.ZodEnum<["si_baseline", "tcp", "convention", "default", "policy_odp"]>;
        rule: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    infrastructure_model: z.ZodOptional<z.ZodEnum<["m365_only", "m365_sentinel", "m365_azure"]>>;
    secret_references: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<"form", [z.ZodObject<{
        variable: z.ZodString;
        form: z.ZodLiteral<"one_time_operator_held">;
        ref: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        variable: string;
        form: "one_time_operator_held";
        ref: string;
    }, {
        variable: string;
        form: "one_time_operator_held";
        ref: string;
    }>, z.ZodObject<{
        variable: z.ZodString;
        form: z.ZodLiteral<"key_vault_secret">;
        vault: z.ZodString;
        name: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        name: string;
        variable: string;
        form: "key_vault_secret";
        vault: string;
    }, {
        name: string;
        variable: string;
        form: "key_vault_secret";
        vault: string;
    }>]>, "many">>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    identity: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    logging: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    security: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    storage: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    network: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    automation: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    diagnostics: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    stamper_variable_map: z.ZodObject<{
        subscriptionId: z.ZodString;
        resourceGroup: z.ZodString;
        location: z.ZodString;
        lawWorkspaceName: z.ZodString;
        eoAppDisplayName: z.ZodString;
        storageAccountName: z.ZodString;
        keyVaultName: z.ZodString;
        cmkKeyName: z.ZodString;
        vnetName: z.ZodString;
        vnetCidr: z.ZodString;
        subnetPeName: z.ZodString;
        subnetPeCidr: z.ZodString;
        nsgPeName: z.ZodString;
        automationAccountName: z.ZodString;
        mgmtSubnetCidr: z.ZodOptional<z.ZodString>;
        workloadSubnetCidr: z.ZodOptional<z.ZodString>;
        bastionSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallSubnetCidr: z.ZodOptional<z.ZodString>;
        identitySubnetCidr: z.ZodOptional<z.ZodString>;
        peSubnetCidr: z.ZodOptional<z.ZodString>;
        /** @deprecated Muster's name for `firewallSubnetCidr`; normalized onto it by InfraManifestSchema. */
        fwSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallName: z.ZodOptional<z.ZodString>;
        publicIpName: z.ZodOptional<z.ZodString>;
        vmName: z.ZodOptional<z.ZodString>;
        vmImage: z.ZodOptional<z.ZodString>;
        vmSize: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        subscriptionId: z.ZodString;
        resourceGroup: z.ZodString;
        location: z.ZodString;
        lawWorkspaceName: z.ZodString;
        eoAppDisplayName: z.ZodString;
        storageAccountName: z.ZodString;
        keyVaultName: z.ZodString;
        cmkKeyName: z.ZodString;
        vnetName: z.ZodString;
        vnetCidr: z.ZodString;
        subnetPeName: z.ZodString;
        subnetPeCidr: z.ZodString;
        nsgPeName: z.ZodString;
        automationAccountName: z.ZodString;
        mgmtSubnetCidr: z.ZodOptional<z.ZodString>;
        workloadSubnetCidr: z.ZodOptional<z.ZodString>;
        bastionSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallSubnetCidr: z.ZodOptional<z.ZodString>;
        identitySubnetCidr: z.ZodOptional<z.ZodString>;
        peSubnetCidr: z.ZodOptional<z.ZodString>;
        /** @deprecated Muster's name for `firewallSubnetCidr`; normalized onto it by InfraManifestSchema. */
        fwSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallName: z.ZodOptional<z.ZodString>;
        publicIpName: z.ZodOptional<z.ZodString>;
        vmName: z.ZodOptional<z.ZodString>;
        vmImage: z.ZodOptional<z.ZodString>;
        vmSize: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        subscriptionId: z.ZodString;
        resourceGroup: z.ZodString;
        location: z.ZodString;
        lawWorkspaceName: z.ZodString;
        eoAppDisplayName: z.ZodString;
        storageAccountName: z.ZodString;
        keyVaultName: z.ZodString;
        cmkKeyName: z.ZodString;
        vnetName: z.ZodString;
        vnetCidr: z.ZodString;
        subnetPeName: z.ZodString;
        subnetPeCidr: z.ZodString;
        nsgPeName: z.ZodString;
        automationAccountName: z.ZodString;
        mgmtSubnetCidr: z.ZodOptional<z.ZodString>;
        workloadSubnetCidr: z.ZodOptional<z.ZodString>;
        bastionSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallSubnetCidr: z.ZodOptional<z.ZodString>;
        identitySubnetCidr: z.ZodOptional<z.ZodString>;
        peSubnetCidr: z.ZodOptional<z.ZodString>;
        /** @deprecated Muster's name for `firewallSubnetCidr`; normalized onto it by InfraManifestSchema. */
        fwSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallName: z.ZodOptional<z.ZodString>;
        publicIpName: z.ZodOptional<z.ZodString>;
        vmName: z.ZodOptional<z.ZodString>;
        vmImage: z.ZodOptional<z.ZodString>;
        vmSize: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>;
    registry_coverage: z.ZodObject<{
        total_infra_entries: z.ZodNumber;
        covered_entry_ids: z.ZodArray<z.ZodString, "many">;
        uncovered_entry_ids: z.ZodArray<z.ZodString, "many">;
        coverage_pct: z.ZodNumber;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        total_infra_entries: z.ZodNumber;
        covered_entry_ids: z.ZodArray<z.ZodString, "many">;
        uncovered_entry_ids: z.ZodArray<z.ZodString, "many">;
        coverage_pct: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        total_infra_entries: z.ZodNumber;
        covered_entry_ids: z.ZodArray<z.ZodString, "many">;
        uncovered_entry_ids: z.ZodArray<z.ZodString, "many">;
        coverage_pct: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">>;
    provenance: z.ZodArray<z.ZodObject<{
        field: z.ZodString;
        value: z.ZodUnknown;
        source: z.ZodEnum<["si_baseline", "tcp", "convention", "default", "policy_odp"]>;
        rule: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        field: z.ZodString;
        value: z.ZodUnknown;
        source: z.ZodEnum<["si_baseline", "tcp", "convention", "default", "policy_odp"]>;
        rule: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        field: z.ZodString;
        value: z.ZodUnknown;
        source: z.ZodEnum<["si_baseline", "tcp", "convention", "default", "policy_odp"]>;
        rule: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    infrastructure_model: z.ZodOptional<z.ZodEnum<["m365_only", "m365_sentinel", "m365_azure"]>>;
    secret_references: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<"form", [z.ZodObject<{
        variable: z.ZodString;
        form: z.ZodLiteral<"one_time_operator_held">;
        ref: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        variable: string;
        form: "one_time_operator_held";
        ref: string;
    }, {
        variable: string;
        form: "one_time_operator_held";
        ref: string;
    }>, z.ZodObject<{
        variable: z.ZodString;
        form: z.ZodLiteral<"key_vault_secret">;
        vault: z.ZodString;
        name: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        name: string;
        variable: string;
        form: "key_vault_secret";
        vault: string;
    }, {
        name: string;
        variable: string;
        form: "key_vault_secret";
        vault: string;
    }>]>, "many">>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    identity: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    logging: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    security: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    storage: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    network: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    automation: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    diagnostics: z.ZodArray<z.ZodObject<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        resource_id: z.ZodString;
        resource_type: z.ZodString;
        name: z.ZodString;
        control_ids: z.ZodArray<z.ZodString, "many">;
        registry_entry_ids: z.ZodArray<z.ZodString, "many">;
        properties: z.ZodRecord<z.ZodString, z.ZodAny>;
        depends_on: z.ZodArray<z.ZodString, "many">;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    stamper_variable_map: z.ZodObject<{
        subscriptionId: z.ZodString;
        resourceGroup: z.ZodString;
        location: z.ZodString;
        lawWorkspaceName: z.ZodString;
        eoAppDisplayName: z.ZodString;
        storageAccountName: z.ZodString;
        keyVaultName: z.ZodString;
        cmkKeyName: z.ZodString;
        vnetName: z.ZodString;
        vnetCidr: z.ZodString;
        subnetPeName: z.ZodString;
        subnetPeCidr: z.ZodString;
        nsgPeName: z.ZodString;
        automationAccountName: z.ZodString;
        mgmtSubnetCidr: z.ZodOptional<z.ZodString>;
        workloadSubnetCidr: z.ZodOptional<z.ZodString>;
        bastionSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallSubnetCidr: z.ZodOptional<z.ZodString>;
        identitySubnetCidr: z.ZodOptional<z.ZodString>;
        peSubnetCidr: z.ZodOptional<z.ZodString>;
        /** @deprecated Muster's name for `firewallSubnetCidr`; normalized onto it by InfraManifestSchema. */
        fwSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallName: z.ZodOptional<z.ZodString>;
        publicIpName: z.ZodOptional<z.ZodString>;
        vmName: z.ZodOptional<z.ZodString>;
        vmImage: z.ZodOptional<z.ZodString>;
        vmSize: z.ZodOptional<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        subscriptionId: z.ZodString;
        resourceGroup: z.ZodString;
        location: z.ZodString;
        lawWorkspaceName: z.ZodString;
        eoAppDisplayName: z.ZodString;
        storageAccountName: z.ZodString;
        keyVaultName: z.ZodString;
        cmkKeyName: z.ZodString;
        vnetName: z.ZodString;
        vnetCidr: z.ZodString;
        subnetPeName: z.ZodString;
        subnetPeCidr: z.ZodString;
        nsgPeName: z.ZodString;
        automationAccountName: z.ZodString;
        mgmtSubnetCidr: z.ZodOptional<z.ZodString>;
        workloadSubnetCidr: z.ZodOptional<z.ZodString>;
        bastionSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallSubnetCidr: z.ZodOptional<z.ZodString>;
        identitySubnetCidr: z.ZodOptional<z.ZodString>;
        peSubnetCidr: z.ZodOptional<z.ZodString>;
        /** @deprecated Muster's name for `firewallSubnetCidr`; normalized onto it by InfraManifestSchema. */
        fwSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallName: z.ZodOptional<z.ZodString>;
        publicIpName: z.ZodOptional<z.ZodString>;
        vmName: z.ZodOptional<z.ZodString>;
        vmImage: z.ZodOptional<z.ZodString>;
        vmSize: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        subscriptionId: z.ZodString;
        resourceGroup: z.ZodString;
        location: z.ZodString;
        lawWorkspaceName: z.ZodString;
        eoAppDisplayName: z.ZodString;
        storageAccountName: z.ZodString;
        keyVaultName: z.ZodString;
        cmkKeyName: z.ZodString;
        vnetName: z.ZodString;
        vnetCidr: z.ZodString;
        subnetPeName: z.ZodString;
        subnetPeCidr: z.ZodString;
        nsgPeName: z.ZodString;
        automationAccountName: z.ZodString;
        mgmtSubnetCidr: z.ZodOptional<z.ZodString>;
        workloadSubnetCidr: z.ZodOptional<z.ZodString>;
        bastionSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallSubnetCidr: z.ZodOptional<z.ZodString>;
        identitySubnetCidr: z.ZodOptional<z.ZodString>;
        peSubnetCidr: z.ZodOptional<z.ZodString>;
        /** @deprecated Muster's name for `firewallSubnetCidr`; normalized onto it by InfraManifestSchema. */
        fwSubnetCidr: z.ZodOptional<z.ZodString>;
        firewallName: z.ZodOptional<z.ZodString>;
        publicIpName: z.ZodOptional<z.ZodString>;
        vmName: z.ZodOptional<z.ZodString>;
        vmImage: z.ZodOptional<z.ZodString>;
        vmSize: z.ZodOptional<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>;
    registry_coverage: z.ZodObject<{
        total_infra_entries: z.ZodNumber;
        covered_entry_ids: z.ZodArray<z.ZodString, "many">;
        uncovered_entry_ids: z.ZodArray<z.ZodString, "many">;
        coverage_pct: z.ZodNumber;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        total_infra_entries: z.ZodNumber;
        covered_entry_ids: z.ZodArray<z.ZodString, "many">;
        uncovered_entry_ids: z.ZodArray<z.ZodString, "many">;
        coverage_pct: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        total_infra_entries: z.ZodNumber;
        covered_entry_ids: z.ZodArray<z.ZodString, "many">;
        uncovered_entry_ids: z.ZodArray<z.ZodString, "many">;
        coverage_pct: z.ZodNumber;
    }, z.ZodTypeAny, "passthrough">>;
    provenance: z.ZodArray<z.ZodObject<{
        field: z.ZodString;
        value: z.ZodUnknown;
        source: z.ZodEnum<["si_baseline", "tcp", "convention", "default", "policy_odp"]>;
        rule: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        field: z.ZodString;
        value: z.ZodUnknown;
        source: z.ZodEnum<["si_baseline", "tcp", "convention", "default", "policy_odp"]>;
        rule: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        field: z.ZodString;
        value: z.ZodUnknown;
        source: z.ZodEnum<["si_baseline", "tcp", "convention", "default", "policy_odp"]>;
        rule: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>, "many">;
    infrastructure_model: z.ZodOptional<z.ZodEnum<["m365_only", "m365_sentinel", "m365_azure"]>>;
    secret_references: z.ZodOptional<z.ZodArray<z.ZodDiscriminatedUnion<"form", [z.ZodObject<{
        variable: z.ZodString;
        form: z.ZodLiteral<"one_time_operator_held">;
        ref: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        variable: string;
        form: "one_time_operator_held";
        ref: string;
    }, {
        variable: string;
        form: "one_time_operator_held";
        ref: string;
    }>, z.ZodObject<{
        variable: z.ZodString;
        form: z.ZodLiteral<"key_vault_secret">;
        vault: z.ZodString;
        name: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        name: string;
        variable: string;
        form: "key_vault_secret";
        vault: string;
    }, {
        name: string;
        variable: string;
        form: "key_vault_secret";
        vault: string;
    }>]>, "many">>;
}, z.ZodTypeAny, "passthrough">>;
export type InfrastructureBody = z.infer<typeof InfrastructureBodySchema>;
//# sourceMappingURL=mission-plan.bodies.d.ts.map