// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G3 #6 — End-to-end command coverage.
//
// Drives EVERY command in ao-commands.registry.json through the REAL execution pipeline
// (CommandExecutor -> RegistryBridge -> SodGate -> GetThenSet/read path -> EvidenceEmitter ->
// CesRepository) and asserts each reaches a terminal "finished" state:
//
//   - non-Tier-3: success + a persisted evidence artifact whose record carries
//     outcome + complianceVerdict + metadata.controlIds (genuinely persisted to the
//     unified CesRepository, then read back).
//   - Tier-3 (unsafe_requires_gate): returns the pending-approval result WITHOUT executing,
//     then a second pass drives the full two-person approval path (create -> approve by a
//     DIFFERENT UPN -> execute) to a finished, evidence-backed state.
//
// Mock boundary: ONLY the PowerShell execution boundary is mocked. We replace
// `ces-stamper/adapters/powershell` PowerShellAdapter with a deterministic stub whose
// `execute()` returns a success ExecutionResult. Everything else (translation, SOD gate,
// get-then-set orchestration, evidence build + persistence, approval store) is the real code.
//
// Temp CES_PIPELINE_ROOT + closeAllCesRepositories() teardown matches cesIdentity.test.ts
// (Windows SQLite file lock).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ── Mock the PowerShell execution boundary BEFORE importing the executor. ──
// vi.mock is hoisted; the factory returns a class whose execute() is deterministic.
// This is the ONLY thing mocked — no real Graph/PowerShell/tenant is touched.
const adapterExecuteCalls: Array<{ command: string; dryRun: boolean }> = [];
vi.mock('ces-stamper/adapters/powershell', () => {
  class PowerShellAdapter {
    // The real constructor takes (config, sessionManager, ...); we accept + ignore.
    constructor(..._args: unknown[]) {}
    getName() {
      return 'mgraph';
    }
    async execute(task: any, _variables: Record<string, any>, dryRun: boolean) {
      const command = task?.action?.command ?? '';
      adapterExecuteCalls.push({ command, dryRun });
      // Deterministic success: a get/set output the pipeline can hash + assess.
      // exit_code 0 + clean stderr -> assessOutcome => automated_success => SAT.
      const body = JSON.stringify({ ok: true, command, dryRun, sample: 'mock-output' });
      // W4-AO1: a state read is marker-delimited ConvertTo-Json; echo the markers as PowerShell would.
      const isStateRead = command.startsWith("Write-Output '<<AO-STATE-BEGIN>>'");
      return {
        success: true,
        stdout: isStateRead ? `<<AO-STATE-BEGIN>>\n${JSON.stringify({ ok: true, sample: 'mock-state' })}\n<<AO-STATE-END>>` : body,
        stderr: '',
        exit_code: 0,
      };
    }
  }
  return { PowerShellAdapter };
});

import { executeAoCommand } from '../src/execution/CommandExecutor.js';
import {
  createApprovalRequest,
  recordApprovalDecision,
  getApprovalRequest,
} from '../src/execution/ApprovalStore.js';
import { requiresManualGate } from '../src/execution/SodGate.js';
import { verifiedApprover } from './fixtures.js';
import type { AoCommand } from '../src/types/AoCommand.js';
import type { TenantConfig } from 'ces-shared/config';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';

// Load the live registry (the single source of truth this test iterates over).
import registry from '../src/registry/ao-commands.registry.json' assert { type: 'json' };
const COMMANDS = registry as unknown as AoCommand[];

let root: string;
const env0 = { ...process.env };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-e2e-'));
  process.env.CES_PIPELINE_ROOT = root;
  delete process.env.CES_CONFIG_PATH;
  delete process.env.CES_AO_SIM_ONLY;
  // FX-AO2: sim-only is ON by default. This pipeline suite runs a live-kind GCC-High
  // fixture with the PowerShell boundary mocked, so it opts in explicitly. The
  // default-refuse behavior itself is proven in simOnlyRail.test.ts.
  process.env.CES_AO_ALLOW_LIVE = '1';
  adapterExecuteCalls.length = 0;
});
afterEach(() => {
  closeAllCesRepositories(); // release SQLite handles before deleting the temp DB (Windows lock)
  for (const k of ['CES_PIPELINE_ROOT', 'CES_CONFIG_PATH', 'CES_AO_ALLOW_LIVE', 'CES_AO_SIM_ONLY'] as const) {
    if (env0[k] === undefined) delete process.env[k];
    else process.env[k] = env0[k];
  }
  fs.rmSync(root, { recursive: true, force: true });
});

// A dummy cert file inside the sandbox so the live (dryRun=false) StamperConfig validation
// (cert-file-exists check) passes. Never read by anything — the PowerShell boundary is mocked.
function certFilePath(): string {
  const p = path.join(root, 'e2e.pfx');
  if (!fs.existsSync(p)) fs.writeFileSync(p, 'dummy-cert');
  return p;
}

// ── Minimal MS/GCC-High tenant config. Storage dirs point at the temp root so nothing
// escapes the sandbox. ──
function makeTenantConfig(): TenantConfig {
  return {
    tenantSlug: 'e2e',
    // FX-AO2: explicit live kind (with the file-level CES_AO_ALLOW_LIVE=1 opt-in).
    kind: 'live',
    // This is a synthetic execution-pipeline fixture, not a CMMC assessment target:
    // mark it migration-exempt so the Phase-2 fail-closed default (CMMC_STRICT_DEFAULT)
    // lets every registry command through to exercise the pipeline itself. Tests that
    // specifically assert CMMC gating live in cmmcScopeGate/cmmcExecutorGate.
    cmmcMigrationExempt: true,
    tenantId: 'e2e-tenant-guid',
    appId: 'e2e-app-id',
    // Stub credentials. The Tier-3 path runs StamperConfig with dryRun=false (live), which
    // validates that a cert thumbprint + an existing cert file are configured. We point at a
    // real temp file inside the sandbox so validation passes — the actual PowerShell/auth
    // boundary is still mocked, so no real certificate is ever used.
    certPath: certFilePath(),
    certThumbprint: 'E2E0000000000000000000000000000000000000',
    domain: 'e2e.onmicrosoft.us',
    endpoints: {
      graph: 'https://graph.microsoft.us',
      login: 'https://login.microsoftonline.us',
      compliance_uri: 'https://ps.compliance.protection.office365.us/powershell-liveid/',
      exchange_env: 'O365USGovGCCHigh',
      azure_auth: 'https://login.microsoftonline.us/organizations',
    },
    subscription: {
      subscription_id: 'e2e-sub',
      resource_group: 'e2e-rg',
      location: 'usgovvirginia',
    },
    subscriptionId: 'e2e-sub',
    // W4-AO2: a COMPLETE Stamper tenant object — every canonical `resources.*` key the
    // AO SourceBindings table reads (src/execution/SourceBindings.ts), so every
    // tenant-sourced parameter binds from the record. (The previous camelCase keys
    // here never matched a registry source path, so those params were silently
    // unbound.) Missing-key behaviour is proven in sourceBindings.test.ts.
    resources: {
      operator_upn: 'operator@e2e.onmicrosoft.us',
      breakglass_upn: 'breakglass@e2e.onmicrosoft.us',
      kv_name: 'e2e-kv',
      law_name: 'e2e-law',
      vnet_name: 'e2e-vnet',
      storage_account_name: 'e2estorage',
      firewall_name: 'e2e-fw',
      public_ip_name: 'e2e-fw-pip',
      m365_license_sku_id: 'e2e-sku',
      base_group_id: 'e2e-group-base',
      loa_group_id: 'e2e-group-loa',
      admin_group_id: 'e2e-group-admins',
      cui_group_id: 'e2e-group-cui',
      training_enforcement_group_id: 'e2e-group-training',
      named_location_id: 'e2e-named-location',
      device_compliance_ca_policy_id: 'e2e-ca-device-compliance',
      admin_portal_ca_policy_id: 'e2e-ca-admin-portal',
      android_app_protection_policy_id: 'e2e-mam-android',
      ios_app_protection_policy_id: 'e2e-mam-ios',
      cui_site_id: 'e2e-site-cui',
      audit_log_retention_days: '365',
      it_helpdesk_phone: '+1-555-0100',
      training_roster_path: 'e2e-roster.csv',
      backup_vault_name: 'e2e-rsv',
    },
    clientName: 'E2E Test Tenant',
    // Keep all stamper storage inside the temp root.
    // (Extra fields are tolerated by StamperConfig.fromTenantConfig pass-through.)
    ...({
      storageRoot: path.join(root, 'stamper'),
      stateDir: path.join(root, 'stamper', 'state'),
      evidenceDir: path.join(root, 'stamper', 'evidence'),
      logDir: path.join(root, 'stamper', 'logs'),
    } as Record<string, unknown>),
  } as TenantConfig;
}

// Derive the required user inputs for a command from its parameter definitions.
// Source-bound params auto-populate from tenant config; only non-source params are "user inputs".
function buildUserInputs(cmd: AoCommand): Record<string, any> {
  const inputs: Record<string, any> = {};
  for (const p of cmd.parameters) {
    if (p.source) continue; // resolved from tenant config, not a user input
    if (p.type === 'select') {
      inputs[p.name] = p.options?.[0]?.value ?? 'stub';
    } else if (p.type === 'checkbox') {
      inputs[p.name] = 'true';
    } else {
      inputs[p.name] = `stub-${p.name}`;
    }
  }
  return inputs;
}

// Read the persisted evidence record straight from the unified repository (real persistence).
function readPersistedEvidence(commandId: string, tenantId: string): any | undefined {
  const all = getCesRepository().listAll<any>('adminops_evidence');
  const rec = all.find((r) => r.data?.metadata?.commandId === commandId);
  return rec?.data;
}

// Assert a finished, evidence-backed terminal state for a normal (non-Tier-3) command result.
// `isDryRun` controls whether dry-run or live verdict/outcome semantics are checked.
function assertFinishedWithEvidence(result: any, cmd: AoCommand, tenantId: string, isDryRun: boolean = true): void {
  expect(result.success, `${cmd.id} should succeed`).toBe(true);
  // In-memory evidence on the result.
  expect(result.evidence, `${cmd.id} evidence present`).toBeTruthy();
  expect(result.evidence.outcome, `${cmd.id} outcome set`).toBeTruthy();
  expect(
    Array.isArray(result.evidence.metadata.controlIds),
    `${cmd.id} controlIds array`
  ).toBe(true);

  // AE-R1: dry-run vs live evidence semantics.
  expect(result.evidence.metadata.dryRun, `${cmd.id} metadata.dryRun`).toBe(isDryRun);
  expect(result.evidence.metadata.mode, `${cmd.id} metadata.mode`).toBe(isDryRun ? 'dry_run' : 'live');
  if (isDryRun) {
    expect(result.evidence.outcome, `${cmd.id} dry-run outcome`).toBe('dry_run');
    expect(result.evidence.complianceVerdict, `${cmd.id} dry-run verdict != SAT`).not.toBe('SAT');
  } else {
    expect(result.evidence.outcome, `${cmd.id} live outcome`).not.toBe('dry_run');
    expect(result.evidence.complianceVerdict, `${cmd.id} live verdict set`).toBeTruthy();
  }

  // Genuinely PERSISTED — read it back from the CesRepository.
  const persisted = readPersistedEvidence(cmd.id, tenantId);
  expect(persisted, `${cmd.id} evidence persisted to repository`).toBeTruthy();
  expect(persisted.evidence.outcome, `${cmd.id} persisted outcome`).toBeTruthy();
  expect(persisted.metadata.dryRun, `${cmd.id} persisted dryRun`).toBe(isDryRun);
  expect(persisted.metadata.mode, `${cmd.id} persisted mode`).toBe(isDryRun ? 'dry_run' : 'live');
  expect(
    Array.isArray(persisted.metadata.controlIds),
    `${cmd.id} persisted controlIds`
  ).toBe(true);
}

describe('AdminOps registry — every command runs to a finished terminal state (E2E)', () => {
  it('the registry is non-empty (sanity)', () => {
    expect(COMMANDS.length).toBeGreaterThan(0);
  });

  // ── Data-driven over the ENTIRE registry: stays exhaustive as commands are added. ──
  for (const cmd of COMMANDS) {
    const isTier3 = cmd.sodTier === 'Tier 3';
    const label = `${cmd.id} (${cmd.sodTier}) ${cmd.title}`;

    if (!isTier3) {
      it(`runs to evidence-backed completion: ${label}`, async () => {
        const tenant = makeTenantConfig();
        const inputs = buildUserInputs(cmd);
        const result = await executeAoCommand(cmd, tenant, inputs, /* dryRun */ true, {
          requestorUPN: 'requestor@e2e.onmicrosoft.us',
        });
        // Non-Tier-3 must never return the pending-approval shape.
        expect((result as any).status).not.toBe('pending_approval');
        assertFinishedWithEvidence(result, cmd, tenant.tenantId);
        // The real adapter boundary was exercised (mock was called).
        expect(adapterExecuteCalls.length).toBeGreaterThan(0);
      });
    } else {
      // Tier-3: two terminal behaviors to verify.
      it(`HALTS for approval (no execution): ${label}`, async () => {
        expect(requiresManualGate(cmd)).toBe(true);
        const tenant = makeTenantConfig();
        const inputs = buildUserInputs(cmd);
        const result = await executeAoCommand(cmd, tenant, inputs, true, {
          requestorUPN: 'requestor@e2e.onmicrosoft.us',
        });
        // Terminal state #1: pending_approval, and NOTHING executed.
        expect((result as any).status).toBe('pending_approval');
        expect((result as any).approvalId).toBeTruthy();
        expect((result as any).success).toBe(false);
        expect(adapterExecuteCalls.length, `${cmd.id} must not execute before approval`).toBe(0);
        // AE-R3: pending-approval now persists exactly one evidence row with blocked_pending_approval.
        const allEvidence = getCesRepository().listAll<any>('adminops_evidence');
        const matching = allEvidence.filter((r: any) => r.data?.metadata?.commandId === cmd.id);
        expect(matching.length, `${cmd.id} exactly one pending evidence row`).toBe(1);
        const persisted = matching[0].data;
        expect(persisted).toBeTruthy();
        expect(persisted.evidence.outcome).toBe('blocked_pending_approval');
        expect(persisted.evidence.complianceVerdict).toBe('NOT_APPLICABLE');
        expect(persisted.metadata.dryRun).toBe(true);
        expect(persisted.metadata.mode).toBe('dry_run');
        expect(persisted.metadata.requestorUPN).toBe('requestor@e2e.onmicrosoft.us');
        expect((result as any).evidencePersisted).toBe(true);
      });

      it(`completes THROUGH two-person approval: ${label}`, async () => {
        const tenant = makeTenantConfig();
        const inputs = buildUserInputs(cmd);

        // 1) Create the approval request bound to this command + exact inputs.
        const req = await createApprovalRequest({
          commandId: cmd.id,
          commandTitle: cmd.title,
          domain: cmd.domain,
          tenantId: tenant.tenantId,
          sodTier: cmd.sodTier,
          requestorUPN: 'requestor@e2e.onmicrosoft.us',
          inputs,
        });
        expect(req.status).toBe('pending');

        // 2) A DIFFERENT UPN approves (separation of duties enforced by the store).
        const decided = await recordApprovalDecision(
          req.approvalId,
          verifiedApprover('approver@e2e.onmicrosoft.us', tenant.tenantId),
          'approve'
        );
        expect(decided.status).toBe('approved');

        // 3) Execute LIVE with the approvalId — drives the real get-then-set write path.
        const result = await executeAoCommand(cmd, tenant, inputs, /* dryRun */ false, {
          requestorUPN: 'requestor@e2e.onmicrosoft.us',
          approvalId: req.approvalId,
        });
        // Terminal state #2: finished + evidence persisted (live run, not dry-run).
        expect((result as any).status).not.toBe('pending_approval');
        assertFinishedWithEvidence(result, cmd, tenant.tenantId, /* isDryRun */ false);
        // The real adapter boundary fired. For a write-capable Tier-3 command the live
        // get-then-set path must have issued at least one non-dryRun (set) call; A-15 is
        // intentionally gated-but-read-only (empty set_command) so it stays all-read.
        expect(adapterExecuteCalls.length).toBeGreaterThan(0);
        if (result.evidence?.metadata?.stateChanged !== undefined) {
          // get-then-set write path was taken -> a live set call happened.
          expect(adapterExecuteCalls.some((c) => c.dryRun === false)).toBe(true);
        }

        // The single-use approval was consumed on the live run.
        const after = await getApprovalRequest(req.approvalId);
        expect(after?.status).toBe('executed');
      });
    }
  }
});
