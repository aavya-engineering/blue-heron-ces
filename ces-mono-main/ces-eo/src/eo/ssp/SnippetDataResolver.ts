// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import Handlebars from 'handlebars';
import type {
  AllManifests,
  TenantManifest,
  InfraManifest,
  InfraResource,
  MissionPlan,
  ControlNarrative,
  EvidenceArtifactEntry,
  OdpEntry,
} from 'ces-shared/types/ssp';
import type { PhysicalSecurityData } from '../../shared/types/ssp.types.js';
import { ManualGateExtractors } from './ManualGateExtractors.js';
import type { ExtendedDirectiveMetadata } from '../../shared/types/directive.types.js';
import type { ArchitectureMetadata } from '../../shared/types/evidence.types.js';
import { DirectiveNarrativeBuilder } from '../generation/DirectiveNarrativeBuilder.js';
import { ArchitectureDetector } from './ArchitectureDetector.js';
import { MechanismNarrativeComposer } from './MechanismNarrativeComposer.js';
import type { DependencyTable } from './MechanismNarrativeComposer.js';
import type { CmmcControl } from 'ces-shared/types/controls';
import type { AdminOpsDataProvider } from './AdminOpsDataProvider.js';
import type { OdpValueProvider } from './OdpValueProvider.js';

const TEMPLATES_DIR = path.resolve(process.cwd(), 'src/shared/data/snippet-templates');
const DEPENDENCY_TABLE_PATH = path.resolve(process.cwd(), 'src/shared/data/mechanism-dependency-table.json');

const WIRELESS_CONTROLS = new Set(['AC.L2-3.1.16', 'AC.L2-3.1.17']);

export interface SnippetDataResolverOptions {
  adminOpsProvider?: AdminOpsDataProvider;
  odpValueProvider?: OdpValueProvider;
}

export interface ManifestPaths {
  tenantManifestPath?: string;
  infraManifestPath?: string;
  missionPlanPath?: string;
}

// Manual gate control IDs (28 total)
export const MANUAL_GATE_CONTROLS = new Set([
  'AT.L2-3.2.1', 'AT.L2-3.2.2', 'AT.L2-3.2.3',
  'PE.L1-3.10.1', 'PE.L1-3.10.3', 'PE.L1-3.10.4', 'PE.L1-3.10.5',
  'PE.L2-3.10.2', 'PE.L2-3.10.6',
  // PS.L2-3.9.1 and PS.L2-3.9.2 removed — now use provisional narratives
  'CA.L2-3.12.1', 'CA.L2-3.12.2', 'CA.L2-3.12.3', 'CA.L2-3.12.4',
  'IR.L2-3.6.2', 'IR.L2-3.6.3',
  // G3 #5: 3.7.3 (sanitize off-site maintenance equipment) and 3.7.6 (supervise uncleared
  // maintenance personnel) are operational/physical controls not auto-assessable from M365
  // signals — they belong with the other manual maintenance gates.
  'MA.L2-3.7.1', 'MA.L2-3.7.2', 'MA.L2-3.7.3', 'MA.L2-3.7.6',
  'AU.L2-3.3.5', 'AU.L2-3.3.8', 'AU.L2-3.3.9',
  'MP.L2-3.8.4', 'MP.L2-3.8.9',
  'RA.L2-3.11.1', 'RA.L2-3.11.2',
  'SC.L2-3.13.7',
  'SI.L2-3.14.4',
]);

/**
 * Resolves SSP narrative data from Tenant Manifest, Infrastructure Manifest,
 * and Mission Plan files. Provides structured ControlNarrative per control.
 */
export class SnippetDataResolver {
  private readonly adminOpsProvider?: AdminOpsDataProvider;
  private readonly odpValueProvider?: OdpValueProvider;

  constructor(options?: SnippetDataResolverOptions) {
    this.adminOpsProvider = options?.adminOpsProvider;
    this.odpValueProvider = options?.odpValueProvider;
  }

  async loadManifests(_tenantSlug: string, paths?: ManifestPaths): Promise<AllManifests> {
    const result: AllManifests = {};

    if (paths?.tenantManifestPath) {
      const raw = this.loadJsonFile<Record<string, unknown>>(paths.tenantManifestPath, 'Tenant Manifest');
      if (raw) {
        // Unwrap: file may have { tenant_manifest: {...} } wrapper
        result.tenantManifest = (raw.tenant_manifest ?? raw) as TenantManifest;
      }
    }

    if (paths?.infraManifestPath) {
      const raw = this.loadJsonFile<Record<string, unknown>>(paths.infraManifestPath, 'Infrastructure Manifest');
      if (raw) {
        // Unwrap: file may have { infrastructure_manifest: {...} } wrapper
        result.infraManifest = (raw.infrastructure_manifest ?? raw) as InfraManifest;
      }
    }

    if (paths?.missionPlanPath) {
      const raw = this.loadJsonFile<Record<string, unknown>>(paths.missionPlanPath, 'Mission Plan');
      if (raw) {
        result.missionPlan = this.extractMissionPlan(raw);
      }
    }

    return result;
  }

  buildControlNarrative(
    controlId: string,
    manifests: AllManifests,
    variables?: Record<string, string>,
  ): ControlNarrative {
    // Check manual gate
    if (MANUAL_GATE_CONTROLS.has(controlId)) {
      // Attempt data extraction before fallback
      const extracted = this.attemptDataExtraction(controlId, manifests, variables);
      if (extracted) {
        return extracted;
      }
      // Fall back to manual gate placeholder
      const family = controlId.split('.')[0];
      const taskType = this.getManualGateTaskType(family);
      return {
        implementationDescription: `REQUIRES MANUAL INPUT: ${taskType} -- provide policy reference, responsible role, and evidence artifacts`,
        technologyStack: [],
        odpValues: [],
        evidenceArtifacts: [],
        verificationMethod: 'Manual verification required',
        isManualGate: true,
      };
    }

    const { tenantManifest, infraManifest, missionPlan } = manifests;

    // 1. Implementation description from tenant manifest required_state
    let implementationDescription = 'Implementation not yet documented in manifests';
    let verificationMethod = '';

    if (tenantManifest) {
      const nc = tenantManifest.normative_controls.find(c => c.control_id === controlId);
      if (nc) {
        // Use required_state as primary narrative if it is detailed (non-generic)
        if (nc.required_state && nc.required_state.length > 100 && !nc.required_state.includes('not yet documented')) {
          implementationDescription = nc.required_state;
        } else {
          implementationDescription = nc.required_state;
        }
        if (nc.verification.length > 0) {
          verificationMethod = nc.verification[0].description;
        }
      }
    }

    // 2. Technology stack from infrastructure manifest
    const technologyStack: string[] = [];
    const infraResources: Array<{ resourceType: string; name: string; properties: Record<string, unknown> }> = [];
    if (infraManifest) {
      const allResources = this.getAllInfraResources(infraManifest);
      for (const resource of allResources) {
        if (resource.control_ids.includes(controlId)) {
          technologyStack.push(`${resource.resource_type} (${resource.name})`);
          infraResources.push({
            resourceType: resource.resource_type,
            name: resource.name,
            properties: resource.properties ?? {},
          });
        }
      }
    }

    // 3. ODP values from infrastructure manifest provenance
    const odpValues: OdpEntry[] = [];
    if (infraManifest) {
      const allResources = this.getAllInfraResources(infraManifest);
      for (const resource of allResources) {
        if (resource.control_ids.includes(controlId) && resource.provenance) {
          for (const prov of resource.provenance) {
            if (prov.source === 'policy_odp') {
              odpValues.push({
                parameter: prov.field,
                value: String(prov.value),
                source: prov.rule,
              });
            }
          }
        }
      }
    }

    // 4. Evidence artifacts from mission plan AND infrastructure manifest (consolidated with source metadata)
    const evidenceArtifacts: EvidenceArtifactEntry[] = [];
    const seenLocations = new Set<string>();

    if (missionPlan) {
      for (const step of missionPlan.steps) {
        const match = step.control_coverage.some(cc => cc.control_id === controlId);
        if (match && step.expected_artifacts) {
          for (const artifact of step.expected_artifacts) {
            if (!seenLocations.has(artifact.storage_location_ref)) {
              seenLocations.add(artifact.storage_location_ref);
              evidenceArtifacts.push({
                path: artifact.storage_location_ref,
                source: 'missionPlan',
              });
            }
          }
        }
      }
    }

    // Evidence from infrastructure manifest resources with matching control_ids
    if (infraManifest) {
      const allResources = this.getAllInfraResources(infraManifest);
      for (const resource of allResources) {
        if (resource.control_ids.includes(controlId) && resource.provenance) {
          for (const prov of resource.provenance) {
            const ref = `infra://${resource.resource_type}/${resource.name}/${prov.field}`;
            if (!seenLocations.has(ref)) {
              seenLocations.add(ref);
              evidenceArtifacts.push({
                path: ref,
                source: 'infraManifest',
              });
            }
          }
        }
      }
    }

    // 5. Verification method fallback
    if (!verificationMethod && missionPlan) {
      for (const step of missionPlan.steps) {
        const match = step.control_coverage.some(cc => cc.control_id === controlId);
        if (match && step.how_to_verify.length > 0) {
          verificationMethod = step.how_to_verify[0];
          break;
        }
      }
    }

    // 5b. Inject OdpValueProvider data (overrides provenance-based ODPs)
    if (this.odpValueProvider) {
      const odpProviderData = this.odpValueProvider.getByControlId(controlId);
      if (odpProviderData) {
        // Check if already present by parameter name to avoid duplicates
        const existing = odpValues.find(o => o.parameter === 'odp_value');
        if (!existing) {
          odpValues.push({
            parameter: 'odp_value',
            value: odpProviderData.value,
            source: odpProviderData.source || 'OdpValueProvider',
          });
        }
        if (odpProviderData.enforcementMechanism) {
          const existingEnf = odpValues.find(o => o.parameter === 'odp_enforcement');
          if (!existingEnf) {
            odpValues.push({
              parameter: 'odp_enforcement',
              value: odpProviderData.enforcementMechanism,
              source: odpProviderData.source || 'OdpValueProvider',
            });
          }
        }
      }
    }

    // 6. Merge ODP values from variables.json (prioritized over provenance for template-specific ODPs)
    const mergedOdpValues: Record<string, string> = {};
    for (const odp of odpValues) {
      mergedOdpValues[odp.parameter] = odp.value;
    }
    if (variables) {
      Object.assign(mergedOdpValues, variables);
    }

    // 6b. Inject AdminOps context into mergedOdpValues as adminOps_* keys
    if (this.adminOpsProvider) {
      const adminOpsContext = this.adminOpsProvider.getByControlId(controlId);
      if (adminOpsContext) {
        // W4-EO2: YAML-derived text is a designed procedure unless a live AO row exists.
        mergedOdpValues['adminOps_provenance'] = adminOpsContext.provenance;
        mergedOdpValues['adminOps_sodTier'] = adminOpsContext.sodTier;
        mergedOdpValues['adminOps_entraRoles'] = adminOpsContext.entraRoles;
        mergedOdpValues['adminOps_portalPath'] = adminOpsContext.portalPath;
        mergedOdpValues['adminOps_powershellCmdlets'] = adminOpsContext.powershellCmdlets;
        mergedOdpValues['adminOps_graphApiEndpoint'] = adminOpsContext.graphApiEndpoint;
        mergedOdpValues['adminOps_complianceBoundary'] = adminOpsContext.complianceBoundary;
        if (adminOpsContext.odpValue) {
          mergedOdpValues['adminOps_odpValue'] = adminOpsContext.odpValue;
        }
        if (adminOpsContext.odpEnforcement) {
          mergedOdpValues['adminOps_odpEnforcement'] = adminOpsContext.odpEnforcement;
        }
      }
    }

    return {
      implementationDescription,
      technologyStack,
      odpValues,
      evidenceArtifacts,
      verificationMethod,
      isManualGate: false,
      mergedOdpValues: Object.keys(mergedOdpValues).length > 0 ? mergedOdpValues : undefined,
      infraResources,
    };
  }

  private attemptDataExtraction(
    controlId: string,
    manifests: AllManifests,
    variables?: Record<string, string>,
  ): ControlNarrative | null {
    const family = controlId.split('.')[0];

    // PE controls: extract from infraManifest.physicalSecurity
    if (family === 'PE' && manifests.infraManifest) {
      const infraAny = manifests.infraManifest as unknown as Record<string, unknown>;
      const physicalSecurity = infraAny.physicalSecurity as PhysicalSecurityData | undefined;
      if (physicalSecurity) {
        const extracted = ManualGateExtractors.extractPhysicalSecurityNarrative(
          controlId,
          physicalSecurity
        );
        if (extracted) {
          return {
            implementationDescription: extracted.narrative,
            technologyStack: [],
            odpValues: [],
            evidenceArtifacts: extracted.sources.map(s => ({ path: s, source: 'infraManifest' as const })),
            verificationMethod: 'Physical security verification',
            isManualGate: false,
          };
        }
      }
    }

    // Policy-based extraction for other families deferred to SspGenerator enrichNarrative()
    return null;
  }

  /**
   * Attempt to resolve a control narrative from directive metadata.
   * Returns a ControlNarrative if the directive has a specialized template
   * (session-controlled BYOD, document-absence, document-prohibition,
   * manual+platform_inherited), or null to fall through to manifest-based/
   * mission-plan resolution.
   *
   * Fallback chain (in priority order):
   * 1. Session-controlled BYOD narrative (if architecture metadata present)
   * 2. DirectiveNarrativeBuilder (if directive metadata present and directive is
   *    document-absence, document-prohibition, or manual+platform_inherited)
   * 3. Returns null to let caller fall through to existing logic
   */
  /**
   * Check if AdminOps knowledge bank data exists for a given control.
   * Used by SharedResponsibilityMatrixGenerator to determine shared vs inherited.
   */
  hasAdminOpsData(controlId: string): boolean {
    if (!this.adminOpsProvider) return false;
    return this.adminOpsProvider.getByControlId(controlId) !== undefined;
  }

  resolveDirectiveNarrative(
    control: CmmcControl,
    directiveMetadata: ExtendedDirectiveMetadata,
    architectureMetadata?: ArchitectureMetadata,
    sectionTwoNumber?: string
  ): ControlNarrative | null {
    // Step 1: Try session-controlled BYOD narrative
    if (architectureMetadata) {
      const byodNarrative = this.resolveByodNarrative(control, directiveMetadata, architectureMetadata, sectionTwoNumber ?? '2.3');
      if (byodNarrative) return byodNarrative;
    }

    // Step 2: Existing directive-specific narratives
    let narrativeText: string | null = null;

    switch (directiveMetadata.directive) {
      case 'document-absence':
        narrativeText = DirectiveNarrativeBuilder.buildDocumentAbsenceNarrative(control, directiveMetadata);
        break;
      case 'document-prohibition':
        narrativeText = DirectiveNarrativeBuilder.buildDocumentProhibitionNarrative(control, directiveMetadata);
        break;
      case 'manual':
        if (directiveMetadata.platform_inherited) {
          narrativeText = DirectiveNarrativeBuilder.buildPlatformInheritedNarrative(control, directiveMetadata);
        }
        break;
      case 'inherit-fedramp':
        narrativeText = DirectiveNarrativeBuilder.buildInheritFedRampNarrative(
          control,
          directiveMetadata,
          false // per-control narrative, not parent section
        );
        break;
      default:
        break;
    }

    if (!narrativeText) return null;

    return {
      implementationDescription: narrativeText,
      technologyStack: [],
      odpValues: [],
      evidenceArtifacts: directiveMetadata.evidence_artifacts.map(a => ({
        path: a,
        source: 'missionPlan' as const,
      })),
      verificationMethod: `Directive verification: ${directiveMetadata.directive}`,
      isManualGate: false,
    };
  }

  resolveByodNarrative(
    control: CmmcControl,
    directiveMetadata: ExtendedDirectiveMetadata,
    architectureMetadata: ArchitectureMetadata,
    sectionTwoNumber: string
  ): ControlNarrative | null {
    if (!ArchitectureDetector.isByodArchitecture(architectureMetadata)) {
      return null;
    }

    let dependencyTable: DependencyTable;
    try {
      dependencyTable = JSON.parse(fs.readFileSync(DEPENDENCY_TABLE_PATH, 'utf-8'));
    } catch {
      return null;
    }

    const dep = dependencyTable.dependencies.find(d => d.control_id === control.control_id);
    if (!dep && !WIRELESS_CONTROLS.has(control.control_id)) {
      return null;
    }

    const verificationDate = this.formatByodDate(architectureMetadata.verification_date);

    if (WIRELESS_CONTROLS.has(control.control_id)) {
      const templatePath = path.join(TEMPLATES_DIR, 'session-controlled-byod-wireless.hbs');
      const narrativeText = this.renderByodTemplate(templatePath, {
        tenant_variant: architectureMetadata.tenant_variant,
        sectionNumber: sectionTwoNumber,
        verification_date: verificationDate,
      });

      if (!narrativeText) return null;

      return {
        implementationDescription: narrativeText,
        technologyStack: [],
        odpValues: [],
        evidenceArtifacts: directiveMetadata.evidence_artifacts.map(a => ({
          path: a,
          source: 'missionPlan' as const,
        })),
        verificationMethod: `BYOD architecture verification: wireless control`,
        isManualGate: false,
      };
    }

    const evaluation = MechanismNarrativeComposer.evaluateMechanismStatus(
      control.control_id,
      architectureMetadata.mechanism_status,
      dependencyTable
    );

    const mechanismNarrative = MechanismNarrativeComposer.composeMechanismFragment(
      control.control_id,
      architectureMetadata.mechanism_status,
      dependencyTable
    );

    let narrativeText: string;

    if (evaluation.allPass) {
      const templatePath = path.join(TEMPLATES_DIR, 'session-controlled-byod-control-passing.hbs');
      narrativeText = this.renderByodTemplate(templatePath, {
        sectionNumber: sectionTwoNumber,
        mechanism_narrative: mechanismNarrative,
        verification_date: verificationDate,
        control_id: control.control_id,
      }) ?? '';
    } else {
      const templatePath = path.join(TEMPLATES_DIR, 'session-controlled-byod-control-failing.hbs');
      narrativeText = this.renderByodTemplate(templatePath, {
        sectionNumber: sectionTwoNumber,
        mechanism_narrative: mechanismNarrative,
        failed_mechanisms: evaluation.failedMechanisms.join(', '),
        gap_disclosure: architectureMetadata.gap_description_dlp ?? '',
        poam_id: architectureMetadata.poam_id ?? '',
        control_id: control.control_id,
      }) ?? '';
    }

    if (!narrativeText) return null;

    return {
      implementationDescription: narrativeText,
      technologyStack: [],
      odpValues: [],
      evidenceArtifacts: directiveMetadata.evidence_artifacts.map(a => ({
        path: a,
        source: 'missionPlan' as const,
      })),
      verificationMethod: `BYOD architecture verification: ${evaluation.allPass ? 'all mechanisms pass' : 'gap detected'}`,
      isManualGate: false,
    };
  }

  private renderByodTemplate(templatePath: string, context: Record<string, string>): string | null {
    try {
      const templateSource = fs.readFileSync(templatePath, 'utf-8');
      const template = Handlebars.compile(templateSource);
      return template(context);
    } catch {
      return null;
    }
  }

  private formatByodDate(isoDate: string): string {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  private loadJsonFile<T>(filePath: string, label: string): T | undefined {
    try {
      if (!fs.existsSync(filePath)) {
        console.warn(`[SnippetDataResolver] ${label} not found at ${filePath}`);
        return undefined;
      }
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch (err) {
      console.warn(`[SnippetDataResolver] Failed to load ${label} from ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  private extractMissionPlan(raw: Record<string, unknown>): MissionPlan {
    // Mission plan may nest steps under outputs.human_readable_mission_plan or at top level
    const plan = raw.outputs as Record<string, unknown> | undefined;
    const hrp = plan?.human_readable_mission_plan as Record<string, unknown> | undefined;
    const rawSteps = (hrp?.steps ?? raw.steps ?? []) as Array<Record<string, unknown>>;

    const steps = rawSteps.map(step => ({
      id: (step.id as string) ?? '',
      title: (step.title as string) ?? '',
      task_type: (step.task_type as string) ?? '',
      control_coverage: ((step.control_coverage ?? []) as Array<Record<string, string>>).map(cc => ({
        control_id: cc.control_id ?? '',
        support_type: cc.support_type ?? '',
        gap_rationale: cc.gap_rationale ?? '',
      })),
      what_to_do: ((step.what_to_do ?? []) as string[]),
      how_to_verify: ((step.how_to_verify ?? []) as string[]),
      expected_artifacts: ((step.expected_artifacts ?? []) as Array<Record<string, unknown>>).map(a => ({
        artifact_id: (a.artifact_id as string) ?? '',
        description: (a.description as string) ?? '',
        storage_location_ref: (a.storage_location_ref as string) ?? '',
      })),
    }));

    return { steps };
  }

  private getAllInfraResources(infra: InfraManifest): InfraResource[] {
    const categories: (keyof InfraManifest)[] = [
      'identity', 'logging', 'security', 'storage', 'network', 'automation', 'diagnostics',
    ];
    const all: InfraResource[] = [];
    for (const cat of categories) {
      const resources = infra[cat];
      if (Array.isArray(resources)) {
        all.push(...resources);
      }
    }
    return all;
  }

  private getManualGateTaskType(family: string): string {
    const taskTypes: Record<string, string> = {
      AT: 'training',
      PE: 'physical security',
      PS: 'personnel screening',
      CA: 'assessment',
      IR: 'incident response',
      MA: 'maintenance',
      AU: 'audit process',
      MP: 'media protection process',
      RA: 'risk assessment',
      SC: 'system communications process',
      SI: 'system integrity process',
    };
    return taskTypes[family] ?? 'process';
  }
}
