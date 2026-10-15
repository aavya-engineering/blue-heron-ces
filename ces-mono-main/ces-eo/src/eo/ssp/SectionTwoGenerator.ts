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
import type { ArchitectureMetadata } from '../../shared/types/evidence.types.js';
import type { SectionTwoNarrative } from '../../shared/types/ssp.types.js';
import { GapDisclosureBuilder } from './GapDisclosureBuilder.js';
import type { DependencyTable } from './MechanismNarrativeComposer.js';

function _resolveDefaultTemplatesDir(): string {
  return path.resolve(process.cwd(), 'src/shared/data/snippet-templates');
}

export class SectionTwoGenerator {
  private readonly dependencyTable: DependencyTable;
  private readonly templatesDir: string;

  constructor(dependencyTable: DependencyTable, templatesDir?: string) {
    this.dependencyTable = dependencyTable;
    this.templatesDir = templatesDir ?? _resolveDefaultTemplatesDir();
  }

  generateBoundaryNarrative(
    evidenceMetadata: ArchitectureMetadata,
    sectionNumber: string = '2.3',
    variables: Record<string, string> = {}
  ): SectionTwoNarrative {
    const templatePath = path.join(this.templatesDir, 'session-controlled-byod-section2.hbs');
    const templateSource = fs.readFileSync(templatePath, 'utf-8');
    const template = Handlebars.compile(templateSource);

    const azureMention = evidenceMetadata.azure_resources_present
      ? ' with a supporting Azure Government subscription for Sentinel'
      : '';

    const verificationDate = this.formatDate(evidenceMetadata.verification_date);

    const gapDisclosure = GapDisclosureBuilder.buildGapDisclosure(
      evidenceMetadata.mechanism_status,
      this.dependencyTable,
      evidenceMetadata
    );

    const context = {
      sectionNumber,
      tenant_variant: evidenceMetadata.tenant_variant,
      azure_mention: azureMention,
      ca_app_control_policies_summary: evidenceMetadata.ca_app_control_policies_summary ?? variables.ca_app_control_policies_summary ?? '[not documented]',
      non_browser_block_policy_summary: evidenceMetadata.non_browser_block_policy_summary ?? variables.non_browser_block_policy_summary ?? '[not documented]',
      dlp_policies_summary: evidenceMetadata.dlp_policies_summary ?? variables.dlp_policies_summary ?? '[not documented]',
      sensitivity_labels_summary: evidenceMetadata.sensitivity_labels_summary ?? variables.sensitivity_labels_summary ?? '[not documented]',
      verification_date: verificationDate,
      gap_disclosure: gapDisclosure,
    };

    const content = template(context);

    return {
      sectionNumber,
      content,
    };
  }

  private formatDate(isoDate: string): string {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
}
