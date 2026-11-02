// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX2-AO2 acceptance (stacksim-backed, opt-in AO_STACKSIM_IT=1 on Windows), updated FC-AO-2 (2026-09-28).
//
// Ops run LIVE through the PRODUCTION executor (executeAoCommand -> Stamper PowerShellAdapter ->
// powershell.exe -> stacksim shims -> in-process stacksim server).
//
// History: FX2-AO2 proved here that D-02's output — only the IPPS connection banner — was NOT_SAT, and that
// A-12 / C-01 / D-01 (then: the sim returned nothing) were NOT_SAT. Since then the sim was fixed (SIMFIX,
// 2026-09-27: A-12/C-01/D-01 return seeded data) and D-02 was fixed AO-side (FC-AO-2: it emits its own
// output, `| ConvertTo-Json` per statement, so the connect object no longer blanks its rows). Both premises
// are now false on the sim, so this file proves the CURRENT behaviour on each side of the rule:
//  - D-02: the connection banner is still in the raw response (kept verbatim), and the DLP data after it is
//    recognised as data (SAT) — the banner stripper no longer swallows output that follows the banner row;
//  - A-12 / C-01 / D-01: the seeded data is data (SAT);
//  - the empty-read rule on the sim: A-12 after every guest user is removed from the sim store returns
//    nothing but the session sentinel -> NOT_SAT with the empty-read reason.
// The banner-ONLY -> NOT_SAT rule itself stays pinned by test/bannerOnly.verdict.test.ts (captured fixture).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startAoStacksim, STACKSIM_IT_ENABLED, logSkipIfDisabled, type AoStacksimEnv } from './stacksimHarness.js';
import { inputsFor } from './opInputs.js';

logSkipIfDisabled('FX2-AO2 bannerOnly.stacksim');

describe.skipIf(!STACKSIM_IT_ENABLED)('FX2-AO2 / FC-AO-2 banners and empty reads on stacksim', () => {
  let env: AoStacksimEnv;
  let live: (id: string) => Promise<any>;

  beforeAll(async () => {
    env = await startAoStacksim({ slug: 'ao-fx2-banner' });
    const { executeAoCommand } = await import('../../src/execution/CommandExecutor.js');
    const { getCommand } = await import('../../src/execution/invokeCommand.js');
    const { loadTenantConfigBySlug } = await import('../../src/tenant/aoTenants.js');
    const tenant = await loadTenantConfigBySlug(env.slug);
    live = async (id: string) => {
      const cmd = getCommand(id)!;
      const res: any = await executeAoCommand(cmd, tenant, inputsFor(cmd), false, {
        requestorUPN: 'operator@ao-fx2.sim',
        correlationId: `fx2-ao2-${id}-${Date.now()}`,
      });
      // eslint-disable-next-line no-console
      console.log(`[FX2-AO2] ${id} stacksim stdout: ${JSON.stringify(res.evidence?.rawResponse)} verdict=${res.evidence?.complianceVerdict}`);
      expect(res.success, `${res.error ?? ''} ${res.stderr ?? ''}`).toBe(true);
      return res;
    };
  }, 180_000);

  afterAll(async () => {
    const { closeAllCesRepositories } = await import('ces-shared/persistence/node');
    closeAllCesRepositories();
    await env?.stop();
  });

  it('D-02 live on stacksim: banner kept verbatim, the DLP data after it is data (SAT), persisted as such', async () => {
    const { EMPTY_READ_RATIONALE } = await import('../../src/execution/EvidenceEmitter.js');
    const { getCesRepository } = await import('ces-shared/persistence/node');
    const res = await live('D-02');
    const raw = String(res.evidence.rawResponse);
    expect(raw).toMatch(/ConnectionUri/); // the connect banner is still there, verbatim
    expect(raw).toMatch(/"Name":"[^"]+","Mode":/); // Get-DlpCompliancePolicy's own JSON output
    expect(res.evidence.complianceVerdict).toBe('SAT');
    expect(res.evidence.verdictRationale).not.toBe(EMPTY_READ_RATIONALE);

    const rows = getCesRepository()
      .listAll<any>('adminops_evidence')
      .filter((r) => r.data?.metadata?.commandId === 'D-02');
    expect(rows).toHaveLength(1);
    expect(rows[0].data.metadata.mode).toBe('live');
    expect(rows[0].data.metadata.outcome).toBe('executed');
    expect(rows[0].data.metadata.verdict).toBe('SAT');
  }, 180_000);

  for (const id of ['A-12', 'C-01', 'D-01']) {
    it(`${id} live on stacksim (seeded data since SIMFIX): data -> SAT`, async () => {
      const { EMPTY_READ_RATIONALE } = await import('../../src/execution/EvidenceEmitter.js');
      const res = await live(id);
      expect(res.evidence.complianceVerdict).toBe('SAT');
      expect(res.evidence.verdictRationale).not.toBe(EMPTY_READ_RATIONALE);
    }, 180_000);
  }

  it('A-12 after every guest is removed from the sim: nothing but the session sentinel -> NOT_SAT, empty-read reason', async () => {
    const { EMPTY_READ_RATIONALE } = await import('../../src/execution/EvidenceEmitter.js');
    const guests = (await env.store.list('users')).filter((u: any) => String(u.userType).toLowerCase() === 'guest');
    expect(guests.length).toBeGreaterThan(0);
    for (const g of guests) await env.store.delete('users', g.id);
    const res = await live('A-12');
    expect(String(res.evidence.rawResponse)).not.toMatch(/#EXT#/);
    expect(res.evidence.complianceVerdict).toBe('NOT_SAT');
    expect(res.evidence.verdictRationale).toBe(EMPTY_READ_RATIONALE);
  }, 180_000);
});
