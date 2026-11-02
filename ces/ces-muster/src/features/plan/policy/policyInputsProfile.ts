// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// policyInputsProfile.ts — MG-16 (decision D2): Planner's Policy Inputs
// profile (PolicyInputsOutput) built from what Muster already knows, then
// handed to the VENDORED generatePolicyInputsOutput, so the profile has
// Planner's exact shape. Every one of the bank's 40 questions gets a value
// source (discover -> derive -> default -> ask):
//
//   organisation  PI.ORG.001/006/007 the engagement profile (organisation name,
//                 CAGE, UEI); PI.ORG.002-005 Graph /organization (harvest
//                 pre-fill) or the operator; PI.ORG.008-011 asked.
//   personnel     the operator's PI.PER.* answers. PI.PER.001-004 and 006 are
//                 also DRAFTED from the directory role holders the harvest
//                 read (TCP.PA.001 Global Admin, .002 Security Admin, .003
//                 Compliance Admin). A draft is shown, never rendered: a person
//                 confirms it on the Plan tab (which records the answer), as
//                 drafts never become fact (D2 discipline, draftSemantics).
//   ODPs          PI.ODP.001-015: the answered value (FIN-32b: asked, optional,
//                 policyInputNodes.ts), else the bank's recommended value,
//                 provenance `defaulted`.
//   governance    PI.GOV.001 = the policies' effective date: an answered approval
//                 date, else the plan date (W5: policies are effective on
//                 approval, and the plan is the approval; the Mission Plan's
//                 milestone dates stay on the POA&M); PI.GOV.002/003 the bank's
//                 recommended values (`defaulted`).
//   physical      PI.PHY.001-003 asked (addresses separated by ';').
//   W5c2          six Muster-only questions (policyInputNodes.ts) the pinned
//                 Planner bank does not carry, folded in after the vendored
//                 generator: PI.PER.009-011 -> personnel[] role_id
//                 authorizing_official / privacy_officer / network_administrator;
//                 PI.SYS.001, CUI.LC.VOL.001, CUI.INT.004 -> `ssp_inputs`.
// The SI Baseline / TCP / CUI / BTC / posture context is added later by the
// vendored compilePolicyContext (policyDocuments.ts).
import { generatePolicyInputsOutput } from '@/features/plan/engine/policy/services/policyProfileGenerator';
import type { PolicyAnswer, PolicyInputsOutput, PolicySectionDef } from '@/features/plan/engine/policy/types';
import type { InterviewFact } from '@/shared/types/engagement';
import { scorableFacts } from '@/features/scoring/draftSemantics';
import { POLICY_INPUT_NODES } from '@/features/interview/policyInputNodes';

export type PolicyValueProvenance = 'discovered' | 'derived' | 'defaulted' | 'answered' | 'drafted' | 'missing';

export interface PolicyValueSource {
  question_id: string;
  prompt: string;
  provenance: PolicyValueProvenance;
  /** Where the value came from (graph:organization, engagement profile, bank recommended, milestone MS-1 …). */
  source?: string;
  /** The value as the profile uses it ('' when missing; a draft's value is shown but not used). */
  value: string;
}

export interface PersonnelDraft {
  question_id: string;
  role_title: string;
  /** "Name | Title | Email" (Planner's personnel format); the name is the role holder's UPN. */
  value: string;
  source: string;
}

/**
 * Synthetic-customer V58: the organisation content's `simulation` block
 * (`customers/<slug>/org-content.json`). Present only for a simulated
 * (fictional) customer; it marks every rendered document.
 */
export interface SimulationBlock {
  simulated: true;
  /** The fictional legal name (ends "(FICTIONAL)"). */
  legalName: string;
  disclaimer?: string;
}

/** The visible marker every document of a simulated customer carries. */
export function simulationMarker(sim: SimulationBlock): string {
  return `SIMULATED CUSTOMER (FICTIONAL): ${sim.legalName}`;
}

/** The block when it marks a simulated customer (`simulated === true` and a legal name), else null. */
export function activeSimulation(block: unknown): SimulationBlock | null {
  const b = block as { simulated?: unknown; legalName?: unknown; disclaimer?: unknown } | null | undefined;
  if (!b || b.simulated !== true || typeof b.legalName !== 'string' || !b.legalName.trim()) return null;
  return {
    simulated: true,
    legalName: b.legalName.trim(),
    ...(typeof b.disclaimer === 'string' && b.disclaimer.trim() ? { disclaimer: b.disclaimer.trim() } : {}),
  };
}

/** W5c2: one interconnection agreement (CUI.INT.004). */
export interface InterconnectionAgreement {
  system: string;
  agreement_reference?: string;
  connection_type?: string;
  data_classification?: string;
}

/**
 * W5c2: SSP inputs the Planner profile shape has no slot for (Muster-only
 * questions). Each key is present only when answered; the block is absent
 * when none is.
 */
export interface SspInputs {
  /** PI.SYS.001: the organisation's identifier for the in-scope system. */
  system_identifier?: string;
  /** CUI.LC.VOL.001: CUI held and typical monthly inflow, as answered. */
  cui_volume?: string;
  /** CUI.INT.004: one entry per interconnection. */
  interconnection_agreements?: InterconnectionAgreement[];
}

export interface PolicyInputsProfile {
  /**
   * Planner's PolicyInputsOutput (vendored generatePolicyInputsOutput). V58: a
   * simulated customer's `simulation` block rides on it (absent otherwise), so
   * the policy_inputs_profile MG-12 envelope carries it to EvidenceOps. W5c2:
   * so does `ssp_inputs` (answered Muster-only SSP inputs).
   */
  output: PolicyInputsOutput & { simulation?: SimulationBlock; ssp_inputs?: SspInputs };
  /** One entry per bank question, in bank order. */
  sources: PolicyValueSource[];
  /** Personnel drafted from directory role holders, awaiting a person's confirmation (not rendered). */
  drafts: PersonnelDraft[];
}

export interface PolicyParty {
  name: string;
  uei?: string;
  cage?: string;
}

type Raw = Record<string, unknown>;

/** usePolicyQuestions: the raw bank's sections (help fields omitted; the generator does not read them). */
export function policySections(bank: unknown): PolicySectionDef[] {
  return (((bank as Raw | null)?.sections as Raw[]) ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    questions: ((s.questions as Raw[]) ?? []).map((q) => ({
      id: q.id as string,
      section: q.section as string,
      prompt: q.prompt as string,
      answer_type: q.answer_type as PolicyAnswer['answer_type'],
      options: (q.options as string[]) ?? [],
      required: (q.required as boolean) ?? false,
      help: (q.help as string) ?? '',
      recommended: q.recommended as PolicySectionDef['questions'][number]['recommended'],
      roles: (q.roles as PolicySectionDef['questions'][number]['roles']) ?? { primary_respondents: [], validators: [] },
      bindings: (q.bindings as PolicySectionDef['questions'][number]['bindings']) ?? {},
      risk_flags: (q.risk_flags as string[]) ?? [],
    })),
  }));
}

/** The personnel questions drafted from directory role holders: question -> [TCP role fact, role title]. */
export const PERSONNEL_DRAFT_SOURCES: Record<string, { fact: string; role: string; title: string }> = {
  'PI.PER.001': { fact: 'TCP.PA.002', role: 'Security Administrator', title: 'Information System Security Officer' },
  'PI.PER.002': { fact: 'TCP.PA.001', role: 'Global Administrator', title: 'System Owner' },
  'PI.PER.003': { fact: 'TCP.PA.003', role: 'Compliance Administrator', title: 'Compliance Officer' },
  'PI.PER.004': { fact: 'TCP.PA.001', role: 'Global Administrator', title: 'IT Director / CTO' },
  'PI.PER.006': { fact: 'TCP.PA.002', role: 'Security Administrator', title: 'Incident Response Lead' },
};

/**
 * W5c2 (SC-5 P1, P2): the Muster-only personnel questions and the profile
 * `personnel[].role_id` each writes. The role_id values are the contract
 * vocabulary EvidenceOps reads (free strings in the Planner shape).
 */
export const MUSTER_PERSONNEL_ROLES: ReadonlyArray<{ id: string; role_id: string; role_title: string }> = [
  { id: 'PI.PER.009', role_id: 'authorizing_official', role_title: 'Authorizing Official' },
  { id: 'PI.PER.010', role_id: 'privacy_officer', role_title: 'Privacy Officer' },
  { id: 'PI.PER.011', role_id: 'network_administrator', role_title: 'Network Administrator' },
];

/** W5c2: the Muster-only SSP-input questions, by `ssp_inputs` key. */
export const SSP_INPUT_QUESTIONS = {
  system_identifier: 'PI.SYS.001',
  cui_volume: 'CUI.LC.VOL.001',
  interconnection_agreements: 'CUI.INT.004',
} as const;

/**
 * W5c7 (AU.L2-3.3.7): the Muster-only ODPs, by `odps` key, with the default a
 * session that did not answer gets (provenance defaulted) and where that default
 * comes from. The pinned bank's ODPs end at PI.ODP.015.
 *
 * FIN-26b (note 42, AC.L2-3.1.11): PI.ODP.017, the sign-in frequency bound in
 * hours. The answer is kept as given (a value over 8 stays a reconciliation
 * input); unanswered it is the CES baseline of 8 h. An answer never relaxes the
 * baseline (founder ruling 2): only an answered 1..8 reaches the Tenant Manifest
 * (verificationExpectations.answeredSignInHours).
 */
export const MUSTER_ODP_QUESTIONS = {
  authoritative_time_source: { id: 'PI.ODP.016', default: 'time.windows.com', source: 'Muster default (Microsoft time service)' },
  sign_in_frequency_hours: { id: 'PI.ODP.017', default: '8', source: 'CES baseline (founder ruling 2)' },
} as const;

const ROLE_HELD_BY = /^role held by\s+(?:the\s+)?(.+?)\.?$/i;

type ProfilePerson = PolicyInputsOutput['personnel'][number];

/**
 * W5c2: one Muster-only personnel answer as a profile entry. "Name | Title |
 * Email" (or the comma form personnelAnswer accepts) gives the person; "role
 * held by <role>" gives the person already named for that role (matched on
 * role_id, role title or title, case-insensitive), titled "<their title>
 * (<role> role holder)". An unmatched "role held by" gives null.
 */
export function musterPersonnelEntry(
  role: { role_id: string; role_title: string },
  answer: string,
  personnel: ProfilePerson[]
): ProfilePerson | null {
  const text = answer.trim();
  const held = ROLE_HELD_BY.exec(text);
  if (held) {
    const want = held[1].trim().toLowerCase();
    const holder = personnel.find((p) =>
      [p.role_id.replace(/_/g, ' '), p.role_title, p.title ?? ''].some((v) => v.toLowerCase() === want)
    );
    if (!holder) return null;
    return {
      role_id: role.role_id,
      role_title: role.role_title,
      name: holder.name,
      title: `${holder.title || holder.role_title} (${role.role_title} role holder)`,
      email: holder.email,
    };
  }
  const parts = personnelAnswer(text).split('|').map((x) => x.trim());
  if (!parts[0]) return null;
  return {
    role_id: role.role_id,
    role_title: role.role_title,
    name: parts[0],
    title: parts[1] || undefined,
    email: parts[2] || undefined,
  };
}

/** W5c2: CUI.INT.004 -> one entry per ';' or line: "System | ISA/MOU reference | connection type | data classification". */
export function interconnectionAgreements(answer: string): InterconnectionAgreement[] {
  return answer
    .split(/[;\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((item) => {
      const [system, agreement_reference, connection_type, data_classification] = item.split('|').map((x) => x.trim());
      return {
        system,
        ...(agreement_reference ? { agreement_reference } : {}),
        ...(connection_type ? { connection_type } : {}),
        ...(data_classification ? { data_classification } : {}),
      };
    })
    .filter((a) => a.system);
}

/** The Mission Plan's earliest milestone (target_date + id), if any. */
export function firstMilestone(missionPlan: unknown): { id: string; target_date: string } | null {
  const ms =
    (missionPlan as { outputs?: { human_readable_mission_plan?: { milestones?: Array<{ id?: string; target_date?: string }> } } } | null)
      ?.outputs?.human_readable_mission_plan?.milestones ?? [];
  const dated = ms.filter((m) => typeof m.target_date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(m.target_date));
  if (dated.length === 0) return null;
  const first = [...dated].sort((a, b) => a.target_date!.localeCompare(b.target_date!))[0];
  return { id: first.id ?? 'milestone', target_date: first.target_date!.slice(0, 10) };
}

/**
 * Planner defect (01-GAP-BACKLOG section 5 class): the bank asks "Provide:
 * Name, Title, Email" but Planner's parsePersonnel splits on '|', so a
 * comma answer becomes one long name with no title or email. A three-part
 * comma answer whose last part is an email is passed on in the '|' form.
 */
export function personnelAnswer(text: string): string {
  if (text.includes('|')) return text;
  const parts = text.split(',').map((x) => x.trim());
  return parts.length === 3 && parts[2].includes('@') ? parts.join(' | ') : text;
}

const FACT_SOURCE = (f: InterviewFact): string => f.source ?? (f.provenance === 'auto_detected' ? 'discovery' : 'interview');

/** The 15 ODPs and the review cycle / fiscal year start: bank-defaulted unless the session answered them (FIN-32b: the ODPs are asked, optional). */
export function isDefaultedPolicyQuestion(id: string): boolean {
  return id.startsWith('PI.ODP.') || id === 'PI.GOV.002' || id === 'PI.GOV.003';
}

export interface ResolvedPolicyValue {
  value: number | string;
  provenance: Extract<PolicyValueProvenance, 'discovered' | 'answered' | 'defaulted'>;
  source: string;
}

/**
 * One rule for a defaulted question's value (W1): a session answer replaces the
 * bank default (a number question needs a number), else the bank's recommended
 * value; null when neither exists. Shared by the profile and, W3, by the Tenant
 * Manifest's verification expected values.
 */
export function resolveDefaultedPolicyValue(
  q: Pick<PolicySectionDef['questions'][number], 'answer_type' | 'recommended'>,
  answered: InterviewFact | undefined
): ResolvedPolicyValue | null {
  const text = answered?.answer?.trim() ?? '';
  if (answered && text && !(q.answer_type === 'number' && !Number.isFinite(Number(text)))) {
    return {
      value: q.answer_type === 'number' ? Number(text) : text,
      provenance: answered.provenance === 'auto_detected' ? 'discovered' : 'answered',
      source: FACT_SOURCE(answered),
    };
  }
  if (q.recommended !== undefined && (typeof q.recommended === 'number' || typeof q.recommended === 'string')) {
    return { value: q.recommended, provenance: 'defaulted', source: 'Policy Inputs bank recommended value' };
  }
  return null;
}

/** W3: the resolved value of every defaulted question (ODPs, PI.GOV.002/003), keyed by question id. */
export function resolveDefaultedPolicyValues(facts: InterviewFact[], bank: unknown): Record<string, ResolvedPolicyValue> {
  const latest = new Map<string, InterviewFact>();
  for (const f of scorableFacts(facts)) latest.set(f.question_id, f);
  const out: Record<string, ResolvedPolicyValue> = {};
  for (const q of policySections(bank).flatMap((s) => s.questions)) {
    if (!isDefaultedPolicyQuestion(q.id)) continue;
    const r = resolveDefaultedPolicyValue(q, latest.get(q.id));
    if (r) out[q.id] = r;
  }
  // W5c7: the Muster-only ODPs (not in the bank): the answer, else Muster's default.
  for (const q of Object.values(MUSTER_ODP_QUESTIONS)) {
    const f = latest.get(q.id);
    const text = f?.answer?.trim() ?? '';
    out[q.id] =
      f && text
        ? { value: text, provenance: f.provenance === 'auto_detected' ? 'discovered' : 'answered', source: FACT_SOURCE(f) }
        : { value: q.default, provenance: 'defaulted', source: q.source };
  }
  return out;
}

/**
 * The profile. `facts` are the session's facts (unconfirmed drafts are
 * dropped here, as for scoring); `missionPlan` supplies the milestone date.
 */
export function buildPolicyInputsProfile(args: {
  facts: InterviewFact[];
  party: PolicyParty;
  missionPlan: unknown;
  bank: unknown;
  /** Bank version stamp (the bank's schema_version). */
  bankVersion?: string;
  /** V58: the organisation content's `simulation` block (a simulated customer only). */
  simulation?: unknown;
  /** W5: the plan date (YYYY-MM-DD) PI.GOV.001 takes when no approval date is answered; default today (UTC). */
  planDate?: string;
}): PolicyInputsProfile {
  const sections = policySections(args.bank);
  const latest = new Map<string, InterviewFact>();
  for (const f of scorableFacts(args.facts)) latest.set(f.question_id, f);

  const answers: Record<string, PolicyAnswer> = {};
  const sources: PolicyValueSource[] = [];
  const drafts: PersonnelDraft[] = [];
  const now = new Date().toISOString();
  const planDate = (args.planDate ?? now).slice(0, 10);

  for (const q of sections.flatMap((s) => s.questions)) {
    const put = (raw: PolicyAnswer['raw_answer'], provenance: PolicyValueProvenance, source: string) => {
      answers[q.id] = {
        question_id: q.id,
        answer_type: q.answer_type,
        raw_answer: raw,
        captured_at: now,
        provenance_class: provenance === 'answered' ? 'client_assertion' : 'operator_inference',
      };
      sources.push({ question_id: q.id, prompt: q.prompt, provenance, source, value: Array.isArray(raw) ? raw.join('; ') : String(raw) });
    };
    const missing = () => sources.push({ question_id: q.id, prompt: q.prompt, provenance: 'missing', value: '' });

    // Engagement profile (the Profile tab asks these once for every output).
    const profile: Record<string, string | undefined> = {
      'PI.ORG.001': args.party.name,
      'PI.ORG.006': args.party.cage,
      'PI.ORG.007': args.party.uei,
    };
    if (q.id in profile) {
      const v = profile[q.id]?.trim();
      if (v) put(v, 'derived', 'engagement profile');
      else missing();
      continue;
    }

    // Defaulted: the 15 ODPs and the review cycle / fiscal year start, unless the
    // session answered one (W1: an interview-answers file); the answer then
    // replaces the bank default, marked answered with its source.
    if (isDefaultedPolicyQuestion(q.id)) {
      const r = resolveDefaultedPolicyValue(q, latest.get(q.id));
      if (r) put(r.value, r.provenance, r.source);
      else missing();
      continue;
    }

    // Governance effective date (W5): an answered approval date, else the plan
    // date. Never a future milestone: a policy in force on the SSP date.
    if (q.id === 'PI.GOV.001') {
      const approved = latest.get(q.id)?.answer?.trim() ?? '';
      if (/^\d{4}-\d{2}-\d{2}/.test(approved)) put(approved.slice(0, 10), 'answered', FACT_SOURCE(latest.get(q.id)!));
      else put(planDate, 'derived', 'plan date (policies effective on approval)');
      continue;
    }

    // Asked (or discovered) nodes: the session's latest non-draft fact.
    const f = latest.get(q.id);
    const text = f?.answer?.trim() ?? '';
    if (f && text) {
      const raw: PolicyAnswer['raw_answer'] =
        q.answer_type === 'list'
          ? text.split(/[;\n]/).map((x) => x.trim()).filter(Boolean)
          : q.id.startsWith('PI.PER.')
            ? personnelAnswer(text)
            : text;
      put(raw, f.provenance === 'auto_detected' ? 'discovered' : 'answered', FACT_SOURCE(f));
      continue;
    }

    // Personnel drafted from a directory role holder (shown, not used until confirmed).
    const draftFrom = PERSONNEL_DRAFT_SOURCES[q.id];
    const holder = draftFrom ? latest.get(draftFrom.fact)?.answer?.split(',').map((x) => x.trim()).find(Boolean) : undefined;
    if (draftFrom && holder) {
      const value = `${holder} | ${draftFrom.title} | ${holder}`;
      const source = `directory role holder: ${draftFrom.role} (${draftFrom.fact}${
        latest.get(draftFrom.fact)?.source ? `, ${latest.get(draftFrom.fact)!.source}` : ''
      })`;
      drafts.push({ question_id: q.id, role_title: draftFrom.title, value, source });
      sources.push({ question_id: q.id, prompt: q.prompt, provenance: 'drafted', source, value });
      continue;
    }
    missing();
  }

  const output: PolicyInputsProfile['output'] = generatePolicyInputsOutput(
    answers,
    sections,
    args.bankVersion ?? String((args.bank as Raw | null)?.schema_version ?? '1.0')
  );
  // W5c2: the Muster-only questions (not in the bank, so not in the loop above).
  const prompt = (id: string): string => POLICY_INPUT_NODES.find((n) => n.id === id)?.text ?? id;
  const answeredText = (id: string): { f: InterviewFact; text: string } | null => {
    const f = latest.get(id);
    const text = f?.answer?.trim() ?? '';
    return f && text ? { f, text } : null;
  };
  const answeredSource = (id: string, value: string, f: InterviewFact) =>
    sources.push({
      question_id: id,
      prompt: prompt(id),
      provenance: f.provenance === 'auto_detected' ? 'discovered' : 'answered',
      source: FACT_SOURCE(f),
      value,
    });
  for (const role of MUSTER_PERSONNEL_ROLES) {
    const a = answeredText(role.id);
    const entry = a ? musterPersonnelEntry(role, a.text, output.personnel) : null;
    if (a && entry) {
      output.personnel.push(entry);
      answeredSource(role.id, [entry.name, entry.title ?? '', entry.email ?? ''].join(' | '), a.f);
    } else sources.push({ question_id: role.id, prompt: prompt(role.id), provenance: 'missing', value: a?.text ?? '' });
  }
  const ssp: SspInputs = {};
  for (const [key, id] of Object.entries(SSP_INPUT_QUESTIONS) as Array<[keyof SspInputs, string]>) {
    const a = answeredText(id);
    const list = key === 'interconnection_agreements' && a ? interconnectionAgreements(a.text) : [];
    if (!a || (key === 'interconnection_agreements' && list.length === 0)) {
      sources.push({ question_id: id, prompt: prompt(id), provenance: 'missing', value: a?.text ?? '' });
      continue;
    }
    if (key === 'interconnection_agreements') ssp.interconnection_agreements = list;
    else ssp[key] = a.text;
    answeredSource(id, a.text, a.f);
  }
  if (Object.keys(ssp).length > 0) output.ssp_inputs = ssp;
  // W5c7: the Muster-only ODPs: the answer, else Muster's default (defaulted).
  for (const [key, q] of Object.entries(MUSTER_ODP_QUESTIONS)) {
    const a = answeredText(q.id);
    output.odps[key] = a ? a.text : q.default;
    if (a) answeredSource(q.id, a.text, a.f);
    else sources.push({ question_id: q.id, prompt: prompt(q.id), provenance: 'defaulted', source: q.source, value: q.default });
  }

  const simulation = activeSimulation(args.simulation);
  if (simulation) output.simulation = simulation;
  return { output, sources, drafts };
}
