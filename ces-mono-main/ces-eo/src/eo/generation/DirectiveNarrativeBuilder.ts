// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Generates directive-specific SSP narratives for document-absence,
 * document-prohibition, and platform-inherited controls.
 *
 * Templates use compliance-critical language that must match legal/procedural
 * standards exactly. Embedded in code (not external files) per Decision 4.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Handlebars from 'handlebars';
import type { CmmcControl } from 'ces-shared/types/controls';
import type { ExtendedDirectiveMetadata } from '../../shared/types/directive.types.js';

const NARRATIVE_TEMPLATES_DIR = path.resolve(process.cwd(), 'src/shared/data/snippet-templates');

export class DirectiveNarrativeBuilder {

  /**
   * Build narrative for document-absence directive (N/A controls).
   * States that the capability does not exist in the assessment boundary.
   */
  static buildDocumentAbsenceNarrative(
    control: CmmcControl,
    metadata: ExtendedDirectiveMetadata
  ): string {
    const capabilitySubject = metadata.narrative_stub || control.practice;
    const baselineDate = metadata.baseline_date || 'baseline date not recorded';

    const baselineRef = metadata.baseline_date
      ? `The baseline system inventory dated ${baselineDate} establishes the absence of this capability in the environment.`
      : `A baseline system inventory establishes the absence of this capability in the environment (baseline date not recorded).`;

    return (
      `This requirement is not applicable to the assessment boundary. ` +
      `${capabilitySubject} does not exist in the environment. ` +
      `${baselineRef} ` +
      `No implementation is required, and no evidence artifacts are produced for this control. ` +
      `This determination is documented and reviewed during each assessment cycle to confirm continued applicability. ` +
      `If the system boundary changes to include this capability in the future, the control will be re-evaluated ` +
      `and appropriate implementation measures will be applied at that time. ` +
      `The Authorizing Official has reviewed and accepted the not-applicable determination for ${control.control_id}.`
    );
  }

  /**
   * Build narrative for document-prohibition directive (MET via enforced prohibition).
   * Cites both the policy reference and the technical enforcement mechanism.
   */
  static buildDocumentProhibitionNarrative(
    control: CmmcControl,
    metadata: ExtendedDirectiveMetadata
  ): string {
    const capabilitySubject = metadata.narrative_stub || control.practice;
    const policyReference = metadata.policy_reference || '[value not recorded]';
    const enforcementMechanism = metadata.enforcement_mechanism || '[value not recorded]';
    const configurationReference = metadata.configuration_reference || '[value not recorded]';
    const verificationDate = metadata.verification_date || '[value not recorded]';
    const monitoringMechanism = metadata.monitoring_mechanism || '[value not recorded]';

    return (
      `This requirement is implemented by prohibiting ${capabilitySubject} entirely within the assessment boundary. ` +
      `The prohibition is documented in ${policyReference} and technically enforced by ${enforcementMechanism}, ` +
      `configured in ${configurationReference}. ` +
      `Enforcement was verified active as of ${verificationDate}. ` +
      `Continuous monitoring is provided by ${monitoringMechanism}. ` +
      `The technical enforcement prevents any user or process from enabling the prohibited capability ` +
      `without administrative override, which requires documented approval and audit trail. ` +
      `Periodic reviews confirm that the prohibition remains in effect and that no exceptions have been granted ` +
      `outside the approved change management process. ` +
      `Evidence of enforcement verification is captured and stored as artifact for ${control.control_id}.`
    );
  }

  /**
   * Build narrative for manual+platform_inherited controls.
   * Cites Microsoft CRM and FedRAMP package for inherited controls.
   */
  static buildPlatformInheritedNarrative(
    control: CmmcControl,
    metadata: ExtendedDirectiveMetadata
  ): string {
    const controlSubject = metadata.narrative_stub || control.practice;
    const serviceLine = metadata.service_line || '[value not recorded]';
    const crmReference = metadata.crm_reference || '[value not recorded]';
    const fedrampPackageId = metadata.fedramp_package_id || '[value not recorded]';

    return (
      `This requirement is satisfied through inheritance from Microsoft's FedRAMP High authorization ` +
      `for ${serviceLine}. ` +
      `Microsoft implements ${controlSubject} on behalf of customers within the GCC High and Azure Government boundaries. ` +
      `The shared responsibility model is documented in the Microsoft Customer Responsibility Matrix (${crmReference}). ` +
      `The FedRAMP authorization package is referenced as ${fedrampPackageId} on the FedRAMP Marketplace. ` +
      `The organization has reviewed the shared responsibility matrix and confirmed that Microsoft's implementation ` +
      `satisfies the requirements of ${control.control_id} within the authorization boundary. ` +
      `Customer-side responsibilities, if any, are addressed through complementary controls documented in this SSP. ` +
      `The inherited control status is reviewed annually to confirm the cloud service provider maintains ` +
      `their FedRAMP authorization and that no changes to the shared responsibility model affect this determination.`
    );
  }

  /**
   * Build narrative for inherit-fedramp directive controls.
   * Renders either the parent section or per-control entry from Handlebars templates.
   */
  static buildInheritFedRampNarrative(
    control: CmmcControl,
    metadata: ExtendedDirectiveMetadata,
    isParentSection: boolean,
    allInheritControls?: CmmcControl[]
  ): string {
    if (isParentSection) {
      const templatePath = path.join(NARRATIVE_TEMPLATES_DIR, 'inherit-fedramp-parent.hbs');
      try {
        const templateSource = fs.readFileSync(templatePath, 'utf-8');
        const template = Handlebars.compile(templateSource);

        const totalCount = allInheritControls?.length ?? 0;
        const context = {
          authorization_level: (metadata as any).authorization_level ?? 'FedRAMP High',
          service_name: (metadata as any).service_name ?? 'Microsoft 365 GCC High + Azure Government',
          package_id: metadata.fedramp_package_id ?? '[MANUAL INPUT REQUIRED]',
          authorization_date: (metadata as any).authorization_date ?? 'see FedRAMP Marketplace',
          tenant_variant: metadata.tenant_variant_confirmed ?? '[MANUAL INPUT REQUIRED]',
          compute_count: String(totalCount),
          facility_count: '0',
          equipment_count: '0',
          scope_observations: 'Inherited controls are subject to annual review per organizational policy.',
        };
        return template(context);
      } catch {
        return `FedRAMP inheritance section: ${metadata.fedramp_package_id ?? '[not recorded]'}`;
      }
    } else {
      const templatePath = path.join(NARRATIVE_TEMPLATES_DIR, 'inherit-fedramp-control.hbs');
      try {
        const templateSource = fs.readFileSync(templatePath, 'utf-8');
        const template = Handlebars.compile(templateSource);
        const context = {
          control_id: control.control_id,
          status: metadata.readiness ?? 'unknown',
          inheritance_source: (metadata as any).service_name ?? 'Microsoft FedRAMP High CSP',
          safeguard: control.practice,
          customer_responsibility: (metadata as any).customer_responsibility_summary ?? 'Review CRM for customer-side actions',
          crm_reference: metadata.crm_reference ?? 'see compliance repository',
          evidence_artifacts: metadata.evidence_artifacts.length > 0 ? metadata.evidence_artifacts.join(', ') : 'No artifacts recorded',
        };
        return template(context);
      } catch {
        return `FedRAMP inherited control ${control.control_id}: ${metadata.readiness ?? 'unknown'}`;
      }
    }
  }
}
