// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

const FORBIDDEN_TERMS = ['VDI', 'Cloud PC', 'AVD', 'Intune', 'MDM'];

const OPT_OUT_CLAUSE_PATTERN = /Organizations that do not issue managed endpoints.*?four mechanisms listed above/s;

export class NarrativeLanguageGuard {

  static validateNoForbiddenTerms(
    narrative: string,
    architecture: string
  ): { valid: boolean; violations: string[] } {
    if (architecture !== 'session_controlled_byod') {
      return { valid: true, violations: [] };
    }

    const optOutMatch = OPT_OUT_CLAUSE_PATTERN.exec(narrative);
    let textToScan = narrative;

    if (optOutMatch) {
      textToScan = narrative.slice(0, optOutMatch.index) + narrative.slice(optOutMatch.index + optOutMatch[0].length);
    }

    const violations: string[] = [];
    for (const term of FORBIDDEN_TERMS) {
      const regex = new RegExp(`\\b${term.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (regex.test(textToScan)) {
        violations.push(term);
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  static validateNoFabricatedDates(
    narrative: string,
    allowedDates: string[]
  ): { valid: boolean; violations: string[] } {
    const datePatterns = [
      /\b\d{4}-\d{2}-\d{2}\b/g,  // YYYY-MM-DD
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/gi,  // Month DD, YYYY
    ];
    const violations: string[] = [];
    for (const pattern of datePatterns) {
      const matches = narrative.match(pattern);
      if (matches) {
        for (const match of matches) {
          if (!allowedDates.includes(match)) {
            violations.push(match);
          }
        }
      }
    }
    return {
      valid: violations.length === 0,
      violations: Array.from(new Set(violations)),
    };
  }

  static validateNoGenericCrm(narrative: string): { valid: boolean; violations: string[] } {
    const genericPhrases = [
      'customer is responsible for',
      'refer to CRM',
      'see Customer Responsibility Matrix',
      'inherited from CSP',
      'contact your CSP',
    ];
    const violations: string[] = [];
    for (const phrase of genericPhrases) {
      const regex = new RegExp(phrase, 'i');
      if (regex.test(narrative)) {
        violations.push(phrase);
      }
    }
    return {
      valid: violations.length === 0,
      violations,
    };
  }
}
