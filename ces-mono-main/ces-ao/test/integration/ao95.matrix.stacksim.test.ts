// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-AO4 — the 95-op matrix against stacksim (opt-in AO_STACKSIM_IT=1, Windows).
//
// Every registry command goes through the GOVERNED pipeline over HTTP: the real
// execute + approvals routers (principal-authenticated decisions, W4-AO3) ->
// CommandExecutor (sim-only rail, CMMC gate, SoD gate, SourceBindings, CUI
// boundary, GetThenSet real state) -> Stamper PowerShellAdapter -> powershell.exe
// -> stacksim shims -> in-process stacksim. Each request carries its own
// correlationId; its persisted evidence row is read back from the temp ces.db
// and validated against the shared AdminOps evidence schema.
//
// Per op: dry run, live run (Tier-3: pending -> self-approval refused (409) ->
// second-person approval -> approved live run), plus deny cases:
//  - sim-only rail: the same op against a kind:'live' record -> denied_sim_only
//  - CMMC scope gate: against an L1 tenant -> denied_cmmc for ops with an L2 practice
//  - CUI boundary: against an L2 tenant whose cuiBoundary excludes the bound resource
//    -> denied_cui, for ops that bind a boundary-checked resource
//  - SoD: Tier-3 pending (blocked_pending_approval), self-approval 409, and one rejection
//
// Status per op is computed from observations by `classify` (below), and the
// test asserts that every op is PASS or HONEST-OPEN naming an existing REQ file
// that lists the op. Nothing is "failing" silently: an AO-side fault (no
// evidence row, a non-conforming row, a 500, a thrown error, a wrong deny) fails
// the test. Set AO_MATRIX_WRITE=1 to (re)write docs/AO-95-OP-MATRIX.md.
//
// The tenant record is stacksim's emitted tenant object AS IS — no keys added —
// so the binding gaps show up honestly (REQ-tenant-stacksim-ao-source-keys).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { startAoStacksim, STACKSIM_IT_ENABLED, logSkipIfDisabled, AO_ROOT, type AoStacksimEnv } from './stacksimHarness.js';
import { inputsFor } from './opInputs.js';
import { classify, ALWAYS_MUTATE, type OpObservation, type OpVerdict } from './matrixClassify.js';
import { renderMatrix, renderReqTable } from './matrixRender.js';
import { execFileSync } from 'node:child_process';

logSkipIfDisabled('W4-AO4 ao95.matrix.stacksim');

const SECRET = 'w4-ao4-matrix-principal-secret';
const REQUESTOR = 'operator@ao-w4.sim';
const APPROVER = 'approver@ao-w4.sim';
const RUN = `m${Date.now().toString(36)}`;

describe.skipIf(!STACKSIM_IT_ENABLED)('W4-AO4 95-op matrix against stacksim (governed pipeline)', () => {
  let env: AoStacksimEnv;
  let server: Server;
  let base: string;
  let COMMANDS: any[];
  let rowsFor: (corr: string) => any[];
  let schema: any;
  let sign: (upn: string) => string;
  let simTenantId: string;
  const observations: OpObservation[] = [];
  const verdicts: OpVerdict[] = [];
  let seq = 0;

  const slugs = { sim: 'ao-w4-matrix', live: 'ao-w4-live-ref', l1: 'ao-w4-l1', cui: 'ao-w4-cui' };

  async function call(pathName: string, body: any, asUpn?: string) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (asUpn) headers['x-ces-principal'] = sign(asUpn);
    const res = await fetch(`${base}${pathName}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) });
    let json: any;
    try { json = await res.json(); } catch { json = undefined; }
    return { status: res.status, body: json };
  }

  async function execute(id: string, tenant: string, dryRun: boolean, extra: Record<string, any> = {}, asUpn: string | undefined = REQUESTOR) {
    const cmd = COMMANDS.find((c) => c.id === id);
    const correlationId = `${RUN}-${id}-${++seq}`;
    const r = await call(`/api/execute/${id}`, { tenant, inputs: inputsFor(cmd), dryRun, ...(dryRun ? {} : { confirmApply: id }), correlationId, ...extra }, asUpn);
    const rows = rowsFor(correlationId);
    const conforming = rows.filter((row) => schema.safeParse(row).success).length;
    return { ...r, correlationId, rowCount: rows.length, conforming, row: rows[0] };
  }

  beforeAll(async () => {
    env = await startAoStacksim({ slug: slugs.sim });

    // Deny-case records, derived from the sim record (same loopback endpoints).
    const simRaw = JSON.parse(fs.readFileSync(env.recordPath, 'utf-8'));
    const write = (kind: string, slug: string, raw: any) => {
      const p = path.join(env.registryRoot, kind, `${slug}.json`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify({ ...raw, kind, client: { ...raw.client, slug } }, null, 2));
    };
    write('live', slugs.live, { ...simRaw });
    write('sim', slugs.l1, { ...simRaw, cmmc_level: 'L1', cui_boundary: { tag_key: 'CUI', tag_value: 'true' }, cmmc_migration_exempt: false });
    write('sim', slugs.cui, { ...simRaw, cmmc_level: 'L2', cui_boundary: { resource_allowlist: ['not-this-resource'] }, cmmc_migration_exempt: false });

    const { resetTenantRegistryForTests, loadTenantConfigBySlug } = await import('../../src/tenant/aoTenants.js');
    resetTenantRegistryForTests();
    // FC-AO-2 step 1: approver tokens are tenant-bound (tid = the approval's tenant, as EO mints them).
    simTenantId = (await loadTenantConfigBySlug(slugs.sim)).tenantId;

    const express = (await import('express')).default;
    const { createExecuteRouter } = await import('../../src/server/routes/execute.routes.js');
    const { createApprovalsRouter } = await import('../../src/server/routes/approvals.routes.js');
    const { listCommands } = await import('../../src/execution/invokeCommand.js');
    const { createHs256PrincipalVerifier, signPrincipalToken } = await import('ces-shared/http/principal');
    const { getCesRepository } = await import('ces-shared/persistence/node');
    const { AdminOpsEvidenceSchema } = await import('ces-shared/types/adminops-evidence');
    schema = AdminOpsEvidenceSchema;
    // FC-AO-3 step 1: approver tokens need the ao-approver role too (roles is harmless on the
    // requestor's own token — the role is only checked at decision time).
    sign = (upn) => signPrincipalToken({ sub: `sub-${upn}`, upn, roles: ['ao-approver'], tid: simTenantId }, { secret: SECRET });
    COMMANDS = listCommands();
    rowsFor = (corr) =>
      getCesRepository()
        .listAll<any>('adminops_evidence')
        .map((r: any) => r.data?.metadata)
        .filter((m: any) => m?.correlationId === corr);

    const principal = { verifier: createHs256PrincipalVerifier({ secret: SECRET }) };
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/api', createExecuteRouter(COMMANDS, { principal }));
    app.use('/api', createApprovalsRouter({ principal }));
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 240_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    const { closeAllCesRepositories } = await import('ces-shared/persistence/node');
    closeAllCesRepositories();
    await env?.stop();
  });

  it('runs all 95 commands (dry run, live, deny cases) and records an observation for each', async () => {
    expect(COMMANDS.length).toBe(95);
    // FC-AO-2 (X1): the classifier's always-mutate set is the production one.
    const { ALWAYS_MUTATE_IDEMPOTENCY_CLASSES } = await import('../../src/execution/EvidenceEmitter.js');
    expect([...ALWAYS_MUTATE].sort()).toEqual([...ALWAYS_MUTATE_IDEMPOTENCY_CLASSES].sort());
    const { translateAoCommandToCommandEntry } = await import('../../src/registry/RegistryBridge.js');
    const { isResourceSource } = await import('../../src/execution/SourceBindings.js');
    let rejectionProven = false;

    for (const cmd of COMMANDS) {
      const entry = translateAoCommandToCommandEntry(cmd);
      const obs: OpObservation = {
        id: cmd.id,
        domain: cmd.domain,
        title: cmd.title,
        tier: cmd.sodTier,
        engine: entry.engine,
        idempotency: entry.idempotency,
        writeShaped: !!entry.set_command,
        getCommand: entry.get_command,
        setCommand: entry.set_command,
        params: Object.keys(inputsFor(cmd)),
        sourced: cmd.parameters.filter((p: any) => p.source).map((p: any) => p.source),
        l2: (cmd.cmmcPractices || []).some((p: string) => /\.L2-/.test(p)),
        cuiApplicable: cmd.parameters.some((p: any) => p.source && isResourceSource(p.source)),
      } as OpObservation;

      // Dry run.
      const dry = await execute(cmd.id, slugs.sim, true);
      obs.dry = summarize(dry);

      // Live run (Tier-3 via the two-person round trip).
      let live = await execute(cmd.id, slugs.sim, false);
      if (live.status === 202 && live.body?.status === 'pending_approval') {
        obs.pending = summarize(live);
        const approvalId = live.body.approvalId;
        const self = await call(`/api/approvals/${approvalId}/decision`, { decision: 'approve' }, REQUESTOR);
        obs.selfApprovalStatus = self.status;
        if (!rejectionProven) {
          // Prove a rejection once (on a throwaway second request), then carry on.
          const extra = await execute(cmd.id, slugs.sim, false);
          const rej = await call(`/api/approvals/${extra.body?.approvalId}/decision`, { decision: 'reject', reason: 'matrix rejection proof' }, APPROVER);
          obs.rejectionStatus = rej.status;
          rejectionProven = rej.status === 200;
        }
        const ok = await call(`/api/approvals/${approvalId}/decision`, { decision: 'approve' }, APPROVER);
        obs.approvalStatus = ok.status;
        live = await execute(cmd.id, slugs.sim, false, { approvalId });
      }
      obs.live = summarize(live);

      // Deny cases (the gates run before any PowerShell spawn).
      obs.denySimOnly = summarize(await execute(cmd.id, slugs.live, false));
      obs.denyCmmc = obs.l2 ? summarize(await execute(cmd.id, slugs.l1, true)) : undefined;
      obs.denyCui = obs.cuiApplicable ? summarize(await execute(cmd.id, slugs.cui, true)) : undefined;

      observations.push(obs);
      verdicts.push(classify(obs));
    }
    expect(observations).toHaveLength(95);
  }, 3_600_000);

  it('every op is PASS or HONEST-OPEN with an existing REQ that names it; no AO-side failure', () => {
    const reqDir = path.join(AO_ROOT, 'docs', 'requirements');
    const failures: string[] = [];
    for (const v of verdicts) {
      if (v.status === 'FAILING') failures.push(`${v.id}: ${v.reason}`);
      if (v.status === 'HONEST-OPEN') {
        const reqPath = path.join(reqDir, `${v.req}.md`);
        if (!fs.existsSync(reqPath)) failures.push(`${v.id}: REQ file missing: ${v.req}.md`);
        else if (!fs.readFileSync(reqPath, 'utf-8').includes(v.id)) failures.push(`${v.id}: ${v.req}.md does not name the op`);
      }
    }
    const reqs = [...new Set(verdicts.map((v) => v.req).filter(Boolean))] as string[];
    fs.writeFileSync(
      path.join(env.workDir, 'matrix-req-tables.md'),
      reqs.map((r) => `## ${r}\n\n${renderReqTable(r, verdicts, observations)}\n`).join('\n'),
    );
    if (process.env.AO_MATRIX_WRITE === '1') {
      let head = '';
      try { head = execFileSync('git', ['-C', AO_ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
      fs.writeFileSync(
        path.join(AO_ROOT, 'docs', 'AO-95-OP-MATRIX.md'),
        renderMatrix(verdicts, observations, { run: `${new Date().toISOString().slice(0, 10)} (${RUN})`, head }),
      );
    }
    fs.writeFileSync(path.join(env.workDir, 'matrix-observations.json'), JSON.stringify({ observations, verdicts }, null, 1));
    // eslint-disable-next-line no-console
    console.log(`[W4-AO4] observations: ${path.join(env.workDir, 'matrix-observations.json')}`);
    const pass = verdicts.filter((v) => v.status === 'PASS').length;
    const open = verdicts.filter((v) => v.status === 'HONEST-OPEN').length;
    // eslint-disable-next-line no-console
    console.log(`[W4-AO4] PASS ${pass} / HONEST-OPEN ${open} / FAILING ${verdicts.length - pass - open}`);
    expect(failures).toEqual([]);
  });
});

function summarize(r: any) {
  const b = r.body ?? {};
  const res = b.result ?? b;
  const ev = b.evidence ?? res.evidence;
  const md = ev?.metadata ?? {};
  return {
    http: r.status,
    success: !!b.success,
    status: b.status,
    outcome: ev?.outcome ?? r.row?.outcome,
    verdict: ev?.complianceVerdict ?? r.row?.verdict,
    verdictRationale: ev?.verdictRationale ?? r.row?.verdictRationale,
    error: String(res.error ?? b.error ?? '').slice(0, 400),
    stdout: String(res.stdout ?? '').slice(0, 1500),
    stderr: String(res.stderr ?? '').slice(0, 600),
    pre: md.preStateOutput,
    post: md.postStateOutput,
    stateChanged: md.stateChanged,
    setApplied: md.setApplied,
    stateReadError: md.stateReadError,
    rowCount: r.rowCount,
    conforming: r.conforming,
    rowOutcome: r.row?.outcome,
  };
}
