// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// questionRegisterJustifications.ts — MG-28: the HAND-AUTHORED half of the
// question register. questionRegister.ts computes everything the code can tell
// (output fields from plan_input / mapped_requirements, discovery/harvest/
// archetype/SI-derivation sources); this file holds what only a person can
// write: why a question cannot be derived, or which backlog item will derive it.
//
// Rules (docs/QUESTION_REGISTER.md):
//   - Every QUESTION_GRAPH node id MUST have an entry here. A node without one
//     is "unregistered" and the questionRegister test fails.
//   - `why` is one of: a reason grounded in code (cite the file), a backlog
//     item (`candidate: 'MG-nn'`), or TO_JUSTIFY — never a guessed reason.
//   - A PR that adds a question adds an entry here and re-runs
//     `npm run register:generate`.

import { LEGACY_READINESS_ALIASES, PHANTOM_RR_ACTIVITY_IDS, RR_ACTIVITY_NODES } from './questionGraph';
import { SSP_ACTIVITY_ID } from '@/features/scoring/readinessScope';

export const TO_JUSTIFY = 'to justify (BHD)';

export interface NodeJustification {
  /** Grounded reason the question cannot be derived; omit when `candidate` or TO_JUSTIFY applies. */
  why?: string;
  /** Backlog item(s) that would derive this answer (from 01-GAP-BACKLOG.md). */
  candidate?: string[];
  /** Output fields fed indirectly (e.g. through an SI derivation), beyond the node's own plan_input / requirements. */
  extraOutputs?: string[];
  /** Sources tried that the generator cannot read from code (compile-time derivations, defaults). */
  extraSources?: string[];
}

const TCP_SI_DEFAULT = 'SI→TCP default at compile when unanswered (vendored tcpSIDerivation.deriveTCPDefaults)';
const TCP_BANK_DEFAULT = "TCP bank 'recommended' value when unanswered and not SI-derived (tcpAdapter.buildTenantConfigProfile)";
const SI_GENERATOR_DEFAULT = "SI generator default when unanswered (listed in planCompileService defaultedInputs)";
// MG-08 (cuiBoundaryAdapter.buildCuiBoundary).
const CUI_SI_DEFAULT = 'SI default when unanswered (vendored cuiSIDerivation.deriveCUIDefaults)';
const CUI_BANK_DEFAULT = "CUI bank 'recommended' value when unanswered (listed in defaultedInputs)";
const CUI_NO_DEFAULT = 'none: left out of the boundary and listed as unresolved when unanswered';
/** MG-14: a tenant fact the harvest's tenant probes read. */
const TENANT_FACT = (read: string): string =>
  `Tenant fact, discovered from ${read} (muster-api harvestService TENANT_PROBES) as an overridable pre-fill; asked only when discovery is silent (no consent, or a build_new tenant).`;
const ARM_ONLY =
  'Sentinel lives in Azure Resource Manager, not Graph: the harvest cannot read it (harvestService NOT-PROBEABLE note), so it is asked.';
/** W5c3: a naming convention is the organisation's rule, not a tenant reading. */
const TCP_CONVENTION =
  "A naming convention is the organisation's own rule: object names in the tenant do not state it, so it is asked (W5c3; unanswered, the bank recommendation stands and is listed as defaulted).";
const TCP_NOT_HARVESTED = (reason: string): string => `Not harvested: ${reason}; asked (W5c3).`;

// MG-07: why an RR activity is (or is not) asked. Grounded in
// scoring/readinessScope.ts and interview/questionGraphService.ts.
const RR_SCENARIO_SOURCE =
  "scenario filter: vendored Planner questionSetGenerator over the session's SI fields; an excluded activity is never asked (readinessScope.selectActivities)";
const RR_CASCADE_SOURCE =
  'bulk cascade: vendored Planner bulkAnswerDerivation over the stack/answer preamble; an activity whose requirement a rule settles (license or scope gate, inherent, SI override, preamble) is derived, not asked (readinessScope.cascadeScope)';
const RR_RESIDUE_WHY =
  'Asked only when the scenario selects it AND every cascade action for its requirement falls to the archetype fallback (no license/scope gate, inherent capability, SI override or preamble rule applies), AND discovery reports no met verdict: the cascade then has nothing but a prior, so the status is asked (readinessScope.residueActivities).';
const RR_SSP_WHY =
  "Asked until answered whenever the scenario selects it: the SSP answer is the only input to the cascade's policy_doc_state preamble (preambleMapper), so the cascade cannot settle it from itself.";
// FIN-26b (NS-audit F-10): an RR activity keyed only to a phantom L2 twin (an L2 label for an L1 practice).
const RR_PHANTOM_WHY =
  'Never asked (FIN-26b, NS-audit F-10): its requirement is an L2 label for an L1 practice that the ces-shared 110-control reference does not have, so the L1 twin activity is the practice and is asked or derived in its place (questionGraphService.readinessResidueIds). The node stays so a recorded fact for it still maps; the cascade derives its posture row as before.';
const RR_FOUNDATION_WHY =
  "Scoping foundation activity (Planner's FOUNDATION requirement). Asked only when selected and the cascade leaves its FOUNDATION actions to the archetype fallback; the CUI boundary nodes (bnd-*, CUI.*) carry the scoping facts the plan uses.";

/** MG-07: the retired readiness ids, kept as never-asked alias nodes. */
function legacyAliasJustifications(): Record<string, NodeJustification> {
  return Object.fromEntries(
    Object.entries(LEGACY_READINESS_ALIASES).map(([id, aliases]) => [
      id,
      {
        why: `Retired static readiness node (MG-07): never asked. Kept only so a fact written under this id (muster-api harvestService readiness probes, older sessions) persists and prunes; it is re-keyed onto ${aliases.join(', ')} (expandLegacyReadinessFacts).`,
      },
    ])
  );
}

function rrActivityJustifications(): Record<string, NodeJustification> {
  return Object.fromEntries(
    RR_ACTIVITY_NODES.map((n) => [
      n.id,
      {
        why:
          n.id === SSP_ACTIVITY_ID
            ? RR_SSP_WHY
            : PHANTOM_RR_ACTIVITY_IDS.has(n.id)
              ? RR_PHANTOM_WHY
              : n.mapped_requirements.includes('FOUNDATION')
                ? RR_FOUNDATION_WHY
                : RR_RESIDUE_WHY,
        extraSources: [RR_SCENARIO_SOURCE, RR_CASCADE_SOURCE],
      },
    ])
  );
}

/** Per-node justification, keyed by QUESTION_GRAPH node id. */
export const NODE_JUSTIFICATIONS: Record<string, NodeJustification> = {
  // ── Readiness: the 165 RR activities (MG-07, decision D5). One generated
  // entry per activity (rrActivityJustifications below): asked only for the
  // scenario's selected activities that the bulk cascade cannot settle and
  // discovery does not report met (MG-02).
  ...rrActivityJustifications(),
  ...legacyAliasJustifications(),

  // ── CUI boundary. Grounded: discoveryFactJoin.ts and boundaryInference.ts.
  'bnd-001': {
    why: 'The CUI boundary is intent: discovery only drafts it (unconfirmed, never scores) and a named human must confirm (discoveryFactJoin.ts, boundaryInference.ts).',
    extraOutputs: ['si_baseline.target.cui_presence'],
  },
  'bnd-002': {
    why: 'The CUI boundary is intent: discovery only drafts it (unconfirmed, never scores) and a named human must confirm (discoveryFactJoin.ts, boundaryInference.ts).',
  },
  'bnd-003': {
    why: 'The CUI boundary is intent: discovery only drafts it (unconfirmed, never scores) and a named human must confirm (discoveryFactJoin.ts, boundaryInference.ts).',
  },

  // ── SI Baseline plan inputs.
  'G-01': {
    why: 'Not asked in practice: derived on every session, L1 when G-02 declares no CUI (no_cui / fci_only), otherwise L2 from the readiness engine (siDerivation G-01).',
  },
  'G-02': {
    why: "Derived only from bnd-001 = yes; a 'no' could mean no_cui or fci_only, so it is not mapped (siDerivation G-02).",
  },
  'G-03': { why: TO_JUSTIFY },
  'G-04': { why: TO_JUSTIFY },
  'G-05': { why: TO_JUSTIFY },
  'G-06': { why: TO_JUSTIFY },
  'G-07': { why: TO_JUSTIFY },
  'G-08': {
    why: 'Derived from the declared service inventory; with nothing declared it is not derivable and is never invented (siDerivation G-08).',
  },
  'S-11': {
    why: 'Pre-filled from the licensed users (TCP.LIC.002, siDerivation S-11); asked to narrow the estimate to an enclave, or when no licence count is held.',
  },
  'S-12': { why: TO_JUSTIFY },
  'S-13': {
    why: "Derived only from TCP.DM.001 = enroll_only; a corporate join or 'None' says nothing about BYOD (siDerivation S-13).",
  },
  'S-16': { why: TO_JUSTIFY },
  'S-20': {
    why: 'Derived from TCP.TI.004 (discovered or asked) or the service inventory (siDerivation S-20); asked only when neither holds a value. DoD is not mapped: IL5 vs IL6 is not determined by the cloud.',
  },
  'SIT-020': { candidate: ['MG-05'] },
  'SIT-021': {
    why: 'Derived from TCP.LIC.001 (graph:subscribedSkus or asked), else the preamble / stack tier (siDerivation SIT-021); asked only when neither maps to an SI tier (E3, E5 and Other are not SI tiers).',
  },
  'S-24': { why: TO_JUSTIFY },
  'S-25': {
    why: 'Derived from the platforms in scope (TCP.DM.004, graph:managedDevices or asked) with the enrollment type (siDerivation S-25); asked only when no platform list is held.',
  },
  'S-26': { why: TO_JUSTIFY },
  'S-27': {
    why: "Discovered as 'blocked' when an Intune device configuration blocks removable storage (harvestService TENANT_PROBES, graph:deviceConfigurations); the absence of that setting does not tell allowed_encrypted from allowed_uncontrolled, so it is asked then.",
  },
  'S-28': {
    why: "Discovered as 'cloud_native' when an enabled Conditional Access policy covers all users and all cloud apps with MFA or a compliant device (graph:conditionalAccess); VPN use is not visible to Graph, so it is asked otherwise.",
  },
  'S-29': {
    why: 'No tenant read evidences a nonlocal-maintenance practice: Intune enrollment does not mean maintenance is done remotely (fixture (c) is Intune-joined and no_nonlocal), so it is asked.',
  },
  'S-30': { why: TO_JUSTIFY },
  'SIT-022': {
    why: 'Derived from the licences assigned on the primary SKU (TCP.LIC.002, graph:subscribedSkus or asked; siDerivation SIT-022); asked only when no licence count is held.',
  },
  'SIT-023': { why: TO_JUSTIFY },
  'SIT-024': { why: TO_JUSTIFY },
  'SIT-025': { why: TO_JUSTIFY },

  // ── Tenant Config Profile plan inputs. MG-14 fills these from discovery.
  'TCP.TI.004': {
    why: 'Discovered (medium confidence) from a .onmicrosoft.us verified domain (graph:organization); Graph does not tell GCC from Commercial, so a .com tenant is asked.',
    extraOutputs: ['si_baseline.dependencies.tenant_model_preference'],
    extraSources: [TCP_SI_DEFAULT, TCP_BANK_DEFAULT],
  },
  'TCP.LIC.001': {
    why: TENANT_FACT('graph:subscribedSkus') + ' Only recognised SKU part numbers map.',
    extraOutputs: ['si_baseline.dependencies.license_tier'],
    extraSources: [TCP_BANK_DEFAULT],
  },
  'TCP.IA.004': {
    why: 'Discovered as entra_native when no user is directory-synced (graph:users); Graph does not tell AD Connect from Cloud Sync, so a synced tenant is asked.',
    extraSources: [TCP_SI_DEFAULT, TCP_BANK_DEFAULT],
  },
  'TCP.IA.005': { why: TENANT_FACT('graph:users'), extraSources: [TCP_SI_DEFAULT, TCP_BANK_DEFAULT] },
  'TCP.PA.004': { why: TENANT_FACT('graph:roleEligibility'), extraSources: [TCP_BANK_DEFAULT] },
  'TCP.GA.004': { why: TENANT_FACT('graph:groups'), extraSources: [TCP_BANK_DEFAULT] },
  'TCP.DM.001': {
    why: 'Discovered from the managed devices\' join type (graph:managedDevices) for Azure AD and hybrid join; Enroll Only (BYOD) and None are not told apart by join type, so they are asked.',
    extraOutputs: ['si_baseline.operations.byod_posture', 'si_baseline.operations.mobile_device_presence'],
    extraSources: [TCP_SI_DEFAULT, TCP_BANK_DEFAULT],
  },

  // ── MG-14: TCP tenant facts as typed plan inputs (tcpPlanInputNodes
  // TCP_TYPED_NODE_SPECS), pre-filled by the harvest's tenant probes.
  'TCP.TI.001': { why: TENANT_FACT('graph:organization'), extraOutputs: ['tenant_manifest.tenant_identity.tenant_id'] },
  'TCP.TI.002': {
    why: TENANT_FACT('graph:organization'),
    extraOutputs: [
      'tenant_manifest.tenant_identity.primary_domain',
      'tenant_config_profile.tenant_config.identity_architecture.admin_naming_convention',
      'tenant_config_profile.tenant_config.identity_architecture.service_account_naming_convention',
    ],
  },
  'TCP.TI.003': { why: TENANT_FACT('graph:organization'), extraSources: [TCP_BANK_DEFAULT] },
  'TCP.TI.005': { why: TENANT_FACT('graph:organization'), extraSources: ['assessed party name, else ' + TCP_BANK_DEFAULT] },
  'TCP.LIC.002': {
    why: TENANT_FACT('graph:subscribedSkus'),
    extraOutputs: ['si_baseline.dependencies.user_count', 'si_baseline.scope.in_scope_users_estimate'],
    extraSources: [TCP_SI_DEFAULT],
  },
  'TCP.IA.001': {
    why: 'Discovered as the Global Administrators excluded from every enabled Conditional Access policy (graph:conditionalAccess + graph:roleAssignments); asked only when discovery is silent.',
    extraOutputs: ['operator_values.breakglass_upn', 'tenant_manifest.assets'],
    extraSources: [TCP_BANK_DEFAULT],
  },
  'TCP.PA.001': { why: TENANT_FACT('graph:roleAssignments'), extraSources: [TCP_BANK_DEFAULT] },
  'TCP.PA.002': { why: TENANT_FACT('graph:roleAssignments'), extraSources: [TCP_BANK_DEFAULT] },
  'TCP.PA.003': { why: TENANT_FACT('graph:roleAssignments + graph:roleEligibility (W5c4: PIM-eligible holders count)'), extraSources: [TCP_BANK_DEFAULT] },
  'TCP.GA.002': {
    why: TENANT_FACT('graph:groups'),
    extraOutputs: ['operator_values.cui_group_name'],
    extraSources: [TCP_BANK_DEFAULT],
  },
  'TCP.CA.003': { why: TENANT_FACT('graph:conditionalAccess'), extraSources: [TCP_BANK_DEFAULT] },
  'TCP.DM.004': {
    why: TENANT_FACT('graph:managedDevices'),
    extraOutputs: ['si_baseline.operations.mobile_device_presence'],
    extraSources: [TCP_BANK_DEFAULT],
  },
  'TCP.MON.003': { why: ARM_ONLY },
  'TCP.MON.004': { why: ARM_ONLY, extraSources: [TCP_BANK_DEFAULT] },
  // W5c3 (SC-8b): the bank's remaining text / list questions as typed nodes.
  'TCP.LIC.003': { why: TCP_NOT_HARVESTED('add-on SKUs are not told apart from the primary SKU by the harvest'), extraSources: [TCP_BANK_DEFAULT] },
  'TCP.LIC.004': { why: TCP_NOT_HARVESTED('the harvest does not read subscribedSkus service plans'), extraSources: [TCP_BANK_DEFAULT] },
  'TCP.IA.002': { why: TCP_CONVENTION, extraSources: [TCP_BANK_DEFAULT] },
  'TCP.IA.003': { why: TCP_CONVENTION, extraSources: [TCP_BANK_DEFAULT] },
  'TCP.PA.005': {
    why: 'Discovered as the one security group every enabled Conditional Access policy excludes (graph:conditionalAccess + graph:groups); asked only when discovery is silent or several groups qualify.',
    extraSources: [TCP_BANK_DEFAULT],
  },
  'TCP.GA.001': { why: TCP_CONVENTION, extraSources: [TCP_BANK_DEFAULT] },
  'TCP.GA.003': { why: TCP_CONVENTION, extraSources: [TCP_BANK_DEFAULT] },
  'TCP.CA.001': { why: TCP_CONVENTION, extraSources: [TCP_BANK_DEFAULT] },
  'TCP.CA.002': { why: TENANT_FACT('graph:namedLocations'), extraSources: [TCP_BANK_DEFAULT] },
  'TCP.DM.002': { why: TCP_CONVENTION, extraSources: [TCP_BANK_DEFAULT] },
  'TCP.DM.003': { why: TCP_CONVENTION, extraSources: [TCP_BANK_DEFAULT] },
  'TCP.DP.001': { why: TCP_CONVENTION, extraSources: [TCP_BANK_DEFAULT] },
  'TCP.DP.002': { why: TCP_NOT_HARVESTED('no tenant read says which sites the organisation designates for CUI'), extraSources: [TCP_BANK_DEFAULT] },
  'TCP.DP.003': { why: TCP_NOT_HARVESTED('no tenant read says which channels the organisation designates for CUI'), extraSources: [TCP_BANK_DEFAULT] },
  'TCP.DP.004': { why: TCP_CONVENTION, extraSources: [TCP_BANK_DEFAULT] },
  'TCP.MON.001': { why: ARM_ONLY, extraSources: [TCP_BANK_DEFAULT] },
  'TCP.MON.002': { why: ARM_ONLY, extraSources: [TCP_BANK_DEFAULT] },
  'TCP.MON.005': { why: TCP_CONVENTION, extraSources: [TCP_BANK_DEFAULT] },

  // ── MG-14 / FX-11: operator values Stamper needs (TCP_OPERATOR_NODE_SPECS).
  'TCP.MU.004': {
    why: 'Discovered as the consented operator (graph:me, delegated sign-in only); asked under app-only consent, which has no signed-in user.',
    extraOutputs: ['tenant_manifest.tenant_identity.operatorUPN (via tcpAdapter.operatorValuesFor, merged by tenantManifestAdapter)'],
  },
  'TCP.MU.005': {
    why: 'Discovered as the object id of the first break-glass account (graph:conditionalAccess exclusions); asked only when no break-glass account is discovered.',
    extraOutputs: ['tenant_manifest.tenant_identity.breakGlassUserId (via tcpAdapter.operatorValuesFor, merged by tenantManifestAdapter)'],
  },
  'TCP.MU.006': {
    why: 'No Graph read Muster runs names the corporate Wi-Fi SSID; asked, otherwise a visible placeholder is emitted and listed as defaulted (derive/operatorValues.ts).',
    extraOutputs: ['tenant_manifest.tenant_identity.wifiSsid (via tcpAdapter.operatorValuesFor, merged by tenantManifestAdapter)'],
  },
  'TCP.MU.007': {
    why: 'The security notification mailbox is an organisational choice no tenant read names; asked, otherwise a visible placeholder is emitted and listed as defaulted (derive/operatorValues.ts).',
    extraOutputs: [
      'tenant_manifest.tenant_identity.securityEmail (via tcpAdapter.operatorValuesFor, merged by tenantManifestAdapter)',
      'tenant_manifest.tenant_identity.cisoEmail (W5c6: the same value, Stamper AZ-MON-001)',
    ],
  },

  // ── Stamper provisioning inputs (tcpProvisioningNodes.ts).
  'TCP.MU.001': { why: TO_JUSTIFY },
  'TCP.MU.002': { why: TO_JUSTIFY, extraOutputs: ['infrastructure_manifest.stamper_variable_map.touFileName'] },
  'TCP.MU.003': {
    why: 'Not a typed answer: the password is generated in Muster and only its one-time reference is recorded (tcpProvisioningNodes.ts, provisioningInputs.ts).',
  },

  // ── MG-08: CUI boundary bindings still asked (cuiBoundaryNodes.ts). Built by
  // plan/cuiBoundaryAdapter.ts: answered > plan-mode derivation > SI defaults
  // (vendored cuiSIDerivation) > CUI bank `recommended`. The other 15 bank
  // questions are derived or defaulted and never asked.
  'CUI.CONTRACT.001': {
    why: 'Contract clauses are not observable in the tenant or the SI Baseline, and the CUI bank gives no recommended value (cuiSIDerivation has no rule).',
    extraSources: [CUI_NO_DEFAULT],
  },
  'CUI.GEN.001': {
    why: "The SI default maps any CUI presence to 'Both' (cuiSIDerivation CUI.GEN.001); whether CUI is only received or also generated is not in the SI or discovery.",
    extraSources: [CUI_SI_DEFAULT],
  },
  'CUI.GEN.002': {
    why: 'Which business functions generate CUI is organisational, not observable; the bank recommendation is a generic starting value.',
    extraSources: [CUI_BANK_DEFAULT],
  },
  'CUI.LC.ING.001': {
    why: 'Out-of-tenant ingress channels (prime portals, SFTP, physical media) are not observable by discovery; the bank recommendation is a generic starting value.',
    extraSources: [CUI_BANK_DEFAULT],
  },
  'CUI.LC.STO.001': {
    why: 'Which stores actually hold CUI is not readable from service inventory (the same GCC High services serve CUI and non-CUI data); the bank recommendation is a generic starting value.',
    extraSources: [CUI_BANK_DEFAULT],
  },
  'CUI.LC.PROC.001': {
    why: 'The tools that process CUI are not in the SI Baseline or discovery, and the CUI bank gives no recommended value.',
    extraSources: [CUI_NO_DEFAULT],
  },
  'CUI.USR.002': {
    why: 'The SI default is the in-scope user estimate (cuiSIDerivation CUI.USR.002), which counts every in-scope user, not only those who handle CUI.',
    extraSources: [CUI_SI_DEFAULT],
  },
  'CUI.DEV.002': {
    why: 'Privileged-workstation isolation is not read by any discovery collector; the bank recommendation is a generic starting value.',
    extraSources: [CUI_BANK_DEFAULT],
  },
  'CUI.INT.001': {
    why: 'Third-party integrations are not enumerated by discovery, and the CUI bank gives no recommended value.',
    extraSources: [CUI_NO_DEFAULT],
  },
  'CUI.OOS.001': {
    why: 'Out-of-scope declarations are a scoping decision, and the CUI bank gives no recommended value.',
    extraSources: [CUI_NO_DEFAULT],
  },
  // W5c4: the seven bindings that only ever took the bank recommendation.
  'CUI.CAT.001': {
    why: 'The CUI categories come from contracts and the data itself; no tenant read or SI field states them, and the bank recommendation (CTI only) is a generic starting value.',
    extraSources: [CUI_BANK_DEFAULT],
  },
  'CUI.USR.001': {
    why: 'Which roles need CUI access is organisational intent (GO-2: the boundary is never auto-detected); group names do not state it.',
    extraSources: [CUI_BANK_DEFAULT],
  },
  'CUI.DEVOPS.002': {
    why: 'Code repositories outside the tenant (commercial GitHub, Azure DevOps) are not read by any discovery collector.',
    extraSources: [CUI_BANK_DEFAULT],
  },
  'CUI.INT.002': {
    why: 'The intended forwarding posture for in-scope users is boundary intent; no discovery read exports the Exchange forwarding configuration.',
    extraSources: [CUI_BANK_DEFAULT],
  },
  'CUI.INT.003': {
    why: 'Whether service principals or tokens move CUI is a data-flow fact; discovery reads no app permissions inventory tied to CUI flows.',
    extraSources: [CUI_BANK_DEFAULT],
  },
  'CUI.BKP.001': {
    why: 'Backup handling sits on the backup platform, outside the Graph/ARM reads.',
    extraSources: [CUI_BANK_DEFAULT],
  },
  'CUI.ENF.001': {
    why: 'The mechanisms the organisation intends to rely on are boundary intent; discovery can only later confirm what is configured.',
    extraSources: [CUI_BANK_DEFAULT],
  },

  // ── MG-09: the BTC questions no discovery read evidences (plan/btc/btcGateNodes.ts).
  // The other eight (BTC.ID.001/002, BTC.DEV.001/002, BTC.LOG.001-004) take
  // their evidence from discovery captures (discovery/btcEvidenceMap.json) and
  // are not asked.
  'BTC.ID.003': {
    why: 'Guest presence is not read by any discovery collector (AC.L2-3.1.20.guest-restrict reads the invitation policy, not the guest list), and the BTC bank gives no default.',
    extraOutputs: ['btc_confirmation.gate_status'],
  },
  'BTC.ID.004': {
    why: 'Break-glass configuration and its documentation are not read by any discovery collector; Planner carries no derivation for it.',
    extraOutputs: ['btc_confirmation.gate_status'],
  },
  'BTC.DEV.003': {
    why: 'PAW/SAW isolation of admin devices is not read by any discovery collector; Planner carries no derivation for it.',
    extraOutputs: ['btc_confirmation.gate_status'],
  },
  'BTC.DEVOPS.001': {
    why: "Repository locations sit on the Git platform, outside the Graph/ARM reads; derived 'No' only when the SI says DevOps does not touch CUI (btcSICUIDerivation).",
    extraOutputs: ['btc_confirmation.gate_status'],
  },
  'BTC.DEVOPS.002': {
    why: "CI/CD runners and pipelines sit outside the Graph/ARM reads; derived 'N/A' only when the SI says DevOps does not touch CUI (btcSICUIDerivation).",
    extraOutputs: ['btc_confirmation.gate_status'],
  },
  'BTC.DEVOPS.003': {
    why: "The artifact store sits outside the Graph/ARM reads; derived 'N/A' only when the SI says DevOps does not touch CUI (btcSICUIDerivation).",
    extraOutputs: ['btc_confirmation.gate_status'],
  },
  'BTC.INT.001': {
    why: 'Approval of external SaaS integrations is an organisational record no discovery collector reads.',
    extraOutputs: ['btc_confirmation.gate_status'],
  },
  'BTC.INT.002': {
    why: 'No discovery read inventories every service principal with its permissions (AZ-ID-003 reads one app); least privilege and documentation are records.',
    extraOutputs: ['btc_confirmation.gate_status'],
  },
  'BTC.INT.003': {
    why: "No discovery read exports the Exchange forwarding configuration; Planner's CUI-egress derivation never fires on the binding-keyed boundary.",
    extraOutputs: ['btc_confirmation.gate_status'],
  },
  'BTC.INT.004': {
    why: 'Backup storage locations sit on the backup platform, outside the Graph/ARM reads.',
    extraOutputs: ['btc_confirmation.gate_status'],
  },
  'BTC.GOV.001': {
    why: 'An exception register is a governance record, not tenant state.',
    extraOutputs: ['btc_confirmation.gate_status'],
  },
  'BTC.GOV.002': {
    why: 'Compensating-control documentation is a governance record, not tenant state.',
    extraOutputs: ['btc_confirmation.gate_status'],
  },
  'BTC.GOV.003': {
    why: 'Formal risk acceptance is a governance record, not tenant state.',
    extraOutputs: ['btc_confirmation.gate_status'],
  },
  'BTC.GOV.004': {
    why: 'Change governance (approvals, rollback authority, windows) is a process record, not tenant state.',
    extraOutputs: ['btc_confirmation.gate_status'],
  },

  // ── MG-10: the one plan-mode confirm question (planModeNode.ts).
  'PLAN.MODE.001': {
    why: 'Confirms the mode plan/planModeDerivation.ts derives from discovery (no or empty tenant -> build_new, else harden_existing): an absent or empty discovery cannot tell a tenant still to be connected from one still to be built.',
    extraOutputs: ['manual_mission_plan.outputs.human_readable_mission_plan.plan_mode', 'tenant_manifest.plan_mode'],
    extraSources: ['discovery: readiness manifest and discovery-sourced facts (planModeDerivation)'],
  },

  // ── MG-16: Policy Inputs (policyInputNodes.ts; plan/policy/policyInputsProfile.ts).
  // Not asked: PI.ORG.001/006/007 (Profile tab), the 15 ODPs and PI.GOV.002/003
  // (bank recommended, provenance defaulted, shown on the Plan tab), PI.GOV.001
  // (W5: the plan date, or an answered approval date).
  ...policyJustifications(),
};

/** MG-16: why each asked Policy Inputs question is asked. */
function policyJustifications(): Record<string, NodeJustification> {
  const POLICY_PROFILE = 'Policy Inputs profile (plan/policy/policyInputsProfile.ts): unanswered -> left empty; the template default applies';
  const ADDRESS: NodeJustification = {
    why: 'Discovered from Graph /organization (street, city, state, postalCode) as an overridable pre-fill; asked only when the read is silent (no consent, or the tenant record has no address). The engagement profile holds no address.',
    extraSources: [POLICY_PROFILE],
  };
  const ORG = (why: string): NodeJustification => ({ why, extraSources: [POLICY_PROFILE] });
  const DRAFTED = (role: string, fact: string): NodeJustification => ({
    why: `A directory role is not a policy role: the ${role} holder (${fact}, harvest roleAssignments) is DRAFTED on the Plan tab and a person confirms or corrects it there (the confirmation records this answer). A draft never renders into a policy unconfirmed (drafts never become fact).`,
    extraSources: [`directory role holder draft: ${role} (${fact}), confirmed on the Plan tab`, POLICY_PROFILE],
  });
  const NO_ROLE = (who: string): NodeJustification => ({
    why: `No directory role, Graph read or other artifact names the ${who}; it is an organisational assignment.`,
    extraSources: [POLICY_PROFILE],
  });
  // W5c2 (SC-5 Q1-Q6): Muster-only questions, folded into the profile Muster-side.
  const MUSTER_PROFILE =
    'Policy Inputs profile (plan/policy/policyInputsProfile.ts), Muster-side: not a question of the pinned Planner bank; unanswered -> absent from the profile';
  const SSP_INPUT = (why: string): NodeJustification => ({ why, extraSources: [MUSTER_PROFILE] });
  // FIN-32b: a bank ODP. The answer is the organisation's own parameter; unanswered, the bank's recommended value applies.
  const BANK_ODP_PROFILE =
    'Policy Inputs profile (plan/policy/policyInputsProfile.ts): unanswered -> the bank recommended value (provenance defaulted)';
  const BANK_ODP = (what: string, recommended: number | string, outputs: string[] = []): NodeJustification => ({
    why: `${what} is an organisation-defined parameter: the organisation's chosen value is policy, not readable tenant state (a deployed setting shows what is configured, not what the organisation designates). Optional: unanswered, the profile takes the bank's recommended value (${recommended}, defaulted).`,
    extraSources: [BANK_ODP_PROFILE],
    ...(outputs.length ? { extraOutputs: outputs } : {}),
  });
  const PHYSICAL = (what: string): NodeJustification => ({
    why: `${what} is physical-site information: no tenant read, discovery collector or other artifact carries it.`,
    extraSources: [POLICY_PROFILE],
  });
  return {
    'PI.ORG.002': ADDRESS,
    'PI.ORG.003': ADDRESS,
    'PI.ORG.004': ADDRESS,
    'PI.ORG.005': ADDRESS,
    'PI.ORG.008': ORG(
      "The contract relationship is not tenant state, and the engagement kind does not settle it (a 'prime assessing subcontractor tier' engagement assesses a subcontractor). Unanswered -> Planner's 'other'."
    ),
    'PI.ORG.009': ORG('Industry is a business fact no tenant read or artifact carries.'),
    'PI.ORG.010': ORG('The NAICS code is a SAM.gov registration fact; Muster reads no registration source.'),
    'PI.ORG.011': ORG('Corporate ownership is a business fact no tenant read or artifact carries.'),
    'PI.PER.001': DRAFTED('Security Administrator', 'TCP.PA.002'),
    'PI.PER.002': DRAFTED('Global Administrator', 'TCP.PA.001'),
    'PI.PER.003': DRAFTED('Compliance Administrator', 'TCP.PA.003'),
    'PI.PER.004': DRAFTED('Global Administrator', 'TCP.PA.001'),
    'PI.PER.005': NO_ROLE('HR representative'),
    'PI.PER.006': DRAFTED('Security Administrator', 'TCP.PA.002'),
    'PI.PER.007': NO_ROLE('facilities / physical security manager'),
    'PI.PER.008': NO_ROLE('legal / contracts representative'),
    'PI.PER.009': {
      why: "No directory role names the Authorizing Official: it is the senior official who accepts the system's risk, an organisational assignment. The SSP's Authorizing Official, approval authority and document approver read it (profile personnel role_id authorizing_official).",
      extraSources: [MUSTER_PROFILE],
    },
    'PI.PER.010': {
      why: 'No directory role, Graph read or other artifact names the Privacy Officer; it is an organisational assignment (a small firm may answer "role held by <role>").',
      extraSources: [MUSTER_PROFILE],
    },
    'PI.PER.011': {
      why: 'The directory shows who holds admin roles, not who administers the network; it is an organisational assignment (a small firm may answer "role held by <role>").',
      extraSources: [MUSTER_PROFILE],
    },
    // FIN-26 (FD-9): the AT.L2-3.2.2 role population, read by EO's training store from the interview record.
    'PI.PER.012': {
      why: "Which duties need role-based security training is the organisation's decision: directory roles show who holds admin rights, not whose job carries information-security duties, and a completion record lists only who took a course. Unanswered, EO's training store does not decide AT.L2-3.2.2 (a role-scoped course takes its population from no record).",
      extraSources: [MUSTER_PROFILE],
      extraOutputs: ['interview record (EO POST /api/interviews) -> EO training store role population for AT.L2-3.2.2 (ces-eo TrainingStore.loadRolePopulation)'],
    },
    'PI.SYS.001': SSP_INPUT(
      "The organisation's own asset or system identifier is not tenant state; the tenant id and the system name are different values."
    ),
    'CUI.LC.VOL.001': SSP_INPUT(
      'No discovery collector measures how much CUI is held or received; CUI.USR.002 is a user count, not a volume.'
    ),
    'CUI.INT.004': SSP_INPUT(
      'ISA / MOU references, connection types and data classifications are agreements and decisions no tenant read carries; CUI.INT.001 lists only the systems.'
    ),
    // FIN-32b (LOG-FIN-32 S-B (c)): the pinned bank's 15 ODPs, asked optionally; unanswered -> the bank's recommended value.
    'PI.ODP.001': BANK_ODP('The account lockout threshold', 3, [
      "tenant_manifest.normative_controls[AC.L2-3.1.8].verification[].expected_value ($.values[?(@.name=='LockoutThreshold')].value lte)",
      'discovery IA.L2-3.5.8.password-policy-evidence: reconciled by EO, not by the verdict (verdictPredicates.json)',
    ]),
    'PI.ODP.002': BANK_ODP('The account lockout duration', 15, [
      "tenant_manifest.normative_controls[AC.L2-3.1.8].verification[].expected_value ($.values[?(@.name=='LockoutDurationInSeconds')].value gte, minutes x 60)",
    ]),
    'PI.ODP.003': BANK_ODP('The session inactivity timeout', 15, [
      'tenant_manifest.normative_controls[AC.L2-3.1.10].verification[].expected_value ($.passwordMinutesOfInactivityBeforeScreenTimeout lte)',
      'tenant_manifest.normative_controls[SC.L2-3.13.9].verification[].expected_value ($.passwordMinutesOfInactivityBeforeScreenTimeout lte)',
      'discovery screen-lock bound (an answer tightens the 15 minutes; verdictPredicates.json)',
    ]),
    'PI.ODP.004': BANK_ODP('The minimum password length', 14, [
      'tenant_manifest.normative_controls[IA.L2-3.5.7].verification[].expected_value ($.passwordMinimumLength gte)',
      'discovery Windows compliance bound (an answer tightens the length 14; verdictPredicates.json)',
    ]),
    'PI.ODP.005': BANK_ODP('The password history depth', 24, [
      'tenant_manifest.normative_controls[IA.L2-3.5.8].verification[].expected_value ($.passwordPreviousPasswordBlockCount gte)',
      'discovery Windows compliance bound (an answer tightens the history 24; verdictPredicates.json)',
    ]),
    'PI.ODP.006': BANK_ODP('The maximum password age', 60),
    'PI.ODP.007': BANK_ODP('The audit log retention period', 365),
    'PI.ODP.008': BANK_ODP('The vulnerability scan frequency', 'Monthly'),
    'PI.ODP.009': BANK_ODP('The critical vulnerability patch timeline', 14),
    'PI.ODP.010': BANK_ODP('The high-severity vulnerability patch timeline', 30),
    'PI.ODP.011': BANK_ODP('The security awareness training frequency', 'Annually'),
    'PI.ODP.012': BANK_ODP('The incident reporting timeline', 72),
    'PI.ODP.013': BANK_ODP('The access review frequency', 'Quarterly'),
    'PI.ODP.014': BANK_ODP('The backup frequency for CUI systems', 'Daily'),
    'PI.ODP.015': BANK_ODP('The media sanitization standard', 'NIST SP 800-88 Purge'),
    // W5c7: the authoritative time source (AU.L2-3.3.7). A Muster-only ODP (the pinned bank ends at PI.ODP.015).
    'PI.ODP.016': {
      why: "The organisation's chosen NTP source is policy, not readable tenant state: a settings-catalog NTP policy shows what is deployed, not what the organisation designates. Unanswered, the profile takes Muster's default (time.windows.com, defaulted) and the TM AU.L2-3.3.7 row gets no expected value.",
      extraSources: [MUSTER_PROFILE],
      extraOutputs: ['policy_inputs_profile.odps.authoritative_time_source', 'tenant_manifest.normative_controls[AU.L2-3.3.7].verification[].expected_value ($.timeServer equals, answered)'],
    },
    // FIN-26 (W7-MX1 part 3, note 42): the sign-in frequency bound for CUI access (AC.L2-3.1.11).
    'PI.ODP.017': {
      why: "The organisation's sign-in frequency is policy, not readable tenant state: a Conditional Access session control shows what is deployed, not what the organisation designates. The CES baseline is 8 hours and an answer never relaxes it (founder ruling 2, 2026-10-29). Unanswered, the profile takes the baseline (8, defaulted) and the TM AC.L2-3.1.11 row gets no expected value; an answer over 8 is kept in the profile for reconciliation only.",
      extraSources: [MUSTER_PROFILE],
      extraOutputs: [
        'policy_inputs_profile.odps.sign_in_frequency_hours',
        'tenant_manifest.normative_controls[AC.L2-3.1.11].verification[].expected_value ($.sessionControls.signInFrequency.value lte, answered 1..8 h only)',
        'interview record (EO POST /api/interviews), cited only',
      ],
    },
    'PI.PHY.001': PHYSICAL('Where CUI is processed or stored'),
    'PI.PHY.002': PHYSICAL('The physical access control system'),
    'PI.PHY.003': PHYSICAL('The visitor procedure'),
  };
}

/** SI nodes the generator default covers when unanswered (sources-tried note). */
export const SI_DEFAULT_SOURCE = SI_GENERATOR_DEFAULT;

/** muster-api harvestService.ts writes prefill facts for these nodes (readiness probes; MG-13/MG-14 tenant probes). */
export const HARVEST_NODE_IDS: readonly string[] = [
  // MG-07: the readiness probes still write the retired iam-001/iam-004/ep-001/
  // ep-002 ids (never-asked alias nodes); their facts are re-keyed onto the RR
  // activities listed after them.
  'iam-001',
  'iam-004',
  'ep-001',
  'ep-002',
  ...['iam-001', 'iam-004', 'ep-001', 'ep-002'].flatMap((id) => LEGACY_READINESS_ALIASES[id] ?? []),
  // MG-13 / MG-14: harvestService tenantFactsFromReads.
  'S-27',
  'S-28',
  'TCP.TI.001',
  'TCP.TI.002',
  'TCP.TI.003',
  'TCP.TI.004',
  'TCP.TI.005',
  'TCP.LIC.001',
  'TCP.LIC.002',
  'TCP.IA.001',
  'TCP.IA.004',
  'TCP.IA.005',
  'TCP.PA.001',
  'TCP.PA.002',
  'TCP.PA.003',
  'TCP.PA.004',
  'TCP.GA.002',
  'TCP.GA.004',
  'TCP.CA.003',
  'TCP.DM.001',
  'TCP.DM.004',
  'TCP.MU.004',
  'TCP.MU.005',
  // MG-16: the organisation's address from /organization (tenantFactsFromReads).
  'PI.ORG.002',
  'PI.ORG.003',
  'PI.ORG.004',
  'PI.ORG.005',
];

/**
 * Questions the Profile tab asks (AssessmentPage.tsx) that are NOT graph nodes.
 * Hand-listed: the unregistered-node test covers graph nodes; for these it only
 * checks that `uiAnchor` still occurs in AssessmentPage.tsx (no stale rows).
 * The archetype pick and the AI-adaptive toggle are interview controls, not
 * inputs to an output, and are not listed.
 */
export interface ProfileQuestion extends NodeJustification {
  id: string;
  text: string;
  /** A string that must occur in AssessmentPage.tsx (radio name, data-testid or setter). */
  uiAnchor: string;
  outputs: string[];
  sources: string[];
  optional: boolean;
}

export const PROFILE_QUESTIONS: ProfileQuestion[] = [
  {
    id: 'profile.engagement_kind',
    text: 'Assessment Type (single contractor / prime assessing subcontractor tier)',
    uiAnchor: "'engagement_kind'",
    outputs: ['readiness_result.manifest.engagement_kind', 'status_payload.engagement_kind'],
    sources: [],
    optional: false,
    why: TO_JUSTIFY,
  },
  {
    id: 'profile.org_name',
    text: 'Organization Name',
    uiAnchor: 'setOrgName',
    outputs: [
      'tenant_config_profile.tenant_config.identity.display_name',
      'status_payload.party.name',
      'evidence_package.party.name',
      'policy_inputs.organization.legal_name',
    ],
    sources: [],
    optional: false,
    // MG-16: the policies' legal name (PI.ORG.001) comes from this answer.
    why: 'The legal entity name is not tenant state: Graph /organization displayName names the tenant (TCP.TI.005), not the legal entity. This one answer feeds every output that names the organisation, including the policies (PI.ORG.001).',
  },
  {
    id: 'profile.uei',
    text: 'UEI',
    uiAnchor: 'setUei',
    outputs: ['status_payload.party.uei', 'evidence_package.party.uei', 'policy_inputs.organization.duns_number'],
    sources: [],
    optional: true,
    why: TO_JUSTIFY,
  },
  {
    id: 'profile.cage',
    text: 'CAGE',
    uiAnchor: 'setCage',
    outputs: ['status_payload.party.cage', 'evidence_package.party.cage', 'policy_inputs.organization.cage_code'],
    sources: [],
    optional: true,
    why: TO_JUSTIFY,
  },
  {
    id: 'profile.covers_m365',
    text: 'Does this assessment cover M365/cloud services?',
    uiAnchor: "'covers_m365'",
    outputs: ['status_payload.profile.covers_m365'],
    sources: [],
    optional: true,
    why: TO_JUSTIFY,
  },
  {
    id: 'profile.on_prem_ot',
    text: 'Does CUI touch on-premises servers or OT/manufacturing systems?',
    uiAnchor: "'on_prem_ot'",
    outputs: ['status_payload.on_prem_ot', 'question set (on_prem_ot stack pruning, questionGraphService)'],
    sources: [],
    optional: false,
    why: TO_JUSTIFY,
  },
  {
    id: 'profile.employee_count',
    text: 'Approximate employee count',
    uiAnchor: 'setEmployeeCount',
    outputs: ['status_payload.profile.employee_count'],
    sources: [],
    optional: true,
    why: TO_JUSTIFY,
  },
  {
    id: 'profile.has_ssp',
    text: 'Does the organization have a System Security Plan (SSP)?',
    uiAnchor: "'has_ssp'",
    outputs: ['status_payload.profile.has_ssp'],
    sources: [],
    optional: true,
    why: TO_JUSTIFY,
  },
  {
    id: 'profile.selected_stacks',
    text: 'Service Inventory — which services does this organization use?',
    uiAnchor: 'toggleService',
    outputs: [
      'si_baseline.scope.deployment_posture',
      'si_baseline.dependencies.tenant_model_preference',
      'si_baseline.dependencies.infrastructure_model',
      'si_baseline.dependencies.license_tier',
      'question set (applicable_stacks pruning, questionGraphService)',
    ],
    sources: [],
    optional: false,
    candidate: ['MG-05'], // MG-13: tenant model and licence tier now come from discovered TCP facts first (siDerivation S-20, SIT-021)
  },
  {
    id: 'profile.manifest.mode',
    text: 'Readiness session manifest: session kind',
    uiAnchor: 'rm-mode',
    outputs: ['readiness_result.manifest.mode'],
    sources: [],
    optional: false,
    why: TO_JUSTIFY,
  },
  {
    id: 'profile.manifest.bhd_name',
    text: 'Readiness session manifest: BHD presence (name), collaborative sessions only',
    uiAnchor: 'rm-bhd-name',
    outputs: ['readiness_result.manifest.bhd_presence.name'],
    sources: [],
    optional: true,
    why: TO_JUSTIFY,
  },
  {
    id: 'profile.manifest.auth_tier',
    text: 'Readiness session manifest: auth tier achieved',
    uiAnchor: 'rm-auth-tier',
    outputs: ['readiness_result.manifest.auth_tier'],
    sources: [],
    optional: false,
    why: TO_JUSTIFY,
  },
  {
    id: 'profile.manifest.tenant_slug',
    text: 'Readiness session manifest: tenant slug',
    uiAnchor: 'rm-tenant-slug',
    outputs: ['readiness_result.manifest.tenant.slug', 'tenant_config_profile (tenant slug)'],
    sources: [],
    optional: false,
    why: TO_JUSTIFY,
  },
  {
    id: 'profile.manifest.tenant_kind',
    text: 'Readiness session manifest: tenant kind (sim / live)',
    uiAnchor: 'rm-tenant-kind',
    outputs: ['readiness_result.manifest.tenant.kind'],
    sources: [],
    optional: false,
    why: TO_JUSTIFY,
  },
  {
    id: 'profile.manifest.operator_name',
    text: 'Readiness session manifest: operator name',
    uiAnchor: 'rm-operator-name',
    outputs: ['readiness_result.manifest.operator.name'],
    sources: [],
    optional: false,
    why: TO_JUSTIFY,
  },
  {
    id: 'profile.manifest.operator_role',
    text: 'Readiness session manifest: operator role',
    uiAnchor: 'rm-operator-role',
    outputs: ['readiness_result.manifest.operator.role'],
    sources: [],
    optional: false,
    why: TO_JUSTIFY,
  },
];

/**
 * MG-09 / MG-16 hand-off (e): questions the Plan tab asks that are NOT graph
 * nodes. The capture review asks, per BTC question a discovery capture
 * evidences, whether the capture answers it (accept / reject). Hand-listed;
 * the register test checks `uiAnchor` occurs in `uiFile` (under src/features/plan/).
 */
export interface PlanTabQuestion extends ProfileQuestion {
  /** The file (under src/features/plan/) whose text must contain `uiAnchor`. */
  uiFile: string;
}

const CAPTURE_REVIEW_WHY =
  'A discovery capture is evidence, not an answer: the registry read exports the record the BTC question names, but whether it matches the declared scope is a judgement. A person accepts the capture as the answer or rejects it (Planner asks the question outright); a rejected or unreviewed capture leaves the gate unanswered.';

export const PLAN_TAB_QUESTIONS: PlanTabQuestion[] = [
  ['BTC.ID.001', 'Export list of Global Admins. Does it match declared scope?'],
  ['BTC.ID.002', 'Export privileged role assignments (PIM/role members). Any unexpected privileged roles or persistent assignments?'],
  ['BTC.DEV.001', 'Export enrolled devices. Do all CUI users have compliant managed devices?'],
  ['BTC.DEV.002', 'Are any unmanaged devices accessing CUI (via SharePoint/Teams/Exchange access logs)? (or its Conditional Access enforcement proof)'],
  ['BTC.LOG.001', 'Is Unified Audit Log enabled and ingesting events?'],
  ['BTC.LOG.002', 'Is Sentinel connected and ingesting required data sources (Entra, M365, Defender, etc.)?'],
  ['BTC.LOG.003', 'Is log retention configured as declared (duration, immutability, eDiscovery/retention policies)?'],
  ['BTC.LOG.004', 'Is tamper protection / protection against log disabling in place (where applicable)?'],
].map(([qid, text]) => ({
  id: `review.${qid}`,
  text: `Capture review: does the discovery capture answer "${text}"`,
  uiFile: 'btc/BtcCaptureReview.tsx',
  uiAnchor: 'btc-review-accept-',
  outputs: ['btc_confirmation.answers', 'btc_confirmation.gate_status'],
  sources: [
    'discovery capture (btcEvidenceMap.json), shown with its evidence ids',
    'discovery verdict where the predicate reads the fact (BTC.LOG.001 only)',
  ],
  optional: true,
  why: CAPTURE_REVIEW_WHY,
}));
