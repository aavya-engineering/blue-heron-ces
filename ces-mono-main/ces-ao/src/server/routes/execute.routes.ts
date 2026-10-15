// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 7: Execute Routes
// Express router for AO command execution API

import { Router, type Request, type Response } from 'express';
import type { AoCommand } from '../../types/AoCommand.js';
import { loadTenantConfigBySlug } from '../../tenant/aoTenants.js';
import { executeAoCommand } from '../../execution/CommandExecutor.js';
import { evidenceLostWarning } from '../../execution/EvidenceEmitter.js';
import { checkWebApplyGuard, recordApplyGuardRefusal } from '../../execution/ApplyGuard.js';
import { getRequestPrincipal, type RequirePrincipalOptions } from 'ces-shared/http/principal';
import { aoPrincipalOptionsFromEnv, optionalAoPrincipal } from '../principal.js';

export interface ExecuteRouterOptions {
  /** Principal posture; defaults to aoPrincipalOptionsFromEnv(). A principal token is optional on execute. */
  principal?: RequirePrincipalOptions;
}

/**
 * FX-AO3: evidence-persistence status carried on EVERY execute response (200/202/4xx/5xx).
 * When the row was lost the response says so explicitly (`evidenceLost`, `evidenceWarning`)
 * and it is logged at error level, so the UI/CLI/MCP can't show a silent success.
 */
function evidenceStatus(result: { evidencePersisted?: boolean; evidenceError?: string }, commandId: string) {
  if (result.evidencePersisted === false) {
    console.error(`[execute.routes] evidence lost for ${commandId}: ${result.evidenceError ?? 'unknown error'}`);
    return {
      evidencePersisted: false,
      evidenceLost: true,
      evidenceError: result.evidenceError,
      evidenceWarning: evidenceLostWarning(result.evidenceError),
    };
  }
  return { evidencePersisted: result.evidencePersisted };
}

/**
 * Create execute router.
 * Route: POST /api/execute/:commandId
 *
 * Request body: { tenant: string, inputs: Record<string, any>, dryRun?: boolean, confirmApply?: string }
 *
 * W4-AO5 apply guard: a live apply (dryRun:false) must also send confirmApply equal to the
 * command id (the web analogue of the CLI's --apply / MCP's AO_MCP_ALLOW_APPLY). Otherwise
 * → 428, the executor is never called, and a refusal evidence row is persisted.
 *
 * Steps:
 * 1. Load tenantConfig
 * 2. Find AoCommand from registry
 * 3. Validate inputs
 * 4. Call executeAoCommand
 * 5. Map HTTP status based on result
 *
 * HTTP status mapping:
 * - success=true → 200 OK
 * - success=false + permission → 403 Forbidden
 * - success=false + validation → 400 Bad Request
 * - success=false + other → 500 Internal Server Error
 *
 * Registry cached at server startup (passed as parameter).
 */
export function createExecuteRouter(registry: AoCommand[], options: ExecuteRouterOptions = {}): Router {
  const router = Router();
  const principalIfPresent = optionalAoPrincipal(options.principal ?? aoPrincipalOptionsFromEnv());

  router.post('/execute/:commandId', principalIfPresent as any, async (req: Request, res: Response) => {
    try {
      const { commandId } = req.params;
      const { tenant, inputs, dryRun, approvalId, correlationId } = req.body;
      // W4-AO3: an authenticated principal (when the request carries one) IS the
      // requestor; a differing body requestorUPN is ignored and logged.
      const principal = getRequestPrincipal(req);
      let requestorUPN: string | undefined = req.body?.requestorUPN;
      if (principal) {
        if (requestorUPN && requestorUPN.trim().toLowerCase() !== principal.upn.trim().toLowerCase()) {
          console.warn(
            `[execute.routes] ignoring body requestorUPN "${requestorUPN}" for ${commandId}; ` +
              `the requestor is the authenticated principal "${principal.upn}".`
          );
        }
        requestorUPN = principal.upn;
      }

      // Validate request body
      if (!tenant || typeof tenant !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Missing or invalid tenant field in request body',
        });
      }

      if (!inputs || typeof inputs !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Missing or invalid inputs field in request body',
        });
      }

      // Step 1: Load tenantConfig through the ces-tenant registry
      // (G-TENANT-M5 — same call path as tenantLoader, the CLI, and MCP).
      let tenantConfig;
      try {
        tenantConfig = await loadTenantConfigBySlug(tenant);
      } catch (error: any) {
        return res.status(400).json({
          success: false,
          error: `Failed to load tenant config: ${error.message}`,
        });
      }

      // Step 2: Find AoCommand
      const aoCommand = registry.find(cmd => cmd.id === commandId);
      if (!aoCommand) {
        return res.status(404).json({
          success: false,
          error: `Command ${commandId} not found in registry`,
        });
      }

      // Step 3: Validate inputs (check required parameters)
      const requiredParams = aoCommand.parameters.filter(p => p.required && !p.source);
      for (const param of requiredParams) {
        if (inputs[param.name] === undefined || inputs[param.name] === null || inputs[param.name] === '') {
          return res.status(400).json({
            success: false,
            error: `Missing required parameter: ${param.name}`,
          });
        }
      }

      // FX-AO4: the approver identity is taken ONLY from the approval record (the
      // second person who decided it), never from the execute request. A
      // request-supplied approver is ignored and logged.
      const forgedApprover = req.body?.approverUPN ?? inputs?.approverUPN;
      if (forgedApprover !== undefined) {
        console.warn(
          `[execute.routes] ignoring request-supplied approverUPN for ${commandId}; ` +
            `the approver is taken from the approval record${approvalId ? ` (${approvalId})` : ''}.`
        );
      }

      // Step 3.5 (W4-AO5): live-apply guard — refuse an unconfirmed live write with evidence.
      const guard = checkWebApplyGuard(commandId, req.body);
      if (!guard.allowed) {
        const refusal = await recordApplyGuardRefusal(aoCommand, tenantConfig, inputs, guard.reason!, {
          requestorUPN,
          correlationId,
        });
        return res.status(428).json({
          success: false,
          applyGuard: 'refused',
          error: guard.reason,
          result: refusal.result,
          evidence: refusal.evidence,
          evidencePath: refusal.evidencePath,
          metadataPath: refusal.metadataPath,
          correlationId,
          ...evidenceStatus(refusal, commandId),
        });
      }

      // Step 4: Call executor
      const result = await executeAoCommand(
        aoCommand,
        tenantConfig,
        inputs,
        dryRun ?? true,
        { requestorUPN, approvalId, correlationId, requestorAuthenticated: principal ? principal.verified : undefined }
      );

      // Step 4.5: Tier 3 commands return a pending-approval record (no execution).
      // Only PendingApprovalResult carries `status`, so this also narrows the type.
      if ('status' in result) {
        return res.status(202).json({ ...result, ...evidenceStatus(result, commandId) });
      }
      const evidenceFields = evidenceStatus(result, commandId);

      // Step 5: HTTP status mapping
      if (result.success) {
        return res.status(200).json({
          success: true,
          result,
          evidence: result.evidence,
          evidencePath: result.evidencePath,
          metadataPath: result.metadataPath,
          correlationId: result.correlationId,
          ...evidenceFields,
        });
      }

      // Classify error for HTTP status
      const errorMessage = result.error || '';
      const errorLower = errorMessage.toLowerCase();

      if (errorLower.includes('permission') || errorLower.includes('forbidden') || errorLower.includes('403')) {
        return res.status(403).json({
          success: false,
          result,
          evidence: result.evidence,
          evidencePath: result.evidencePath,
          metadataPath: result.metadataPath,
          correlationId: result.correlationId,
          ...evidenceFields,
        });
      }

      if (errorLower.includes('validation') || errorLower.includes('invalid') || errorLower.includes('required')) {
        return res.status(400).json({
          success: false,
          result,
          evidence: result.evidence,
          evidencePath: result.evidencePath,
          metadataPath: result.metadataPath,
          correlationId: result.correlationId,
          ...evidenceFields,
        });
      }

      // Default: 500 Internal Server Error
      return res.status(500).json({
        success: false,
        result,
        evidence: result.evidence,
        evidencePath: result.evidencePath,
        metadataPath: result.metadataPath,
        correlationId: result.correlationId,
        ...evidenceFields,
      });

    } catch (error: any) {
      // A Tier 3 request without a requestor is a client error, not a server fault.
      if (/requires a requestorUPN/i.test(error?.message ?? '')) {
        return res.status(400).json({ success: false, error: error.message });
      }
      // Unexpected error
      console.error('[execute.routes] Unexpected error:', error);
      return res.status(500).json({
        success: false,
        error: `Internal server error: ${error.message}`,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  });

  return router;
}
