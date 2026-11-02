// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AssessmentSource, AssessmentSnapshot } from 'ces-shared/types/controls';
import type { DirectiveMetadata } from 'ces-shared/types/evidence';
import type { ExtendedDirectiveMetadata } from '../../shared/types/directive.types.js';
import { isValidDirective, toExtendedDirectiveMetadata } from '../../shared/types/directive.types.js';
import { RenderDirectiveSchema } from '../../shared/types/render.types.js';
import type { RenderDirective } from '../../shared/types/render.types.js';
import { getStamperTenantRoot } from 'ces-shared/storage/node';
import { stamperRecordAssignmentState, UNASSIGNED_SENTENCE, type AssignmentState } from '../mapping/evaluators/assignments.js';

export interface StamperEvidence {
  complianceVerdict: string;
  sha256Hash: string;
  timestamp: string;
  controlIds: string[];
  entryId: string;
  label: string;
  directiveMetadata?: DirectiveMetadata;
  renderDirective?: RenderDirective;
  evidenceFilePath?: string;
  /** W1.1: metadata.commandExecuted as Stamper wrote it. */
  commandExecuted?: string;
  /**
   * W1.1 / B8: 'evidence-only' when commandExecuted carries Stamper's '[manual/evidence-only]'
   * prefix (the verdict rests on the command's exit code, not on a read of tenant state);
   * otherwise 'state-verified' (absent is read as 'state-verified').
   */
  mode?: 'state-verified' | 'evidence-only';
  /** outcomeRationale as Stamper wrote it (W1.0 reads it for the HTTP 404 signature). */
  outcomeRationale?: string;
  /** Run id on the record (metadata.runId or runId), when Stamper writes one. */
  runId?: string;
  /** W0.2a: true when the record's rawResponse is empty (no payload behind the verdict). */
  payloadEmpty?: boolean;
  /** W0.2c: metadata.executorIdentity as Stamper wrote it. */
  executorIdentity?: string;
  /**
   * W5 cycle 3: for a record that reads or writes an assignable Intune object, the object's assignment
   * state as the payload shows it (undefined for any other record).
   */
  assignment?: AssignmentState;
  /**
   * FIN-10 (FD-2): set when the record is a Stamper manual-gate record (`metadata.gate: 'manual'`,
   * written by the GUI execute route and by the CLI's buildManualGateEvidence): the operator action
   * (`metadata.gateAction`) and the owner role. Undefined for any other record.
   */
  gate?: { action: 'approved' | 'rejected' | 'none'; ownerRole?: string };
  /**
   * PH7-EO: 'manual_gate' when Stamper wrote the record while running a manual_gate task's runnable
   * sub-commands (`metadata.gateContext: 'manual_gate'`, P7-ST). Display only (MANUAL_GATE_DISPLAY_ONLY).
   */
  gateContext?: 'manual_gate';
}

/**
 * FIN-10 (FD-2): the non-stack set, the 28 controls no tenant setting can prove (AUDIT-NONSTACK.md
 * §1, functional audit 2026-10-31): the 25 controls in which every objective of
 * ces-shared/data/assessor-evidence-matrix has no `stack_signal` evidence row, plus AT.L2-3.2.1,
 * AT.L2-3.2.3 and PS.L2-3.9.2, which the records stores decide (NS-3b). A test recomputes it from the
 * reference data. A manual-gate record never credits one of these controls.
 */
export const NON_STACK_CONTROL_IDS: ReadonlySet<string> = new Set([
  'AT.L2-3.2.1', 'AT.L2-3.2.2', 'AT.L2-3.2.3',
  'AU.L2-3.3.8', 'AU.L2-3.3.9',
  'CA.L2-3.12.1', 'CA.L2-3.12.2', 'CA.L2-3.12.3', 'CA.L2-3.12.4',
  'CM.L2-3.4.4',
  'IR.L2-3.6.2', 'IR.L2-3.6.3',
  'MA.L2-3.7.1', 'MA.L2-3.7.2', 'MA.L2-3.7.3', 'MA.L2-3.7.6',
  'MP.L1-3.8.3', 'MP.L2-3.8.4', 'MP.L2-3.8.9',
  'PE.L1-3.10.1', 'PE.L2-3.10.2', 'PE.L1-3.10.3', 'PE.L1-3.10.4', 'PE.L1-3.10.5', 'PE.L2-3.10.6',
  'PS.L2-3.9.1', 'PS.L2-3.9.2',
  'RA.L2-3.11.1',
]);

/**
 * FIN-10 (FD-2): detail suffix of a manual-gate approval on a non-stack control. The source is
 * `no_query` (no opinion): it is pending_review and ranks below GD-b, so only GD-b document reviews
 * or the records stores decide the control.
 */
export const GATE_PENDING_REVIEW = 'manual-gate approval; pending_review: a gate approval never credits a non-stack control (FD-2)';

/**
 * FIN-10: detail suffix of a manual-gate record with no operator action (PROVISIONAL). It is no
 * opinion: Stamper itself records it "pending review by the owner role", never SAT and never NOT_SAT.
 */
export const GATE_NO_ACTION = 'manual gate with no operator action (PROVISIONAL); not counted';

/** FIN-10: true for a manual-gate approval source on a non-stack control (see GATE_PENDING_REVIEW). */
export function isGatePendingReviewSource(s: AssessmentSource): boolean {
  return s.type === 'evidence_import' && s.result === 'no_query' && s.detail.endsWith(`(${GATE_PENDING_REVIEW})`);
}

/** FIN-10: the manual-gate fields of a parsed Stamper evidence document, or undefined. */
export function manualGateOf(parsed: unknown): StamperEvidence['gate'] {
  const md = (parsed as { metadata?: Record<string, unknown> } | null)?.metadata;
  if (!md || md.gate !== 'manual') return undefined;
  const action = md.gateAction === 'approved' || md.gateAction === 'rejected' ? md.gateAction : 'none';
  return { action, ...(typeof md.ownerRole === 'string' && md.ownerRole !== '' ? { ownerRole: md.ownerRole } : {}) };
}

/**
 * PH7-EO (orchestrator decision, option a): detail suffix of a record Stamper wrote inside a manual gate
 * (`metadata.gateContext: 'manual_gate'`). The record is shown in the SSP evidence index and is no opinion
 * on any control, whatever its verdict: credit comes only through the gate review (GD-b).
 */
export const MANUAL_GATE_DISPLAY_ONLY = 'manual-gate run record; display only, never credits: credit comes only through the gate review (GD-b)';

/** PH7-EO: 'manual_gate' when a parsed Stamper evidence document carries `metadata.gateContext: 'manual_gate'`. */
export function gateContextOf(parsed: unknown): StamperEvidence['gateContext'] {
  const md = (parsed as { metadata?: Record<string, unknown> } | null)?.metadata;
  return md?.gateContext === 'manual_gate' ? 'manual_gate' : undefined;
}

/** W1.1: which Stamper evidence files belong to the current run. */
export interface CurrentRunFilter {
  /** Keep a record that carries a run id only when it equals this one. */
  runId?: string;
  /** For a record without a run id, keep it only when metadata.timestamp >= this ISO instant. */
  executionStart?: string;
}

/** B8: label appended to the detail of an evidence-only SAT source. */
export const STATE_NOT_VERIFIED = 'state not verified';

const EVIDENCE_ONLY_PREFIX = '[manual/evidence-only]';
const HTTP_404_RE = /\(404\)/;

/** W0.2a: detail suffix of a SAT source whose file has an empty rawResponse (not counted). */
export const EMPTY_PAYLOAD = 'SAT on an empty payload; not counted';

/**
 * W5 cycle 2: an evidence-only NOT_SAT on an empty payload is no opinion (unread / errored / empty /
 * 404 = no opinion): never Tier 1, never a positive. Detail suffix of such a source.
 */
export const EMPTY_READ_UNCOUNTED = 'empty read, uncounted';

/**
 * W5 cycle 3: a SAT on an Intune object whose payload carries no assignment information is no opinion
 * (an object acts on no device or user until it is assigned). Detail suffix of such a source.
 */
export const INTUNE_ASSIGNMENT_UNREAD = 'SAT on an Intune object read without assignment information; not counted';

/**
 * W5 cycle 3: a SAT on an Intune object that is explicitly unassigned is a negative, but not a failed
 * Stamper task: it ranks Tier 3 (state-verified), never Tier 1. Detail suffix of such a source.
 */
export const INTUNE_UNASSIGNED = `SAT, but the Intune object was ${UNASSIGNED_SENTENCE}`;

/** True for an evidence_import source built from a SAT on an explicitly unassigned Intune object. */
export function isUnassignedObjectSource(s: AssessmentSource): boolean {
  return s.type === 'evidence_import' && s.result === 'missing' && s.detail.endsWith(`(${INTUNE_UNASSIGNED})`);
}

/** W0.2c: an executor identity in Stamper's `stamper/<version>@<ClientId>` shape. */
const EXECUTOR_IDENTITY_RE = /^stamper\/[^\s@\]]+@[^\s\]]+$/;
const EXECUTOR_IN_DETAIL_RE = /\[executor (stamper\/[^\s@\]]+@[^\s\]]+)\]/;

/**
 * W5 cycle 2: a NOT_SAT evidence_import source also carries the registry entry id and Stamper's
 * outcomeRationale, so a Tier 1 finding can name the entry (ledger, SSP, POA&M). `detail` is unchanged.
 */
export interface StamperNotSatSource extends AssessmentSource {
  entryId: string;
  outcomeRationale: string;
}

export function isStamperNotSatSource(s: AssessmentSource): s is StamperNotSatSource {
  return s.type === 'evidence_import' && s.result === 'missing' && typeof (s as Partial<StamperNotSatSource>).entryId === 'string';
}

/** True for an evidence_import source built from an evidence-only SAT file (B8). */
export function isStateNotVerifiedSource(s: AssessmentSource): boolean {
  return s.type === 'evidence_import' && s.result === 'imported' && s.detail.endsWith(`(${STATE_NOT_VERIFIED})`);
}

/**
 * W0.2a: a payload is empty when rawResponse is absent, blank, or a JSON null / empty array /
 * empty object / empty string. Such a record proves nothing about tenant state.
 */
export function isEmptyPayload(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true;
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t === '' || t === 'null' || t === '[]' || t === '{}' || t === '""';
  }
  if (Array.isArray(raw)) return raw.length === 0;
  if (typeof raw === 'object') return Object.keys(raw as object).length === 0;
  return false;
}

/**
 * W5 cycle 2: a Graph list envelope with no rows (`{ "value": [] }`, object or JSON text; `@odata.*`
 * keys ignored). Empty for an evidence-only entry, whose payload is the list it read.
 */
export function isEmptyValueList(raw: unknown): boolean {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return false; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v as object).filter(k => !k.startsWith('@odata.'));
  return keys.length === 1 && keys[0] === 'value' && Array.isArray((v as { value: unknown }).value) && (v as { value: unknown[] }).value.length === 0;
}

/** W0.2c: the Stamper executor identity carried in an evidence_import source's detail, if any. */
export function executorIdentityOf(s: AssessmentSource): string | undefined {
  if (s.type !== 'evidence_import') return undefined;
  return EXECUTOR_IN_DETAIL_RE.exec(s.detail)?.[1];
}

function isCurrentRun(recordRunId: string | undefined, timestamp: string, filter: CurrentRunFilter | undefined): boolean {
  if (!filter) return true;
  if (filter.runId && recordRunId) return recordRunId === filter.runId;
  if (filter.executionStart) {
    const t = Date.parse(timestamp);
    return Number.isFinite(t) && t >= Date.parse(filter.executionStart);
  }
  return true;
}

export class StamperEvidenceLoader {
  private readonly evidenceDir: string;

  constructor(tenantSlug: string) {
    this.evidenceDir = path.join(getStamperTenantRoot(tenantSlug), 'evidence');
  }

  /**
   * Scan plan-data/{slug}/evidence/**\/*.json and parse each file into StamperEvidence.
   * Returns empty array if evidence directory does not exist.
   * W1.1: with `currentRun`, files from another run are skipped (run id when the record carries
   * one, else metadata.timestamp >= executionStart). Without it every file is read.
   */
  loadEvidenceForTenant(currentRun?: CurrentRunFilter): StamperEvidence[] {
    if (!fs.existsSync(this.evidenceDir)) {
      return [];
    }

    const results: StamperEvidence[] = [];

    let files: string[];
    try {
      files = fs.readdirSync(this.evidenceDir, { recursive: true }) as string[];
    } catch {
      return [];
    }

    for (const relPath of files) {
      const normalized = String(relPath).replace(/\\/g, '/');
      if (!normalized.endsWith('.json')) continue;

      const fullPath = path.join(this.evidenceDir, String(relPath));

      try {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const parsed = JSON.parse(raw);

        const controlIds: string[] = parsed.metadata?.controlIds;
        if (!controlIds || !Array.isArray(controlIds) || controlIds.length === 0) {
          continue;
        }

        const verdict: string = parsed.complianceVerdict ?? '';
        const sha256Hash: string = parsed.metadata?.sha256Hash ?? '';
        const timestamp: string = parsed.metadata?.timestamp ?? '';
        const entryId: string = parsed.registryEntry?.entry_id ?? path.basename(fullPath, '.json');
        const label: string = parsed.registryEntry?.label ?? entryId;
        const recordRunId: string | undefined = parsed.metadata?.runId ?? parsed.runId ?? undefined;
        if (!isCurrentRun(recordRunId, timestamp, currentRun)) continue;
        const commandExecuted: string = parsed.metadata?.commandExecuted ?? '';
        const mode: 'state-verified' | 'evidence-only' =
          commandExecuted.startsWith(EVIDENCE_ONLY_PREFIX) ? 'evidence-only' : 'state-verified';
        const outcomeRationale: string = parsed.outcomeRationale ?? '';
        const executorIdentity: string = parsed.metadata?.executorIdentity ?? '';
        // W5 cycle 3: an evidence-only record's commandExecuted is only its label; the embedded registry
        // entry's get / set / evidence commands name the Intune read it made.
        const re = parsed.registryEntry ?? {};
        const commands = [commandExecuted, re.get_command, re.set_command, ...(Array.isArray(re.evidence_commands) ? re.evidence_commands : [])]
          .filter((c: unknown): c is string => typeof c === 'string' && c !== '').join(' ; ');
        const assignment = stamperRecordAssignmentState(commands, parsed.rawResponse);
        const gate = manualGateOf(parsed);
        const gateContext = gateContextOf(parsed);

        // Parse optional directiveMetadata block
        const rawDm = parsed.directiveMetadata;
        const directiveMetadata: DirectiveMetadata | undefined =
          rawDm && typeof rawDm === 'object' && typeof rawDm.directive === 'string'
            ? {
                control_id: String(rawDm.control_id ?? ''),
                directive: String(rawDm.directive),
                readiness: String(rawDm.readiness ?? 'unknown'),
                platform_inherited: Boolean(rawDm.platform_inherited),
                enforcement_verified: Boolean(rawDm.enforcement_verified),
                narrative_stub: String(rawDm.narrative_stub ?? ''),
                reasoning_trace: String(rawDm.reasoning_trace ?? ''),
                evidence_artifacts: Array.isArray(rawDm.evidence_artifacts)
                  ? rawDm.evidence_artifacts.map(String)
                  : [],
              }
            : undefined;

        // Parse optional eo_render_directive block using Zod schema
        let renderDirective: RenderDirective | undefined;
        const rawRd = parsed.eo_render_directive;
        if (rawRd && typeof rawRd === 'object') {
          const rdResult = RenderDirectiveSchema.safeParse(rawRd);
          if (rdResult.success) {
            renderDirective = rdResult.data;
          } else {
            console.warn(
              `[StamperEvidenceLoader] Invalid eo_render_directive in ${normalized}: ` +
              rdResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
            );
          }
        }

        results.push({
          complianceVerdict: verdict,
          sha256Hash,
          timestamp,
          controlIds,
          entryId,
          label,
          directiveMetadata,
          renderDirective,
          evidenceFilePath: fullPath,
          commandExecuted,
          mode,
          outcomeRationale,
          ...(recordRunId ? { runId: String(recordRunId) } : {}),
          payloadEmpty: isEmptyPayload(parsed.rawResponse) || (mode === 'evidence-only' && isEmptyValueList(parsed.rawResponse)),
          ...(executorIdentity ? { executorIdentity: String(executorIdentity) } : {}),
          ...(assignment ? { assignment } : {}),
          ...(gate ? { gate } : {}),
          ...(gateContext ? { gateContext } : {}),
        });
      } catch {
        // Skip malformed JSON files
      }
    }

    return results;
  }

  /**
   * Convert StamperEvidence[] to Map<controlId, AssessmentSource[]>.
   * SAT -> result='imported' (an evidence-only SAT is labelled "state not verified", B8);
   * NOT_SAT -> result='missing', except a NOT_SAT whose command got an HTTP 404 -> 'no_query'
   * (W1.0: the object could not be read, which is not a negative finding).
   * W0.2a: a SAT counts only when its rawResponse is non-empty, evidence-only records included;
   * an empty one becomes 'no_query' ("SAT on an empty payload; not counted").
   * W5 cycle 2: an evidence-only NOT_SAT on an empty payload (empty rawResponse, or `value: []`) is
   * 'no_query' too ("empty read, uncounted"). A state-verified NOT_SAT (a failed set or state
   * postcheck) stays 'missing' (Tier 1) whatever its payload, as does a non-empty evidence-only NOT_SAT.
   * W5 cycle 3: a SAT on an assignable Intune object counts only when the payload shows an assignment:
   * no assignment information -> 'no_query' (INTUNE_ASSIGNMENT_UNREAD); explicitly unassigned ->
   * 'missing' labelled INTUNE_UNASSIGNED, which ranks Tier 3, not Tier 1 (isUnassignedObjectSource).
   * W0.2c: a `stamper/<version>@<ClientId>` executor identity is carried in the detail as
   * "[executor ...]" (read back by executorIdentityOf for the ledger's provenance).
   * FIN-10 (FD-2), manual-gate records (`ev.gate`), decided per control:
   * - approved, on a non-stack control (NON_STACK_CONTROL_IDS) -> 'no_query', GATE_PENDING_REVIEW:
   *   pending_review, ranked below GD-b; the gate record never decides the control.
   * - approved, on a stack control -> unchanged (Tier 3, or Tier 4 when evidence-only).
   * - no operator action (PROVISIONAL) -> 'no_query', GATE_NO_ACTION, on every control (before
   *   FIN-10 it fell through to 'missing', a Tier 1 not_met).
   * - rejected (NOT_SAT) -> unchanged: 'missing' (an operator's negative never credits).
   * The CLI writes its gate records to `<slug>/evidence-by-task/<task>/manual-gate.json`, a sibling
   * of the evidence folder this loader scans, so they never reach EO at all.
   * PH7-EO: a record run inside a manual gate (`ev.gateContext === 'manual_gate'`) is checked first:
   * 'no_query', MANUAL_GATE_DISPLAY_ONLY, on every control, for any verdict (SAT and NOT_SAT alike).
   */
  toAssessmentSources(evidence: StamperEvidence[]): Map<string, AssessmentSource[]> {
    const map = new Map<string, AssessmentSource[]>();
    const add = (controlId: string, source: AssessmentSource) => {
      const existing = map.get(controlId);
      if (existing) existing.push(source); else map.set(controlId, [source]);
    };

    for (let ev of evidence) {
      if (ev.gateContext === 'manual_gate') {
        const label = ev.executorIdentity && EXECUTOR_IDENTITY_RE.test(ev.executorIdentity)
          ? `${ev.label} [executor ${ev.executorIdentity}]`
          : ev.label;
        for (const controlId of ev.controlIds) add(controlId, { type: 'evidence_import', timestamp: ev.timestamp, detail: `${label} (${MANUAL_GATE_DISPLAY_ONLY})`, result: 'no_query' });
        continue;
      }
      if (ev.gate && ev.gate.action !== 'rejected') {
        const label = ev.executorIdentity && EXECUTOR_IDENTITY_RE.test(ev.executorIdentity)
          ? `${ev.label} [executor ${ev.executorIdentity}]`
          : ev.label;
        const approved = ev.gate.action === 'approved' && ev.complianceVerdict === 'SAT';
        const stackControls: string[] = [];
        for (const controlId of ev.controlIds) {
          if (!approved) add(controlId, { type: 'evidence_import', timestamp: ev.timestamp, detail: `${label} (${GATE_NO_ACTION})`, result: 'no_query' });
          else if (NON_STACK_CONTROL_IDS.has(controlId)) add(controlId, { type: 'evidence_import', timestamp: ev.timestamp, detail: `${label} (${GATE_PENDING_REVIEW})`, result: 'no_query' });
          else stackControls.push(controlId);
        }
        if (stackControls.length === 0) continue;
        // An approved gate on stack controls: the ordinary SAT path below, for those controls only.
        ev = { ...ev, controlIds: stackControls };
      }
      let result: AssessmentSource['result'];
      const label = ev.executorIdentity && EXECUTOR_IDENTITY_RE.test(ev.executorIdentity)
        ? `${ev.label} [executor ${ev.executorIdentity}]`
        : ev.label;
      let detail = label;
      if (ev.complianceVerdict === 'SAT' && ev.payloadEmpty) {
        result = 'no_query';
        detail = `${label} (${EMPTY_PAYLOAD})`;
      } else if (ev.complianceVerdict === 'SAT' && ev.assignment === 'unknown') {
        result = 'no_query';
        detail = `${label} (${INTUNE_ASSIGNMENT_UNREAD})`;
      } else if (ev.complianceVerdict === 'SAT' && ev.assignment === 'unassigned') {
        result = 'missing';
        detail = `${label} (${INTUNE_UNASSIGNED})`;
      } else if (ev.complianceVerdict === 'SAT') {
        result = 'imported';
        if (ev.mode === 'evidence-only') detail = `${label} (${STATE_NOT_VERIFIED})`;
      } else if (HTTP_404_RE.test(ev.outcomeRationale ?? '')) {
        result = 'no_query';
        detail = `${label} (Stamper command got HTTP 404; not read, not assessed)`;
      } else if (ev.payloadEmpty && ev.mode === 'evidence-only') {
        result = 'no_query';
        detail = `${label} (NOT_SAT on an empty payload; ${EMPTY_READ_UNCOUNTED}${ev.outcomeRationale ? `: ${ev.outcomeRationale}` : ''})`;
      } else {
        result = 'missing';
      }

      const source: AssessmentSource = {
        type: 'evidence_import',
        timestamp: ev.timestamp,
        detail,
        result,
        ...(result === 'missing' && ev.complianceVerdict !== 'SAT' ? { entryId: ev.entryId, outcomeRationale: ev.outcomeRationale ?? '' } : {}),
      };

      for (const controlId of ev.controlIds) add(controlId, source);
    }

    return map;
  }

  /**
   * Build a Map<controlId, DirectiveMetadata> from evidence that carries directive provenance.
   * First-write-wins per controlId (earlier evidence file takes priority).
   */
  toDirectiveMetadataMap(evidence: StamperEvidence[]): Map<string, DirectiveMetadata> {
    const map = new Map<string, DirectiveMetadata>();

    for (const ev of evidence) {
      if (!ev.directiveMetadata) continue;
      for (const controlId of ev.controlIds) {
        if (!map.has(controlId)) {
          map.set(controlId, ev.directiveMetadata);
        }
      }
    }

    return map;
  }

  /**
   * Load directive metadata for a single control from already-loaded evidence.
   * Validates the directive value and returns an ExtendedDirectiveMetadata or null.
   * Throws on invalid directive values.
   */
  loadDirectiveMetadata(controlId: string, evidence: StamperEvidence[]): ExtendedDirectiveMetadata | null {
    for (const ev of evidence) {
      if (!ev.directiveMetadata) continue;
      if (!ev.controlIds.includes(controlId)) continue;

      const raw = ev.directiveMetadata as unknown as Record<string, unknown>;
      if (!raw.directive || typeof raw.directive !== 'string') {
        console.warn(`[StamperEvidenceLoader] Missing directive_metadata for control ${controlId}`);
        return null;
      }

      if (!isValidDirective(raw.directive as string)) {
        throw new Error(
          `Invalid directive value '${raw.directive}' for control ${controlId}. ` +
          `Valid values: implement, validate, manual, document-absence, document-prohibition, skip.`
        );
      }

      return toExtendedDirectiveMetadata(raw as { directive: string; readiness: string; [key: string]: unknown });
    }

    // No evidence with directive metadata found for this control
    return null;
  }

  /**
   * Enrich an AssessmentSnapshot's controls with extended directive metadata.
   * Iterates controls, calls loadDirectiveMetadata() for each, and attaches
   * the result to the control's directiveMetadata field.
   * Accumulates and logs warnings for controls missing directive metadata.
   */
  enrichAssessmentWithDirectives(
    assessment: AssessmentSnapshot,
    evidence: StamperEvidence[]
  ): { enrichedCount: number; missingControls: string[] } {
    let enrichedCount = 0;
    const missingControls: string[] = [];

    for (const ctrl of assessment.controls) {
      try {
        const extended = this.loadDirectiveMetadata(ctrl.control_id, evidence);
        if (extended) {
          // Assign extended metadata back to the control record
          (ctrl as unknown as Record<string, unknown>).extendedDirectiveMetadata = extended;
          enrichedCount++;
        } else {
          missingControls.push(ctrl.control_id);
        }
      } catch (err) {
        // Invalid directive — propagate the error (halt on invalid per plan)
        throw err;
      }
    }

    if (missingControls.length > 0) {
      console.warn(
        `[StamperEvidenceLoader] ${missingControls.length} controls missing directive metadata. ` +
        `Fallback to existing assessment logic will be used.`
      );
    }

    return { enrichedCount, missingControls };
  }
}
