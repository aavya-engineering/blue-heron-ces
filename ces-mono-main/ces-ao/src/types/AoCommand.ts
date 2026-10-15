// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

export interface AoCommand {
  id: string;              // "A-07"
  title: string;           // "MFA Enrollment Enforcement"
  domain: string;          // "A"
  domainName: string;      // "Identity & Access Management"
  trigger: string;         // "ONBOARDING"
  priority: string;        // "P1 Critical"
  sodTier: string;         // "Tier 2"
  overview: string;        // 2-3 sentence description
  cmmcPractices: string[]; // ["IA.L2-3.5.3", "AC.L1-3.1.1"] — exactly as in ces-shared cmmc-l2-controls.reference.json
  parameters: AoParameter[];
  idempotencyClass?: string; // explicit registry override (e.g. "evidence-only"); wins over the heuristic classifier
}

export interface AoParameter {
  name: string;
  label: string;
  type: 'text' | 'select' | 'checkbox' | 'readonly';
  source?: string;         // tenant config field path (auto-populate)
  required: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
}
