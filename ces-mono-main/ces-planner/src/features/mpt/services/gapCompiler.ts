// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { GapSet, Gap, GapClassification, BoundaryRelevance, ScopeExclusion, ControlDisposition, StamperAction } from '../types';
import type { ReadinessPosture, SIBaseline, CMMCLevel, BTCConfirmationOutput, CUIBoundaryOutput } from '@/shared/types/artifacts';
import type { PatternEntry, PlaybookEntry } from '@/shared/types/domain';
import { CUI_DOMAIN_MAP } from '@/shared/utils/cuiDomainMap';
import { L1_CANONICAL_IN_L2 } from '@/shared/constants/cmmcConstants';
import { M365_ALTERNATIVES } from './m365Alternatives';
import { evaluateInheritance, validatePackageIdFormat } from './fedrampInheritance';
import type { FedRAMPInheritanceTable } from './fedrampInheritance';

/**
 * Compile gap set from Readiness Posture (pseudocode §4.2).
 * Identifies requirements with status NOT_MET, PARTIAL, or UNKNOWN
 * and enriches with missing evidence archetypes, methods, and
 * vendor stack coverage so the plan clearly shows what the stack
 * handles vs what requires work outside the stack.
 */
/**
 * Derive scope exclusions from SI operational decisions.
 * Returns a Map of requirement_id → ScopeExclusion for controls that are
 * not applicable to the customer's environment.
 */
export function buildScopeExclusions(siBaseline: SIBaseline): { exclusions: Map<string, ScopeExclusion>; warnings: string[] } {
  const ops = siBaseline.si_baseline?.operations;
  const deployment_posture = siBaseline.si_baseline?.scope?.deployment_posture;

  const exclusions = new Map<string, ScopeExclusion>();
  const warnings: string[] = [];

  const addExclusion = (reqId: string, justification: string, siField: string, siValue: string, kind: 'capability-absent' | 'prohibition') => {
    exclusions.set(reqId, { requirement_id: reqId, justification, si_field: siField, si_value: siValue, kind });
  };

  // Rule 1: No mobile devices in enclave
  if (ops?.mobile_device_presence === 'no_mobile_devices') {
    const j = 'No mobile devices in CUI enclave per Strategic Intent baseline';
    const f = 'mobile_device_presence';
    const v = 'no_mobile_devices';
    addExclusion('AC.L2-3.1.18', j, f, v, 'capability-absent');
    addExclusion('AC.L2-3.1.19', j, f, v, 'capability-absent');
    // 3.1.15 and 3.1.16 only excluded when BOTH no mobile AND no wireless
    // (3.1.16 covers wireless access authorization for mobile devices)
  }

  // Rule 2: No wireless networks in enclave
  if (ops?.wireless_posture === 'no_wireless') {
    const j = 'No wireless networks in CUI enclave per Strategic Intent baseline';
    const f = 'wireless_posture';
    const v = 'no_wireless';
    addExclusion('AC.L2-3.1.16', j, f, v, 'capability-absent');
  }

  // Rule 3: Removable media blocked
  if (ops?.removable_media_posture === 'blocked') {
    const j = 'Removable media prohibited by policy and technical control per Strategic Intent baseline';
    const f = 'removable_media_posture';
    const v = 'blocked';
    addExclusion('AC.L2-3.1.6', j, f, v, 'prohibition');  // portable storage use restriction
    addExclusion('MP.L2-3.8.5', j, f, v, 'prohibition');
    addExclusion('MP.L2-3.8.6', j, f, v, 'prohibition');
  }

  // Rule 4: No remote access
  if (ops?.remote_access_posture === 'no_remote' && deployment_posture !== 'cloud_only') {
    const j = 'No remote access to CUI systems per Strategic Intent baseline';
    const f = 'remote_access_posture';
    const v = 'no_remote';
    addExclusion('AC.L2-3.1.12', j, f, v, 'capability-absent');
    addExclusion('AC.L2-3.1.13', j, f, v, 'capability-absent');  // remote access cryptographic protection
    addExclusion('PE.L2-3.10.6', j, f, v, 'capability-absent'); // genuine L2 control
  }

  // Rule 5: No nonlocal maintenance
  if (ops?.maintenance_posture === 'no_nonlocal') {
    const j = 'No nonlocal maintenance performed per Strategic Intent baseline';
    const f = 'maintenance_posture';
    const v = 'no_nonlocal';
    addExclusion('MA.L2-3.7.4', j, f, v, 'capability-absent');
  }

  // Rule 6: Browser-only CUI (no endpoint data-at-rest)
  if (ops?.cui_endpoint_posture === 'browser_only') {
    const j = 'CUI accessible via browser only with endpoint downloads blocked per Strategic Intent baseline';
    const f = 'cui_endpoint_posture';
    const v = 'browser_only';
    addExclusion('CM.L2-3.4.6', j, f, v, 'prohibition');   // least functionality / desktop hardening — no desktops
    addExclusion('MP.L2-3.8.7', j, f, v, 'prohibition');   // media handling on endpoints — no CUI on endpoint
    if (!exclusions.has('AC.L2-3.1.19')) {
      addExclusion('AC.L2-3.1.19', j, f, v, 'prohibition');
    }
    const exclusion: ScopeExclusion = {
      requirement_id: 'SC.L2-3.13.16',
      justification: j,
      si_field: f,
      si_value: v,
      requires_rr_validation: true,
      kind: 'prohibition',
    };
    exclusions.set(exclusion.requirement_id, exclusion);
  }

  // Session-controlled BYOD justification override — refine Rule 6 exclusion justifications
  // when BYOD devices access CUI via Entra ID CA App Control session policies
  if (ops?.byod_posture === 'session_controlled_byod') {
    const sessionJustification = 'CUI accessible via session-controlled browser only. Entra ID Conditional Access App Control enforces download/copy/print/upload blocks at M365 service layer. Endpoint is untrusted by design; CUI never persists on device.';
    for (const controlId of ['CM.L2-3.4.6', 'MP.L2-3.8.7', 'AC.L2-3.1.19', 'SC.L2-3.13.16']) {
      const existing = exclusions.get(controlId);
      if (existing) {
        existing.justification = sessionJustification;
      }
    }
  }

  // Cross-field consistency check: remote_access_posture vs deployment_posture
  if (ops?.remote_access_posture === 'no_remote' && deployment_posture === 'cloud_only') {
    warnings.push('Configuration conflict: remote_access_posture is \'no_remote\' but deployment_posture is \'cloud_only\'. Cloud-only deployments inherently require remote access. Review SI answers for accuracy.');
  }

  // Cross-field consistency check: wireless_access_path_only vs remote_access_posture
  if (ops?.wireless_posture === 'wireless_access_path_only' && ops?.remote_access_posture === 'no_remote') {
    warnings.push('Configuration conflict: wireless_posture is \'wireless_access_path_only\' but remote_access_posture is \'no_remote\'. Wireless-only access path implies remote access exists. Review SI answers for accuracy.');
  }

  return { exclusions, warnings };
}

/**
 * Build control disposition map covering ALL controls at the target level.
 * This is the authoritative source for per-control Stamper actions.
 *
 * De-duplicates by NIST base ID (e.g. 3.1.1): when both L1 and L2 entries
 * exist for the same practice, the highest applicable level wins (L2 subsumes
 * L1 assessment objectives) — EXCEPT for the 17 L1-canonical controls listed
 * in L1_CANONICAL_IN_L2 where the L1 entry is preferred.
 * For L1-only projects only L1 entries are emitted.
 */
function buildControlDispositions(
  reqStore: any[],
  targetLevel: CMMCLevel,
  readinessPosture: ReadinessPosture,
  scopeExclusions: Map<string, ScopeExclusion>,
  gapMap: Map<string, Gap>,
  siBaseline: SIBaseline,
  inheritanceTable: FedRAMPInheritanceTable | null,
): ControlDisposition[] {
  const LEVEL_HIERARCHY: Record<CMMCLevel, string[]> = {
    L1: ['L1'],
    L2: ['L1', 'L2'],
    L3: ['L1', 'L2', 'L3'],
  };
  const LEVEL_RANK: Record<string, number> = { L1: 1, L2: 2, L3: 3 };
  const inScopeLevels = LEVEL_HIERARCHY[targetLevel];

  // De-duplicate: keep the highest-level entry per NIST base ID, except for
  // controls that are canonically L1 in L2 assessments (L1_CANONICAL_IN_L2).
  const bestByBase = new Map<string, any>();
  for (const req of reqStore) {
    if (!inScopeLevels.includes(req.level)) continue;
    const baseId = req.requirement_id.split('-').slice(1).join('-');
    const existing = bestByBase.get(baseId);
    if (!existing) {
      bestByBase.set(baseId, req);
    } else if (targetLevel !== 'L1' && L1_CANONICAL_IN_L2.has(baseId)) {
      // For canonical L1-in-L2 controls, prefer the L1 entry
      if ((LEVEL_RANK[req.level] || 0) < (LEVEL_RANK[existing.level] || 0)) {
        bestByBase.set(baseId, req);
      }
    } else if ((LEVEL_RANK[req.level] || 0) > (LEVEL_RANK[existing.level] || 0)) {
      bestByBase.set(baseId, req);
    }
  }

  // Validate expected control count after deduplication
  const expectedCount = targetLevel === 'L1' ? 17 : targetLevel === 'L2' ? 110 : null;
  if (expectedCount && bestByBase.size !== expectedCount) {
    console.warn(
      `[gapCompiler] Control count mismatch for ${targetLevel}: expected ${expectedCount}, got ${bestByBase.size}. ` +
        `This may indicate missing controls in the requirements store or dedup logic issues.`,
    );
  }

  const dispositions: ControlDisposition[] = [];

  for (const req of bestByBase.values()) {

    const reqId = req.requirement_id;
    const exclusion = scopeExclusions.get(reqId);
    const gap = gapMap.get(reqId);
    const rrResult = readinessPosture.ces.requirement_results.find(r => r.requirement_id === reqId);

    let stamperAction: StamperAction;
    let scopeStatus: 'in_scope' | 'scoped_out' = 'in_scope';
    let scopeJustification: string | undefined;
    let siDecision: { field: string; value: string } | undefined;
    let readinessStatus: 'met' | 'partial' | 'not_met' | 'unknown' | undefined;
    let gapClassifications: GapClassification[] = [];
    const estimatedEffortHours = 0;
    let inheritanceRationale: string | undefined;
    let fedrampPackageId: string | undefined;
    let requiresStamperVerification: boolean | undefined;

    // Decision order: exclusion > inheritance > NONSTACK_OVERRIDES > met > gap > fallback
    const inheritResult = inheritanceTable
      ? evaluateInheritance(siBaseline, reqId, inheritanceTable)
      : null;

    if (exclusion) {
      // Scoped out by SI operational decisions
      stamperAction = exclusion.kind === 'prohibition'
        ? 'Met-By-Prohibition' : 'N-A-Capability-Absent';
      scopeStatus = 'scoped_out';
      scopeJustification = exclusion.justification;
      siDecision = { field: exclusion.si_field, value: exclusion.si_value };
    } else if (inheritResult) {
      // FedRAMP inheritance — runs before NONSTACK_OVERRIDES so that
      // PE controls classify as Inherited-FedRAMP when conditions are met
      stamperAction = 'Inherited-FedRAMP';
      readinessStatus = rrResult?.status as any;
      inheritanceRationale = inheritResult.rationale;
      fedrampPackageId = inheritResult.fedramp_package_id;
      requiresStamperVerification = inheritResult.requires_stamper_verification;
    } else if (NONSTACK_OVERRIDES.has(reqId)) {
      // Personnel/process control — no tenant automation; force nonstack
      stamperAction = 'Non-Stack';
      readinessStatus = rrResult?.status as any;
      if (gap) gapClassifications = gap.gap_classifications;
    } else if (rrResult?.status === 'met') {
      // Control is MET — Stamper validates it
      stamperAction = 'Automated';
      readinessStatus = 'met';
    } else if (gap) {
      // Control has gaps — derive disposition from gap classifications
      readinessStatus = rrResult?.status as any;
      gapClassifications = gap.gap_classifications;
      // Check if ALL classifications are manual/manual_alternative/control_not_available
      // auto_generate controls (policies) are automated by CES-FE, NOT manual
      const allManual =
        gapClassifications.length > 0 &&
        gapClassifications.every(
          (gc) =>
            gc === 'manual' || gc === 'manual_alternative' || gc === 'control_not_available',
        );
      const hasAutoGenerate = gapClassifications.includes('auto_generate');
      stamperAction = (allManual && !hasAutoGenerate) ? 'Non-Stack' : 'Automated';
    } else {
      // No gap, not met, not scoped out — unknown or policy-only
      stamperAction = 'Non-Stack';
      readinessStatus = rrResult?.status as any;
    }

    dispositions.push({
      requirement_id: reqId,
      title: req.title || reqId,
      domain: req.domain || '',
      level: req.level || '',
      scope_status: scopeStatus,
      scope_justification: scopeJustification,
      si_decision: siDecision,
      readiness_status: readinessStatus,
      stamper_action: stamperAction,
      task_ids: [],  // Will be populated by taskCompiler later
      estimated_effort_hours: estimatedEffortHours,
      gap_classifications: gapClassifications,
      ...(inheritanceRationale ? { inheritance_rationale: inheritanceRationale } : {}),
      ...(fedrampPackageId ? { fedramp_package_id: fedrampPackageId } : {}),
      ...(requiresStamperVerification != null ? { requires_stamper_verification: requiresStamperVerification } : {}),
    });
  }

  return dispositions;
}

export function compileGapSet(
  siBaseline: SIBaseline,
  readinessPosture: ReadinessPosture,
  cmmcRequirements: any,
  evidenceMatrix: any,
  vendorCapabilities?: any,
  btcConfirmation?: BTCConfirmationOutput | null,
  cuiBoundary?: CUIBoundaryOutput | null,
  inheritanceTable?: FedRAMPInheritanceTable | null,
): GapSet {
  const infrastructure_model = siBaseline.si_baseline?.dependencies?.infrastructure_model || 'm365_azure';
  const license_tier = siBaseline.si_baseline?.dependencies?.license_tier || 'g5';

  // Build scope exclusions from SI operational decisions — excluded controls
  // will not generate gaps, tasks, or plan steps
  const { exclusions: scopeExclusions, warnings: scopeWarnings } = buildScopeExclusions(siBaseline);

  // Validate FedRAMP Package ID formats (advisory only — does not block inheritance)
  const packageIds = siBaseline.si_baseline?.dependencies?.fedramp_package_ids;
  if (packageIds && packageIds.length > 0) {
    const { invalid } = validatePackageIdFormat(packageIds);
    if (invalid.length > 0) {
      scopeWarnings.push(
        `Invalid FedRAMP Package ID format: ${invalid.join(', ')}. Expected pattern: F followed by 10 digits.`,
      );
    }
  }

  const gaps: Gap[] = [];
  const reqStore: any[] = cmmcRequirements?.requirements
    || cmmcRequirements?.ces?.requirements
    || [];

  const emxEntries: any[] = evidenceMatrix?.ces?.entries
    || evidenceMatrix?.entries
    || [];

  const patterns: PatternEntry[] = vendorCapabilities?.patterns?.patterns || [];
  const playbook: PlaybookEntry[] = vendorCapabilities?.playbook?.playbook || [];

  // Index playbook by action_id for fast lookup
  const playbookByAction = new Map<string, PlaybookEntry>();
  for (const entry of playbook) {
    playbookByAction.set(entry.action_id, entry);
  }

  const postureReqIds = new Set<string>();

  for (const rr of readinessPosture.ces.requirement_results) {
    postureReqIds.add(rr.requirement_id);
    if (scopeExclusions.has(rr.requirement_id)) continue; // Scoped out by SI decisions
    if (rr.status === 'not_met' || rr.status === 'partial' || rr.status === 'unknown') {
      const requirement = reqStore.find((r: any) => r.requirement_id === rr.requirement_id);
      const emxRow = emxEntries.find((e: any) => e.requirement_id === rr.requirement_id);

      const expectedArchetypes: string[] = emxRow?.expected_evidence_archetypes
        || requirement?.expected_evidence_archetypes
        || [];
      const satisfiedArchetypes: string[] = (rr as any).evidence_archetypes_satisfied || [];
      const missingArchetypes = expectedArchetypes.filter((a: string) => !satisfiedArchetypes.includes(a));

      const expectedMethods: string[] = emxRow?.minimum_methods
        || requirement?.minimum_methods
        || [];
      const satisfiedMethods: string[] = (rr as any).assessor_methods_satisfied || [];
      const methodsNeeded = expectedMethods.filter((m: string) => !satisfiedMethods.includes(m));

      // Determine gap classification from playbook signals
      const matchingPatterns = patterns.filter((p) => p.practice_id === rr.requirement_id);
      const classifications = classifyGapType(matchingPatterns, playbookByAction);

      gaps.push({
        requirement_id: rr.requirement_id,
        severity: computeSeverity(rr, requirement, siBaseline, emxRow),
        gap_reason: rr.notes || buildGapReason(rr.status, matchingPatterns, classifications),
        gap_classifications: classifications,
        missing_evidence_archetypes: missingArchetypes,
        methods_needed: methodsNeeded,
        requirement_title: requirement?.title || rr.requirement_id,
        requirement_text: requirement?.requirement_text || '',
        domain: requirement?.domain || '',
        level: requirement?.level || '',
        nist_reference: requirement?.references?.nist_800_171_id || '',
        assessment_objectives: (requirement?.assessment_objectives || []).map((ao: any) => ({
          id: ao.id,
          text: ao.text,
          methods: ao.methods || [],
        })),
        design_for_assessment: (requirement?.design_for_assessment || []).map((d: any) => ({
          title: d.title,
          constraint: d.constraint,
          verification: d.verification,
        })),
        operationalization_notes: requirement?.operationalization_notes,
        common_pitfalls: requirement?.common_pitfalls,
      });
    }
  }

  // Safety net: catch in-scope requirements absent from the readiness posture.
  // These were never assessed (e.g. question set generated before coverage fix)
  // but are still required for the target CMMC level.
  const targetLevel = siBaseline.si_baseline?.target?.target_cmmc_level || 'L2';
  const inScopeLevels = LEVEL_HIERARCHY[targetLevel];

  for (const req of reqStore) {
    if (!inScopeLevels.includes(req.level)) continue;
    if (postureReqIds.has(req.requirement_id)) continue;
    if (scopeExclusions.has(req.requirement_id)) continue; // Scoped out by SI decisions

    const emxRow = emxEntries.find((e: any) => e.requirement_id === req.requirement_id);
    const expectedArchetypes: string[] = emxRow?.expected_evidence_archetypes
      || req.expected_evidence_archetypes || [];
    const expectedMethods: string[] = emxRow?.minimum_methods
      || req.minimum_methods || [];

    const matchingPatterns = patterns.filter((p) => p.practice_id === req.requirement_id);
    const classifications = classifyGapType(matchingPatterns, playbookByAction);

    gaps.push({
      requirement_id: req.requirement_id,
      severity: computeSeverity({ status: 'unknown' }, req, siBaseline, emxRow),
      gap_reason: buildGapReason('unknown', matchingPatterns, classifications),
      gap_classifications: classifications,
      missing_evidence_archetypes: expectedArchetypes,
      methods_needed: expectedMethods,
      requirement_title: req.title || req.requirement_id,
      requirement_text: req.requirement_text || '',
      domain: req.domain || '',
      level: req.level || '',
      nist_reference: req.references?.nist_800_171_id || '',
      assessment_objectives: (req.assessment_objectives || []).map((ao: any) => ({
        id: ao.id, text: ao.text, methods: ao.methods || [],
      })),
      design_for_assessment: (req.design_for_assessment || []).map((d: any) => ({
        title: d.title, constraint: d.constraint, verification: d.verification,
      })),
      operationalization_notes: req.operationalization_notes,
      common_pitfalls: req.common_pitfalls,
    });
  }

  // BTC gate failures — create HIGH-severity gaps for failed gates
  if (btcConfirmation?.btc_confirmation?.gate_status) {
    const existingReqIds = new Set(gaps.map((g) => g.requirement_id));
    const gateEntries = Object.values(btcConfirmation.btc_confirmation.gate_status);

    for (const gate of gateEntries) {
      if (gate.pass) continue;

      const gateDomainLower = gate.domain.toLowerCase();
      const matchingReqs = reqStore.filter(
        (r: any) =>
          r.domain?.toLowerCase() === gateDomainLower &&
          !existingReqIds.has(r.requirement_id) &&
          inScopeLevels.includes(r.level) &&
          !scopeExclusions.has(r.requirement_id)
      );

      for (const req of matchingReqs) {
        existingReqIds.add(req.requirement_id);

        const matchingPatterns = patterns.filter((p) => p.practice_id === req.requirement_id);
        const classifications = classifyGapType(matchingPatterns, playbookByAction);

        gaps.push({
          requirement_id: req.requirement_id,
          severity: 'HIGH',
          gap_reason: `BTC gate failure: ${gate.reason}`,
          gap_classifications: classifications,
          missing_evidence_archetypes: [],
          methods_needed: [],
          requirement_title: req.title || req.requirement_id,
          requirement_text: req.requirement_text || '',
          domain: req.domain || '',
          level: req.level || '',
          nist_reference: req.references?.nist_800_171_id || '',
          assessment_objectives: (req.assessment_objectives || []).map((ao: any) => ({
            id: ao.id,
            text: ao.text,
            methods: ao.methods || [],
          })),
          design_for_assessment: (req.design_for_assessment || []).map((d: any) => ({
            title: d.title,
            constraint: d.constraint,
            verification: d.verification,
          })),
          operationalization_notes: req.operationalization_notes,
          common_pitfalls: req.common_pitfalls,
        });
      }
    }
  }

  // Infrastructure model + license tier gap classification with precedence rules
  // Infrastructure classification takes precedence; license tier only applies when NO infrastructure classification exists
  for (const gap of gaps) {
    const infraClasses = classifyInfrastructureGaps(infrastructure_model, gap.requirement_id);
    const tierClasses =
      infraClasses.length === 0
        ? classifyLicenseTierGaps(license_tier, gap.requirement_id)
        : [];
    gap.gap_classifications = [...gap.gap_classifications, ...infraClasses, ...tierClasses];
  }

  // Boundary relevance tagging + severity downgrade for out-of-boundary gaps
  const boundaryDomains = cuiBoundary ? buildBoundaryScopeMap(cuiBoundary) : null;
  if (boundaryDomains) {
    for (const gap of gaps) {
      const rel = computeBoundaryRelevance(gap.domain, boundaryDomains);
      gap.boundary_relevance = rel;

      // Downgrade severity for out-of-boundary gaps, but never for BTC gate failures
      if (rel === 'out_of_boundary' && !gap.gap_reason.startsWith('BTC gate failure')) {
        if (gap.severity === 'HIGH') gap.severity = 'MEDIUM';
        else if (gap.severity === 'MEDIUM') gap.severity = 'LOW';
      }
    }
  }

  gaps.sort((a, b) => {
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return order[a.severity] - order[b.severity];
  });

  // Build control dispositions for ALL L2 controls
  const gapMap = new Map(gaps.map(g => [g.requirement_id, g]));
  const controlDispositions = buildControlDispositions(
    reqStore,
    targetLevel,
    readinessPosture,
    scopeExclusions,
    gapMap,
    siBaseline,
    inheritanceTable ?? null,
  );

  return { gaps, scopeExclusions: Array.from(scopeExclusions.values()), controlDispositions, warnings: scopeWarnings };
}

// ---------------------------------------------------------------------------
// Infrastructure model + license tier gap classification
// ---------------------------------------------------------------------------

// Controls that must be Non-Stack when inheritance conditions are NOT met.
// PE controls are CSP-inherited for cloud_only deployments with FedRAMP packages;
// otherwise Non-Stack (datacenter controls outside M365/Azure tenant automation).
// PS.L2-3.9.2 is always Non-Stack (HR offboarding procedure).
const NONSTACK_OVERRIDES = new Set([
  'PS.L2-3.9.2',    // Personnel Termination and Transfer — HR offboarding procedure
  'PE.L1-3.10.1',   // Physical access — FedRAMP CSP inherited
  'PE.L2-3.10.2',   // Physical access monitoring — FedRAMP CSP inherited
  'PE.L1-3.10.3',   // Escort visitors — FedRAMP CSP inherited
  'PE.L1-3.10.4',   // Physical access logs — FedRAMP CSP inherited
  'PE.L1-3.10.5',   // Physical access control — FedRAMP CSP inherited
]);

// Derive infrastructure gap control IDs from M365_ALTERNATIVES keys (single source of truth)
// Category A (6 controls): Azure infrastructure gaps — no M365 registry coverage
// Category B (3 controls): In M365 registry but use az engine, require Azure subscription
// Source: NIST 800-171 Rev 2 (frozen for CMMC L2)
const INFRA_GAP_CONTROL_IDS = new Set(Object.keys(M365_ALTERNATIVES));

// Business Premium lacks these features: Purview Audit Premium, Insider Risk Management, Advanced eDiscovery
const LICENSE_TIER_GAP_CONTROL_IDS = new Set([
  'AU.L2-3.3.1', 'IR.L2-3.6.1', 'IR.L2-3.6.2',
]);

export function classifyInfrastructureGaps(
  infrastructure_model: string,
  requirement_id: string,
): GapClassification[] {
  if (infrastructure_model === 'm365_only' && INFRA_GAP_CONTROL_IDS.has(requirement_id)) {
    return ['manual_alternative'];
  }
  return [];
}

export function classifyLicenseTierGaps(
  license_tier: string,
  requirement_id: string,
): GapClassification[] {
  if (license_tier === 'business_premium' && LICENSE_TIER_GAP_CONTROL_IDS.has(requirement_id)) {
    return ['control_not_available'];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Gap classification — stack-gap vs process-gap vs work-to-do
// ---------------------------------------------------------------------------

const LEVEL_HIERARCHY: Record<CMMCLevel, string[]> = {
  L1: ['L1'],
  L2: ['L1', 'L2'],
  L3: ['L1', 'L2', 'L3'],
};

/**
 * Classify a requirement by reading the `signal` field from the vendor
 * playbook for every action across all matching patterns. Single code path
 * for all requirements — the playbook is the sole authority.
 *
 * Most constrained signal wins: manual > customize > configure.
 */
export function classifyGapType(
  matchingPatterns: PatternEntry[],
  playbookByAction: Map<string, PlaybookEntry>,
): GapClassification[] {
  const found = new Set<GapClassification>();

  for (const pattern of matchingPatterns) {
    for (const action of pattern.actions) {
      const pb = playbookByAction.get(action.id);
      if (!pb) continue;
      const signal = pb.signal || 'manual';
      if (signal === 'configure') found.add('configure');
      else if (signal === 'customize') found.add('customize');
      else found.add('manual');
    }
  }

  if (found.size === 0) return ['manual'];
  // Return all distinct classifications in constrained-first order
  const ordered: GapClassification[] = [];
  if (found.has('manual')) ordered.push('manual');
  if (found.has('customize')) ordered.push('customize');
  if (found.has('configure')) ordered.push('configure');
  return ordered;
}

// ---------------------------------------------------------------------------
// Gap reason builder
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  not_met: 'Not met',
  partial: 'Partially met',
  unknown: 'Not yet assessed',
};

const CLASSIFICATION_LABELS: Record<GapClassification, string> = {
  configure: 'Configure',
  customize: 'Customize',
  manual: 'Manual',
  auto_generate: 'Auto-Generated',
  manual_alternative: 'Manual Alternative',
  control_not_available: 'Not Available',
  scoped_out: 'Scoped Out (N/A)',
};

function buildGapReason(
  status: string,
  matchingPatterns: PatternEntry[],
  classifications: GapClassification[],
): string {
  const primary = classifications[0] || 'manual';
  const label = STATUS_LABELS[status] || status;
  const names = [...new Set(matchingPatterns.map((p) => p.pattern_name))];
  const patternHint = names.length > 0 ? names.join(', ') : '';

  const parts: string[] = [label];
  if (primary === 'configure' && patternHint) {
    parts.push(`Stack supports this requirement — configure ${patternHint}`);
  } else if (primary === 'customize' && patternHint) {
    parts.push(`Requires customization — ${patternHint}`);
  } else {
    parts.push(`${CLASSIFICATION_LABELS[primary]} work required${patternHint ? ` — ${patternHint}` : ''}`);
  }

  return parts.join('. ');
}

function computeSeverity(
  result: any,
  requirement: any,
  siBaseline: SIBaseline,
  emxRow?: any,
): 'HIGH' | 'MEDIUM' | 'LOW' {
  const targetLevel = siBaseline.si_baseline?.target?.target_cmmc_level || 'L2';
  if (requirement?.criticality === 'CRITICAL') return 'HIGH';
  if (result.status === 'not_met') return targetLevel === 'L3' ? 'HIGH' : 'MEDIUM';

  // Partial-met granularity: compute evidence coverage ratio
  if (result.status === 'partial') {
    if (emxRow) {
      const expectedArchetypes: string[] = emxRow.expected_evidence_archetypes || [];
      const satisfiedArchetypes: string[] = result.evidence_archetypes_satisfied || [];
      const evidenceRefs: any[] = result.evidence_refs || [];

      if (expectedArchetypes.length > 0) {
        const coverage = satisfiedArchetypes.length / expectedArchetypes.length;
        if (coverage < 0.3) return 'HIGH';
        if (coverage <= 0.6) return 'MEDIUM';
        return 'LOW';
      }

      // Zero evidence refs + partial → HIGH
      if (evidenceRefs.length === 0) return 'HIGH';
    }
    return 'MEDIUM';
  }

  return 'LOW';
}

// ---------------------------------------------------------------------------
// CUI Boundary scope mapping — maps CUI answer prefixes to CMMC domains
// ---------------------------------------------------------------------------

interface BoundaryScopeResult {
  primaryDomains: Set<string>;
  adjacentDomains: Set<string>;
}

function buildBoundaryScopeMap(cuiBoundary: CUIBoundaryOutput): BoundaryScopeResult {
  const primaryDomains = new Set<string>();
  const adjacentDomains = new Set<string>();

  const answerKeys = Object.keys(cuiBoundary.cui_boundary);
  for (const key of answerKeys) {
    for (const [prefix, mapping] of Object.entries(CUI_DOMAIN_MAP)) {
      if (key.startsWith(prefix)) {
        for (const d of mapping.primary) primaryDomains.add(d);
        for (const d of mapping.adjacent) adjacentDomains.add(d);
      }
    }
  }

  return { primaryDomains, adjacentDomains };
}

function computeBoundaryRelevance(
  domain: string,
  scope: BoundaryScopeResult,
): BoundaryRelevance {
  const upper = (domain || '').toUpperCase();
  if (scope.primaryDomains.has(upper)) return 'in_boundary';
  if (scope.adjacentDomains.has(upper)) return 'boundary_adjacent';
  return 'out_of_boundary';
}
