// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { ResolverEntry } from './types.js';
import { deriveResolversFromInventory, loadInventoryItemsSync } from '../codegen/deriveResolversFromInventory.js';
import { TENANT_INIT_GRAPH_ENTRIES } from './tenantInitResolvers.js';

/**
 * Graph resolver entries wired at M2 (read surface). Only the entries
 * needed by M2's spike-test gate and its immediate URI-pattern counterpart
 * are populated here; the rest of ComplianceSignalFetcher's/TemplateRegistry's
 * endpoint coverage is added by later milestones (M4 write surface, M6 DOC
 * verification) as those milestones' own File Inventory rows require it.
 */
const manualGraphResolvers: ResolverEntry[] = [
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgIdentityConditionalAccessPolicy',
    endpoint: '/identity/conditionalAccess/policies',
    collection: 'caPolicies',
    verb: 'GET',
    azureTier: 'none',
  },
  // P0-2 fix 10 (CA-policy create, 2026-07-28): New-MgIdentityConditionalAccessPolicy
  // (Stamper's MA.L2-3.7.5.remote-mfa "New-MgIdentityConditionalAccessPolicy
  // -DisplayName 'CMMC-RemoteMaintenance-MFA' -State '...'" and AO's A-14/A-16/
  // A-17/A-18 session-timeout/untrusted-location/admin-MFA/mobile-device
  // policies, coverage/inventory.json lines 206/238/254/286/894) had NO manual
  // entry, so codegen's deriveResolversFromInventory minted its OWN collection
  // for it: deriveCollectionInfo("IdentityConditionalAccessPolicy") ->
  // lowerFirst -> "identityConditionalAccessPolicy" (singular; the naive
  // pluralizer's "identityConditionalAccessPolicys" never matches
  // KNOWN_OBJECT_TYPES's "caPolicies", so no seeded-plural remap applies) -
  // a collection distinct from Get-MgIdentityConditionalAccessPolicy's real
  // "caPolicies" (declared above and at the URI-pattern entry below). A
  // pipeline-created CA policy landed in "identityConditionalAccessPolicy"
  // and a subsequent GET of "caPolicies" never saw it - the write->read
  // collection-parity gap ces-tester's remote-maintenance-mfa-baseline
  // scenario surfaced (same class as the P0-2 fix 8 dlp-policy / fix 9
  // member-add collection-mismatch bugs). This manual entry routes the
  // write onto the SAME "caPolicies" collection the GET reads; singletonId
  // is a same-class-idiom fallback (mirrors fix 8's dlpCompliancePolicy
  // self-referential default) that resolveMutation only falls back to when
  // the caPolicyNaturalId displayName key (ResolverTable.ts) is absent.
  {
    kind: 'cmdlet',
    cmdlet: 'New-MgIdentityConditionalAccessPolicy',
    endpoint: '/identity/conditionalAccess/policies',
    collection: 'caPolicies',
    verb: 'POST',
    azureTier: 'none',
    mutationVerbs: ['POST'],
    singletonId: 'caPolicies',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/policies/authorizationPolicy',
    collection: 'authorizationPolicy',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'raw',
    // M4 write surface: AO's A-18 template (TemplateRegistry.ts:59-62) PATCHes
    // this exact URI. singletonId matches the id M1's generateAuthorizationPolicy
    // generator assigns its first seeded object ('authorizationPolicy').
    mutationVerbs: ['PATCH'],
    singletonId: 'authorizationPolicy',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/identity/conditionalAccess/policies',
    collection: 'caPolicies',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgAuditLogDirectoryAudit',
    endpoint: '/auditLogs/directoryAudits',
    collection: 'directoryAudits',
    verb: 'GET',
    azureTier: 'none',
  },
  // M6: DOC check 2 - EO's ComplianceSignalFetcher.fetchAuthorizationPolicy()
  // calls this exact cmdlet (endpointToCmdlet's '/policies/authorizationPolicy'
  // -> 'Get-MgPolicyAuthorizationPolicy' mapping, ComplianceSignalFetcher.ts:690
  // and the direct call at ComplianceSignalFetcher.ts:387). Named-cmdlet GET
  // resolution (ResolverTable.resolveEntry) returns store.list('authorizationPolicy'),
  // which holds exactly one seeded object (id 'authorizationPolicy') - a
  // single-element array flowing through the generated wrapper function's
  // PowerShell pipeline collapses to a scalar object under ConvertTo-Json,
  // matching real Microsoft Graph's singleton-resource cmdlet shape.
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgPolicyAuthorizationPolicy',
    endpoint: '/policies/authorizationPolicy',
    collection: 'authorizationPolicy',
    verb: 'GET',
    azureTier: 'none',
  },
  // M4: Stamper's baseline-stamping template for an authorization-policy-class
  // control (ces-stamper/src/registry/cmmc-l2-commands.registry.json,
  // entry_id "IA.L2-3.5.3.fido2-enable", quoted verbatim in
  // tests/integration/m4-write-surface.test.ts). Stamper's registry has no
  // literal `/v1.0/policies/authorizationPolicy`-targeting entry (confirmed
  // by a targeted grep - see IMPLEMENTATION_LOG.md M4 Deviations); this is
  // the closest genuine Stamper command in the same policy-singleton class
  // (a Graph `/v1.0/policies/...` resource PATCHed via Invoke-MgGraphRequest).
  // Stamper's registry hardcodes the absolute URL
  // 'https://graph.microsoft.us/...' (unlike AO's relative '/v1.0/...'),
  // so ResolverTable.resolveUri() normalizes away any absolute-URL prefix
  // before matching against this (relative) pattern.
  {
    kind: 'uri',
    pattern: '/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/Fido2',
    collection: 'authenticationMethodsPolicyConfigurations',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'raw',
    mutationVerbs: ['PATCH'],
    singletonId: 'Fido2',
  },
  // G-STACKSIM-2 iteration 2: Fido2's siblings under the same real Graph
  // authenticationMethodConfigurations collection (Stamper's
  // IA.L2-3.5.3.mfa-authenticator, IA.L2-3.5.9.tap-config,
  // IA.L2-3.5.10.cert-auth entries) - same collection, one singletonId each.
  {
    kind: 'uri',
    pattern: '/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/MicrosoftAuthenticator',
    collection: 'authenticationMethodsPolicyConfigurations',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'raw',
    mutationVerbs: ['PATCH'],
    singletonId: 'MicrosoftAuthenticator',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/TemporaryAccessPass',
    collection: 'authenticationMethodsPolicyConfigurations',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'raw',
    mutationVerbs: ['PATCH'],
    singletonId: 'TemporaryAccessPass',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/x509Certificate',
    collection: 'authenticationMethodsPolicyConfigurations',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'raw',
    mutationVerbs: ['PATCH'],
    singletonId: 'x509Certificate',
  },
  // G-STACKSIM-2 iteration 3: dynamic-id mutation targets - AO's A-20 (dupe CA
  // policy cleanup) DELETEs, and A-19 (break-glass CA exclusion) PATCHes, a
  // SPECIFIC policy by the id an earlier GET returned
  // ("/v1.0/identity/conditionalAccess/policies/$($p.id)"), not a fixed
  // singleton. ResolverTable now captures the '*' segment's real value and
  // uses it as the mutation's objectId (see ResolverTable.ts's
  // matchPatternCapture()); no singletonId is declared here on purpose.
  {
    kind: 'uri',
    pattern: '/v1.0/identity/conditionalAccess/policies/*',
    collection: 'caPolicies',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'raw',
    mutationVerbs: ['PATCH', 'DELETE'],
  },
  // AO's A-10 (standing-GA-to-eligible) DELETEs a specific role assignment
  // by id once it has been superseded by the new eligibility schedule
  // request ("/v1.0/roleManagement/directory/roleAssignments/$($a.id)") -
  // same dynamic-id mechanism as the CA-policies entry above.
  {
    kind: 'uri',
    pattern: '/v1.0/roleManagement/directory/roleAssignments/*',
    collection: 'roleAssignments',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'raw',
    mutationVerbs: ['DELETE'],
  },

  // GP-STACKSIM-1 M4 (demo profile): item-level PATCH on users/groups/
  // managedDevices - the exact URIs a real admin's rename/update makes
  // (Update-MgUser, Update-MgGroup, Update-MgDeviceManagementManagedDevice
  // all PATCH these resources by id). The inventory-derived '/v1.0/users/*'
  // entry was GET-only because Stamper/AO's registry only ever READS these
  // item-level URIs via Invoke-MgGraphRequest; a real GCC High tenant
  // accepts the PATCH, so per the sim-transparency contract the sim must
  // too. First consumer: scenarios/demo-dib-small.json's realistic-tenant
  // steps (dynamic-id capture, same mechanism as the CA-policies entry
  // above; no singletonId on purpose).
  {
    kind: 'uri',
    pattern: '/v1.0/users/*',
    collection: 'users',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'raw',
    mutationVerbs: ['PATCH'],
  },
  {
    kind: 'uri',
    pattern: '/v1.0/groups/*',
    collection: 'groups',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'raw',
    mutationVerbs: ['PATCH'],
  },
  // W5c2 follow-up 6 (SIM-A1, SIM-A2): the group and named-location LISTS as
  // REST reads (Muster's harvest GETs `/groups` and
  // `/identity/conditionalAccess/namedLocations` through the Graph REST
  // facade; only the item and cmdlet paths were routed). `$filter` applies.
  {
    kind: 'uri',
    pattern: '/v1.0/groups',
    collection: 'groups',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/identity/conditionalAccess/namedLocations',
    collection: 'namedLocations',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/deviceManagement/managedDevices/*',
    collection: 'managedDevices',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'raw',
    mutationVerbs: ['PATCH'],
  },

  // G-STACKSIM-2 iteration 3: EO's ComplianceSignalFetcher.ts calls each of
  // these named cmdlets directly (fetchIdentitySignals/fetchDeviceSignals/
  // fetchSecuritySignals/fetchDlpSignals/fetchAuthStrengthPolicies/
  // fetchAgreements/fetchPimPolicies/fetchVulnerabilities/
  // fetchExpandedSignals - see ComplianceSignalFetcher.ts's
  // endpointToCmdlet() map). Before this fix none of them had a resolver
  // entry at all, so the sim's fake module had no wrapper function
  // exported for them: SessionManager's persistent PowerShell session hit a
  // "term not recognized" error, session-host.ps1 caught it and returned
  // EMPTY stdout, and `JSON.parse('')` on that empty string is exactly the
  // "Unexpected end of JSON input" error every one of these 22
  // coverage-report.json failures shares. Each cmdlet below is mapped to its
  // own dedicated, newly-seeded collection (src/seed/generators/compliance.ts)
  // reusing an EXISTING collection name only where one already holds
  // realistic seeded data for the same real-world resource (deviceCompliancePolicies,
  // detectedApps) - never a bare empty array, since piping a genuinely empty
  // PowerShell array through `ConvertTo-Json` (the exact pattern
  // ComplianceSignalFetcher.ts's own commands use) also produces NO output at
  // all (verified directly against powershell.exe: `@() | ConvertTo-Json`
  // prints nothing), which is the same "Unexpected end of JSON input" failure
  // mode one level up the stack - seeding at least one real object per
  // collection is what actually fixes it, matching how a real GCC High tenant
  // always has these singleton policies/collections populated.
  // Reuses the EXISTING, already-seeded "managedDevices" collection (M1's
  // devices.ts generator, 4 objects). Before this override,
  // Get-MgDeviceManagementManagedDevice auto-derived to its own
  // never-seeded collection ("deviceManagementManagedDevice") - empty for
  // eo:fetchDeviceSignals:managedDevices (the same "empty array piped to
  // ConvertTo-Json produces no stdout" failure mode as the rest of this
  // block) AND for AO's B-05 (stale/lost device retire), whose set_command
  // `ForEach-Object`s over the SAME cmdlet's result to call
  // Clear-/Invoke-...RetireDevice per device - zero devices meant zero
  // mutation calls ("no ledger mutation" failure).
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgDeviceManagementManagedDevice',
    endpoint: '/deviceManagement/managedDevices',
    collection: 'managedDevices',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgPolicyAuthenticationMethodPolicy',
    endpoint: '/policies/authenticationMethodsPolicy',
    collection: 'authenticationMethodsPolicy',
    verb: 'GET',
    azureTier: 'none',
  },
  // GP-STACKSIM-1 M3 (2026-07-25): the NamedLocation cmdlet trio auto-derived
  // to its own never-seeded collection ('identityConditionalAccessNamedLocation')
  // while the URI entries and M1's seed use 'namedLocations' - the SAME real
  // Graph resource (/identity/conditionalAccess/namedLocations). EO's
  // fetchNamedLocations read the empty derived collection: empty array ->
  // ConvertTo-Json prints nothing -> "Unexpected end of JSON input"
  // (eo:fetchNamedLocations FAIL, 2026-07-25 coverage re-run). Remap all
  // three to the seeded collection so reads see the seed AND stamper's
  // named-location create lands where every reader looks.
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgIdentityConditionalAccessNamedLocation',
    endpoint: '/identity/conditionalAccess/namedLocations',
    collection: 'namedLocations',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'New-MgIdentityConditionalAccessNamedLocation',
    endpoint: '/identity/conditionalAccess/namedLocations',
    collection: 'namedLocations',
    verb: 'POST',
    azureTier: 'none',
    mutationVerbs: ['POST'],
    singletonId: 'namedLocation-1',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Update-MgIdentityConditionalAccessNamedLocation',
    endpoint: '/identity/conditionalAccess/namedLocations',
    collection: 'namedLocations',
    verb: 'PATCH',
    azureTier: 'none',
    mutationVerbs: ['PATCH'],
    singletonId: 'namedLocation-1',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgDeviceManagementDeviceCompliancePolicy',
    endpoint: '/deviceManagement/deviceCompliancePolicies',
    collection: 'deviceCompliancePolicies',
    verb: 'GET',
    azureTier: 'none',
  },
  // W5c2 follow-up 9: the compliance-policy list as a REST read AND create
  // (Stamper's Windows compliance POST, then `/{id}/assign`). The derived
  // inventory entry was GET-only. `singletonId` = the collection name keeps a
  // POST creating a new member with a new id (as configurationPolicies).
  {
    kind: 'uri',
    pattern: '/v1.0/deviceManagement/deviceCompliancePolicies',
    collection: 'deviceCompliancePolicies',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
    mutationVerbs: ['POST'],
    singletonId: 'deviceCompliancePolicies',
  },
  // DEPTH-9a (2026-10-31): the REST forms of two reads Stamper's evidence entries send
  // (CM.L2-3.4.8.detected-apps, IA.L1-3.5.1.identity-evidence; DEPTH-0 listed them unanswered).
  {
    kind: 'uri',
    pattern: '/v1.0/deviceManagement/detectedApps',
    collection: 'detectedApps',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/devices',
    collection: 'devices',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgDeviceManagementDetectedApp',
    endpoint: '/deviceManagement/detectedApps',
    collection: 'detectedApps',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgSecuritySecureScore',
    endpoint: '/security/secureScores',
    collection: 'secureScores',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgSecurityAlert',
    endpoint: '/security/alerts_v2',
    collection: 'alerts',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgInformationProtectionPolicyLabel',
    endpoint: '/informationProtection/policy/labels',
    collection: 'policyLabels',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgPolicyAuthenticationStrengthPolicy',
    endpoint: '/policies/authenticationStrengthPolicies',
    collection: 'authenticationStrengthPolicies',
    verb: 'GET',
    azureTier: 'none',
  },
  // W5c2 follow-up 10 (SIM-W4c1..W4c6): EO coverage list reads (sub-resources
  // are in ResolverTable.resolveCoverageSubresource).
  { kind: 'uri', pattern: '/beta/deviceManagement/remoteActionAudits', collection: 'remoteActionAudits', verb: 'GET', azureTier: 'none', envelope: 'value' },
  { kind: 'uri', pattern: '/beta/deviceManagement/windowsMalwareInformation', collection: 'windowsMalwareInformation', verb: 'GET', azureTier: 'none', envelope: 'value' },
  { kind: 'uri', pattern: '/v1.0/identityGovernance/termsOfUse/agreements', collection: 'touAgreements', verb: 'GET', azureTier: 'none', envelope: 'value' },
  { kind: 'uri', pattern: '/v1.0/identityGovernance/accessReviews/definitions', collection: 'accessReviewDefinitions', verb: 'GET', azureTier: 'none', envelope: 'value' },
  // SIM-BL (2026-10-31): the BitLocker recovery keys escrowed in Entra ID,
  // Stamper's SC.L2-3.13.10.key-escrow read (`(Invoke-MgGraphRequest -Uri
  // '.../v1.0/informationProtection/bitlocker/recoveryKeys').value`). Key
  // metadata only (id, createdDateTime, deviceId, volumeType): the seeds
  // carry no key material. Seeded by customer-history and muster-partial-config.
  { kind: 'uri', pattern: '/v1.0/informationProtection/bitlocker/recoveryKeys', collection: 'bitlockerRecoveryKeys', verb: 'GET', azureTier: 'none', envelope: 'value' },
  // W5c2 follow-up 8: Graph v1.0's authentication strength list (the same
  // collection as the cmdlet; the built-in strengths are in every tenant).
  {
    kind: 'uri',
    pattern: '/v1.0/identity/conditionalAccess/authenticationStrength/policies',
    collection: 'authenticationStrengthPolicies',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgAgreement',
    endpoint: '/agreements',
    collection: 'touAgreements',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgPolicyRoleManagementPolicy',
    endpoint: '/policies/roleManagementPolicies',
    collection: 'roleManagementPolicies',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgSecurityThreatIntelligenceVulnerability',
    endpoint: '/security/microsoft/vulnerabilities',
    collection: 'vulnerabilities',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgPolicyCrossTenantAccessPolicyDefault',
    endpoint: '/policies/crossTenantAccessPolicy/default',
    collection: 'crossTenantAccessPolicy',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgReportAuthenticationMethodUserRegistrationDetail',
    endpoint: '/reports/authenticationMethods/userRegistrationDetails',
    collection: 'authenticationMethodUserRegistrationDetails',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgAuditLogSignIn',
    endpoint: '/auditLogs/signIns',
    collection: 'signInLogs',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgDeviceManagementConfigurationPolicy',
    endpoint: '/deviceManagement/configurationPolicies',
    collection: 'deviceManagementConfigurationPolicies',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgDeviceManagementIntent',
    endpoint: '/deviceManagement/intents',
    collection: 'deviceManagementIntents',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgInformationProtectionSensitivityLabel',
    endpoint: '/informationProtection/sensitivityLabels',
    collection: 'sensitivityLabels',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgInformationProtectionDataLossPreventionPolicy',
    endpoint: '/informationProtection/dataLossPreventionPolicies',
    collection: 'dlpPolicies',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgSecurityAttackSimulation',
    endpoint: '/security/attackSimulation/simulations',
    collection: 'attackSimulations',
    verb: 'GET',
    azureTier: 'none',
  },
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgRiskDetection',
    endpoint: '/identityProtection/riskDetections',
    collection: 'riskDetections',
    verb: 'GET',
    azureTier: 'none',
  },
  // G-STACKSIM-2 iteration 4: AO's F-08 (set) PATCHes a security alert's
  // status/assignment via Update-MgSecurityAlert before its second
  // statement (`az resource update`, now shimmed - see
  // src/resolvers/azCliResolvers.ts). Update-MgSecurityAlert is only ever
  // referenced inside F-08:set (an az-CLI-tainted item, so it was never
  // picked up by deriveResolversFromInventory.ts's usage scan, which skips
  // excluded items and F-08:set's own `engine` stays 'other' even once
  // un-excluded - see classifyCommandEngine()'s isAzCli() short-circuit).
  // Same collection ('alerts') as the already-hand-authored
  // Get-MgSecurityAlert above, so a read after this mutation sees it.
  {
    kind: 'cmdlet',
    cmdlet: 'Update-MgSecurityAlert',
    endpoint: '/security/alerts_v2/{id}',
    collection: 'alerts',
    verb: 'PATCH',
    azureTier: 'none',
    mutationVerbs: ['PATCH'],
    singletonId: 'alert-1',
  },
  // P0-2 fix 9 (member-add, 2026-07-27): AC.L2-3.1.1.member-add's write
  // (New-MgGroupMemberByRef -BodyParameter @{'@odata.id'='.../directoryObjects/{id}'})
  // auto-derived to its OWN never-read collection ("groupMemberByRef"),
  // distinct from Get-MgGroupMember's "groupMember" - the same "collection
  // is the real identity" class of bug the namedLocation/managedDevice
  // remaps above fixed, so the write was never visible to the read. Real
  // Microsoft Graph's POST .../members/$ref IS a Get-MgGroupMember-visible
  // member add, so this override targets the SAME collection
  // Get-MgGroupMember already reads; the member's real id (the trailing
  // /directoryObjects/{id} segment of the @odata.id ref) is parsed out in
  // ResolverTable.resolveMutation.
  {
    kind: 'cmdlet',
    cmdlet: 'New-MgGroupMemberByRef',
    endpoint: '/groups/{id}/members/$ref',
    collection: 'groupMember',
    verb: 'POST',
    azureTier: 'none',
    mutationVerbs: ['POST'],
    singletonId: 'groupMember',
  },
  // FC-SIM-2 (2026-09-28, REQ-tenant-stacksim-ao-paired-read-endpoints /
  // ../ces-ao's REQ-ces-ao-paired-reads): AO's B-08 paired read lists the
  // Android app-protection policy's apps (Graph
  // androidManagedAppProtections/{id}/apps) - the read half of the set
  // New-MgDeviceAppManagementAndroidManagedAppProtectionApp already writes
  // (COLLECTION_REMAP above puts both on "androidManagedAppProtectionApps").
  // `-AndroidManagedAppProtectionId` is a registered TARGET_PARAMS key
  // (targets.ts), so this named-cmdlet GET is scoped to the named policy's
  // apps by ResolverTable.resolveTargetedGet's existing sub-resource branch -
  // no new resolver mechanism needed, only this entry.
  {
    kind: 'cmdlet',
    cmdlet: 'Get-MgDeviceAppManagementAndroidManagedAppProtectionApp',
    endpoint: '/deviceAppManagement/androidManagedAppProtections/{id}/apps',
    collection: 'androidManagedAppProtectionApps',
    verb: 'GET',
    azureTier: 'none',
  },
  // synthetic-customer W6 (S2 MAM reads): the Android app-protection list, the
  // Graph twin of the iOS list (inventory-derived from Stamper's GET). S2 seeds
  // one policy; `$expand=assignments` applies (ResolverTable EXPAND_ONLY).
  {
    kind: 'uri',
    pattern: '/v1.0/deviceAppManagement/androidManagedAppProtections',
    collection: 'androidManagedAppProtections',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/beta/deviceAppManagement/androidManagedAppProtections',
    collection: 'androidManagedAppProtections',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },

  // FC-SIM-2 (2026-09-28): EvidenceOps overlay signal reads (EO-03,
  // ../ces-eo's REQ-tenant-stacksim-{training-user-coverage,users,
  // security-incidents,lifecycle-workflows}.md). Each is a plain read-only
  // Graph v1.0 collection, called via Invoke-MgGraphRequest -Method GET
  // (ComplianceSignalFetcher.fetchGraphCollection), so a bare URI-pattern
  // entry with the "value" envelope is the whole fix - query strings
  // ($select/$expand/$filter) are stripped by normalizeUri before matching.
  {
    kind: 'uri',
    pattern: '/v1.0/reports/security/getAttackSimulationTrainingUserCoverage',
    collection: 'trainingUserCoverage',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  // EO's /v1.0/security/incidents?$expand=alerts read is a COLLECTION GET,
  // distinct from AO's Get-MgSecurityIncident item-level cmdlet read (same
  // "securityIncidents" collection, already seeded - see gccHighG5.ts).
  {
    kind: 'uri',
    pattern: '/v1.0/security/incidents',
    collection: 'securityIncidents',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/identityGovernance/lifecycleWorkflows/workflows',
    collection: 'lifecycleWorkflows',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  // W7-SIM (2026-10-29): one lifecycle workflow by id (W7-TST's A-21 confirm
  // read) and its PATCH (AO's A-21 schedules a leaver / mover workflow).
  // The PATCH accepts isEnabled and isSchedulingEnabled only
  // (ResolverTable.patchLifecycleWorkflow); dynamic id, no singletonId.
  {
    kind: 'uri',
    pattern: '/v1.0/identityGovernance/lifecycleWorkflows/workflows/*',
    collection: 'lifecycleWorkflows',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'raw',
    mutationVerbs: ['PATCH'],
  },
  // W7-SIM: AO's A-10 routes as manual entries (they were derived from
  // coverage/inventory.json, so they were served only while the inventory
  // named them): the role-assignment list ($filter applies) and the
  // eligibility-request create (an adminAssign request provisions the
  // eligibility schedule, ResolverTable.resolveMutation). Same shapes as the
  // derived entries.
  {
    kind: 'uri',
    pattern: '/v1.0/roleManagement/directory/roleAssignments',
    collection: 'roleAssignments',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/roleManagement/directory/roleEligibilityScheduleRequests',
    collection: 'roleEligibilityScheduleRequests',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
    mutationVerbs: ['POST'],
    singletonId: 'roleEligibilityScheduleRequests',
  },
  // W7-SIM: the MFA registration report as a REST read (the same collection
  // Get-MgReportAuthenticationMethodUserRegistrationDetail reads; it was
  // inventory-derived). One page, as everywhere in the Sim: no
  // @odata.nextLink, so a caller paging with -All gets every row.
  {
    kind: 'uri',
    pattern: '/v1.0/reports/authenticationMethods/userRegistrationDetails',
    collection: 'authenticationMethodUserRegistrationDetails',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  // EO-collection B20 (2026-10-27): the identity-protection and PIM reads
  // EO's collectors make with Invoke-MgGraphRequest (C5 risk detections and
  // risky users, C4 role-activation requests). Same collections the cmdlets
  // (Get-MgRiskDetection, Get-MgRiskyUser) read. Single-page `value`
  // envelopes like every other sim collection (no @odata.nextLink); the URI
  // `$filter` (date operators included) is applied by resolveUri.
  {
    kind: 'uri',
    pattern: '/v1.0/identityProtection/riskDetections',
    collection: 'riskDetections',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/identityProtection/riskyUsers',
    collection: 'riskyUsers',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/roleManagement/directory/roleAssignmentScheduleRequests',
    collection: 'roleAssignmentScheduleRequests',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  // synthetic-customer W1 (2026-10-28, PLAN §2.2 known gaps): the tenant
  // reads Muster's harvest makes (harvestService.ts TENANT_READS) to fill
  // tenant_id, primary_domain, the licence and PIM facts. Single-page `value`
  // envelopes like every other sim collection (no @odata.nextLink); the URI
  // `$filter` is applied by resolveUri. /organization replaces the
  // inventory-derived raw entry (it returned a bare array, not Graph's
  // collection shape); it is seeded per scenario (base.ts / customerHistory.ts).
  // /me and roleEligibilityScheduleInstances are ResolverTable special cases
  // (resolveMe, resolveEligibilityInstances).
  {
    kind: 'uri',
    pattern: '/v1.0/organization',
    collection: 'organization',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/subscribedSkus',
    collection: 'subscribedSkus',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  // PH-6 R-SIM (2026-10-31): the app registrations list (real Graph
  // GET /applications). The AO sweep discovers C-02's appId here.
  {
    kind: 'uri',
    pattern: '/v1.0/applications',
    collection: 'applications',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/roleManagement/directory/roleEligibilitySchedules',
    collection: 'roleEligibilitySchedules',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  // synthetic-customer W5 cycle 1 (2026-10-28): fixed entries for the
  // security reads EO's collectors C6a (alerts_v2), C8 (secureScores) and C8b
  // (secureScoreControlProfiles) make with Invoke-MgGraphRequest. They used
  // to come from the entries derived from coverage/inventory.json at module
  // load, so the URI was served only while the inventory named it. The
  // manual entries suppress the derived ones (MANUAL_URI_PATTERNS). Same
  // collections the cmdlets read; single-page `value` envelopes; the URI
  // `$filter` is applied by resolveUri.
  {
    kind: 'uri',
    pattern: '/v1.0/security/alerts_v2',
    collection: 'alerts',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/security/secureScores',
    collection: 'secureScores',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/security/secureScoreControlProfiles',
    collection: 'secureScoreControlProfiles',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  // W5c1 (W3 Stamper finding b): Update-MgPolicyAuthorizationPolicy derived to
  // a second collection/id ('policyAuthorizationPolicy'), so its PATCH was
  // never visible to Get-MgPolicyAuthorizationPolicy or the URI read. It now
  // PATCHes the one seeded singleton every reader returns.
  {
    kind: 'cmdlet',
    cmdlet: 'Update-MgPolicyAuthorizationPolicy',
    endpoint: '/policies/authorizationPolicy',
    collection: 'authorizationPolicy',
    verb: 'PATCH',
    azureTier: 'none',
    mutationVerbs: ['PATCH'],
    singletonId: 'authorizationPolicy',
  },
  // W5c1: the PIM policy chain as REST reads (the cmdlets keep their derived
  // collections, which these entries share): role management policies (rules
  // only with `$expand=rules`, W5c1-c; resolveUri), their role assignments, and
  // the directory role definitions. `$filter` (eq ... and ...) is applied by
  // resolveUri.
  {
    kind: 'uri',
    pattern: '/v1.0/policies/roleManagementPolicies',
    collection: 'roleManagementPolicies',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/policies/roleManagementPolicyAssignments',
    collection: 'policyRoleManagementPolicyAssignment',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/v1.0/roleManagement/directory/roleDefinitions',
    collection: 'roleManagementDirectoryRoleDefinition',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  // W5c1: tenant domains (password expiry is a domain property).
  {
    kind: 'uri',
    pattern: '/v1.0/domains',
    collection: 'domains',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  // W5c1-b: the authentication methods policy singleton (the derived raw
  // entry listed the collection, an array). ResolverTable embeds the
  // per-method configurations at read time, as Graph v1.0 returns them.
  {
    kind: 'uri',
    pattern: '/v1.0/policies/authenticationMethodsPolicy',
    collection: 'authenticationMethodsPolicy',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'raw',
    singletonId: 'authenticationMethodsPolicy',
  },
  // W5c1-b: Graph v1.0's directory settings (Password Rule Settings: smart
  // lockout and banned passwords) - the same objects Get-MgDirectorySetting
  // reads.
  {
    kind: 'uri',
    pattern: '/v1.0/groupSettings',
    collection: 'directorySettings',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  // W5c2: the same directory settings at `/beta/settings` (Graph's beta
  // list; Stamper's AC.L2-3.1.8 smart-lockout and IA.L2-3.5.8
  // password-policy evidence read it). The v1.0 list is `/v1.0/groupSettings`
  // above. W5c2 follow-up 5: the `/v1.0/settings` alias is gone (no caller
  // uses it); only the stale coverage inventory still derives that path.
  {
    kind: 'uri',
    pattern: '/beta/settings',
    collection: 'directorySettings',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  // W5c2 follow-up 4 (SIM-11): deleted users (Entra's 30-day recycle bin),
  // served only through the type-cast segment, as Graph does. One page;
  // `$select` and `$filter` are honoured (ResolverTable). EO's IA.L2-3.5.5
  // reads the v1.0 path.
  {
    kind: 'uri',
    pattern: '/v1.0/directory/deletedItems/microsoft.graph.user',
    collection: 'deletedUsers',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/beta/directory/deletedItems/microsoft.graph.user',
    collection: 'deletedUsers',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  // P1.4b (2026-10-27): Intune templates (security baselines) - the list a
  // caller filters by displayName to capture a template id, and the item read.
  {
    kind: 'uri',
    pattern: '/beta/deviceManagement/templates',
    collection: 'deviceManagementTemplates',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/beta/deviceManagement/templates/*',
    collection: 'deviceManagementTemplates',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'raw',
  },
  // P1.4c (2026-10-27): intents live in the SAME collection
  // Get-MgDeviceManagementIntent reads (the derived entry used 'intents').
  {
    kind: 'uri',
    pattern: '/beta/deviceManagement/intents',
    collection: 'deviceManagementIntents',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
  },
  {
    kind: 'uri',
    pattern: '/beta/deviceManagement/intents/*',
    collection: 'deviceManagementIntents',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'raw',
  },
  // W5c1-c (2026-10-28): the settings catalog as a REST read (EO's
  // configurationPolicies signal, `?$expand=settings`). It lives in the SAME
  // collection Get-MgDeviceManagementConfigurationPolicy reads (the derived
  // entry used a separate 'configurationPolicies'), so S1's seeded policy is
  // served and Stamper's ASR / firewall POSTs create new members there.
  // `settings` come back only with `$expand=settings` (resolveUri). Beta
  // only, as on Graph; single-page `value` envelope.
  {
    kind: 'uri',
    pattern: '/beta/deviceManagement/configurationPolicies',
    collection: 'deviceManagementConfigurationPolicies',
    verb: 'GET',
    azureTier: 'none',
    envelope: 'value',
    mutationVerbs: ['POST'],
    singletonId: 'deviceManagementConfigurationPolicies',
  },
  // FIN-21 (2026-10-31): Stamper tenant initialization on a clean tenant
  // (bootstrap + preflight); ResolverTable answers them with resolveTenantInit.
  ...TENANT_INIT_GRAPH_ENTRIES,
];

/** Cmdlets/URI patterns already hand-authored above - excluded from the generic inventory-derived set below to avoid duplicate/conflicting entries. */
const MANUAL_CMDLETS = new Set(
  manualGraphResolvers.filter((e): e is Extract<ResolverEntry, { kind: 'cmdlet' }> => e.kind === 'cmdlet').map((e) => e.cmdlet),
);
const MANUAL_URI_PATTERNS = new Set(
  manualGraphResolvers.filter((e): e is Extract<ResolverEntry, { kind: 'uri' }> => e.kind === 'uri').map((e) => e.pattern),
);

const derived = deriveResolversFromInventory(loadInventoryItemsSync(), {
  cmdlets: MANUAL_CMDLETS,
  uriPatterns: MANUAL_URI_PATTERNS,
});

/**
 * G-STACKSIM-2 iteration 2: hand-authored entries (M2/M4/M6, above) plus
 * every additional Graph named cmdlet / Invoke-MgGraphRequest URI pattern
 * `coverage/inventory.json` references, derived at module-load time
 * (src/codegen/deriveResolversFromInventory.ts) - "extend the module
 * manifest/codegen from the inventory itself" per the iteration-2 task.
 */
export const graphResolvers: ResolverEntry[] = [...manualGraphResolvers, ...derived.graph, ...derived.graphUri];
