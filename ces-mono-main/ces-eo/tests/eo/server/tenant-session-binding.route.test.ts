// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FX2-EO1 (P0, cross-tenant) — Graph sessions are bound to the tenant they were opened for.
 *
 * Before the fix EO held ONE server-global SessionManager: after `/api/connect?tenant=A`,
 * `/api/assess?tenant=B` (Phase 4) and `/api/evidence-explorer/capture` for B fetched live
 * signals through A's session and merged them into B's results; `captureSignalsForTenant`
 * also loaded the server DEFAULT tenant's config (`config.tenantConfigPath`) for any tenant.
 *
 * Drives the REAL config, assessment and evidence routers over HTTP, wired exactly like
 * EoServer (one TenantSessionRegistry shared by all three; the production
 * `captureSignalsForTenant`). "Connect (sim)" = the real `/api/connect` route building a REAL
 * `SessionManager` (ces-tenant PersistentSessionFactory) whose powershell host is replaced by
 * ces-tenant's injected spawn seam — a fake host per tenant that answers every Graph command
 * with JSON carrying that tenant's marker, and records the commands it received.
 *
 * Replaced (network / process I/O only): the blob transport (in-memory, per account), the
 * Exchange/Purview PowerShellFallbackAdapter (it would spawn powershell.exe with the tenant's
 * cert against real endpoints — records which tenant config it was built with and returns a
 * tenant-marked signal), and the docx render pipeline (unloadable under ts-jest). Sim only:
 * nothing leaves the process.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type { TenantConfig } from 'ces-shared/config';
import { closeAllCesRepositories } from 'ces-shared/persistence/node';
import { SessionManager } from '../../../src/eo/core/SessionManager';
import { TenantSessionRegistry } from '../../../src/eo/server/TenantSessionRegistry';
import { captureSignalsForTenant, getLastCaptureRun } from '../../../src/eo/server/signalCapture';
import { createConfigRouter } from '../../../src/eo/server/routers/config-router';
import { createAssessmentRouter } from '../../../src/eo/server/routers/assessment-router';
import { createEvidenceRouter } from '../../../src/eo/server/routers/evidence-router';
import { createRiskAssessmentRouter } from '../../../src/eo/server/routers/risk-assessment-router';
import { AssessmentStore } from '../../../src/eo/assessment/AssessmentStore';
import { PoamStore } from '../../../src/eo/poam/PoamStore';
import { PoamLedgerStore } from '../../../src/eo/poam/PoamLedgerStore';
import { PolicyStore } from '../../../src/eo/policies/PolicyStore';
import { PersonnelStore } from '../../../src/eo/personnel/PersonnelStore';
import { TrainingStore } from '../../../src/eo/personnel/TrainingStore';
import { ScreeningElementStore } from '../../../src/eo/personnel/ScreeningElementStore';
import { RiskAssessmentStore } from '../../../src/eo/risk-assessment/RiskAssessmentStore';

jest.mock('../../../src/eo/rendering/RenderOrchestrator', () => ({
  RenderOrchestrator: class { setAdminOpsData() {} async orchestrateRenders() { return new Map(); } },
}));

// Exchange/Purview adapter: records the tenant config it was built with (the FX2-EO1
// default-config proof) and returns one signal marked with that tenant's GUID.
const mockPsAdapterTenants: string[] = [];
jest.mock('../../../src/eo/ingestion/PowerShellFallbackAdapter', () => ({
  PowerShellFallbackAdapter: class {
    private readonly tenantId: string;
    constructor(tc: { tenantId: string }) { this.tenantId = tc.tenantId; mockPsAdapterTenants.push(tc.tenantId); }
    private sig(signalId: string) {
      return [{ signalId, source: 'powershell', endpoint: signalId, timestamp: new Date().toISOString(),
        rawData: { psMarker: `PS-FROM-${this.tenantId}` }, status: 'success', findings: [] }];
    }
    async runExchangeCommands() { return this.sig('exchangeConfig'); }
    async runPurviewCommands() { return this.sig('purviewConfig'); }
  },
}));

const mockUploads: Array<{ acct: string; body: string }> = [];
jest.mock('ces-shared/blob', () => ({
  ...jest.requireActual('../../__mocks__/ces-shared/blob'),
  listBlobs: async () => [],
  uploadEvidenceBlob: async (cfg: { account_name: string }, blobPath: string, content: string) => {
    mockUploads.push({ acct: cfg.account_name, body: content });
    return { success: true, url: `mem://${cfg.account_name}/${blobPath}` };
  },
}));

// ---- Fake persistent host (ces-tenant's spawn seam), one per SessionManager ----
const HOST_READY = 'STAMPER_HOST_READY';
const CMD_END = 'STAMPER_CMD_END';
const STDOUT_END = 'STAMPER_STDOUT_END';
const STDERR_END = 'STAMPER_STDERR_END';
const EXIT_PREFIX = 'STAMPER_EXIT:';

class FakeStream {
  private listeners: Array<(d: Buffer) => void> = [];
  on(_e: 'data', l: (d: Buffer) => void): this { this.listeners.push(l); return this; }
  removeListener(_e: 'data', l: (d: Buffer) => void): this { this.listeners = this.listeners.filter(x => x !== l); return this; }
  emit(text: string): void { for (const l of [...this.listeners]) l(Buffer.from(text)); }
}

/** Answers every command with JSON carrying `marker` — "this tenant's live Graph data". */
class FakeSessionHost {
  stdout = new FakeStream();
  stderr = new FakeStream();
  killed = false;
  exitCode: number | null = null;
  commands: string[] = [];
  private buffered = '';
  private handlers: Record<string, Array<(...a: any[]) => void>> = {};
  constructor(private readonly marker: string) {}
  stdin = {
    write: (chunk: string): boolean => {
      this.buffered += chunk;
      let idx: number;
      while ((idx = this.buffered.indexOf(`${CMD_END}\n`)) !== -1) {
        const command = this.buffered.slice(0, idx).replace(/\n$/, '');
        this.buffered = this.buffered.slice(idx + CMD_END.length + 1);
        this.commands.push(command);
        const body = JSON.stringify({ liveMarker: this.marker, value: [{ id: this.marker, displayName: this.marker }] });
        setImmediate(() => {
          this.stdout.emit(`${body}\n${STDOUT_END}\n${EXIT_PREFIX}0\n`);
          this.stderr.emit(STDERR_END);
        });
      }
      return true;
    },
    end: (): void => undefined,
  };
  kill(): void { this.killed = true; if (this.exitCode === null) this.exitCode = 0; }
  on(e: string, l: (...a: any[]) => void): this { (this.handlers[e] ??= []).push(l); return this; }
  removeListener(e: string, l: (...a: any[]) => void): this { this.handlers[e] = (this.handlers[e] ?? []).filter(x => x !== l); return this; }
}

const T = {
  A: { slug: 'fx2eo1-tenant-a', guid: '00000000-0000-4000-8000-0000000f2eaa', acct: 'acct-fx2-a', marker: 'LIVE-SIGNAL-OF-TENANT-A' },
  B: { slug: 'fx2eo1-tenant-b', guid: '00000000-0000-4000-8000-0000000f2ebb', acct: 'acct-fx2-b', marker: 'LIVE-SIGNAL-OF-TENANT-B' },
};
const bySlug = (slug: string) => (slug === T.A.slug ? T.A : T.B);

const REGISTRY = path.resolve(__dirname, '../../../../ces-stamper/src/registry/cmmc-l2-commands.registry.json');
const quietLogger = { log: () => undefined, warn: () => undefined, error: () => undefined };

describe('FX2-EO1: live signals for tenant X only ever come from X\'s own session', () => {
  let tmp: string;
  let server: Server;
  let base: string;
  let stamperRoot: string;
  let config: any;
  let cfgPath: Record<string, string>;
  let assessmentStore: AssessmentStore;
  const sessions = new TenantSessionRegistry();
  const hosts: Record<string, FakeSessionHost[]> = { [T.A.slug]: [], [T.B.slug]: [] };
  const prevPipeline = process.env.CES_PIPELINE_ROOT;
  const prevTenantRoot = process.env.CES_TENANT_ROOT;

  /** Commands received by every host ever opened for `slug`. */
  const commandCount = (slug: string) => hosts[slug].reduce((n, h) => n + h.commands.length, 0);

  /** The sim session factory: a REAL SessionManager over a per-tenant fake host. */
  const createSessionManager = (tc: TenantConfig, slug: string) => new SessionManager(tc, {
    tenantSlug: slug,
    sessionHostScript: 'X:\\fake\\session-host.ps1',
    logger: quietLogger,
    spawnFn: () => {
      const host = new FakeSessionHost(bySlug(slug).marker);
      hosts[slug].push(host);
      setImmediate(() => host.stdout.emit(`${HOST_READY}\n`));
      return host as any;
    },
  });

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fx2-eo1-'));
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    fs.mkdirSync(process.env.CES_PIPELINE_ROOT, { recursive: true });
    stamperRoot = path.join(tmp, 'stamper');
    cfgPath = {};
    for (const t of [T.A, T.B]) {
      const dir = path.join(stamperRoot, 'plan-data', t.slug);
      fs.mkdirSync(dir, { recursive: true });
      cfgPath[t.slug] = path.join(dir, `${t.slug}.json`);
      fs.writeFileSync(cfgPath[t.slug], JSON.stringify({
        kind: 'sim',
        client: { slug: t.slug, name: t.slug },
        tenant: { tenant_id: t.guid, domain: `${t.slug}.example.test` },
        auth: { app_id: '00000000-0000-4000-8000-000000000000', cert_path: 'sim.pfx', cert_thumbprint: 'SIM' },
        evidence_storage: {
          account_name: t.acct, account_key: 'sim-key', container: 'evidence', base_path: '',
          blob_endpoint: 'http://127.0.0.1:1/never-called/',
        },
      }));
    }
    const storageRoot = path.join(tmp, 'eo-storage');
    fs.mkdirSync(storageRoot, { recursive: true });
    assessmentStore = new AssessmentStore(storageRoot);
    config = { storageRoot, registryPath: REGISTRY } as any;

    const app = express();
    app.use(express.json());
    // Wired exactly like EoServer: one registry shared by every router.
    app.use(createConfigRouter({ config, stamperRoot, startedAt: new Date().toISOString(), sessions, createSessionManager }));
    app.use(createAssessmentRouter({
      config, stamperRoot, getSessionManager: (slug) => sessions.get(slug),
      assessmentStore, poamStore: new PoamStore(storageRoot), poamLedgerStore: new PoamLedgerStore(storageRoot),
      policyStore: new PolicyStore(storageRoot), personnelStore: new PersonnelStore(storageRoot),
      screeningElementStore: new ScreeningElementStore(storageRoot), trainingStore: new TrainingStore(storageRoot),
    }));
    app.use(createEvidenceRouter({
      config, stamperRoot, assessmentStore,
      personnelStore: new PersonnelStore(storageRoot), riskAssessmentStore: new RiskAssessmentStore(storageRoot),
      policyStore: new PolicyStore(storageRoot), poamStore: new PoamStore(storageRoot),
      getSessionManager: (slug) => sessions.get(slug), captureSignals: captureSignalsForTenant, getLastCaptureRun,
    }));
    app.use(createRiskAssessmentRouter({
      config, riskAssessmentStore: new RiskAssessmentStore(storageRoot), assessmentStore, stamperRoot,
      getSessionManager: (slug) => sessions.get(slug),
      riskBlobReplicatorFor: () => ({ replicateRegister: async () => undefined }) as any,
    }));
    server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await sessions.disconnectAll();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeAllCesRepositories();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (prevPipeline === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = prevPipeline;
    if (prevTenantRoot === undefined) delete process.env.CES_TENANT_ROOT; else process.env.CES_TENANT_ROOT = prevTenantRoot;
  });

  const sse = async (url: string): Promise<any[]> => {
    const r = await fetch(`${base}${url}`);
    expect(r.status).toBe(200);
    const text = await r.text();
    return text.split('\n\n').filter(f => f.startsWith('data: ')).map(f => JSON.parse(f.slice(6)));
  };
  const connect = async (slug: string) => {
    const events = await sse(`/api/connect?tenant=${slug}`);
    expect(events.find(e => e.phase === 'connected_graph')).toBeDefined();
  };
  const capture = async (slug: string) => {
    const r = await fetch(`${base}/api/evidence-explorer/capture?tenant=${slug}`, { method: 'POST' });
    expect(r.status).toBe(200);
    return r.json() as Promise<any>;
  };
  const snapshotText = (guid: string) => JSON.stringify(assessmentStore.loadLatestForTenant(guid));

  it('connect A, then assess B and capture B: no A signal reaches B — B is reported not_connected', async () => {
    await connect(T.A.slug);
    expect(sessions.slugs()).toEqual([T.A.slug]);
    const aCommandsAfterConnect = commandCount(T.A.slug);
    mockPsAdapterTenants.length = 0;
    mockUploads.length = 0;

    const events = await sse(`/api/assess?tenant=${T.B.slug}`);
    expect(events.map(e => e.type)).toContain('assess_done');
    expect(events.find(e => e.type === 'live_signals')).toEqual({ type: 'live_signals', tenant: T.B.slug, liveSignals: 'not_connected' });
    expect(events.find(e => e.type === 'assess_done').liveSignals).toBe('not_connected');
    expect(events.find(e => e.type === 'signal_fetch')).toBeUndefined();
    expect(snapshotText(T.B.guid)).not.toContain(T.A.marker);
    expect(snapshotText(T.B.guid)).not.toContain(T.A.guid);

    const cap = await capture(T.B.slug);
    expect(cap.liveSignals).toBe('not_connected');
    expect(cap.capturedCount).toBe(0);

    // A's session was never touched on B's behalf; nothing of A's was built or uploaded.
    expect(commandCount(T.A.slug)).toBe(aCommandsAfterConnect);
    expect(mockPsAdapterTenants).not.toContain(T.A.guid);
    expect(mockUploads.filter(u => u.body.includes(T.A.marker))).toEqual([]);

    // Explorer index + live-signal route report B's own state, not "someone is connected".
    const idx = await (await fetch(`${base}/api/evidence-explorer/index?tenant=${T.B.slug}`)).json() as any;
    expect(idx.connectionState).toBe('disconnected');
    const sig = await fetch(`${base}/api/evidence-explorer/signal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant: T.B.slug, signalId: 'identitySignals' }),
    });
    expect(sig.status).toBe(503);

    // FX2-EO2: risk ingestion (Defender / Secure Score / Sentinel) for B does not run through A's session.
    const ingest = await fetch(`${base}/api/risk-assessment/ingest?tenant=${T.B.slug}`, { method: 'POST' });
    expect(ingest.status).toBe(200);
    expect(commandCount(T.A.slug)).toBe(aCommandsAfterConnect);
  });

  it("A still gets A's own live signals through A's session", async () => {
    const before = commandCount(T.A.slug);
    mockPsAdapterTenants.length = 0;

    const events = await sse(`/api/assess?tenant=${T.A.slug}`);
    expect(events.find(e => e.type === 'live_signals')?.liveSignals).toBe('connected');
    const fetched = events.find(e => e.type === 'signal_fetch');
    expect(fetched?.signalCount).toBeGreaterThan(0);
    expect(commandCount(T.A.slug)).toBeGreaterThan(before);
    expect(mockPsAdapterTenants).toEqual([T.A.guid]);
    // (The fake Graph payloads map to no evaluator, so A's content is asserted via the live-signal route below.)
    expect(snapshotText(T.A.guid)).not.toContain(T.B.marker);

    const idx = await (await fetch(`${base}/api/evidence-explorer/index?tenant=${T.A.slug}`)).json() as any;
    expect(idx.connectionState).toBe('connected');
    const sig = await fetch(`${base}/api/evidence-explorer/signal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant: T.A.slug, signalId: 'identitySignals' }),
    });
    expect(sig.status).toBe(200);
    expect(JSON.stringify(await sig.json())).toContain(T.A.marker);

    // FX2-EO2: A's own risk ingestion still uses A's session.
    const beforeIngest = commandCount(T.A.slug);
    const ingest = await fetch(`${base}/api/risk-assessment/ingest?tenant=${T.A.slug}`, { method: 'POST' });
    expect(ingest.status).toBe(200);
    expect(commandCount(T.A.slug)).toBeGreaterThan(beforeIngest);
  });

  // FC-EO-H (2026-09-28): 'coverageSignals' is a new evidence-explorer/signal methodMap entry
  // (the six automatic-signal-coverage reads). Proves the on-demand route wiring — through A's
  // own session, not the server default — the same way 'identitySignals' is proven above.
  it("coverageSignals (the six automatic-signal-coverage reads) also comes through A's own session", async () => {
    const sig = await fetch(`${base}/api/evidence-explorer/signal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant: T.A.slug, signalId: 'coverageSignals' }),
    });
    expect(sig.status).toBe(200);
    const body = await sig.json() as { signalResults: Array<{ signalId: string; status: string; rawData: unknown }> };
    expect(body.signalResults.map(s => s.signalId).sort()).toEqual(
      ['directoryUsers', 'lifecycleWorkflows', 'managedDevicesAll', 'roleAssignmentsAll', 'securityIncidents', 'trainingUserCoverage', 'tvmAssessmentRecency']);
    expect(body.signalResults.every(s => s.status === 'success')).toBe(true);
    expect(JSON.stringify(body)).toContain(T.A.marker);
  });

  it("capture for B with its OWN session uses B's session and B's tenant config — even while A is the server default", async () => {
    await connect(T.B.slug);
    await connect(T.A.slug); // A connected LAST: A is the server default (config.tenantConfigPath)
    expect(config.tenantConfigPath).toBe(cfgPath[T.A.slug]);
    expect(sessions.slugs().sort()).toEqual([T.A.slug, T.B.slug].sort());
    const aBefore = commandCount(T.A.slug);
    const bBefore = commandCount(T.B.slug);
    mockPsAdapterTenants.length = 0;
    mockUploads.length = 0;

    const cap = await capture(T.B.slug);
    expect(cap.liveSignals).toBe('connected');
    expect(mockPsAdapterTenants).toEqual([T.B.guid]); // B's config, not the default tenant's
    expect(commandCount(T.B.slug)).toBeGreaterThan(bBefore);
    expect(commandCount(T.A.slug)).toBe(aBefore);
    for (const u of mockUploads) {
      expect(u.acct).toBe(T.B.acct);
      expect(u.body).not.toContain(T.A.marker);
    }
  });

  it('captureSignalsForTenant loads the requested tenant\'s config, not config.tenantConfigPath, and refuses a foreign session', async () => {
    const serverDefault = { ...config, tenantConfigPath: cfgPath[T.A.slug], tenantSlug: T.A.slug };
    const storageB = { account_name: T.B.acct, account_key: 'k', container: 'evidence', base_path: '', blob_endpoint: 'http://127.0.0.1:1/' } as any;

    mockPsAdapterTenants.length = 0;
    const own = await captureSignalsForTenant(T.B.slug, sessions.get(T.B.slug), storageB, serverDefault, stamperRoot);
    expect(own.liveSignals).toBe('connected');
    expect(mockPsAdapterTenants).toEqual([T.B.guid]);

    // Handed A's session for B (a mis-wired caller): refused, nothing fetched through A.
    mockPsAdapterTenants.length = 0;
    const aBefore = commandCount(T.A.slug);
    const foreign = await captureSignalsForTenant(T.B.slug, sessions.get(T.A.slug), storageB, serverDefault, stamperRoot);
    expect(foreign).toEqual({ capturedCount: 0, errors: [], liveSignals: 'not_connected' });
    expect(mockPsAdapterTenants).toEqual([]);
    expect(commandCount(T.A.slug)).toBe(aBefore);

    // The registry never serves a session under another tenant's slug either.
    expect(() => sessions.set(T.B.slug, sessions.get(T.A.slug)!)).toThrow(/bound to tenant/);
    expect(sessions.get(T.B.slug, T.A.guid)).toBeNull();
  });
});
