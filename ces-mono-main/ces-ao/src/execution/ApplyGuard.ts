// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-AO5 item 3: live-apply guard for the web execute route.
//
// The CLI arms a live write only with an explicit `--apply`; the MCP server only when it
// was started with AO_MCP_ALLOW_APPLY=1 AND the call says dryRun:false. The web route
// previously ran a live write on `dryRun:false` alone. The web analogue of `--apply` is a
// typed confirmation: the request must also carry `confirmApply` equal to the command id.
// A refused live apply never reaches the executor and is persisted as enforcement
// evidence (live row, contract outcome `failed`, verdict NOT_APPLICABLE; local outcome
// `denied_apply_guard` — see REQ-ces-shared-adminops-evidence-inconclusive-verdict).

import type { AoCommand } from '../types/AoCommand.js';
import type { TenantConfig } from 'ces-shared/config';
import type { ExecutionResult, StructuredEvidence } from '../types/StamperTypes.js';
import { translateAoCommandToCommandEntry } from '../registry/RegistryBridge.js';
import {
  buildEvidenceArtifact,
  persistEvidenceArtifact,
  generateExecutionId,
  type EvidencePersistenceResult,
} from './EvidenceEmitter.js';
import { resolveTargetIdentity } from './TargetIdentity.js';

/** Request-body field that confirms a live apply; its value must equal the command id. */
export const APPLY_CONFIRM_FIELD = 'confirmApply';

export interface ApplyGuardDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Is this web execute request allowed to proceed? Only a live apply (dryRun === false)
 * is guarded; anything else runs as a dry run and needs no confirmation.
 */
export function checkWebApplyGuard(commandId: string, body: Record<string, unknown> | undefined): ApplyGuardDecision {
  if (body?.dryRun !== false) return { allowed: true };
  if (body?.[APPLY_CONFIRM_FIELD] === commandId) return { allowed: true };
  return {
    allowed: false,
    reason:
      `Live apply of ${commandId} refused by the web apply guard: a live write (dryRun:false) must also send ` +
      `${APPLY_CONFIRM_FIELD}: "${commandId}" (the CLI requires --apply; MCP requires AO_MCP_ALLOW_APPLY=1).`,
  };
}

/** Persist the refusal of an unconfirmed live apply as enforcement evidence. */
export async function recordApplyGuardRefusal(
  aoCommand: AoCommand,
  tenantConfig: TenantConfig,
  inputs: Record<string, any>,
  reason: string,
  opts: { requestorUPN?: string; correlationId?: string } = {},
): Promise<{ result: ExecutionResult; evidence: StructuredEvidence } & EvidencePersistenceResult> {
  const result: ExecutionResult = { success: false, error: reason, stdout: '', stderr: '', exit_code: 1 };
  const evidence = buildEvidenceArtifact(aoCommand, result, translateAoCommandToCommandEntry(aoCommand), {}, {
    dryRun: false,
    overrideOutcome: 'denied_apply_guard',
  });
  evidence.outcomeRationale = reason;
  const persisted = await persistEvidenceArtifact(evidence, {
    commandId: aoCommand.id,
    tenantId: tenantConfig.tenantId || 'unknown',
    executionId: generateExecutionId(),
    domain: aoCommand.domain,
    tenantSlug: tenantConfig.tenantSlug,
    tenantKind: (tenantConfig as { kind?: string }).kind,
    requestorUPN: opts.requestorUPN,
    correlationId: opts.correlationId,
    ...resolveTargetIdentity(inputs, aoCommand),
  });
  return { result, evidence, ...persisted };
}
