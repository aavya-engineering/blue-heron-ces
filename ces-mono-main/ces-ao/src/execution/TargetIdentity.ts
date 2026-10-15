// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX-AO6 (AdminOps evidence contract 1.3.0, ces-shared FX-SH3): target identity.
//
// `targetUPN` / `targetObjectId` on a contract row name the user the command ACTED ON
// (e.g. the offboarded user of A-02/A-03/B-05) — never the operator. They come from the
// command's own request parameters, by an explicit allowlist:
//   - targetUPN      ← `targetUPN` (A-03..A-06, A-10, A-16, B-05, C-10, D-03, G-02, H-02, H-04)
//                      or `upn` (A-01, A-02, A-07)
//   - targetObjectId ← `targetObjectId` / `targetUserObjectId` (no registry command carries
//                      a user object id today, so this stays unpopulated in practice)
// Deliberately NOT mapped: operatorUPN, adminUPN, breakGlassUPN/breakglassUPN,
// serviceAccountUPN, requestorUPN (operator/service identities) and deviceId (a device,
// not a user — ces-eo's offboarding wizard compares targetObjectId against a user's id).

import type { AoCommand } from '../types/AoCommand.js';

const TARGET_UPN_KEYS = ['targetUPN', 'upn'] as const;
const TARGET_OBJECT_ID_KEYS = ['targetObjectId', 'targetUserObjectId'] as const;

export interface TargetIdentity {
  targetUPN?: string;
  targetObjectId?: string;
}

function pick(
  inputs: Record<string, unknown>,
  keys: readonly string[],
  declared: Set<string> | null,
): string | undefined {
  for (const k of keys) {
    if (declared && !declared.has(k)) continue;
    const v = inputs[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

/**
 * Resolve the target identity from request inputs. When `aoCommand` is given, only
 * parameters the command declares count; without it (approval-store rejection, whose
 * inputs were validated against the command when the approval was opened) the key
 * allowlist alone applies. Inputs are never mutated (paramsHash binds to them).
 */
export function resolveTargetIdentity(
  inputs: Record<string, unknown> | undefined,
  aoCommand?: Pick<AoCommand, 'parameters'>,
): TargetIdentity {
  if (!inputs) return {};
  const declared = aoCommand ? new Set((aoCommand.parameters ?? []).map((p) => p.name)) : null;
  const out: TargetIdentity = {};
  const upn = pick(inputs, TARGET_UPN_KEYS, declared);
  if (upn) out.targetUPN = upn;
  const oid = pick(inputs, TARGET_OBJECT_ID_KEYS, declared);
  if (oid) out.targetObjectId = oid;
  return out;
}
