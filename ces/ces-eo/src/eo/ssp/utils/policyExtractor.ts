// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { PolicyDocument } from 'ces-shared/types/policy';

/**
 * Extracts procedure/implementation content from policy markdown by searching
 * for ATX headers containing implementation, procedures, enforcement, or compliance keywords.
 * Falls back to substring if no matching header is found.
 */
export function extractPolicyProcedures(markdown: string, maxLength: number): string {
  const headerPattern = /^#{1,3}\s+.*(?:implementation|procedures?|enforcement|compliance)/im;
  const match = headerPattern.exec(markdown);

  if (match) {
    const startIndex = match.index + match[0].length;
    const remaining = markdown.substring(startIndex);
    const nextHeader = /^#{1,3}\s+/m.exec(remaining);
    const endIndex = nextHeader ? nextHeader.index : remaining.length;
    const excerpt = remaining.substring(0, Math.min(endIndex, maxLength)).trim();
    return excerpt;
  }

  return markdown.substring(0, maxLength);
}

/**
 * Extracts content from a policy section that specifically references a NIST ref or CMMC control ID.
 * Searches for ATX headers containing the NIST ref (e.g., "3.1.1") or CMMC ID (e.g., "AC.L2-3.1.1").
 * Returns null if no control-specific section is found.
 */
export function extractControlSpecificContent(policy: PolicyDocument, controlId: string): string | null {
  for (const nistRef of policy.nist_controls) {
    const escapedNistRef = nistRef.replace(/\./g, '\\.');
    const escapedCmmcId = controlId.replace(/\./g, '\\.').replace(/-/g, '\\-');
    const pattern = new RegExp(`^#{1,3}\\s+.*(?:${escapedNistRef}|${escapedCmmcId})`, 'im');
    const match = pattern.exec(policy.markdown);

    if (match) {
      const startIndex = match.index + match[0].length;
      const remaining = policy.markdown.substring(startIndex);
      const nextHeader = /^#{1,3}\s+/m.exec(remaining);
      const endIndex = nextHeader ? nextHeader.index : remaining.length;
      const excerpt = remaining.substring(0, Math.min(endIndex, 500)).trim();
      if (excerpt.length >= 200) return excerpt;
      // If less than 200 chars, still return what we have (minimum viable content)
      if (excerpt.length > 0) return excerpt;
    }
  }

  return null;
}

/**
 * Builds a policy excerpt with tiered extraction by completeness score.
 * - >=90%: 500 char max, full extraction cascade
 * - 50-89%: 200 char max, full extraction cascade
 * - <50%: empty excerpt (title-only)
 */
export function buildPolicyExcerpt(
  policy: PolicyDocument,
  controlId: string
): { title: string; excerpt: string; completeness: number } {
  if (policy.completeness < 50) {
    return { title: policy.title, excerpt: '', completeness: policy.completeness };
  }

  const maxLength = policy.completeness >= 90 ? 500 : 200;

  // Extraction cascade: control-specific -> procedures -> substring fallback
  const controlSpecific = extractControlSpecificContent(policy, controlId);
  if (controlSpecific) {
    return {
      title: policy.title,
      excerpt: controlSpecific.substring(0, maxLength),
      completeness: policy.completeness,
    };
  }

  const procedures = extractPolicyProcedures(policy.markdown, maxLength);
  if (procedures) {
    return {
      title: policy.title,
      excerpt: procedures,
      completeness: policy.completeness,
    };
  }

  // Final fallback: never return empty excerpt for >=50% policies
  return {
    title: policy.title,
    excerpt: policy.markdown.substring(0, maxLength),
    completeness: policy.completeness,
  };
}
