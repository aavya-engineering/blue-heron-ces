// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// synthetic-customer W3 (2026-10-28): MP.L2-3.8.9.dlp-policy is verified by re-reading the policy
// (Get-DlpCompliancePolicy -Identity) after the create and on the already-exists path.
// DistributionStatus Success -> SAT; Pending -> SAT "created, distribution pending" with
// metadata.distributionStatus; anything else, or no policy -> NOT_SAT. Uses the real registry entry.
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { PowerShellAdapter } from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { ExecutionContext } from '../../src/core/ExecutionContext';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { ExeTask, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json');
const TENANT = 'fx-unit-w3-dlp-policy';

function makeConfig(): StamperConfig {
  return StamperConfig.fromTenantConfig({
    tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
    certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
  });
}

function asSub(entryId: string): SubCommand {
  const e = CommandRegistry.load(REGISTRY_PATH).allEntries.find(x => x.entry_id === entryId)!;
  return {
    id: e.entry_id, label: e.label, set_command: e.set_command, get_command: e.get_command, engine: e.engine,
    sequence_hint: e.sequence_hint, idempotency: e.idempotency as SubCommand['idempotency'],
    variables_required: e.variables_required, variables_runtime: e.variables_runtime, captures: e.captures,
    on_failure: e.on_failure, evidence_commands: e.evidence_commands, verification: e.verification,
  } as SubCommand;
}

function makeTask(id: string, subs: SubCommand[]): ExeTask {
  return {
    id, type: 'configuration', priority: 'p1', depends_on: [],
    action: { engine: 'ipps', command: 'placeholder', args: { _sub_commands: subs } },
    inputs: [], outputs: [], controls: ['MP.L2-3.8.9'], idempotency: 'safe', rollback: { strategy: 'none' },
  } as ExeTask;
}

const policy = (status?: string): string => JSON.stringify({
  Name: 'CMMC-CUI-Block', Mode: 'Enable', ExchangeLocation: ['All'],
  ...(status !== undefined ? { DistributionStatus: status } : {}),
});

/** A tenant whose policy reads `before` until New-DlpCompliancePolicy runs, then `after`. */
function fakeTenant(before: string, after: string) {
  const received: string[] = [];
  let created = false;
  return {
    received,
    manager: {
      execute: async (_t: string, command: string) => {
        received.push(command);
        if (command.includes('New-DlpCompliancePolicy')) {
          created = true;
          return { stdout: after === '' ? '' : policy('Pending'), stderr: '', exitCode: 0 };
        }
        if (command.includes('Get-DlpCompliancePolicy')) return { stdout: created ? after : before, stderr: '', exitCode: 0 };
        if (command.includes('DlpComplianceRule')) return { stdout: '{"Name":"CMMC-CUI-Block-Rule","DistributionStatus":"Success"}', stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    },
  };
}

function readEvidence(taskId: string, sub: SubCommand): any {
  const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
  return JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(TENANT), taskId, evidFile), 'utf-8'));
}

describe('W3: MP.L2-3.8.9.dlp-policy verification by re-read', () => {
  const dlpPolicy = asSub('MP.L2-3.8.9.dlp-policy');
  // The adapter waits 30 s after New-DlpCompliancePolicy (compliance-backend propagation) and
  // 5 s before an empty re-read's retry; the waits are kept, only shortened for the unit test.
  const realSetTimeout = global.setTimeout;
  beforeEach(() => {
    (global as any).setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
      realSetTimeout(fn, ms !== undefined && ms >= 5000 ? 0 : ms, ...args);
  });
  afterEach(() => {
    (global as any).setTimeout = realSetTimeout;
  });

  it('the registry entry accepts Success or Pending on $.DistributionStatus and verifies on the exists path', () => {
    expect(dlpPolicy.get_command).toBe("Get-DlpCompliancePolicy -Identity 'CMMC-CUI-Block' | ConvertTo-Json -Depth 10");
    // W3 Stamper slice: plus the state check Mode = Enable, and the entry is a state postcheck.
    expect(dlpPolicy.verification?.evidence).toEqual({ jsonpath: '$.DistributionStatus', regex: '^(Success|Pending)$', checks: [{ jsonpath: '$.Mode', equals: 'Enable' }] });
    expect(dlpPolicy.verification?.postcheck_mode).toBe('state');
    expect(dlpPolicy.verification?.verify_on_exists).toBe(true);
    expect(dlpPolicy.on_failure).toBe('abort_step');
  });

  it('create path: the re-read says Pending -> SAT, note "created, distribution pending", distributionStatus Pending', async () => {
    const t = fakeTenant('', policy('Pending'));
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, new ExecutionContext(false), undefined, TENANT);
    const result = await adapter.execute(makeTask('task-w3-create-pending', [dlpPolicy]), {}, false);

    expect(result.success).toBe(true);
    expect(t.received.some(c => c.includes('New-DlpCompliancePolicy'))).toBe(true);
    // pre-SET GET, post-SET re-read, evidence command
    expect(t.received.filter(c => c.startsWith("Get-DlpCompliancePolicy -Identity 'CMMC-CUI-Block'")).length).toBeGreaterThanOrEqual(2);
    const rec = readEvidence('task-w3-create-pending', dlpPolicy);
    expect(rec.complianceVerdict).toBe('SAT');
    expect(rec.verdictRationale).toContain('created, distribution pending');
    expect(rec.metadata.distributionStatus).toBe('Pending');
    expect(rec.metadata.stateChanged).toBe(true);
    expect(rec.verificationResult.passed).toBe(true);
  });

  it('create path, simulator shape: the re-read says Success -> SAT without the pending note', async () => {
    const t = fakeTenant('', policy('Success'));
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, new ExecutionContext(false), undefined, TENANT);
    const result = await adapter.execute(makeTask('task-w3-create-success', [dlpPolicy]), {}, false);

    expect(result.success).toBe(true);
    const rec = readEvidence('task-w3-create-success', dlpPolicy);
    expect(rec.complianceVerdict).toBe('SAT');
    expect(rec.verdictRationale).not.toContain('distribution pending');
    expect(rec.metadata.distributionStatus).toBe('Success');
  });

  it('Get path: the policy exists with Success -> verified SAT, SET not sent', async () => {
    const t = fakeTenant(policy('Success'), policy('Success'));
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, new ExecutionContext(false), undefined, TENANT);
    const result = await adapter.execute(makeTask('task-w3-exists-success', [dlpPolicy]), {}, false);

    expect(result.success).toBe(true);
    expect(t.received.some(c => c.includes('New-DlpCompliancePolicy'))).toBe(false);
    const rec = readEvidence('task-w3-exists-success', dlpPolicy);
    expect(rec.outcomeRationale).toBe('Resource already exists — creation skipped (idempotent)');
    expect(rec.complianceVerdict).toBe('SAT');
    expect(rec.verificationResult).toBeDefined();
    expect(rec.verificationResult.passed).toBe(true);
    expect(rec.verificationResult.details.evidence_check).toBe(true);
    expect(rec.metadata.distributionStatus).toBe('Success');
  });

  it('Get path: the policy exists with Pending -> SAT with the pending note', async () => {
    const t = fakeTenant(policy('Pending'), policy('Pending'));
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, new ExecutionContext(false), undefined, TENANT);
    const result = await adapter.execute(makeTask('task-w3-exists-pending', [dlpPolicy]), {}, false);

    expect(result.success).toBe(true);
    const rec = readEvidence('task-w3-exists-pending', dlpPolicy);
    expect(rec.complianceVerdict).toBe('SAT');
    expect(rec.verdictRationale).toContain('created, distribution pending');
    expect(rec.metadata.distributionStatus).toBe('Pending');
  });

  it('Get path: the policy exists with any other status -> NOT_SAT, SET not sent, the step aborts', async () => {
    const dlpRule = asSub('MP.L2-3.8.9.dlp-rule');
    const t = fakeTenant(policy('Failed'), policy('Failed'));
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, new ExecutionContext(false), undefined, TENANT);
    const result = await adapter.execute(makeTask('task-w3-exists-failed', [dlpPolicy, dlpRule]), {}, false);

    expect(result.success).toBe(false);
    expect(result.error).toContain('MP.L2-3.8.9.dlp-policy: verification failed on existing resource');
    expect(t.received.some(c => c.includes('New-DlpCompliancePolicy'))).toBe(false);
    expect(t.received.some(c => c.includes('DlpComplianceRule'))).toBe(false); // abort_step
    const rec = readEvidence('task-w3-exists-failed', dlpPolicy);
    expect(rec.complianceVerdict).toBe('NOT_SAT');
    expect(rec.outcome).toBe('failed_no_remediation');
    expect(rec.verificationResult.details.evidence_check).toBe(false);
    expect(rec.metadata.preStateOutput).toBe(policy('Failed'));
    expect(rec.metadata.distributionStatus).toBe('Failed');
  });

  it('Get path: the policy exists without a DistributionStatus -> NOT_SAT (no unverified skip)', async () => {
    const t = fakeTenant(policy(), policy());
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, new ExecutionContext(false), undefined, TENANT);
    const result = await adapter.execute(makeTask('task-w3-exists-nofield', [dlpPolicy]), {}, false);

    expect(result.success).toBe(false);
    expect(readEvidence('task-w3-exists-nofield', dlpPolicy).complianceVerdict).toBe('NOT_SAT');
  });

  it('missing: the create leaves no policy, the re-read is empty -> NOT_SAT', async () => {
    const t = fakeTenant('', '');
    const adapter = new PowerShellAdapter(makeConfig(), t.manager as any, new ExecutionContext(false), undefined, TENANT);
    const result = await adapter.execute(makeTask('task-w3-missing', [dlpPolicy]), {}, false);

    expect(result.success).toBe(false);
    expect(result.error).toContain('MP.L2-3.8.9.dlp-policy: verification failed');
    const rec = readEvidence('task-w3-missing', dlpPolicy);
    expect(rec.complianceVerdict).toBe('NOT_SAT');
    expect(rec.metadata.distributionStatus).toBeUndefined();
  });
});
