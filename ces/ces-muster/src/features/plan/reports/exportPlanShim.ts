// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// exportPlanShim.ts — MG-18: the two HTML helpers the vendored
// exportTechRefPlan.ts imports from Planner's src/shared/utils/exportPlan.ts
// (esc, escWithLinks), copied verbatim. The rest of exportPlan.ts (~900 lines)
// is not needed by Muster and is not vendored.

/** Escape HTML entities to prevent rendering issues in the browser. */
export function esc(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** HTML-escape text, then convert markdown `[text](url)` links to `<a>` tags. */
export function escWithLinks(str: string | undefined | null): string {
  if (!str) return '';
  return esc(str).replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" class="doc-link" target="_blank" rel="noopener noreferrer">$1</a>',
  );
}
