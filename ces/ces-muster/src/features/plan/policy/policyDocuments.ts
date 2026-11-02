// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// policyDocuments.ts — MG-16 (decision D2): all 20 of Planner's policy, SSP,
// POA&M and IR documents, through the VENDORED chain Planner's
// useMissionPlanGenerator step 7 runs:
//   policy inputs profile (policyInputsProfile.ts)
//   -> compilePolicyContext({ policyInputs, siBaseline, tenantConfig,
//        cuiBoundary, btcConfirmation, readinessPosture })
//   -> withOrganisationNames (W5: empty roles and "Not specified" governance
//        owners take the organisation content's names)
//   -> renderAllPolicies (the 20 templates in public/templates/policies/)
//      + renderMusterPolicies (W5c2 P10: Muster's own 2, public/templates/muster-policies/)
//   -> withApprovalBlock (W5 SC-6: owner, default ISSM, and approver with
//        name, title, signature and date where the template names none)
//   -> withPlanningDraftBanner (SSP and POA&M only; W4 banner)
//   -> withSimulationMarker (every document, a simulated customer only; V58)
//   -> exportPolicyToDocx (one DOCX per document).
// The context reads the compile's own artifacts and the session's ONE posture
// (MG-03), so the policies describe the plan that was compiled.
//
// BHD review: the backlog's Done-when includes "BHD has reviewed the rendered
// set". That review is BHD-owed; nothing here claims it.
import { load } from 'js-yaml';
import Handlebars from 'handlebars';
import {
  assessContextCompleteness,
  compilePolicyContext,
  type ContextCompleteness,
  type PolicyTemplateContext,
} from '@/features/plan/engine/mpt/services/policyContextCompiler';
import { renderAllPolicies, type RenderedPolicyDocument } from '@/features/plan/engine/mpt/services/policyRenderer';
import { exportPolicyToDocx } from '@/features/plan/engine/mpt/services/policyDocxExporter';
import type { InterviewFact } from '@/shared/types/engagement';
import {
  buildPolicyInputsProfile,
  simulationMarker,
  type PolicyInputsProfile,
  type PolicyParty,
  type SimulationBlock,
} from './policyInputsProfile';

export const POLICY_BANK_FILE = '/knowledge/primed Policy Inputs Question Bank.yaml';

/** The slice of a plan compile the policies read (structural, so the runner can pass its own). */
export interface CompiledForPolicies {
  artifacts: {
    siBaseline: unknown;
    missionPlan: unknown;
    tenantConfig: unknown | null;
    cuiBoundary: unknown | null;
    btcConfirmation?: unknown | null;
  };
  /** The session's one posture (MG-03). */
  posture: unknown;
}

export interface PolicySet {
  profile: PolicyInputsProfile;
  context: PolicyTemplateContext;
  /** Planner's context completeness (21 checked variables). */
  contextCompleteness: ContextCompleteness;
  /** The 22 rendered documents: Planner's 20 in registry order, then Muster's 2 (MUSTER_POLICY_TEMPLATES). */
  documents: RenderedPolicyDocument[];
}

/**
 * W5c2 (SC-5 P10): Muster's own policy-set templates, beside Planner's pinned
 * 20 (which stay consume-never-fork). Same Handlebars context, helpers (the
 * vendored renderer registers them) and render-time conventions (approval
 * block, simulation marker). An input the organisation has not supplied
 * renders EvidenceOps' content-gap sentence ("Not supplied by the
 * organisation (content gap): <what>.").
 */
export const MUSTER_POLICY_TEMPLATES: ReadonlyArray<Omit<RenderedPolicyDocument, 'markdown' | 'completeness'> & { filename: string }> = [
  {
    template_id: 'continuous_monitoring_plan',
    title: 'Continuous Monitoring Plan',
    filename: 'continuous-monitoring-plan.md',
    domain: 'CA',
    nist_controls: ['3.12.3'],
  },
  {
    template_id: 'acceptable_use_policy',
    title: 'Acceptable Use Policy',
    filename: 'acceptable-use-policy.md',
    domain: 'AC',
    nist_controls: ['3.1.1', '3.1.2', '3.1.9'],
  },
];

export const MUSTER_POLICY_TEMPLATE_DIR = '/templates/muster-policies';

/**
 * W5c2 (SC-5 P10): the policy-set document (base name, policyFileBase) that
 * serves each SSP appendix EvidenceOps fills from the policy-set manifest.
 * I is EO's existing mapping; J maps the configuration management policy as
 * the Configuration Management Plan reference; K and L are Muster's templates.
 */
export const SSP_APPENDIX_DOCUMENTS: Readonly<Record<'I' | 'J' | 'K' | 'L', string>> = {
  I: 'incident-response-plan',
  J: 'configuration-management-policy',
  K: 'continuous-monitoring-plan',
  L: 'acceptable-use-policy',
};

/** W5c2: render Muster's own templates with the policy context (fetched like the vendored renderer's). */
export async function renderMusterPolicies(ctx: PolicyTemplateContext): Promise<RenderedPolicyDocument[]> {
  const out: RenderedPolicyDocument[] = [];
  for (const { filename, ...entry } of MUSTER_POLICY_TEMPLATES) {
    const resp = await fetch(`${MUSTER_POLICY_TEMPLATE_DIR}/${filename}`);
    if (!resp.ok) throw new Error(`Failed to load Muster policy template ${filename}: ${resp.status}`);
    const markdown = Handlebars.compile(await resp.text(), { noEscape: true })(ctx);
    out.push({ ...entry, nist_controls: [...entry.nist_controls], markdown, completeness: unresolvedTokens(markdown).length === 0 ? 100 : 0 });
  }
  return out;
}

/**
 * W4 banner (founder decision 2026-10-27): the SSP and POA&M Muster renders
 * are planning drafts; EvidenceOps' documents are the documents of record.
 * Prepended at render time because the two templates are pinned Planner
 * copies (consume, never fork). A plain paragraph, not a blockquote: the
 * vendored DOCX exporter applies bold only to plain paragraphs.
 */
export const PLANNING_DRAFT_BANNERS: Readonly<Record<string, string>> = {
  system_security_plan:
    '**Planning draft, not the SSP of record.** The system security plan of record is the EvidenceOps SSP, which carries the assessed status.',
  poam: '**Planning draft, not the POA&M of record.** The POA&M of record is the EvidenceOps POA&M, which carries the assessed status.',
};

/** The document with its planning-draft banner as the first paragraph under the title (other documents unchanged). */
export function withPlanningDraftBanner(doc: RenderedPolicyDocument): RenderedPolicyDocument {
  const banner = PLANNING_DRAFT_BANNERS[doc.template_id];
  if (!banner) return doc;
  const eol = doc.markdown.includes('\r\n') ? '\r\n' : '\n';
  const end = doc.markdown.indexOf('\n');
  const title = end < 0 ? doc.markdown : doc.markdown.slice(0, end).replace(/\r$/, '');
  const rest = end < 0 ? '' : doc.markdown.slice(end + 1);
  return { ...doc, markdown: `${title}${eol}${eol}${banner}${eol}${rest}` };
}

/**
 * V58 (synthetic customer): the marker paragraph, "**SIMULATED CUSTOMER
 * (FICTIONAL): <legal name>**" plus the block's disclaimer. A plain
 * paragraph, so the vendored DOCX exporter renders the lead in bold.
 */
export function simulationMarkerParagraph(sim: SimulationBlock): string {
  return `**${simulationMarker(sim)}**${sim.disclaimer ? ` ${sim.disclaimer}` : ''}`;
}

/**
 * The document with the simulated-customer marker as the first paragraph
 * under the title. No simulation block -> the same object, unchanged.
 */
export function withSimulationMarker(doc: RenderedPolicyDocument, sim: SimulationBlock | null | undefined): RenderedPolicyDocument {
  if (!sim) return doc;
  const eol = doc.markdown.includes('\r\n') ? '\r\n' : '\n';
  const end = doc.markdown.indexOf('\n');
  const title = end < 0 ? doc.markdown : doc.markdown.slice(0, end).replace(/\r$/, '');
  const rest = end < 0 ? '' : doc.markdown.slice(end + 1);
  return { ...doc, markdown: `${title}${eol}${eol}${simulationMarkerParagraph(sim)}${eol}${rest}` };
}

/** A named person for a signature line. */
export interface Signatory {
  name: string;
  title: string;
  /** Where the name came from (org-content role, policy personnel). */
  source: string;
}

/** W5 (SC-6): who owns a document whose template names no owner (default ISSM) and who approves every document. */
export interface PolicySignatories {
  owner: Signatory | null;
  approver: Signatory | null;
}

type OrgPerson = { name?: unknown; title?: unknown };
const BLANK_NAME = /^(|not specified|tbd|n\/a|none|designated official|\[.*\]|_+)$/i;
const named = (v: unknown): v is string => typeof v === 'string' && !BLANK_NAME.test(v.trim());

function orgPerson(p: OrgPerson | undefined, source: string): Signatory | null {
  return p && named(p.name) ? { name: p.name.trim(), title: typeof p.title === 'string' ? p.title.trim() : '', source } : null;
}

function contextPerson(ctx: PolicyTemplateContext, role: string): Signatory | null {
  const p = ctx.personnel[role];
  return p && named(p.name) ? { name: p.name.trim(), title: (p.title ?? '').trim(), source: `policy personnel ${role}` } : null;
}

/**
 * W5 (SC-6): the approver is the organisation content's policy approver, else
 * its authorizing official, else the policy personnel's Authorizing Official
 * (W5c2, PI.PER.009), else its System Owner (the templates' Authorizing Official). The default owner is the ISSM: the
 * organisation content's ISSM, else the Compliance Officer (PI.PER.003).
 * A role with no name gives null, never a stand-in.
 */
export function resolvePolicySignatories(ctx: PolicyTemplateContext, orgContent?: unknown): PolicySignatories {
  const org = (orgContent ?? {}) as { roles?: Record<string, OrgPerson>; approvers?: { policy_approver?: OrgPerson } };
  return {
    owner: orgPerson(org.roles?.issm, 'org-content roles.issm') ?? contextPerson(ctx, 'compliance_officer'),
    approver:
      orgPerson(org.approvers?.policy_approver, 'org-content approvers.policy_approver') ??
      orgPerson(org.roles?.authorizing_official, 'org-content roles.authorizing_official') ??
      contextPerson(ctx, 'authorizing_official') ??
      contextPerson(ctx, 'system_owner'),
  };
}

/** Organisation-content roles that fill a policy personnel role the answers left empty. */
export const ORG_ROLE_FOR_PERSONNEL: Readonly<Record<string, readonly string[]>> = {
  system_owner: ['authorizing_official', 'owner'],
  isso: ['isso'],
  compliance_officer: ['issm'],
  facilities_manager: ['fso'],
  legal_representative: ['cui_manager'],
};

/**
 * W5 (SC-6): the context with every name the organisation knows. An empty
 * personnel role takes the matching organisation-content role (so a template's
 * "Designated Official" fallback never shows when a name exists); an SI
 * governance owner left "Not specified" takes the approver (affirming official)
 * or the ISSM (change control owner). Named values are never replaced.
 */
export function withOrganisationNames(ctx: PolicyTemplateContext, orgContent?: unknown): PolicyTemplateContext {
  const roles = ((orgContent ?? {}) as { roles?: Record<string, OrgPerson & { upn?: unknown }> }).roles ?? {};
  const personnel = { ...ctx.personnel };
  for (const [role, orgRoles] of Object.entries(ORG_ROLE_FOR_PERSONNEL)) {
    if (named(personnel[role]?.name)) continue;
    const from = orgRoles.map((r) => roles[r]).find((p) => p && named(p.name));
    if (!from) continue;
    personnel[role] = {
      name: String(from.name).trim(),
      title: typeof from.title === 'string' ? from.title.trim() : '',
      email: typeof from.upn === 'string' ? from.upn : '',
      role_title: personnel[role]?.role_title ?? role,
    };
  }
  const withPersonnel = { ...ctx, personnel };
  const signatories = resolvePolicySignatories(withPersonnel, orgContent);
  const si = { ...ctx.si };
  if (!named(si.affirming_official) && signatories.approver) si.affirming_official = signatories.approver.name;
  if (!named(si.change_control_owner) && signatories.owner) si.change_control_owner = signatories.owner.name;
  return { ...withPersonnel, si };
}

/** The owner a rendered document names (`**Policy|Plan|Document Owner:**`), '' when none. */
export function documentOwner(markdown: string): string {
  return (/\*\*(?:Policy|Plan|Document) Owner:\*\*[ \t]*([^\n]*)/.exec(markdown)?.[1] ?? '').trim();
}

/** The approver a rendered document names (an `Approved By` cell or line, or the Attestation block's Name), '' when none. */
export function documentApprover(markdown: string): string {
  const m =
    /\|\s*\*\*Approved By\*\*\s*\|\s*([^|\n]*)\|/.exec(markdown) ??
    /\*\*Approved By:\*\*[ \t]*([^\n]*)/.exec(markdown) ??
    /##\s*Attestation[\s\S]*?\*\*Name:\*\*[ \t]*([^\n]*)/.exec(markdown);
  return (m?.[1] ?? '').trim();
}

const signatoryText = (s: Signatory): string => (s.title ? `${s.name}, ${s.title}` : s.name);

/**
 * W5 (SC-6): a document whose template names no owner or no approver gets an
 * "Approval" section at its end: the owner (default ISSM) and the approver
 * with name and title, plus signature and date lines. Appended at render time
 * because the 20 templates are pinned Planner copies. A document that already
 * names both, or a signatory with no name, is left as it is.
 */
export function withApprovalBlock(doc: RenderedPolicyDocument, signatories: PolicySignatories): RenderedPolicyDocument {
  const needOwner = !named(documentOwner(doc.markdown)) && signatories.owner;
  const needApprover = !named(documentApprover(doc.markdown)) && signatories.approver;
  if (!needOwner && !needApprover) return doc;
  const eol = doc.markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = ['## Approval', ''];
  if (needOwner) lines.push(`**Document Owner:** ${signatoryText(signatories.owner!)}`);
  if (needApprover) {
    lines.push(`**Approved By:** ${signatoryText(signatories.approver!)} (Authorizing Official)`);
    lines.push('**Signature:** ___________________________');
    lines.push('**Date:** ___________________________');
  }
  const body = doc.markdown.replace(/\s+$/, '');
  return { ...doc, markdown: `${body}${eol}${eol}${lines.join(eol)}${eol}` };
}

/** Unresolved-token patterns: Handlebars leftovers, Planner's markers, V16's single-brace {name}. */
const UNRESOLVED = [/\{\{[^}]+\}\}/g, /\[(TBD|PLACEHOLDER|TODO)\]/gi, /\{[A-Za-z][A-Za-z0-9_]*\}/g];

/**
 * The tenant's naming-convention patterns the templates quote verbatim (e.g.
 * the TCP's CA naming convention `CA-{Number}-{Purpose}`). They are patterns,
 * not unresolved tokens; Planner's golden carries the same text.
 */
export function conventionPatterns(context: PolicyTemplateContext): string[] {
  return [context.tenant.ca_naming, context.tenant.dlp_convention, context.tenant.sensitivity_labels].filter(
    (p): p is string => typeof p === 'string' && /\{[A-Za-z]/.test(p)
  );
}

/** Every unresolved token in a rendered text (empty = clean); `patterns` (conventionPatterns) are skipped. */
export function unresolvedTokens(text: string, patterns: string[] = []): string[] {
  const scanned = patterns.reduce((t, p) => t.split(p).join(' '), text);
  return UNRESOLVED.flatMap((re) => scanned.match(re) ?? []);
}

/** A document's download base name (Planner's PolicyDocumentsPanel / exportAllPoliciesToDocx naming). */
export function policyFileBase(doc: Pick<RenderedPolicyDocument, 'template_id'>): string {
  return doc.template_id.replace(/_/g, '-');
}

/** The raw Policy Inputs bank, from the SPA's static /knowledge assets. */
export async function loadPolicyBank(): Promise<unknown> {
  const resp = await fetch(POLICY_BANK_FILE);
  if (!resp.ok) throw new Error(`Failed to load the Policy Inputs bank: ${resp.status}`);
  return load(await resp.text());
}

/** Profile -> context -> the 22 documents (Planner's 20, then Muster's 2). */
export async function renderPolicySet(args: {
  compile: CompiledForPolicies;
  facts: InterviewFact[];
  party: PolicyParty;
  bank: unknown;
  /** V58: the organisation content's `simulation` block (a simulated customer only). */
  simulation?: unknown;
  /** W5 (SC-6): the organisation content (`roles`, `approvers`); names owners and approvers. */
  orgContent?: unknown;
  /** W5: the plan date (YYYY-MM-DD) for the policies' effective date; default today. */
  planDate?: string;
}): Promise<PolicySet> {
  const a = args.compile.artifacts;
  const profile = buildPolicyInputsProfile({
    facts: args.facts,
    party: args.party,
    missionPlan: a.missionPlan,
    bank: args.bank,
    simulation: args.simulation,
    planDate: args.planDate,
  });
  const context = withOrganisationNames(
    compilePolicyContext({
      policyInputs: profile.output,
      siBaseline: a.siBaseline,
      tenantConfig: a.tenantConfig ?? undefined,
      cuiBoundary: a.cuiBoundary ?? undefined,
      btcConfirmation: a.btcConfirmation ?? undefined,
      readinessPosture: args.compile.posture,
    }),
    args.orgContent
  );
  const signatories = resolvePolicySignatories(context, args.orgContent);
  const documents = [...(await renderAllPolicies(context)), ...(await renderMusterPolicies(context))]
    .map((d) => withApprovalBlock(d, signatories))
    .map(withPlanningDraftBanner)
    .map((d) => withSimulationMarker(d, profile.output.simulation));
  return { profile, context, contextCompleteness: assessContextCompleteness(context), documents };
}

/** One document as DOCX (Planner's exporter: cover page, body, signature block, revision history). */
export function policyDocxBlob(doc: RenderedPolicyDocument, context: PolicyTemplateContext): Promise<Blob> {
  return exportPolicyToDocx(doc, context);
}

/**
 * Headless entry point (runner, tests): a compiled plan + the session's facts
 * and party + the bank -> base name -> { markdown, docx }. Base names are the
 * registry file names without `.md` (e.g. access-control-policy).
 */
export async function renderPolicies(args: {
  compile: CompiledForPolicies;
  facts: InterviewFact[];
  party: PolicyParty;
  bank: unknown;
  simulation?: unknown;
  orgContent?: unknown;
  planDate?: string;
}): Promise<Record<string, { markdown: string; docx: Buffer }>> {
  return policyFiles(await renderPolicySet(args));
}

/** A rendered set -> base name -> { markdown, docx } (Node: the DOCX as a Buffer). */
export async function policyFiles(set: PolicySet): Promise<Record<string, { markdown: string; docx: Buffer }>> {
  const out: Record<string, { markdown: string; docx: Buffer }> = {};
  for (const doc of set.documents) {
    const blob = await policyDocxBlob(doc, set.context);
    out[policyFileBase(doc)] = { markdown: doc.markdown, docx: Buffer.from(await blob.arrayBuffer()) };
  }
  return out;
}
