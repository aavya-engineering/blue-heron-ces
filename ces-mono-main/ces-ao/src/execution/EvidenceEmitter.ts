// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Module 4: Evidence Emitter
// Builds StructuredEvidence artifacts from ExecutionResult and persists them durably.
// AE-R2: contract-conformant rows; AE-R3: full metadata threading.

import { randomUUID } from 'node:crypto';
import type { AoCommand } from '../types/AoCommand.js';
import type { CommandEntry } from 'ces-shared/types/registry';
import type { ExecutionResult, StructuredEvidence, EvidenceOutcome } from '../types/StamperTypes.js';
import { buildStructuredEvidence } from '../utils/evidenceBuilder.js';
import { resolveCesIdentity } from 'ces-shared/config/ces';
import { loadCesConfig } from 'ces-shared/config/ces/node';
import { getCesRepository } from 'ces-shared/persistence/node';
import {
  ADMINOPS_EVIDENCE_CONTRACT_VERSION,
  type AdminOpsEvidence,
  type AdminOpsEvidenceOutcomeType,
} from 'ces-shared/types/adminops-evidence';

const AO_EVIDENCE_COLLECTION = 'adminops_evidence';

function resolvePlaceholders(template: string, variables: Record<string, any> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, name) => {
    const v = variables[name];
    return (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') ? String(v) : m;
  });
}

// ─── AE-R2: outcome normalization ────────────────────────────────

export function normalizeOutcome(
  local: EvidenceOutcome,
  mode: 'dry_run' | 'live',
): AdminOpsEvidenceOutcomeType {
  switch (local) {
    case 'dry_run': return 'dry_run';
    case 'denied_cmmc': return 'denied_cmmc';
    case 'denied_cui': return 'denied_cui';
    // FX-SH1 / contract 1.2.0+: dedicated sim-only rail refusal outcome (was denied_cmmc).
    case 'denied_sim_only': return 'denied_sim_only';
    case 'blocked_pending_approval': return 'blocked_pending_approval';
    case 'approval_rejected': return 'approval_rejected';
    case 'automated_success':
    case 'policy_compliance':
      return mode === 'dry_run' ? 'dry_run' : 'executed';
    case 'manual_action':
    case 'exception_granted':
    case 'outside_action':
    case 'partial_success':
      return 'executed';
    // W4-AO5: no contract outcome for a web apply-guard refusal yet
    // (REQ-ces-shared-adminops-evidence-inconclusive-verdict) → failed, never SAT.
    case 'denied_apply_guard': return 'failed';
    case 'failed_remediation_available':
    case 'failed_no_remediation':
    case 'not_applicable':
    case 'inherited':
    case 'verification_pending':
    case 'unknown_legacy':
      return 'failed';
    default:
      return 'failed';
  }
}

// ─── AE-R2: contract row builder ─────────────────────────────────

export function toContractRow(
  evidence: StructuredEvidence,
  opts: EvidencePersistenceOptions,
): AdminOpsEvidence {
  const mode = evidence.metadata.mode ?? (evidence.metadata.dryRun ? 'dry_run' : 'live');
  const outcome = normalizeOutcome(evidence.outcome, mode);
  return {
    contractVersion: ADMINOPS_EVIDENCE_CONTRACT_VERSION,
    commandId: opts.commandId,
    tenantId: opts.tenantId,
    tenantSlug: opts.tenantSlug,
    tenantKind: opts.tenantKind,
    mode,
    dryRun: !!evidence.metadata.dryRun,
    outcome,
    controlIds: evidence.metadata.controlIds,
    correlationId: opts.correlationId,
    requestorUPN: opts.requestorUPN,
    approverUPN: opts.approverUPN,
    // FX-AO6 / contract 1.3.0: the user the command acted on (never the operator).
    // Keys are set only when known — the schema rejects empty strings.
    ...(opts.targetUPN ? { targetUPN: opts.targetUPN } : {}),
    ...(opts.targetObjectId ? { targetObjectId: opts.targetObjectId } : {}),
    approvalId: opts.approvalId,
    timestamp: evidence.metadata.timestamp,
    preStateOutput: evidence.metadata.preStateOutput,
    postStateOutput: evidence.metadata.postStateOutput,
    verdict: evidence.complianceVerdict ?? 'NOT_APPLICABLE',
    verdictRationale: evidence.verdictRationale,
    sha256: evidence.metadata.sha256Hash,
  };
}

// ─── Evidence artifact builder ───────────────────────────────────

export interface EvidenceArtifactOptions {
  dryRun: boolean;
  overrideOutcome?: EvidenceOutcome;
  /**
   * W4-AO5: true when the result is a READ (the read/evidence path, not get-then-set).
   * A live read that returns no data is never SAT — see isEmptyReadResult.
   */
  readOp?: boolean;
  /**
   * FC-AO-2 (X1): the get-then-set result of a WRITE — whether the set was sent and
   * whether the paired read observed a change (undefined when either snapshot is missing).
   */
  setApplied?: boolean;
  stateChanged?: boolean;
}

/**
 * FC-AO-2 (X1, founder decision 2026-09-27 #8): idempotency classes that mean the
 * write ALWAYS mutates state (Stamper IdempotencyGuard: "unsafe to re-run"). A write of
 * one of these classes whose paired read shows no change did not do its job, so it is
 * never SAT. Every other class (get-then-set, safe, evidence-only, best_effort) is
 * idempotent: an unchanged state can legitimately mean "already compliant", so it is
 * left as is.
 */
export const ALWAYS_MUTATE_IDEMPOTENCY_CLASSES: ReadonlySet<string> = new Set(['unsafe_requires_gate', 'unsafe']);

/** FC-AO-2 (X1): verdict rationale on an always-mutate write whose paired read shows no change. */
export const NO_OBSERVED_CHANGE_RATIONALE =
  'Write applied but its paired read shows no change, and this command always mutates state ' +
  '(idempotency class requires a change) — no observed effect cannot evidence compliance (NOT_SAT)';

/** W4-AO5: verdict rationale on a live read that returned no data. */
export const EMPTY_READ_RATIONALE =
  'Read returned no data — an empty or absent result cannot evidence compliance (NOT_SAT, not a positive determination)';

/** FX2-AO2: the success sentinel the Stamper session appends after every script. */
export const STAMPER_SUCCESS_SENTINEL = 'STAMPER_EXECUTION_SUCCESS';

/**
 * FX2-AO2: property names of a session/connection object. A PowerShell table or list is
 * a connect banner (e.g. Connect-IPPSSession's `Organization / ConnectionUri`) only when
 * ALL its columns/keys are connection fields AND at least one is DISTINCTIVE (appears only
 * on connection objects). Generic names (Name, Id, State, UserPrincipalName, ...) alone
 * never make a banner, so a real data table with those columns is kept.
 */
const CONNECTION_DISTINCTIVE_FIELDS = new Set(
  [
    'ConnectionUri', 'ConnectionId', 'ExchangeEnvironmentName', 'TokenStatus', 'ModulePrefix', 'IsEopSession',
    'ConnectionUsedForInbuiltCmdlets', 'AzureAdAuthorizationEndpointUri', 'DelegatedOrganization', 'ContextScope',
    'TokenCredentialType', 'AuthType',
  ].map((f) => f.toLowerCase())
);
const CONNECTION_FIELDS = new Set([
  ...CONNECTION_DISTINCTIVE_FIELDS,
  ...['Organization', 'UserPrincipalName', 'Id', 'Name', 'State', 'TenantID', 'AppId', 'ClientId', 'ModuleName',
    'Account', 'Environment', 'Scopes', 'CertificateThumbprint'].map((f) => f.toLowerCase()),
]);

function isConnectionKeySet(keys: string[]): boolean {
  const k = keys.map((x) => x.trim().toLowerCase());
  return k.length > 0 && k.every((x) => CONNECTION_FIELDS.has(x)) && k.some((x) => CONNECTION_DISTINCTIVE_FIELDS.has(x));
}

/** Graph SDK welcome lines (Connect-MgGraph without -NoWelcome). */
const GRAPH_WELCOME_LINE =
  /^\s*(Welcome to Microsoft Graph!?|Connected via (delegated|apponly|managedidentity) access using .*|Readme:\s*https?:\/\/\S+|SDK Docs:\s*https?:\/\/\S+|API Docs:\s*https?:\/\/\S+|NOTE: You can use the -NoWelcome parameter to suppress this message\.?)\s*$/i;

const DASH_RULE = /^\s*-{10,}\s*$/;
const TABLE_RULE = /^\s*-+(\s+-+)*\s*$/;

/**
 * FX2-AO2: remove known session/connection banners from PowerShell output so an
 * empty read is recognised even when the connect step printed something:
 *  - the Stamper success sentinel;
 *  - a table or list whose columns/keys are only connection fields (IPPS / Exchange
 *    Online connect objects);
 *  - the Exchange Online V3 module notice (the dashed "This V3 EXO PowerShell module" block);
 *  - the Microsoft Graph welcome text.
 * Anything else — including tables with any non-connection column — is kept.
 */
export function stripSessionBanners(text: string): string {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === STAMPER_SUCCESS_SENTINEL || GRAPH_WELCOME_LINE.test(line)) {
      i++;
      continue;
    }

    // EXO V3 notice: a dashed rule ... dashed rule block that mentions the EXO module.
    if (DASH_RULE.test(line)) {
      let j = i + 1;
      while (j < lines.length && !DASH_RULE.test(lines[j])) j++;
      if (j < lines.length) {
        const block = lines.slice(i + 1, j).join('\n');
        if (/EXO (V3 )?PowerShell module|V3 EXO|aka\.ms\/exov3/i.test(block)) {
          i = j + 1;
          continue;
        }
      }
    }

    // Table: header of connection columns, a dash rule, then rows up to a blank line.
    if (trimmed && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].trim()) {
      const cols = trimmed.split(/\s+/);
      if (isConnectionKeySet(cols)) {
        // FC-AO-2: consume only the table's own ROWS. Output a script writes straight after the
        // connect object (e.g. D-02's `| ConvertTo-Json` strings) follows the rows with no blank
        // line; it is not a table row — a row never starts a JSON value and never runs past the
        // table width (Format-Table fits rows to the header/rule width).
        // Width = the header/rule as rendered, padding included (Format-Table pads them to the table width).
        const width = Math.max(lines[i].length, lines[i + 1].length);
        const isRow = (l: string) => {
          const t = l.trim();
          return t !== '' && !/^[[{]/.test(t) && l.trimEnd().length <= width;
        };
        let j = i + 2;
        while (j < lines.length && isRow(lines[j])) j++;
        i = j;
        continue;
      }
    }

    // List (Format-List): a contiguous "Key : value" block whose keys are all connection fields.
    if (/^\s*[A-Za-z][\w]*\s*:\s/.test(line) || /^\s*[A-Za-z][\w]*\s*:\s*$/.test(line)) {
      let j = i;
      const keys: string[] = [];
      while (j < lines.length && lines[j].trim() !== '' && /^\s*([A-Za-z][\w]*)\s*:/.test(lines[j])) {
        keys.push(/^\s*([A-Za-z][\w]*)\s*:/.exec(lines[j])![1]);
        j++;
      }
      if (keys.length >= 2 && isConnectionKeySet(keys) && (j >= lines.length || lines[j].trim() === '')) {
        i = j;
        continue;
      }
    }

    out.push(line);
    i++;
  }
  return out.join('\n');
}

/**
 * FC-AO-2 step 3 (E-06, founder decision 2026-09-27 #9): "a count of 0 is an empty read".
 * True when the (banner-stripped) output is ONLY `Measure-Object | Select-Object Count`
 * results that are all zero — a single-column `Count` table (`Count / ----- / 0`, further
 * objects of the same pipeline render as more value rows or as blank rows) and/or the list
 * form `Count : 0`. A non-zero count, or any other column/line, is data.
 */
export function isZeroCountOnly(text: string): boolean {
  const lines = String(text ?? '')
    .split(/\r?\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (lines.length === 0) return false;
  let i = 0;
  let blocks = 0;
  while (i < lines.length) {
    if (/^count$/i.test(lines[i]) && i + 1 < lines.length && /^-+$/.test(lines[i + 1])) {
      let j = i + 2;
      let values = 0;
      while (j < lines.length && /^\d+$/.test(lines[j])) {
        if (Number(lines[j]) !== 0) return false;
        values++;
        j++;
      }
      if (values === 0) return false;
      blocks++;
      i = j;
      continue;
    }
    const m = /^count\s*:\s*(\d+)$/i.exec(lines[i]);
    if (m) {
      if (Number(m[1]) !== 0) return false;
      blocks++;
      i++;
      continue;
    }
    return false;
  }
  return blocks > 0;
}

/** FC-AO-2 (E-06): a JSON `{ "Count": 0 }` (or an array of only such objects) is a zero count too. */
function isZeroCountJson(parsed: unknown): boolean {
  const zero = (o: unknown) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    const keys = Object.keys(o as Record<string, unknown>);
    return keys.length === 1 && keys[0].toLowerCase() === 'count' && Number((o as Record<string, unknown>)[keys[0]]) === 0;
  };
  if (Array.isArray(parsed)) return parsed.length > 0 && parsed.every(zero);
  return zero(parsed);
}

/**
 * W4-AO5 (P0, score integrity): does a read's raw output carry no data?
 * Empty/whitespace output, and JSON that is null, "", [], {}, or a Graph-style
 * collection whose `value` array is empty; FC-AO-2 (E-06): only zero counts.
 * Deliberately conservative: an empty list that might mean "no violations found"
 * is still NOT evidence of compliance.
 */
export function isEmptyReadResult(stdout: string | undefined | null): boolean {
  // FX2-AO2: decide on the output with session/connection noise removed. rawResponse
  // itself is never modified — this only feeds the emptiness decision.
  const text = stripSessionBanners(stdout ?? '').trim();
  if (text === '') return true;
  // FC-AO-2 (E-06): a count of zero carries no data.
  if (isZeroCountOnly(text)) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false; // non-JSON text is data
  }
  if (parsed === null || parsed === '') return true;
  if (isZeroCountJson(parsed)) return true;
  if (Array.isArray(parsed)) return parsed.length === 0;
  if (typeof parsed === 'object') {
    const keys = Object.keys(parsed as Record<string, unknown>);
    if (keys.length === 0) return true;
    const value = (parsed as Record<string, unknown>).value;
    const meta = keys.filter((k) => k !== 'value' && !k.startsWith('@odata.'));
    if (Array.isArray(value) && value.length === 0 && meta.length === 0) return true;
  }
  return false;
}

export function buildEvidenceArtifact(
  aoCommand: AoCommand,
  executionResult: ExecutionResult,
  commandEntry: CommandEntry,
  variables: Record<string, any> = {},
  opts: EvidenceArtifactOptions
): StructuredEvidence {
  const rawResponse = executionResult.stdout || '';
  const exitCode = executionResult.exit_code ?? 0;
  const stderr = executionResult.stderr || '';
  const controlIds = aoCommand.cmmcPractices;
  const rawCommand = commandEntry.set_command || commandEntry.get_command || commandEntry.label;
  const commandExecuted = resolvePlaceholders(rawCommand, variables);
  const executorIdentity = 'cse-ao-service';

  const evidence = buildStructuredEvidence(
    rawResponse,
    exitCode,
    stderr,
    controlIds,
    commandExecuted,
    executorIdentity
  );

  evidence.metadata.dryRun = !!opts.dryRun;
  evidence.metadata.mode = opts.dryRun ? 'dry_run' : 'live';

  if (opts.overrideOutcome) {
    evidence.outcome = opts.overrideOutcome;
    evidence.outcomeRationale =
      opts.overrideOutcome === 'dry_run'
        ? 'Dry-run preview — no state change, no compliance determination'
        : opts.overrideOutcome === 'denied_cmmc'
          ? 'Command denied by CMMC scope gate — enforcement evidence'
          : opts.overrideOutcome === 'denied_cui'
            ? 'Command denied by CUI boundary — enforcement evidence'
            : opts.overrideOutcome === 'denied_sim_only'
            ? 'Command refused by the sim-only safety rail — enforcement evidence'
            : opts.overrideOutcome === 'denied_apply_guard'
            ? 'Live apply refused by the web apply guard (no confirmApply) — enforcement evidence'
            : opts.overrideOutcome === 'blocked_pending_approval'
              ? 'Command blocked — awaiting second-person approval'
              : opts.overrideOutcome === 'approval_rejected'
                ? 'Approval request rejected by approver'
                : `Override outcome: ${opts.overrideOutcome}`;
    evidence.complianceVerdict = 'NOT_APPLICABLE';
    evidence.verdictRationale =
      opts.overrideOutcome === 'dry_run'
        ? 'A dry-run preview is not a compliance determination'
        : 'This outcome is not a compliance determination';
    delete evidence.failureDiagnostics;
  } else if (opts.dryRun) {
    evidence.outcome = 'dry_run';
    evidence.outcomeRationale = 'Dry-run preview — no state change, no compliance determination';
    evidence.complianceVerdict = 'NOT_APPLICABLE';
    evidence.verdictRationale = 'A dry-run preview is not a compliance determination';
    delete evidence.failureDiagnostics;
  } else if (opts.readOp && evidence.complianceVerdict === 'SAT' && isEmptyReadResult(rawResponse)) {
    // W4-AO5: a live read with no data must never be SAT (the command ran, so the
    // contract outcome stays `executed`; EvidenceOps credits only SAT rows).
    evidence.complianceVerdict = 'NOT_SAT';
    evidence.verdictRationale = EMPTY_READ_RATIONALE;
  } else if (
    evidence.complianceVerdict === 'SAT' &&
    opts.setApplied === true &&
    opts.stateChanged === false &&
    ALWAYS_MUTATE_IDEMPOTENCY_CLASSES.has(String(commandEntry.idempotency ?? ''))
  ) {
    // FC-AO-2 (X1): an always-mutate write that changed nothing its read observes is not
    // evidence of compliance. `stateChanged === undefined` (a snapshot is missing) is NOT
    // "no change" and is left alone; idempotent classes are left alone by decision.
    evidence.complianceVerdict = 'NOT_SAT';
    evidence.verdictRationale = NO_OBSERVED_CHANGE_RATIONALE;
  }

  return evidence;
}

// ─── Persistence ─────────────────────────────────────────────────

export interface EvidencePersistenceOptions {
  commandId: string;
  tenantId: string;
  executionId: string;
  domain: string;
  tenantSlug?: string;
  tenantKind?: string;
  requestorUPN?: string;
  approverUPN?: string;
  approvalId?: string;
  correlationId?: string;
  /** FX-AO6 / contract 1.3.0: target user UPN (see TargetIdentity.resolveTargetIdentity). */
  targetUPN?: string;
  /** FX-AO6 / contract 1.3.0: target user object id, when the parameters carry one. */
  targetObjectId?: string;
}

export interface EvidencePersistenceResult {
  evidencePath: string;
  metadataPath: string;
  skipped: boolean;
  evidencePersisted: boolean;
  evidenceError?: string;
}

/** FX-AO3: error-level log prefix written whenever an evidence row fails to persist. */
export const EVIDENCE_LOST_LOG_PREFIX = '[EvidenceEmitter] EVIDENCE NOT PERSISTED:';

/** FX-AO3: operator-facing warning carried on API responses when evidence was lost. */
export function evidenceLostWarning(evidenceError?: string): string {
  return (
    'EVIDENCE NOT PERSISTED: this action has no audit evidence row' +
    (evidenceError ? ` (${evidenceError})` : '') +
    '. Do not treat it as recorded; re-run once persistence is restored.'
  );
}

/** Generate a collision-proof UUID execution ID (AE-R3). */
export function generateExecutionId(): string {
  return randomUUID();
}

export async function persistEvidenceArtifact(
  evidence: StructuredEvidence,
  opts: EvidencePersistenceOptions
): Promise<EvidencePersistenceResult> {
  const recordId = `${opts.commandId}:${opts.executionId}`;
  const locator = `${AO_EVIDENCE_COLLECTION}/${recordId}`;

  try {
    const repo = getCesRepository();
    const scope = { tenantId: opts.tenantId };

    if (repo.get(AO_EVIDENCE_COLLECTION, recordId, scope)) {
      return { evidencePath: locator, metadataPath: locator, skipped: true, evidencePersisted: true };
    }

    const ces = resolveCesIdentity(loadCesConfig(), { tenantId: opts.tenantId });
    // A4 (AE-R2): the persisted `data.metadata` IS the contract row — exactly
    // toContractRow() output (current ADMINOPS_EVIDENCE_CONTRACT_VERSION), nothing more, so ces-eo can parse it
    // with AdminOpsEvidenceSchema unchanged. AO-private fields live elsewhere:
    //   executionId → the record id (`${commandId}:${executionId}`)
    //   executorIdentity, sha256Hash, local outcome, complianceVerdict → data.evidence
    //   CES identity (incl. customerName, which CesRecord columns drop) → data.ces
    const metadata = toContractRow(evidence, opts);

    repo.put(AO_EVIDENCE_COLLECTION, { id: recordId, ces, data: { evidence, metadata, ces } });
    return { evidencePath: locator, metadataPath: locator, skipped: false, evidencePersisted: true };
  } catch (err: any) {
    const evidenceError = err?.message ?? 'Unknown persistence failure';
    // FX-AO3: lost evidence is never silent. One choke point covers the executor, the
    // approval store (rejections), the CLI and MCP. Stable prefix for log search.
    console.error(
      `${EVIDENCE_LOST_LOG_PREFIX} command ${opts.commandId} (execution ${opts.executionId}, ` +
        `tenant ${opts.tenantId}, outcome ${evidence.outcome ?? 'unknown'}): ${evidenceError}`
    );
    return {
      evidencePath: locator,
      metadataPath: locator,
      skipped: false,
      evidencePersisted: false,
      evidenceError,
    };
  }
}
