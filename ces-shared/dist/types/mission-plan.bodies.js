// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.
// Typed body schemas for Manual Mission Plan steps, Tenant Manifest body,
// and Infrastructure Manifest body. Derived from the superset of Muster's
// provisional contract and Stamper's private schemas. Every z.object()
// uses .passthrough() to preserve fields not yet in the shared contract.
import { z } from 'zod';
// ─── Shared sub-enums (used in ManualStep + TM body) ────────────
export const TaskTypeEnum = z.enum([
    'policy', 'configuration', 'process', 'monitoring',
    'training', 'assessment', 'evidence_collection',
]);
export const PriorityEnum = z.enum(['p0', 'p1', 'p2', 'p3']);
export const SupportTypeEnum = z.enum([
    'Overt', 'Configurable', 'Inherited', 'Partial', 'None',
]);
export const ArtifactTypeEnum = z.enum([
    'policy', 'procedure', 'ssp', 'diagram', 'config_export',
    'log_export', 'ticket_export', 'training_record', 'scan_report',
    'attestation', 'other',
]);
export const CheckMethodEnum = z.enum([
    'api_query', 'config_export', 'log_query', 'event_stream', 'manual',
]);
export const CollectionMethodEnum = z.enum([
    'api_poll', 'event_stream', 'scheduled_export', 'manual',
]);
export const SourceOfTruthEnum = z.enum([
    'iac', 'policy_doc', 'platform_setting', 'manual',
]);
export const QueryMethodEnum = z.enum(['api', 'export', 'log_query', 'manual']);
export const SeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);
export const GapClassificationEnum = z.enum([
    'configure', 'customize', 'manual', 'auto_generate',
]);
// ─── ManualStep sub-schemas ────────────────────────────────────
export const ControlCoverageSchema = z.object({
    control_id: z.string().min(1),
    support_type: SupportTypeEnum,
    gap_rationale: z.string().min(1),
}).passthrough();
export const EvidenceArtifactRefSchema = z.object({
    artifact_id: z.string().min(1),
    artifact_type: ArtifactTypeEnum,
    description: z.string().min(1),
    collector: z.string().min(1),
    retention_days: z.number().int().min(0),
    storage_location_ref: z.string().min(1),
}).passthrough();
export const VendorHelpRefSchema = z.object({
    vendor: z.string().min(1),
    product: z.string().min(1),
    title: z.string().min(1),
    url: z.string().optional(),
    path_hint: z.string().optional(),
}).passthrough();
export const VendorBlockSchema = z.object({
    m365_service: z.string().optional(),
    implementation: z.string().optional(),
    portal_path: z.string().optional(),
    powershell: z.array(z.string()).optional(),
    evidence_commands: z.array(z.string()).optional(),
    notes: z.string().optional(),
    tech_ref_guidance: z.array(z.string()).optional(),
}).passthrough();
export const StepActionSchema = z.object({
    action_id: z.string().min(1),
    action: z.string().min(1),
    action_type: z.string().min(1),
    evidence_outputs: z.array(z.string()),
    vendor: VendorBlockSchema.optional(),
}).passthrough();
export const EffortEstimateSchema = z.object({
    one_time_dev_loe: z.number().min(0),
    one_time_config_manual: z.number().min(0),
    one_time_config_automated: z.number().min(0),
    recurring_evidence_manual: z.number().min(0),
    recurring_evidence_automated: z.number().min(0),
}).passthrough();
export const RequirementContextSchema = z.object({
    title: z.string().optional(),
    requirement_text: z.string().optional(),
    domain: z.string().optional(),
    level: z.string().optional(),
    nist_reference: z.string().optional(),
}).passthrough();
// Stamper-only fields: section, resource_type, layer, tech_ref
export const ManualStepSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    task_type: TaskTypeEnum,
    priority: PriorityEnum,
    control_coverage: z.array(ControlCoverageSchema),
    what_to_do: z.array(z.string().min(1)).min(1),
    how_to_verify: z.array(z.string().min(1)).min(1),
    vendor_help_refs: z.array(VendorHelpRefSchema),
    expected_artifacts: z.array(EvidenceArtifactRefSchema).min(1),
    manual_completion_criteria: z.array(z.string().min(1)).min(1),
    owner_role: z.string().optional(),
    estimated_effort_hours: z.number().min(0).optional(),
    effort_estimate: EffortEstimateSchema.optional(),
    dependencies: z.array(z.string()).optional(),
    actions: z.array(StepActionSchema).optional(),
    notes: z.string().optional(),
    gap_classifications: z.array(GapClassificationEnum).optional(),
    requirement_context: RequirementContextSchema.optional(),
    // Stamper-only (infra plan enrichment)
    section: z.string().optional(),
    resource_type: z.string().optional(),
    layer: z.number().int().min(0).optional(),
    tech_ref: z.record(z.any()).optional(),
}).passthrough();
// ─── Tenant Manifest body schemas ──────────────────────────────
export const CheckSchema = z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    method: CheckMethodEnum,
    expected: z.string().min(1),
    on_fail: z.string().min(1),
}).passthrough();
export const NormativeControlSchema = z.object({
    control_id: z.string().min(1),
    required_state: z.string().min(1),
    verification: z.array(CheckSchema),
    evidence_artifacts: z.array(EvidenceArtifactRefSchema),
}).passthrough();
export const AssetSchema = z.object({
    asset_id: z.string().min(1),
    asset_type: z.string().min(1),
    scope_category: z.string().min(1),
    tags: z.array(z.string()),
    owner: z.string().optional(),
    notes: z.string().optional(),
}).passthrough();
export const ConfigIntentSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    control_ids: z.array(z.string().min(1)).min(1),
    desired_config: z.record(z.any()),
    source_of_truth: SourceOfTruthEnum,
    query_method: QueryMethodEnum,
    notes: z.string().optional(),
}).passthrough();
export const EvidenceMonitorSchema = z.object({
    id: z.string().min(1),
    control_ids: z.array(z.string().min(1)).min(1),
    signal: z.string().min(1),
    collection_method: CollectionMethodEnum,
    cadence: z.string().min(1),
    retention_days: z.number().int().min(0),
    on_drift: z.string().min(1),
    // Stamper-only
    sentinel_workspace: z.string().optional(),
    sentinel_resource_group: z.string().optional(),
    log_analytics_workspace_id: z.string().optional(),
}).passthrough();
export const DriftPolicySchema = z.object({
    id: z.string().min(1),
    scope: z.string().min(1),
    severity: SeverityEnum,
    detection: z.array(z.string().min(1)).min(1),
    response_playbook: z.array(z.string().min(1)).min(1),
    // Stamper-only (per-control exception registry)
    control_id: z.string().optional(),
    config_key: z.string().optional(),
    approval_status: z.enum(['approved', 'pending', 'rejected']).optional(),
}).passthrough();
// ─── Secret reference (FC-SH step 1, REQ-ces-shared-im-secret-values) ──
// A secret-bearing field (e.g. the operator's initial password) must never travel as a plain
// value in a manifest. It travels as one of these typed shapes instead. `.strict()` — deliberately
// NOT `.passthrough()` like the rest of this file — so a stray `value`/`secret`/`password` key on a
// reference object is a parse error, not a silently-preserved leak.
//
// `one_time_operator_held`: the value was shown to the operator once (Muster's Configure intake)
// and is never stored; `ref` is an opaque marker, not a lookup key.
// `key_vault_secret`: the value lives in an Azure Key Vault secret; `vault`/`name` locate it.
export const SecretReferenceFormEnum = z.enum(['one_time_operator_held', 'key_vault_secret']);
export const OneTimeOperatorHeldSecretRefSchema = z.object({
    variable: z.string().min(1),
    form: z.literal('one_time_operator_held'),
    ref: z.string().min(1),
}).strict();
export const KeyVaultSecretRefSchema = z.object({
    variable: z.string().min(1),
    form: z.literal('key_vault_secret'),
    vault: z.string().min(1),
    name: z.string().min(1),
}).strict();
export const SecretReferenceSchema = z.discriminatedUnion('form', [
    OneTimeOperatorHeldSecretRefSchema,
    KeyVaultSecretRefSchema,
]);
/**
 * Variable names that must NEVER carry a plain value in stamper_variable_map — they may only be
 * resolved via a SecretReference (secret_references[] / provisioning_inputs). Extend as new secret
 * variables are introduced.
 */
export const SECRET_VARIABLE_NAMES = ['initialPassword'];
// ─── Provisioning inputs (FC-SH step 1, founder decision 2026-09-28 #11) ──
// m365-only sessions carry no Infrastructure Manifest, so the three provisioning inputs Stamper
// needs at Configure time travel on the Tenant Manifest instead. Field/variable names mirror
// Stamper's existing VARIABLE_MAPPING (approverUPN, touFileName/touFileBase64, initialPassword).
export const ProvisioningInputsSchema = z.object({
    approver_upn: z.string().min(1),
    terms_of_use_file: z.object({
        file_name: z.string().min(1),
        content_base64: z.string().min(1),
    }).passthrough(),
    initial_password_ref: SecretReferenceSchema,
}).passthrough();
export const TenantIdentitySchema = z.object({
    tenant_id: z.string().min(1),
    primary_domain: z.string().min(1),
    cloud_environment: z.string().min(1),
    display_name: z.string().min(1),
    primary_sku: z.string().min(1),
    license_count: z.number().int().min(0),
    custom_domains: z.array(z.string()).optional(),
    addon_skus: z.array(z.string()).optional(),
    service_activations: z.array(z.string()).optional(),
}).passthrough();
export const BoundaryZoneDefinitionSchema = z.object({
    key: z.string().min(1),
    value: z.any(),
    type: z.string().min(1),
}).passthrough();
export const BoundaryZonesSchema = z.object({
    cui_boundary_version: z.string().min(1),
    definitions: z.array(BoundaryZoneDefinitionSchema),
}).passthrough();
export const TenantManifestBodySchema = z.object({
    manifest_id: z.string().min(1),
    tech_stack_id: z.number().int().min(1),
    normative_controls: z.array(NormativeControlSchema).min(1),
    assets: z.array(AssetSchema),
    config_intents: z.array(ConfigIntentSchema).min(1),
    evidence_monitors: z.array(EvidenceMonitorSchema).min(1),
    drift_policies: z.array(DriftPolicySchema).min(1),
    // Stamper-only
    tenant_identity: z.union([TenantIdentitySchema, z.record(z.any())]).optional(),
    boundary_zones: z.union([BoundaryZonesSchema, z.array(z.record(z.any()))]).optional(),
    // m365-only sessions (no Infra Manifest): FC-SH step 1 / founder decision 2026-09-28 #11.
    provisioning_inputs: ProvisioningInputsSchema.optional(),
}).passthrough();
// ─── Infrastructure Manifest body schemas ──────────────────────
export const InfraResourceSpecSchema = z.object({
    resource_id: z.string().min(1),
    resource_type: z.string().min(1),
    name: z.string().min(1),
    control_ids: z.array(z.string().min(1)),
    registry_entry_ids: z.array(z.string()),
    properties: z.record(z.any()),
    depends_on: z.array(z.string()),
}).passthrough();
export const InfraVariableMapSchema = z.object({
    subscriptionId: z.string().min(1),
    resourceGroup: z.string().min(1),
    location: z.string().min(1),
    lawWorkspaceName: z.string().min(1),
    eoAppDisplayName: z.string().min(1),
    storageAccountName: z.string(),
    keyVaultName: z.string(),
    cmkKeyName: z.string(),
    vnetName: z.string(),
    vnetCidr: z.string(),
    subnetPeName: z.string(),
    subnetPeCidr: z.string(),
    nsgPeName: z.string(),
    automationAccountName: z.string(),
    // Subnet CIDRs Stamper's network registry resolves (AZ-NET-*): canonical names.
    mgmtSubnetCidr: z.string().optional(),
    workloadSubnetCidr: z.string().optional(),
    bastionSubnetCidr: z.string().optional(),
    firewallSubnetCidr: z.string().optional(),
    // W4-SH2: names Muster's generator emits. identity/pe are Muster-side extras
    // (Stamper resolves the private-endpoint subnet from subnetPeCidr).
    identitySubnetCidr: z.string().optional(),
    peSubnetCidr: z.string().optional(),
    /** @deprecated Muster's name for `firewallSubnetCidr`; normalized onto it by InfraManifestSchema. */
    fwSubnetCidr: z.string().optional(),
    // W4-SH2: further resource names Stamper's infra registry requires (AZ-FW-*, AZ-VM-*).
    firewallName: z.string().optional(),
    publicIpName: z.string().optional(),
    vmName: z.string().optional(),
    vmImage: z.string().optional(),
    vmSize: z.string().optional(),
}).passthrough();
/**
 * W4-SH2: deprecated variable-name aliases → canonical name Stamper resolves.
 * InfraManifestSchema copies an alias value onto its canonical key when the canonical key is absent/empty
 * and rejects a manifest where both are set to different non-empty values.
 */
export const INFRA_VARIABLE_ALIASES = { fwSubnetCidr: 'firewallSubnetCidr' };
/** Variables Stamper's BaselineProvisioner requires to be NON-EMPTY before it will provision (m365_azure). */
export const STAMPER_PROVISIONING_REQUIRED_VARIABLES = [
    'subscriptionId', 'resourceGroup', 'location',
    'lawWorkspaceName', 'storageAccountName', 'keyVaultName',
    'cmkKeyName', 'vnetName', 'vnetCidr', 'subnetPeName',
    'subnetPeCidr', 'nsgPeName', 'automationAccountName', 'eoAppDisplayName',
];
/** Return a copy of a variable map with deprecated aliases copied onto their canonical names (alias kept). */
export function normalizeInfraVariableMap(map) {
    const out = { ...map };
    for (const [alias, canonical] of Object.entries(INFRA_VARIABLE_ALIASES)) {
        const a = out[alias];
        if (typeof a === 'string' && a !== '' && (out[canonical] === undefined || out[canonical] === ''))
            out[canonical] = a;
    }
    return out;
}
export const InfraProvenanceEntrySchema = z.object({
    field: z.string().min(1),
    value: z.unknown(),
    source: z.enum(['si_baseline', 'tcp', 'convention', 'default', 'policy_odp']),
    rule: z.string().min(1),
}).passthrough();
export const RegistryCoverageSchema = z.object({
    total_infra_entries: z.number().int().min(0),
    covered_entry_ids: z.array(z.string()),
    uncovered_entry_ids: z.array(z.string()),
    coverage_pct: z.number().min(0).max(100),
}).passthrough();
export const InfrastructureBodySchema = z.object({
    identity: z.array(InfraResourceSpecSchema),
    logging: z.array(InfraResourceSpecSchema),
    security: z.array(InfraResourceSpecSchema),
    storage: z.array(InfraResourceSpecSchema),
    network: z.array(InfraResourceSpecSchema),
    automation: z.array(InfraResourceSpecSchema),
    diagnostics: z.array(InfraResourceSpecSchema),
    stamper_variable_map: InfraVariableMapSchema,
    registry_coverage: RegistryCoverageSchema,
    provenance: z.array(InfraProvenanceEntrySchema),
    infrastructure_model: z.enum(['m365_only', 'm365_sentinel', 'm365_azure']).optional(),
    // FC-SH step 1: a secret-bearing variable (e.g. initialPassword) travels here, never as a plain
    // value in stamper_variable_map. InfraManifestSchema's superRefine rejects the latter.
    secret_references: z.array(SecretReferenceSchema).optional(),
}).passthrough();
//# sourceMappingURL=mission-plan.bodies.js.map