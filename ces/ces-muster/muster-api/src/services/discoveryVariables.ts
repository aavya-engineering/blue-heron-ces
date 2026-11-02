// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// discoveryVariables.ts — synthetic-customer W5c3 (P-2): the values the
// registry get_commands' `{variable}` placeholders need, resolved BEFORE the
// read-only discovery walk from reads Muster already makes. Before, the walk ran
// every placeholder literally (e.g. userPrincipalName eq '{operatorUPN}'), so
// those reads came back empty and their controls stayed unsure.
//
//   operatorUPN       TCP.MU.004  (graph:me; the consented operator)
//   breakGlassUPN     TCP.IA.001  (first break-glass account; CA exclusions x GA)
//   tenantId          TCP.TI.001  (graph:organization)
//   tenantName        TCP.TI.002  (primary domain's first label)
//   primaryDomain     TCP.TI.002  (W5c6: the Exchange rule blocks' RecipientDomainIs)
//   operatorUserId    graph:users (the object id of operatorUPN)
//   roleDefId         Global Administrator role template (platform constant; the
//                     value Muster's operator values give Stamper)
//   complianceRoleId  Compliance Administrator role template (platform constant)
//   lawWorkspaceName, resourceGroup, subscriptionId
//                     the ONE Log Analytics workspace an az read lists (its name,
//                     and the resource group / subscription in its ResourceId);
//                     several or none: nothing (a choice is not a reading).
// Not resolved: adminUserName (an operator choice no read holds; it is answered
// in org-content for the plan, which discovery does not read).
//
// W5c4 (the Stamper lookup blocks' value placeholders):
//   cuiGroupId        graph:groups — the first security group whose name
//                     contains "CUI", in read order (the rule operatorValues
//                     uses for cuiGroupName from TCP.GA.002, so the TM and
//                     discovery name the same group)
//   phishingResistantStrengthId
//                     graph authenticationStrength/policies — the built-in
//                     strength whose combinations are all phishing-resistant;
//                     when the read is not served, the platform's fixed id
//   wifiSsid          the organisation's answer TCP.MU.006 (an answer, never a
//                     reading: the SSID a Wi-Fi profile carries is what is judged)
//   cisoEmail         W5c6: the answer TCP.MU.007 (the security mailbox; AZ-MON-001's
//                     action group must mail it)
// and the answered bounds (answerBoundsFromFacts): PI.ODP.003, the inactivity
// timeout in minutes, on the screen-lock path the registry binds; W5c5
// PI.ODP.004 / PI.ODP.005, the password length and history the Windows
// compliance entry binds.
//
// Same FCA guardrail as the harvest: a failed or empty read yields no value, and
// an unresolved placeholder stays literal (the read then behaves as before).
import type { GraphClient } from '../lib/graphClient.js';
import type { DiscoverySession } from './discoveryService.js';
import { ROLE_TEMPLATE, TENANT_READS, tenantFactsFromReads, type TenantFact, type TenantReads } from './harvestService.js';

/** The placeholders this module can fill (in the order documented above). */
export const DISCOVERY_VARIABLES = [
  'operatorUPN',
  'breakGlassUPN',
  'tenantId',
  'tenantName',
  'operatorUserId',
  'roleDefId',
  'complianceRoleId',
  'lawWorkspaceName',
  'resourceGroup',
  'subscriptionId',
  'cuiGroupId',
  'primaryDomain',
  'phishingResistantStrengthId',
  'wifiSsid',
  'cisoEmail',
  'adminNamingPattern',
] as const;
export type DiscoveryVariable = (typeof DISCOVERY_VARIABLES)[number];

/** The read-only az read that lists Log Analytics workspaces (served by the sim's Az shim). */
export const WORKSPACE_READ = 'Get-AzOperationalInsightsWorkspace | ConvertTo-Json -Depth 5';

/** The Graph reads the variables need (a subset of the harvest's tenant reads). */
const GRAPH_READS = ['organization', 'users', 'roleAssignments', 'conditionalAccess', 'me', 'groups'] as const;

/** W5c4: the authentication strengths (Graph v1.0); not a harvest read. */
export const AUTH_STRENGTH_READ = '/identity/conditionalAccess/authenticationStrength/policies';
/** The built-in "Phishing-resistant MFA" strength: a platform constant, identical in every tenant. */
export const BUILTIN_PHISHING_RESISTANT_STRENGTH_ID = '00000000-0000-0000-0000-000000000004';
const PHISHING_RESISTANT = new Set(['fido2', 'windowshelloforbusiness', 'x509certificatemultifactor']);

/** W5c4: the answered question that supplies each answer-held variable. */
export const ANSWER_VARIABLES: Record<string, DiscoveryVariable> = {
  'TCP.MU.006': 'wifiSsid',
  // W5c6: the answered security mailbox is also Stamper's cisoEmail (the plan emits it under both names).
  'TCP.MU.007': 'cisoEmail',
};
/**
 * W5c4: answered bounds, by the dot path a registry org_value_binding names
 * (the same question -> path pairs as the plan's verificationExpectations.ts).
 */
export const ANSWER_BOUND_QUESTIONS: Record<string, string> = {
  'PI.ODP.003': '$.passwordMinutesOfInactivityBeforeScreenTimeout',
  // W5c5: the Windows compliance entry's bindings (verificationExpectations IA.L2-3.5.7 / IA.L2-3.5.8).
  'PI.ODP.004': '$.passwordMinimumLength',
  'PI.ODP.005': '$.passwordPreviousPasswordBlockCount',
  // W5c7: the authoritative time source (a string bound on the time-sync entry's $.timeServer).
  'PI.ODP.016': '$.timeServer',
};
/** W5c7: the answered bounds that are text, not numbers. */
const STRING_BOUND_QUESTIONS = new Set(['PI.ODP.016']);

/** An answer as the answers file / session holds it (InterviewFact subset). */
export interface AnswerFact {
  question_id: string;
  answer: string;
  confidence?: string;
}

const lastAnswer = (facts: AnswerFact[], id: string): string => {
  for (let i = facts.length - 1; i >= 0; i--) {
    const f = facts[i];
    if (f.question_id === id && f.confidence !== 'unknown' && typeof f.answer === 'string') return f.answer.trim();
  }
  return '';
};

/** Pure: the variables the organisation's answers hold (wifiSsid). */
export function variablesFromAnswers(facts: AnswerFact[]): Partial<Record<DiscoveryVariable, string>> {
  const out: Partial<Record<DiscoveryVariable, string>> = {};
  for (const [qid, name] of Object.entries(ANSWER_VARIABLES)) {
    const v = lastAnswer(facts, qid);
    if (v) out[name] = v;
  }
  return out;
}

/** Pure: answered bounds keyed by lower-cased dot path (numbers only). */
export function answerBoundsFromFacts(facts: AnswerFact[]): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [qid, p] of Object.entries(ANSWER_BOUND_QUESTIONS)) {
    const v = lastAnswer(facts, qid);
    if (STRING_BOUND_QUESTIONS.has(qid)) {
      if (v) out[p.toLowerCase()] = v;
    } else if (/^\d+(\.\d+)?$/.test(v)) out[p.toLowerCase()] = Number(v);
  }
  return out;
}

/**
 * W5c7: the admin naming convention as Stamper's ManifestReader builds
 * `adminNamingPattern` (ces-stamper src/translators/ManifestReader.ts, EO's
 * conventionPattern): a whole-UPN regex; {firstname} / {lastname} match
 * ([a-z0-9\x27-]+), any other {token} [^@\s]+, the rest literal. Copied, not
 * imported (tool boundary); a test pins the S1 / S2 values.
 */
export function adminNamingPattern(convention: string): string {
  const src = convention
    .split(/(\{[A-Za-z]+\})/)
    .map((tok) => {
      const m = /^\{([A-Za-z]+)\}$/.exec(tok);
      if (!m) return tok.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
      const k = m[1].toLowerCase();
      return k === 'firstname' || k === 'lastname' ? '([a-z0-9\\x27-]+)' : '[^@\\s]+';
    })
    .join('');
  return `^${src}$`;
}

/** W5c7: the admin-account GET's {adminNamingPattern}: the answered TCP.IA.002 convention, else Stamper's '(?!)' (matches no UPN). */
export function adminNamingPatternFromAnswers(facts: AnswerFact[]): string {
  const convention = lastAnswer(facts, 'TCP.IA.002');
  const pattern = convention ? adminNamingPattern(convention) : undefined;
  return pattern !== undefined && !/['`;|&<>\r\n]|\$\(|\$\{/.test(pattern) ? pattern : '(?!)';
}

/** Pure: cuiGroupId from the groups read (first security group naming CUI). */
export function cuiGroupIdFromGroups(groups: unknown): string {
  const g = list(groups).find((x) => x.securityEnabled === true && /cui/i.test(str(x.displayName)));
  return g ? str(g.id) : '';
}

/** Pure: the built-in phishing-resistant strength's id from the strengths read, else ''. */
export function phishingResistantStrengthFromRead(read: unknown): string {
  const p = list(read).find((x) => {
    const combos = Array.isArray(x.allowedCombinations) ? (x.allowedCombinations as unknown[]).map((c) => str(c).toLowerCase()).filter(Boolean) : [];
    return str(x.policyType).toLowerCase() === 'builtin' && combos.length > 0 && combos.every((c) => PHISHING_RESISTANT.has(c));
  });
  return p ? str(p.id) : '';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
function list(v: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
  if (v && typeof v === 'object' && Array.isArray((v as { value?: unknown }).value)) {
    return (v as { value: Array<Record<string, unknown>> }).value;
  }
  return [];
}

/** Pure: the variables the harvest's tenant facts (and the users read) hold. */
export function variablesFromTenantFacts(
  facts: TenantFact[],
  users: unknown = undefined
): Partial<Record<DiscoveryVariable, string>> {
  const out: Partial<Record<DiscoveryVariable, string>> = {};
  const fact = (id: string) => facts.find((f) => f.question_id === id)?.answer.trim() ?? '';
  const set = (k: DiscoveryVariable, v: string) => {
    if (v) out[k] = v;
  };
  set('operatorUPN', fact('TCP.MU.004'));
  set('breakGlassUPN', fact('TCP.IA.001').split(',')[0]?.trim() ?? '');
  set('tenantId', fact('TCP.TI.001'));
  set('tenantName', fact('TCP.TI.002').split('.')[0] ?? '');
  // W5c6: the Exchange rule blocks scope rules to the primary domain (RecipientDomainIs contains {primaryDomain}).
  set('primaryDomain', fact('TCP.TI.002'));
  const upn = out.operatorUPN?.toLowerCase();
  if (upn) set('operatorUserId', str(list(users).find((u) => str(u.userPrincipalName).toLowerCase() === upn)?.id));
  out.roleDefId = ROLE_TEMPLATE.globalAdministrator;
  out.complianceRoleId = ROLE_TEMPLATE.complianceAdministrator;
  return out;
}

/** Pure: workspace name, resource group and subscription from the az workspace read (exactly one workspace). */
export function variablesFromWorkspaceRead(stdout: string): Partial<Record<DiscoveryVariable, string>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return {};
  }
  const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : [];
  if (items.length !== 1) return {};
  const ws = items[0] as Record<string, unknown>;
  const key = (k: string) => Object.keys(ws).find((x) => x.toLowerCase() === k.toLowerCase());
  const get = (k: string) => {
    const kk = key(k);
    return kk ? str(ws[kk]) : '';
  };
  const out: Partial<Record<DiscoveryVariable, string>> = {};
  const name = get('Name');
  const rid = get('ResourceId') || get('Id');
  const m = /\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\//i.exec(rid);
  if (name) out.lawWorkspaceName = name;
  const rg = get('ResourceGroupName') || (m ? m[2] : '');
  if (rg) out.resourceGroup = rg;
  if (m) out.subscriptionId = m[1];
  return out;
}

/**
 * Resolve the variables before a walk: the Graph tenant reads (per-read
 * non-fatal) and one az workspace read through the walk's own session. Never
 * throws; anything unread is simply absent.
 */
export async function resolveDiscoveryVariables(
  client: GraphClient | null,
  session: DiscoverySession,
  now: () => Date = () => new Date(),
  answers: AnswerFact[] = []
): Promise<Partial<Record<DiscoveryVariable, string>>> {
  const reads: TenantReads = {};
  if (client) {
    for (const name of GRAPH_READS) {
      try {
        reads[name] = await client.get(TENANT_READS[name]);
      } catch {
        // absence, not 'no'
      }
    }
  }
  const out = variablesFromTenantFacts(tenantFactsFromReads(reads, now().toISOString()), reads.users);
  const cui = cuiGroupIdFromGroups(reads.groups);
  if (cui) out.cuiGroupId = cui;
  let strength = '';
  if (client) {
    try {
      strength = phishingResistantStrengthFromRead(await client.get(AUTH_STRENGTH_READ));
    } catch {
      // not served: the platform constant below
    }
  }
  out.phishingResistantStrengthId = strength || BUILTIN_PHISHING_RESISTANT_STRENGTH_ID;
  Object.assign(out, variablesFromAnswers(answers));
  // W5c7: always set (Stamper's rule), so the admin-account read never runs with the literal placeholder.
  out.adminNamingPattern = adminNamingPatternFromAnswers(answers);
  try {
    const r = await session.execute('az', WORKSPACE_READ);
    if (r.exitCode === 0 && r.stdout.trim()) Object.assign(out, variablesFromWorkspaceRead(r.stdout));
  } catch {
    // absence
  }
  return out;
}

/** The registry entries whose get_command uses a placeholder, and how many of them the variables fill completely. */
export function variableCoverage(
  entries: Array<{ entry_id: string; get_command?: string; manual_only?: boolean }>,
  variables: Partial<Record<string, string>>
): { withPlaceholders: number; filled: number; partial: number; byVariable: Record<string, number> } {
  let withPlaceholders = 0;
  let filled = 0;
  let partial = 0;
  const byVariable: Record<string, number> = {};
  for (const e of entries) {
    if (e.manual_only || !e.get_command) continue;
    const names = [...new Set([...e.get_command.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((m) => m[1]))];
    if (names.length === 0) continue;
    withPlaceholders++;
    for (const n of names) byVariable[n] = (byVariable[n] ?? 0) + 1;
    const have = names.filter((n) => Boolean(variables[n]));
    if (have.length === names.length) filled++;
    else if (have.length > 0) partial++;
  }
  return { withPlaceholders, filled, partial, byVariable };
}
