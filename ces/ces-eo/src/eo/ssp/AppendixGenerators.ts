// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import type { ControlImplementation } from 'ces-shared/types/ssp';

const EXCLUDED_ACRONYMS = new Set([
  'THE', 'AND', 'FOR', 'ARE', 'THIS', 'THAT', 'WITH', 'FROM', 'HAVE', 'BEEN',
  'WERE', 'WHICH', 'THEIR', 'WILL', 'WOULD', 'THERE', 'ABOUT', 'OTHER', 'SHALL',
  'MUST', 'SHOULD', 'COULD', 'SYSTEM', 'SYSTEMS', 'CONTROL', 'CONTROLS', 'SECURITY',
  'INFORMATION', 'MANAGEMENT',
]);

/**
 * Static mapping from NIST SP 800-171 Rev 2 control IDs to NIST SP 800-53 controls.
 * Data sourced from NIST SP 800-171 Rev 2 Appendix D.
 */
const NIST_171_TO_53_MAP: Record<string, string[]> = {
  '3.1.1': ['AC-2', 'AC-3', 'AC-17'],
  '3.1.2': ['AC-3', 'AC-4', 'MP-2'],
  '3.1.3': ['AC-4'],
  '3.1.4': ['AC-5', 'AC-6'],
  '3.1.5': ['AC-6(1)', 'AC-6(5)'],
  '3.1.6': ['AC-6(2)'],
  '3.1.7': ['AC-6(9)', 'AC-6(10)'],
  '3.1.8': ['AC-7'],
  '3.1.9': ['AC-8'],
  '3.1.10': ['AC-11', 'AC-11(1)'],
  '3.1.11': ['AC-12'],
  '3.1.12': ['AC-17(1)', 'AC-17(2)'],
  '3.1.13': ['AC-17(3)'],
  '3.1.14': ['AC-17(4)'],
  '3.1.15': ['AC-18'],
  '3.1.16': ['AC-18(1)'],
  '3.1.17': ['AC-18(1)'],
  '3.1.18': ['AC-19'],
  '3.1.19': ['AC-19(5)'],
  '3.1.20': ['AC-20', 'AC-20(1)'],
  '3.1.21': ['AC-20(2)'],
  '3.1.22': ['AC-22'],
  '3.2.1': ['AT-2'],
  '3.2.2': ['AT-2(2)'],
  '3.2.3': ['AT-3'],
  '3.3.1': ['AU-2', 'AU-3', 'AU-3(1)', 'AU-12'],
  '3.3.2': ['AU-3', 'AU-6', 'AU-12'],
  '3.3.3': ['AU-8'],
  '3.3.4': ['AU-5'],
  '3.3.5': ['AU-6(3)'],
  '3.3.6': ['AU-7'],
  '3.3.7': ['AU-4'],
  '3.3.8': ['AU-9'],
  '3.3.9': ['AU-9(4)'],
  '3.4.1': ['CM-2', 'CM-6', 'CM-8', 'CM-8(1)'],
  '3.4.2': ['CM-2', 'CM-6', 'CM-8', 'CM-8(1)'],
  '3.4.3': ['CM-4'],
  '3.4.4': ['CM-3(4)'],
  '3.4.5': ['CM-7', 'CM-7(1)', 'CM-7(2)'],
  '3.4.6': ['CM-7', 'CM-7(4)'],
  '3.4.7': ['CM-7(5)'],
  '3.4.8': ['CM-11'],
  '3.4.9': ['CM-11'],
  '3.5.1': ['IA-2', 'IA-5'],
  '3.5.2': ['IA-2', 'IA-5'],
  '3.5.3': ['IA-2(1)', 'IA-2(2)'],
  '3.5.4': ['IA-2(8)', 'IA-2(9)'],
  '3.5.5': ['IA-4'],
  '3.5.6': ['IA-4'],
  '3.5.7': ['IA-5(1)'],
  '3.5.8': ['IA-5(1)'],
  '3.5.9': ['IA-5(1)'],
  '3.5.10': ['IA-5(1)'],
  '3.5.11': ['IA-6'],
  '3.6.1': ['IR-2', 'IR-4', 'IR-5', 'IR-6', 'IR-7'],
  '3.6.2': ['IR-6'],
  '3.6.3': ['IR-2', 'IR-3'],
  '3.7.1': ['MA-2'],
  '3.7.2': ['MA-3', 'MA-3(1)', 'MA-3(2)'],
  '3.7.3': ['MA-4'],
  '3.7.4': ['MA-4'],
  '3.7.5': ['MA-5'],
  '3.7.6': ['MA-6'],
  '3.8.1': ['MP-2', 'MP-4', 'MP-6'],
  '3.8.2': ['MP-2', 'MP-4', 'MP-6'],
  '3.8.3': ['MP-6'],
  '3.8.4': ['MP-3'],
  '3.8.5': ['MP-5', 'MP-5(4)'],
  '3.8.6': ['MP-5(4)'],
  '3.8.7': ['MP-7', 'MP-7(1)'],
  '3.8.8': ['MP-7(1)'],
  '3.8.9': ['MP-4'],
  '3.9.1': ['PS-3', 'PS-4', 'PS-5'],
  '3.9.2': ['PS-4', 'PS-5'],
  '3.10.1': ['PE-2', 'PE-3'],
  '3.10.2': ['PE-5'],
  '3.10.3': ['PE-6'],
  '3.10.4': ['PE-2', 'PE-3'],
  '3.10.5': ['PE-3'],
  '3.10.6': ['PE-17'],
  '3.11.1': ['RA-3'],
  '3.11.2': ['RA-5', 'RA-5(5)'],
  '3.11.3': ['RA-5', 'SI-5'],
  '3.12.1': ['CA-2', 'CA-2(1)'],
  '3.12.2': ['CA-5', 'CA-7'],
  '3.12.3': ['CA-7'],
  '3.12.4': ['CA-9'],
  '3.13.1': ['SC-7'],
  '3.13.2': ['SC-7'],
  '3.13.3': ['SC-7(5)'],
  '3.13.4': ['SC-7(5)'],
  '3.13.5': ['SC-7(7)'],
  '3.13.6': ['SC-7'],
  '3.13.7': ['SC-7'],
  '3.13.8': ['SC-8', 'SC-8(1)'],
  '3.13.9': ['SC-10'],
  '3.13.10': ['SC-12'],
  '3.13.11': ['SC-13'],
  '3.13.12': ['SC-15'],
  '3.13.13': ['SC-18'],
  '3.13.14': ['SC-23'],
  '3.13.15': ['SC-39'],
  '3.13.16': ['SC-8'],
  '3.14.1': ['SI-2', 'SI-3', 'SI-5'],
  '3.14.2': ['SI-2'],
  '3.14.3': ['SI-3'],
  '3.14.4': ['SI-3'],
  '3.14.5': ['SI-4'],
  '3.14.6': ['SI-4'],
  '3.14.7': ['SI-4', 'SI-4(4)'],
};

export class AppendixGenerators {

  static generateAcronymList(narratives: string[], policyTexts: string[]): string {
    const allText = [...narratives, ...policyTexts].join(' ');
    const matches = allText.match(/\b([A-Z]{2,6})\b/g);
    if (!matches || matches.length === 0) {
      return '[No acronyms detected in control narratives or policies]';
    }

    const acronyms = new Set<string>();
    for (const match of matches) {
      if (!EXCLUDED_ACRONYMS.has(match)) {
        acronyms.add(match);
      }
    }

    if (acronyms.size === 0) {
      return '[No acronyms detected after filtering common words]';
    }

    const sorted = Array.from(acronyms).sort();
    const lines = sorted.map(a => `**${a}** — [Definition not resolved - see NIST/CMMC glossary]`);
    return lines.join('\n\n');
  }

  static generateReferenceList(controls: ControlImplementation[]): string {
    const references: string[] = [
      '1. NIST SP 800-171 Rev 2, "Protecting Controlled Unclassified Information in Nonfederal Systems and Organizations," February 2020. https://doi.org/10.6028/NIST.SP.800-171r2',
      '2. NIST SP 800-171A, "Assessing Security Requirements for Controlled Unclassified Information," June 2018. https://doi.org/10.6028/NIST.SP.800-171A',
      '3. DFARS 252.204-7012, "Safeguarding Covered Defense Information and Cyber Incident Reporting," December 2019.',
      '4. CMMC Model Version 2.0 Level 2, Cybersecurity Maturity Model Certification, November 2021.',
    ];

    // Conditional: FedRAMP if any inherit-fedramp directive
    const hasFedramp = controls.some(c => {
      const anyC = c as unknown as Record<string, unknown>;
      return anyC.directive === 'inherit-fedramp';
    });
    if (hasFedramp) {
      references.push('5. FedRAMP Security Assessment Framework, General Services Administration. https://www.fedramp.gov/documents/');
    }

    // Always include Azure compliance doc for GCC High environments
    references.push(`${references.length + 1}. Microsoft Azure Government Compliance Documentation, "Azure compliance offerings for DoD." https://learn.microsoft.com/en-us/azure/compliance/`);

    return references.join('\n\n');
  }

  static generateControlCorrelationMatrix(controls: ControlImplementation[], cmmcRefPath: string): string {
    let cmmcControls: Array<{ control_id: string; nist_ref: string; practice: string }> = [];
    try {
      const refData = JSON.parse(fs.readFileSync(cmmcRefPath, 'utf-8'));
      cmmcControls = refData.controls ?? [];
    } catch {
      return '[ERROR: Could not load CMMC reference data for correlation matrix]';
    }

    if (cmmcControls.length === 0) {
      return '[No CMMC controls found in reference file]';
    }

    const lines: string[] = [
      '| NIST 800-171 ID | CMMC Practice ID | CMMC Practice Statement | NIST 800-53 Mapping |',
      '|---|---|---|---|',
    ];

    for (const ctrl of cmmcControls) {
      const nistRef = ctrl.nist_ref;
      const nist53Mappings = NIST_171_TO_53_MAP[nistRef] ?? [];
      const mappingStr = nist53Mappings.length > 0 ? nist53Mappings.join(', ') : 'N/A';
      const practiceText = (ctrl.practice ?? '').substring(0, 100) + ((ctrl.practice ?? '').length > 100 ? '...' : '');
      lines.push(`| ${nistRef} | ${ctrl.control_id} | ${practiceText} | ${mappingStr} |`);
    }

    return lines.join('\n');
  }
}
