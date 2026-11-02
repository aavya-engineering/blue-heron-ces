// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G-AO-CMMC-BOUND-1 M4 — SodGate additive floor unit tests.
// Scope boundary under test: the ONE floor is (cmmcLevel === 'L2' && kind ===
// 'live' && write-shaped && Tier 2); nothing else may change gate behavior.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { closeAllCesRepositories, getCesRepository } from 'ces-shared/persistence/node';
import {
  requiresManualGate,
  assertManualGateCleared,
  ApprovalIdRequiredError,
  APPROVAL_ID_REQUIRED,
} from '../src/execution/SodGate.js';
import {
  createApprovalRequest,
  getApprovalRequest,
  recordApprovalDecision,
  SodViolationError,
  SOD_SAME_PERSON,
} from '../src/execution/ApprovalStore.js';
import { makeAoCommand, verifiedApprover } from './fixtures.js';

const l2Live = { cmmcLevel: 'L2' as const, kind: 'live', writeShaped: true };

describe('SodGate.requiresManualGate — M4 additive floor', () => {
  it('Tier 3 always gates, with or without tenant context', () => {
    const t3 = makeAoCommand({ sodTier: 'Tier 3' });
    expect(requiresManualGate(t3)).toBe(true);
    expect(requiresManualGate(t3, l2Live)).toBe(true);
  });

  it('Tier 2 without tenant context keeps its historical behavior (no gate)', () => {
    expect(requiresManualGate(makeAoCommand({ sodTier: 'Tier 2' }))).toBe(false);
  });

  it('floors a write-shaped Tier 2 command against a live L2 tenant', () => {
    expect(requiresManualGate(makeAoCommand({ sodTier: 'Tier 2' }), l2Live)).toBe(true);
  });

  it('does not floor read/evidence commands (writeShaped false)', () => {
    expect(requiresManualGate(makeAoCommand({ sodTier: 'Tier 2' }), { ...l2Live, writeShaped: false })).toBe(false);
  });

  it('does not floor against a sim tenant', () => {
    expect(requiresManualGate(makeAoCommand({ sodTier: 'Tier 2' }), { ...l2Live, kind: 'sim' })).toBe(false);
  });

  it('does not floor against an L1 (or unmigrated) tenant', () => {
    expect(requiresManualGate(makeAoCommand({ sodTier: 'Tier 2' }), { ...l2Live, cmmcLevel: 'L1' })).toBe(false);
    expect(requiresManualGate(makeAoCommand({ sodTier: 'Tier 2' }), { kind: 'live', writeShaped: true })).toBe(false);
  });
});

// AO-3 (GAP-CLOSURE-PLAN §4 G-AO): the manual separation-of-duties gate on the two-person
// approval store. Real temp CES database; no mocks.
describe('SodGate manual separation-of-duties gate (AO-3)', () => {
  const TENANT_ID = 'ao-3-sod-tenant';
  const REQUESTOR = 'requestor@ao3.onmicrosoft.us';
  const APPROVER = 'approver@ao3.onmicrosoft.us';
  const INPUTS = { targetUPN: 'target@ao3.onmicrosoft.us' };
  const t3 = makeAoCommand({ id: 'A-03', sodTier: 'Tier 3' });
  const KEYS = ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'CES_AO_PRINCIPAL_SECRET', 'CES_AO_PRINCIPAL_TOKEN'];
  const saved: Record<string, string | undefined> = {};
  let root: string;

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-3-sod-'));
    process.env.CES_PIPELINE_ROOT = root;
    for (const k of KEYS.slice(1)) delete process.env[k];
  });

  afterEach(() => {
    closeAllCesRepositories();
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function pending(): Promise<string> {
    const r = await createApprovalRequest({
      commandId: t3.id,
      commandTitle: t3.title,
      domain: t3.domain,
      tenantId: TENANT_ID,
      sodTier: 'Tier 3',
      requestorUPN: REQUESTOR,
      inputs: INPUTS,
      controlIds: t3.cmmcPractices,
    });
    return r.approvalId;
  }

  it('refuses clearance with no approval id, before touching the store', async () => {
    for (const bad of ['', '   ', undefined as unknown as string]) {
      const err = await assertManualGateCleared(bad, t3, INPUTS).catch((e) => e);
      expect(err).toBeInstanceOf(ApprovalIdRequiredError);
      expect(err.code).toBe(APPROVAL_ID_REQUIRED);
    }
    await expect(recordApprovalDecision('', verifiedApprover(APPROVER, TENANT_ID), 'approve')).rejects.toThrow(/not found/);
  });

  it('refuses the requestor approving their own request (case/space variant) and records nothing', async () => {
    const id = await pending();
    const self = verifiedApprover(`  ${REQUESTOR.toUpperCase()} `, TENANT_ID);
    const err = await recordApprovalDecision(id, self, 'approve').catch((e) => e);
    expect(err).toBeInstanceOf(SodViolationError);
    expect(err.code).toBe(SOD_SAME_PERSON);
    expect(err.message).toMatch(/Separation-of-duties/);
    const a = (await getApprovalRequest(id))!;
    expect(a.status).toBe('pending');
    expect(a.approverUPN).toBeUndefined();
    expect(a.decidedAt).toBeUndefined();
  });

  it('records a distinct approver decision, which then clears the gate for the same command and inputs', async () => {
    const id = await pending();
    const decided = await recordApprovalDecision(id, verifiedApprover(APPROVER, TENANT_ID), 'approve');
    expect(decided.status).toBe('approved');
    const stored = (await getApprovalRequest(id))!;
    expect(stored.status).toBe('approved');
    expect(stored.approverUPN).toBe(APPROVER);
    expect(stored.requestorUPN).toBe(REQUESTOR);
    expect(typeof stored.decidedAt).toBe('string');
    const cleared = await assertManualGateCleared(id, t3, INPUTS);
    expect(cleared.approvalId).toBe(id);
  });

  it('records a rejection, and a rejected approval does not clear the gate', async () => {
    const id = await pending();
    await recordApprovalDecision(id, verifiedApprover(APPROVER, TENANT_ID), 'reject', 'not now');
    const stored = (await getApprovalRequest(id))!;
    expect(stored.status).toBe('rejected');
    expect(stored.rejectionReason).toBe('not now');
    await expect(assertManualGateCleared(id, t3, INPUTS)).rejects.toThrow(/not in 'approved' status/);
  });

  it('does not clear a pending approval, an unknown id, other inputs or another command', async () => {
    const id = await pending();
    await expect(assertManualGateCleared(id, t3, INPUTS)).rejects.toThrow(/not in 'approved' status/);
    await expect(assertManualGateCleared('no-such-approval', t3, INPUTS)).rejects.toThrow(/not found/);
    await recordApprovalDecision(id, verifiedApprover(APPROVER, TENANT_ID), 'approve');
    await expect(assertManualGateCleared(id, t3, { targetUPN: 'other@ao3.onmicrosoft.us' })).rejects.toThrow(
      /different parameters/
    );
    await expect(assertManualGateCleared(id, makeAoCommand({ id: 'A-04', sodTier: 'Tier 3' }), INPUTS)).rejects.toThrow(
      /authorises command A-03/
    );
  });

  it('refuses to clear an approved record whose stored approver is the requestor (defense in depth)', async () => {
    const id = await pending();
    const a = (await getApprovalRequest(id))!;
    const tampered = { ...a, status: 'approved' as const, approverUPN: REQUESTOR.toUpperCase(), decidedAt: new Date().toISOString() };
    getCesRepository().put('adminops_approvals', { id, ces: a.ces ?? { tenantId: TENANT_ID }, data: tampered });
    const err = await assertManualGateCleared(id, t3, INPUTS).catch((e) => e);
    expect(err).toBeInstanceOf(SodViolationError);
  });

  it('refuses to clear an approved record with no recorded approver', async () => {
    const id = await pending();
    const a = (await getApprovalRequest(id))!;
    getCesRepository().put('adminops_approvals', { id, ces: a.ces ?? { tenantId: TENANT_ID }, data: { ...a, status: 'approved' } });
    await expect(assertManualGateCleared(id, t3, INPUTS)).rejects.toThrow(/no recorded second-person decision/);
  });
});
