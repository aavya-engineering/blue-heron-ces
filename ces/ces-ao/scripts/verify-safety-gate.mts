// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Safety-gate verification — exercises the two-person approval gate and
// get-then-set write path entirely in dryRun (no live creds, nothing destructive).
// Run: npx tsx scripts/verify-safety-gate.mts   (from cse-ao/)

import { readFileSync } from 'node:fs';
import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import { getApprovalRequest } from '../src/execution/ApprovalStore.js';
// FX2-AO1: approvers are verified principals (signed token), never typed names.
import { signPrincipalToken } from 'ces-shared/http/principal';
import { decideApprovalAsVerifiedPrincipal } from '../src/execution/VerifiedApprover.js';
const SCRIPT_SECRET = 'verify-safety-gate-local-secret';
const principalEnv = { ...process.env, CES_AO_PRINCIPAL_SECRET: SCRIPT_SECRET };
const tokenFor = (upn: string) => signPrincipalToken({ sub: `sub-${upn}`, upn }, { secret: SCRIPT_SECRET });

const registry = JSON.parse(
  readFileSync(new URL('../src/registry/ao-commands.registry.json', import.meta.url), 'utf-8')
);
const find = (id: string) => registry.find((c: any) => c.id === id);

// Dummy auth fields satisfy StamperConfig validation; nothing real is contacted in dryRun.
const tenantConfig: any = {
  tenantId: 'dev-tenant',
  tenantSlug: 'dev',
  appId: '00000000-0000-0000-0000-000000000000',
  certPath: 'C:/dev/null/cert.pem',
  certThumbprint: 'DEADBEEF',
  domain: 'dev.onmicrosoft.us',
  endpoints: { graph: 'https://graph.microsoft.us', login: 'https://login.microsoftonline.us' },
};
const REQUESTOR = 'operator@dev.onmicrosoft.us';
const APPROVER = 'manager@dev.onmicrosoft.us';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

// 1. Tier-2 write (A-02 disable) in dryRun → preview, NOT applied.
const a02: any = await executeAoCommand(find('A-02'), tenantConfig, { targetUPN: 'x@dev.us', reason: 'test' }, true);
check('A-02 Tier-2 write dryRun returns a result (no pending status)', !('status' in a02));
check('A-02 evidence captured pre-state (get-then-set ran get first)',
  a02?.evidence?.metadata?.preStateOutput !== undefined);
check('A-02 dryRun did NOT apply the change', a02?.evidence?.metadata?.stateChanged === false);

// 2. Tier-3 (A-03 hard delete) → pending approval, does NOT execute.
const a03: any = await executeAoCommand(find('A-03'), tenantConfig, { targetUPN: 'y@dev.us', reason: 'test' }, false, { requestorUPN: REQUESTOR });
check('A-03 Tier-3 returns pending_approval (no execution)', a03?.status === 'pending_approval');
const approvalId = a03?.approvalId;
check('A-03 produced an approvalId', typeof approvalId === 'string');

// 3. Separation of duties: requestor cannot approve own request.
let sodBlocked = false;
try { await decideApprovalAsVerifiedPrincipal({ approvalId, decision: 'approve', principalToken: tokenFor(REQUESTOR), env: principalEnv }); }
catch (e: any) { sodBlocked = /separation-of-duties/i.test(e.message); }
check('Requestor cannot self-approve (SoD enforced)', sodBlocked);

// 4. A different person CAN approve.
const approved = await decideApprovalAsVerifiedPrincipal({ approvalId, decision: 'approve', principalToken: tokenFor(APPROVER), env: principalEnv });
check('Second distinct UPN can approve', approved.status === 'approved');

// 5. Approved Tier-3 in dryRun → executes write path but previews (not applied).
const a03run: any = await executeAoCommand(find('A-03'), tenantConfig, { targetUPN: 'y@dev.us', reason: 'test' }, true, { approvalId });
check('Approved A-03 no longer pending (gate cleared)', !('status' in a03run));
check('Approved A-03 dryRun previews, does not apply', a03run?.evidence?.metadata?.stateChanged === false);

// 6. Wrong-params approval is rejected (approval bound to exact inputs).
let paramsGuard = false;
try { await executeAoCommand(find('A-03'), tenantConfig, { targetUPN: 'DIFFERENT@dev.us' }, true, { approvalId }); }
catch (e: any) { paramsGuard = /different parameters/i.test(e.message); }
check('Approval is bound to exact parameters', paramsGuard);

console.log(`\n${pass}/${pass + fail} checks passed.`);
process.exit(fail === 0 ? 0 : 1);
