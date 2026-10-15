// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 5: Idempotency Classifier
// Maps AO command metadata to Stamper idempotency modes

import type { AoCommand } from '../types/AoCommand.js';

/**
 * Classify idempotency mode for an AO command.
 * Maps from AO metadata (sodTier, trigger, parameters) to Stamper idempotency enum.
 *
 * Rules:
 * - sodTier === 'Tier 3' → 'unsafe_requires_gate'
 * - trigger === 'AUDIT' → 'evidence-only'
 * - trigger === 'CONFIG' || 'ONBOARDING' + write operation → 'get-then-set'
 * - Read-only → 'safe'
 * - Default → 'best_effort'
 */
export function classifyIdempotency(aoCommand: AoCommand): string {
  // Tier 3 always requires manual gate
  if (aoCommand.sodTier === 'Tier 3') {
    return 'unsafe_requires_gate';
  }

  // Audit triggers are evidence-only
  if (aoCommand.trigger === 'AUDIT') {
    return 'evidence-only';
  }

  // Config/Onboarding triggers with write operations → get-then-set
  // Heuristic: if command title/overview contains keywords indicating write operations
  const isWriteOperation =
    /create|new|set|update|add|enable|provision|assign|configure/i.test(aoCommand.title) ||
    /create|new|set|update|add|enable|provision|assign|configure/i.test(aoCommand.overview);

  if ((aoCommand.trigger === 'CONFIG' || aoCommand.trigger === 'ONBOARDING') && isWriteOperation) {
    return 'get-then-set';
  }

  // Read-only heuristic: title/overview contains only read keywords
  const isReadOnly =
    /^(get|list|view|check|verify|read|export|report)/i.test(aoCommand.title) &&
    !/create|new|set|update|add|enable|provision|assign|configure|delete|remove|disable/i.test(aoCommand.overview);

  if (isReadOnly) {
    return 'safe';
  }

  // Default fallback
  return 'best_effort';
}
