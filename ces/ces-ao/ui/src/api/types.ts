// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30: the wire shapes the SPA reads, written here and NOT imported from ces-ao/src (API-5: the UI
// package imports no server or core module, type-only imports included). They mirror
// ces-ao/src/types/AoCommand.ts and the replies of ces-ao/src/server/routes/*.ts as of 2026-10-31.

export interface AoParameter {
  name: string;
  label?: string;
  type?: 'text' | 'select' | 'checkbox' | 'readonly';
  source?: string;
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

export interface AoCostGate {
  recurring: boolean;
  cost_key?: string | null;
  last_resort?: boolean;
  standard_alternative?: string[] | 'none' | null;
}

export interface AoCommand {
  id: string;
  title: string;
  domain: string;
  domainName: string;
  sodTier?: string;
  overview?: string;
  cmmcPractices?: string[];
  parameters: AoParameter[];
  evidence_objectives?: string[];
  cost_gate?: AoCostGate;
}

/** GET /api/commands */
export interface CommandsReply {
  domains: { id: string; name: string; commands: AoCommand[] }[];
}

export interface TenantRow {
  slug: string;
  kind: string;
}

/** GET /api/tenants */
export interface TenantsReply {
  tenants?: TenantRow[];
  liveAllowed?: boolean;
  stacksimModeActive?: boolean;
  error?: string;
}

/** The execute route's `evidence` (StructuredEvidence, the fields the screen shows). */
export interface ExecEvidence {
  outcome?: string;
  complianceVerdict?: string;
  verdict?: string;
  verdictRationale?: string;
  metadata?: {
    dryRun?: boolean;
    mode?: string;
    twoPersonApproval?: { mode?: string; tierRequired?: boolean };
    costGate?: { classification?: string; ackHash?: string; monthlyUsd?: number; priceDate?: string; costKey?: string };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/** POST /api/execute/:commandId reply (200 / 202 / 4xx / 5xx). */
export interface ExecuteReply {
  success?: boolean;
  status?: string;
  approvalId?: string;
  message?: string;
  error?: string;
  applyGuard?: string;
  result?: { success?: boolean; stdout?: string; error?: string; [k: string]: unknown };
  evidence?: ExecEvidence;
  evidencePath?: string;
  metadataPath?: string;
  correlationId?: string;
  evidencePersisted?: boolean;
  evidenceLost?: boolean;
  evidenceWarning?: string;
  evidenceError?: string;
}

/** DP-1, the cost acknowledgement (COST-GATE-SPEC §3.4; LOG-FIN-13). */
export interface CostAck {
  opId: string;
  ackHash: string;
  monthlyUsd: number;
  priceDate?: string;
  operator?: string;
  at: string;
  noOtherMeans?: string;
}

/** POST /api/execute/:commandId body, exactly the legacy page's fields. */
export interface ExecuteBody {
  tenant: string;
  inputs: Record<string, string>;
  dryRun: boolean;
  confirmApply?: string;
  costAck?: CostAck;
  confirmCost?: string;
  requestorUPN?: string;
  approvalId?: string;
  correlationId: string;
}
