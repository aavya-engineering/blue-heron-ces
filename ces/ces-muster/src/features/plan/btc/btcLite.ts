// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// btcLite.ts — MG-09: Planner's BTC Confirmation built from discovery, through
// the VENDORED runlistEngine (the 9 activation rules), btcSICUIDerivation and
// btcOutputGenerator (gateEvaluator).
//
// Inputs, as Planner's BTCWizard assembles them:
//   siOutputs  — BTCWizard.tsx loadData (copied below, the only non-service step);
//   cuiOutputs — the CUI boundary's cui_boundary block (binding-keyed);
//   bank       — useBTCQuestions.ts / useActivationPackage.ts parse (copied below;
//                like Planner's it does not carry `recommended`, so no
//                recommendation is applied);
//   answers    — deriveBTCDefaults (operator_inference), then the discovery
//                verdict where btcEvidenceMap.json says the predicate reads the
//                question's fact (operator_inference), then the operator's
//                answers to the asked BTC nodes (client_assertion, wins);
//   evidence   — discovery captures (discoveryEvidence.ts). Planner's
//                seedDefaultEvidence placeholders are NOT seeded: a placeholder
//                is not evidence, so an evidence-required gate with no capture fails.
// Planner builds no BTC without a CUI boundary (BTCWizard); neither does this.
//
// The posture raise (Planner rrt/services/postureGenerator.ts ~27-50) is
// raisePostureWithEvidence below: a requirement whose captured evidence maps
// to it moves unknown -> partial with Planner's note.
import { buildRunlist } from '@/features/plan/engine/btc/services/runlistEngine';
import { deriveBTCDefaults } from '@/features/plan/engine/btc/services/btcSICUIDerivation';
import { generateBTCConfirmation } from '@/features/plan/engine/btc/services/btcOutputGenerator';
import type {
  ActivationRule,
  BTCAnswer,
  BTCQuestionDef,
  BTCSectionDef,
  Runlist,
} from '@/features/plan/engine/btc/types';
import type {
  BTCConfirmationOutput,
  BTCEvidenceRef,
  CUIBoundaryOutput,
  SIBaseline,
} from '@/features/plan/engine/shared/types/artifacts';
import type { InterviewFact } from '@/shared/types/engagement';
import type { DiscoveryEvidenceItem } from '@/features/discovery/discoveryEvidence';
import { BTC_NODE_SPEC_BY_ID, btcRawAnswer } from './btcGateNodes';
import type { BtcCaptureReview } from '@/shared/types/engagement';
import { acceptedAnswer } from './captureReviewSpec';

/** The raw YAML banks (compilerBanks loads them). */
export interface BtcBanks {
  btcQuestionBank: unknown;
  btcActivationPackage: unknown;
}

export interface ParsedBtcBank {
  sections: BTCSectionDef[];
  virtualQuestions: BTCQuestionDef[];
  rules: ActivationRule[];
  bankVersion: string;
  packageVersion: string;
}

type Raw = Record<string, unknown>;

// useBTCQuestions.ts question parse (help overlay omitted).
function parseQuestion(q: Raw): BTCQuestionDef {
  return {
    id: q.id as string,
    section: q.section as string,
    prompt: q.prompt as string,
    answer_type: q.answer_type as BTCQuestionDef['answer_type'],
    options: (q.options as string[]) || [],
    required: (q.required as boolean) ?? true,
    help: (q.help as string) || '',
    roles: (q.roles as BTCQuestionDef['roles']) || { primary_respondents: [], validators: [] },
    validations: (q.validations as BTCQuestionDef['validations']) || [],
    risk_flags: (q.risk_flags as string[]) || [],
    bindings: (q.bindings as BTCQuestionDef['bindings']) || {},
    activation: (q.activation as BTCQuestionDef['activation']) || { default_mode: 'full' },
    aliases: (q.aliases as string[]) || [],
  };
}

/** useBTCQuestions.ts + useActivationPackage.ts over the raw YAML. */
export function parseBtcBanks(banks: BtcBanks): ParsedBtcBank {
  const raw = (banks.btcQuestionBank ?? {}) as Raw;
  const pkg = (banks.btcActivationPackage ?? {}) as Raw;
  const sections: BTCSectionDef[] = ((raw.sections as Raw[]) || []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    activation: (s.activation as BTCSectionDef['activation']) || { default_mode: 'full', gating: true },
    questions: ((s.questions as Raw[]) || []).map(parseQuestion),
  }));
  const virtualQuestions = ((raw.virtual_questions as Raw[]) || []).map((q) => ({ ...parseQuestion(q), aliases: [] }));
  const rules: ActivationRule[] = ((pkg.rules as Raw[]) || []).map((r) => ({
    id: r.id as string,
    description: r.description as string,
    priority: r.priority as number,
    when: r.when as ActivationRule['when'],
    then: r.then as ActivationRule['then'],
  }));
  return {
    sections,
    virtualQuestions,
    rules,
    bankVersion: (raw.schema_version as string) || '1.0',
    packageVersion: (pkg.schema_version as string) || '1.0',
  };
}

/** BTCWizard.tsx loadData: the SI outputs the activation rules read. */
export function siOutputsFor(siBaseline: SIBaseline): Record<string, unknown> {
  const si = siBaseline.si_baseline as unknown as {
    scope?: { boundary_strategy?: string; external_service_providers?: unknown[] };
    operations?: { collaboration_mode?: string };
  };
  return {
    isolation_philosophy: si?.scope?.boundary_strategy || '',
    external_collaboration_posture:
      si?.operations?.collaboration_mode === 'teams_first'
        ? 'Controlled external sharing'
        : si?.operations?.collaboration_mode === 'email_first'
          ? 'Controlled external sharing'
          : 'No external sharing',
    third_party_tolerance: si?.scope?.external_service_providers?.length
      ? 'MSP allowed (controlled)'
      : 'No third parties',
    automation_ambition: 'Baseline automation',
  };
}

export interface BtcLiteResult {
  confirmation: BTCConfirmationOutput;
  runlist: Runlist;
  /** Runlist questions answered by none of: derivation, discovery verdict, operator. */
  unanswered: string[];
}

/**
 * The capture -> runlist entry it evidences. A virtual question counts only for
 * the entry it substitutes; a host question's own evidence only when that entry
 * is not substituted.
 */
function btcEvidenceRefs(runlist: Runlist, items: DiscoveryEvidenceItem[]): BTCEvidenceRef[] {
  const refs: BTCEvidenceRef[] = [];
  for (const item of items) {
    if (!item.btc_question_id) continue;
    const entry = runlist.entries.find((e) =>
      e.substitute_source_id ? e.substitute_source_id === item.btc_question_id : e.question_id === item.btc_question_id
    );
    if (!entry) continue;
    refs.push({
      evidence_id: item.evidence_id,
      source_system: item.source_system,
      location: item.location,
      hash_sha256: item.hash_sha256,
      captured_at: item.captured_at,
      question_id: entry.question_id,
      notes: `Discovery capture of ${item.entry_id}`,
    });
  }
  return refs;
}

export function buildBtcLite(args: {
  siBaseline: SIBaseline;
  cuiBoundary: CUIBoundaryOutput | null;
  evidence: DiscoveryEvidenceItem[];
  facts: InterviewFact[];
  banks: BtcBanks;
  /** MG-09 hand-off (e): the Plan tab's capture reviews (captureReviewSpec.ts). */
  reviews?: Record<string, BtcCaptureReview>;
}): BtcLiteResult | null {
  if (!args.cuiBoundary) return null;
  const bank = parseBtcBanks(args.banks);
  const runlist = buildRunlist(
    siOutputsFor(args.siBaseline),
    args.cuiBoundary.cui_boundary as unknown as Record<string, unknown>,
    { sections: bank.sections, virtualQuestions: bank.virtualQuestions },
    bank.rules
  );
  const refs = btcEvidenceRefs(runlist, args.evidence);
  const { defaults } = deriveBTCDefaults(args.siBaseline, args.cuiBoundary, runlist.entries);
  const answers: Record<string, BTCAnswer> = { ...defaults };
  const entryById = new Map(runlist.entries.map((e) => [e.question_id, e]));

  // The discovery verdict, where it reads the question's own fact.
  const fromVerdict = new Set<string>();
  for (const item of args.evidence) {
    if (!item.btc_answer || !item.btc_question_id) continue;
    const entry = entryById.get(item.btc_question_id);
    if (!entry || entry.substitute_source_id) continue;
    answers[entry.question_id] = {
      question_id: entry.question_id,
      raw_answer: item.btc_answer,
      mode: entry.mode,
      evidence_ids: [item.evidence_id],
      captured_at: item.captured_at,
      provenance_class: 'operator_inference',
    };
    fromVerdict.add(entry.question_id);
  }

  // MG-09 hand-off (e): the capture review. Accepted -> the capture is the
  // answer (a person's assertion, citing the captures); rejected -> no
  // discovery-sourced answer for it (the gate stays unanswered).
  for (const [qid, review] of Object.entries(args.reviews ?? {})) {
    const entry = entryById.get(qid);
    if (!entry || !refs.some((r) => r.question_id === qid)) continue;
    if (review.verdict === 'rejected') {
      if (fromVerdict.has(qid)) delete answers[qid];
      continue;
    }
    const raw = acceptedAnswer(qid, entry.substitute_source_id);
    if (raw === null) continue;
    answers[qid] = {
      question_id: qid,
      raw_answer: raw,
      mode: entry.mode,
      evidence_ids: [],
      captured_at: review.reviewed_on,
      notes: 'Discovery capture accepted as the answer on the Plan tab capture review',
      provenance_class: 'client_assertion',
    };
  }

  // The operator's answers to the asked BTC nodes (last stored answer wins).
  for (const f of args.facts) {
    if (!BTC_NODE_SPEC_BY_ID[f.question_id]) continue;
    const entry = entryById.get(f.question_id);
    const raw = btcRawAnswer(f.question_id, f.answer);
    if (!entry || raw === null) continue;
    answers[entry.question_id] = {
      question_id: entry.question_id,
      raw_answer: raw,
      mode: entry.mode,
      evidence_ids: [],
      captured_at: f.recorded_at,
      provenance_class: 'client_assertion',
    };
  }

  // Each answer cites the captures for its question.
  for (const ref of refs) {
    const a = answers[ref.question_id];
    if (a && !a.evidence_ids.includes(ref.evidence_id)) a.evidence_ids = [...a.evidence_ids, ref.evidence_id];
  }

  const confirmation = generateBTCConfirmation(answers, refs, runlist, bank.bankVersion, bank.packageVersion);
  const unanswered = runlist.entries.filter((e) => !answers[e.question_id]).map((e) => e.question_id);
  return { confirmation, runlist, unanswered };
}

// ── The posture raise (Planner rrt/services/postureGenerator.ts ~27-50) ──────

interface PostureLike {
  ces: {
    control_status_summary: { level?: string; met: number; partial: number; not_met: number; unknown: number };
    key_findings: Array<{ severity: string; statement: string; impacts_requirements?: string[] }>;
    requirement_results: Array<{
      requirement_id: string;
      status: string;
      evidence_refs: Array<{ evidence_id: string }>;
      notes?: string;
    }>;
    evidence_index: Array<{
      evidence_id: string;
      source_system: string;
      location: string;
      hash_sha256: string;
      captured_at?: string;
    }>;
  };
}

export const BTC_EVIDENCE_NOTE = '[BTC evidence contributes to satisfaction]';

/**
 * Captured evidence -> the posture: evidence_index and each mapped
 * requirement's evidence_refs gain the captures (postureGenerator's evidence
 * cross-reference), and a mapped requirement still `unknown` becomes `partial`
 * with Planner's note (postureGenerator's BTC auto-satisfaction). The summary
 * and key findings are recounted as the generator computes them
 * (computeControlStatusSummary / deriveKeyFindings). Mutates and returns the
 * posture. Returns the ids raised.
 */
export function raisePostureWithEvidence<P extends PostureLike>(posture: P, items: DiscoveryEvidenceItem[]): string[] {
  if (items.length === 0) return [];
  const byReq = new Map<string, string[]>();
  for (const item of items) {
    for (const reqId of item.mapped_requirements) byReq.set(reqId, [...(byReq.get(reqId) ?? []), item.evidence_id]);
  }
  const raised: string[] = [];
  const results = posture.ces.requirement_results.filter((r) => r.requirement_id !== 'placeholder');
  for (const r of results) {
    const ids = byReq.get(r.requirement_id);
    if (!ids) continue;
    for (const id of ids) if (!r.evidence_refs.some((e) => e.evidence_id === id)) r.evidence_refs.push({ evidence_id: id });
    if (r.status === 'unknown') {
      r.status = 'partial';
      r.notes = (r.notes ? r.notes + ' ' : '') + BTC_EVIDENCE_NOTE;
      raised.push(r.requirement_id);
    }
  }
  for (const item of items) {
    posture.ces.evidence_index.push({
      evidence_id: item.evidence_id,
      source_system: item.source_system,
      location: item.location,
      hash_sha256: item.hash_sha256,
      ...(item.captured_at ? { captured_at: item.captured_at } : {}),
    });
  }
  if (raised.length > 0 && results.length > 0) {
    const s = posture.ces.control_status_summary;
    const count = (st: string) => results.filter((r) => r.status === st).length;
    s.met = count('met');
    s.partial = count('partial');
    s.not_met = count('not_met');
    s.unknown = results.length - s.met - s.partial - s.not_met;
    const notMet = results.filter((r) => r.status === 'not_met');
    const unknown = results.filter((r) => r.status !== 'met' && r.status !== 'partial' && r.status !== 'not_met');
    const findings: PostureLike['ces']['key_findings'] = [];
    if (notMet.length > 0) {
      findings.push({
        severity: notMet.length > 5 ? 'critical' : 'high',
        statement: `${notMet.length} requirement(s) are currently NOT MET and require remediation.`,
        impacts_requirements: notMet.map((r) => r.requirement_id),
      });
    }
    if (unknown.length > 0) {
      findings.push({
        severity: 'medium',
        statement: `${unknown.length} requirement(s) have UNKNOWN status and need further investigation.`,
        impacts_requirements: unknown.map((r) => r.requirement_id),
      });
    }
    posture.ces.key_findings =
      findings.length > 0 ? findings : [{ severity: 'low', statement: 'No significant findings at this time.' }];
  }
  return raised;
}
