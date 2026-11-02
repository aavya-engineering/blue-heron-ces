// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ObjectStore } from '../store/ObjectStore.js';
import { DEPTH10_IR_CMDLETS } from './depth10IRResolvers.js';
import { exoResolvers } from './exoResolvers.js';
import { ResolverTable } from './ResolverTable.js';
import { StackShapeGate } from '../gating/StackShapeGate.js';

type Row = Record<string, any>;
const SECURITY_MAILBOX = 'secops@sim.example';

describe('DEPTH-10.8 IR golden (depth10IRResolvers.ts)', () => {
  let dir: string;
  let store: ObjectStore;
  let table: ResolverTable;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-depth10-ir-'));
    store = new ObjectStore(path.join(dir, 'store.json'));
    table = new ResolverTable(store, new StackShapeGate('m365_only'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('each DEPTH-10.8 cmdlet is one manual Exchange entry (so the PowerShell wrapper is generated and no derived twin)', () => {
    const named = exoResolvers.filter((e) => e.kind === 'cmdlet').map((e) => (e as { cmdlet: string }).cmdlet);
    for (const c of DEPTH10_IR_CMDLETS) expect(named.filter((n) => n === c)).toHaveLength(1);
  });

  it('IR.L2-3.6.1.user-reporting: before the SET the default policy reads back without a reporting mailbox', async () => {
    const before = (await table.resolveCmdlet('Get-ReportSubmissionPolicy', ['-Identity', 'DefaultReportSubmissionPolicy'])) as Row;
    expect(before).toMatchObject({ Identity: 'DefaultReportSubmissionPolicy', EnableReportToMicrosoft: true, ReportPhishToCustomizedAddress: false, ReportPhishAddresses: [] });
  });

  it('IR.L2-3.6.1.user-reporting: SET then GET returns Microsoft reporting on and the security mailbox for junk, not-junk and phish', async () => {
    // The registry SET, as the PowerShell shim forwards it ($true arrives as a boolean).
    await table.resolveCmdlet('Set-ReportSubmissionPolicy', [
      '-Identity', 'DefaultReportSubmissionPolicy',
      '-EnableReportToMicrosoft', true,
      '-ReportJunkToCustomizedAddress', true, '-ReportJunkAddresses', SECURITY_MAILBOX,
      '-ReportNotJunkToCustomizedAddress', true, '-ReportNotJunkAddresses', SECURITY_MAILBOX,
      '-ReportPhishToCustomizedAddress', true, '-ReportPhishAddresses', SECURITY_MAILBOX,
    ]);
    const read = (await table.resolveCmdlet('Get-ReportSubmissionPolicy', ['-Identity', 'DefaultReportSubmissionPolicy'])) as Row;
    expect(read).toMatchObject({
      EnableReportToMicrosoft: true,
      ReportPhishToCustomizedAddress: true, ReportPhishAddresses: [SECURITY_MAILBOX],
      ReportJunkToCustomizedAddress: true, ReportJunkAddresses: [SECURITY_MAILBOX],
      ReportNotJunkToCustomizedAddress: true, ReportNotJunkAddresses: [SECURITY_MAILBOX],
    });
    // A second Set changes only what it names.
    await table.resolveCmdlet('Set-ReportSubmissionPolicy', ['-Identity', 'DefaultReportSubmissionPolicy', '-EnableUserEmailNotification', '$true']);
    expect((await table.resolveCmdlet('Get-ReportSubmissionPolicy', [])) as Row).toMatchObject({ EnableUserEmailNotification: true, ReportPhishAddresses: [SECURITY_MAILBOX] });
  });

  it('Set-ReportSubmissionPolicy refuses another identity (404), a missing identity and an unknown parameter (400)', async () => {
    await expect(table.resolveCmdlet('Set-ReportSubmissionPolicy', ['-Identity', 'Other', '-EnableReportToMicrosoft', true])).rejects.toThrow(/not found/);
    await expect(table.resolveCmdlet('Set-ReportSubmissionPolicy', ['-EnableReportToMicrosoft', true])).rejects.toThrow(/-Identity is required/);
    await expect(table.resolveCmdlet('Set-ReportSubmissionPolicy', ['-Identity', 'DefaultReportSubmissionPolicy', '-ReportPhishAdress', SECURITY_MAILBOX])).rejects.toThrow(/cannot be found/);
    await expect(table.resolveCmdlet('Set-ReportSubmissionPolicy', ['-Identity', 'DefaultReportSubmissionPolicy', '-EnableReportToMicrosoft', 'maybe'])).rejects.toThrow(/\$true or \$false/);
  });
});
