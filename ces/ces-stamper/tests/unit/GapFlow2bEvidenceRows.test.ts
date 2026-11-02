// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FLOW-2b (gap closure): every evidence file Stamper writes under plan-data/<slug>/ (evidence/ and
// evidence-by-task/) gets exactly one WORM stamper_evidence_metadata row per write, id
// `<plan>:<task>:<relative path>#<attempt>`, with the sha256 of the file's bytes. A retry adds #2.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'node:url';
import { StamperConfig } from '../../src/config/StamperConfig';
import { StamperEngine } from '../../src/core/StamperEngine';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { evidenceDirForTenant } from '../../src/core/EvidenceReadinessAnalyzer';
import { writeTaskRecord, buildManualGateEvidence, MANUAL_GATE_FILE } from '../../src/core/GateEvidence';
import { writeAndUploadEvidence, buildStructuredEvidence } from '../../src/utils/structuredEvidence';
import { ExeTask, SubCommand } from '../../src/types/schema.types';
import { getCesRepository, closeAllCesRepositories, type CesRepository } from 'ces-shared/persistence/node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const META = 'stamper_evidence_metadata';
const TENANT = 'fx-unit-flow2b';
const PLAN = 'flow2b-plan';
const scope = { tenantId: 'test-tenant' };

const sub: SubCommand = {
  id: 'FX.flow2b.read', label: 'Flow 2b read', engine: 'mgraph', sequence_hint: 1,
  set_command: "New-MgThing -DisplayName 'CMMC-Thing'",
  get_command: "Get-MgThing -Filter \"displayName eq 'CMMC-Thing'\" | ConvertTo-Json",
  idempotency: 'get-then-set', variables_required: [], variables_runtime: [],
  captures: [], on_failure: 'warn_continue', evidence_commands: [],
} as SubCommand;

function makeTask(id: string): ExeTask {
  return {
    id, type: 'configuration', priority: 'p1', depends_on: [],
    action: { engine: 'mgraph', command: 'placeholder', args: { _sub_commands: [sub] } },
    inputs: [], outputs: [], controls: ['AC.L2-3.1.5'], idempotency: 'safe', rollback: { strategy: 'none' },
  } as ExeTask;
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? listFiles(path.join(dir, d.name)) : [path.join(dir, d.name)]);
}

const sha = (f: string) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

describe('FLOW-2b: one WORM metadata row per evidence file written', () => {
  let tmpDir: string;
  let repo: CesRepository;
  let base: string;
  const prevRoot = process.env.CES_PIPELINE_ROOT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-flow2b-'));
    process.env.CES_PIPELINE_ROOT = tmpDir;
    // WORM enforced explicitly (independent of the ces-shared dist rebuild); the engine's store shares it.
    repo = getCesRepository(undefined, { wormCollections: ['adminops_evidence', META, 'stamper_change_log'] });
    base = path.dirname(evidenceDirForTenant(TENANT));
  });

  afterEach(() => {
    closeAllCesRepositories();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.CES_PIPELINE_ROOT;
    else process.env.CES_PIPELINE_ROOT = prevRoot;
  });

  async function loadEngine(answer: string): Promise<StamperEngine> {
    const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/synthetic-mission-plan.executable.json'), 'utf-8'));
    fs.writeFileSync(path.join(tmpDir, 'plan.json'), JSON.stringify({ ...fixture, plan_id: PLAN, execution_graph: [makeTask('task-a')] }));
    // The GET finds the resource (idempotent skip): the adapter writes its evidence record, sends no SET.
    const manager = { execute: async (_t: string, cmd: string) => ({ stdout: cmd.startsWith('Get-MgThing') ? answer : '', stderr: '', exitCode: 0 }) };
    const engine = new StamperEngine(StamperConfig.fromTenantConfig({
      tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
      certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
    }));
    await engine.loadPlan(path.join(tmpDir, 'plan.json'), TENANT, manager as any, new ExecutionContext(false));
    return engine;
  }

  const rows = () => repo.list<any>(META, scope);
  const evidenceFiles = () => [...listFiles(path.join(base, 'evidence')), ...listFiles(path.join(base, 'evidence-by-task'))];
  const rel = (f: string) => path.relative(base, f).split(path.sep).join('/');

  it('CLI-path execution writes exactly one row per evidence file, hash and relative path matching', async () => {
    const engine = await loadEngine('{"id":"existing-1","displayName":"CMMC-Thing"}');
    const { taskRunner } = engine.getTuiDependencies() as any;
    const result = await taskRunner.getAdapter('mgraph').execute(makeTask('task-a'), {}, false);
    expect(result.success).toBe(true);

    const files = evidenceFiles();
    expect(files.length).toBe(2); // evidence/<entry file> and evidence-by-task/task-a/<entry file>
    const all = rows();
    expect(all).toHaveLength(files.length);
    for (const f of files) {
      const mine = all.filter((r) => r.data.relative_path === rel(f));
      expect(mine).toHaveLength(1);
      expect(mine[0].id).toBe(`${PLAN}:task-a:${rel(f)}#1`);
      expect(mine[0].data.sha256_hash).toBe(sha(f));
      expect(mine[0].data.task_id).toBe('task-a');
      expect(mine[0].data.control_ids).toEqual(['AC.L2-3.1.5']);
      expect(typeof mine[0].data.collected_at).toBe('string');
      expect(mine[0].data.attempt).toBe(1);
    }
  });

  it('a retry adds #2 rows and never overwrites #1', async () => {
    const engine = await loadEngine('{"id":"existing-1","displayName":"CMMC-Thing"}');
    const { taskRunner } = engine.getTuiDependencies() as any;
    await taskRunner.getAdapter('mgraph').execute(makeTask('task-a'), {}, false);
    const first = new Map(rows().map((r) => [r.id, r.data.sha256_hash]));
    await new Promise((r) => setTimeout(r, 5)); // a later timestamp, so the rewritten bytes differ
    await taskRunner.getAdapter('mgraph').execute(makeTask('task-a'), {}, false);

    const files = evidenceFiles();
    const all = rows();
    expect(all).toHaveLength(files.length * 2);
    for (const [id, hash] of first) expect(all.find((r) => r.id === id)?.data.sha256_hash).toBe(hash);
    for (const f of files) {
      const second = all.find((r) => r.id === `${PLAN}:task-a:${rel(f)}#2`);
      expect(second?.data.sha256_hash).toBe(sha(f));
      expect(first.get(`${PLAN}:task-a:${rel(f)}#1`)).not.toBe(sha(f));
    }
  });

  it('gate records (TaskRunner path) and GUI-route writes with a ledger get a row; a write without a ledger gets none', async () => {
    const engine = await loadEngine('{}');
    const evDir = evidenceDirForTenant(TENANT);
    const task = makeTask('task-gate');
    const gatePath = writeTaskRecord(evDir, task.id, MANUAL_GATE_FILE,
      buildManualGateEvidence(task, { ownerRole: 'ISSO', gateAction: 'none' } as any), engine.evidenceLedger(task.id));
    const ev = buildStructuredEvidence('{"ok":true}', 0, '', null, sub as any, task, {}, undefined);
    const routed = await writeAndUploadEvidence(evDir, 'identity/route-file.json', ev, undefined, engine.evidenceLedger(task.id));
    await writeAndUploadEvidence(evDir, 'identity/no-ledger.json', ev, undefined);

    const all = rows();
    expect(all.map((r) => r.id).sort()).toEqual([
      `${PLAN}:task-gate:${rel(gatePath)}#1`,
      `${PLAN}:task-gate:${rel(routed.localPath)}#1`,
    ].sort());
    expect(all.find((r) => r.data.relative_path === rel(gatePath))?.data.sha256_hash).toBe(sha(gatePath));
    expect(all.find((r) => r.data.relative_path === rel(routed.localPath))?.data.sha256_hash).toBe(sha(routed.localPath));
  });
});
