// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-30: every AO route the SPA calls, one function each (the legacy page's fetch calls, same URLs).

import type { ApprovalRecord, TwoPersonDecision } from 'ces-ui-kit';
import { apiCall, withQuery } from './http';
import type { ApiReply } from './http';
import type { CommandsReply, ExecuteBody, ExecuteReply, TenantsReply } from './types';

export interface ApprovalsReply {
  success?: boolean;
  approvals?: ApprovalRecord[];
  error?: string;
}

export interface DecisionReply {
  success?: boolean;
  error?: string;
  evidencePersisted?: boolean;
  evidenceLost?: boolean;
  evidenceWarning?: string;
  evidenceError?: string;
}

export const aoApi = {
  tenants: () => apiCall<TenantsReply>('GET', '/api/tenants'),
  commands: () => apiCall<CommandsReply>('GET', '/api/commands'),
  bindings: (tenant: string, commandId: string) =>
    apiCall<{ bindings?: Record<string, string> }>('GET', withQuery('/api/tenant/bindings', { tenant, commandId })),
  execute: (commandId: string, body: ExecuteBody): Promise<ApiReply<ExecuteReply>> =>
    apiCall<ExecuteReply>('POST', `/api/execute/${encodeURIComponent(commandId)}`, { body }),
  approvals: (status: string) => apiCall<ApprovalsReply>('GET', withQuery('/api/approvals', { status })),
  /** W4-AO3: the approver's sign-in token goes as `x-ces-principal`; the server records that principal. */
  decide: (approvalId: string, decision: TwoPersonDecision, reason: string | undefined, principalToken: string) =>
    apiCall<DecisionReply>('POST', `/api/approvals/${encodeURIComponent(approvalId)}/decision`, {
      body: { decision, reason },
      headers: principalToken ? { 'x-ces-principal': principalToken } : {},
    }),
};
