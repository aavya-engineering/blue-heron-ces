// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W4-AO4: PASS / HONEST-OPEN / FAILING classification for one matrix op.
//
// FAILING = an AO-side fault. Any of these fails the matrix test:
//  - a request that did not persist exactly ONE contract-conforming evidence row;
//  - a deny case that did not deny with its own outcome (sim-only rail, CMMC, CUI);
//  - a Tier-3 op whose two-person round trip misbehaved (no pending stop, a
//    self-approval that was not refused with 409, a second-person approval that failed);
//  - a dry run that sent a write (setApplied true) or a server error on a dry run;
//  - an evidence outcome that contradicts the HTTP result.
// HONEST-OPEN = AO behaved correctly but the sim cannot show the op working
// (value unbound, sim returned an error/empty data, the write did not land in the
// paired read). Each maps to ONE requirement file by cause and cmdlet family.
// PASS = everything above holds AND the op did its job observably on the sim:
//  - read op: the live output carries data;
//  - write op: the live write changed the state its paired read observes (stateChanged).

export interface RunSummary {
  http: number;
  success: boolean;
  status?: string;
  outcome?: string;
  verdict?: string;
  /** FC-AO-2: the live row's verdict rationale (X1 / E-06 demotions are named here). */
  verdictRationale?: string;
  error: string;
  stdout: string;
  stderr: string;
  pre?: string;
  post?: string;
  stateChanged?: boolean;
  setApplied?: boolean;
  stateReadError?: string;
  rowCount: number;
  conforming: number;
  rowOutcome?: string;
}

export interface OpObservation {
  id: string;
  domain: string;
  title: string;
  tier: string;
  engine: string;
  /** FC-AO-2 (X1): the command's idempotency class (registry override or classifier). */
  idempotency?: string;
  writeShaped: boolean;
  getCommand: string;
  setCommand: string;
  params: string[];
  sourced: string[];
  l2: boolean;
  cuiApplicable: boolean;
  dry?: RunSummary;
  pending?: RunSummary;
  live?: RunSummary;
  selfApprovalStatus?: number;
  rejectionStatus?: number;
  approvalStatus?: number;
  denySimOnly?: RunSummary;
  denyCmmc?: RunSummary;
  denyCui?: RunSummary;
}

export type Family = 'graph' | 'azure' | 'm365-compliance';

export interface OpVerdict {
  id: string;
  status: 'PASS' | 'HONEST-OPEN' | 'FAILING';
  reason: string;
  req?: string;
  family: Family;
  denies: string[];
}

export const REQ_SOURCE_KEYS = 'REQ-tenant-stacksim-ao-source-keys';
export const REQ_BY_FAMILY: Record<Family, string> = {
  graph: 'REQ-tenant-stacksim-graph-fidelity',
  azure: 'REQ-tenant-stacksim-azure-fidelity',
  'm365-compliance': 'REQ-tenant-stacksim-m365-compliance',
};

/**
 * Outputs that LOOK non-empty but carry no tenant data. Each is a documented
 * observation, not a relaxation: these ops stay HONEST-OPEN.
 */
export const NO_DATA_OBSERVED: Record<string, string> = {
  // FC-AO-2: D-02's override removed (tenant-stacksim REQ-ces-ao-matrix-inputs). Its command now
  // emits its own output (ConvertTo-Json per statement), so the classifier decides on the data.
};

/** FC-AO-2 (X1): mirrors EvidenceEmitter.ALWAYS_MUTATE_IDEMPOTENCY_CLASSES (asserted equal in the matrix test). */
export const ALWAYS_MUTATE: ReadonlySet<string> = new Set(['unsafe_requires_gate', 'unsafe']);
const X1_RATIONALE = /paired read shows no change, and this command always mutates state/;

/**
 * FC-AO-2: ops whose open cause is a specific AO->sim requirement rather than the family-wide fidelity REQ
 * (the op's read is real-service-correct; the sim does not serve it yet). The REQ must still name the op.
 */
export const REQ_BY_OP: Record<string, string> = {
  'B-08': 'REQ-tenant-stacksim-ao-paired-read-endpoints',
};

export function familyOf(o: Pick<OpObservation, 'getCommand' | 'setCommand' | 'engine'>): Family {
  // The family of the READ that observes the op decides (it is what the sim must answer);
  // the set is consulted only when there is no get.
  const text = o.getCommand || o.setCommand || '';
  if (/Search-UnifiedAuditLog|ComplianceCase|ComplianceSearch|CaseHold|-Label\b|LabelPolicy|DlpCompliance|TransportRule|Mailbox|OMEConfiguration|-SPO|PnP|-Cs[A-Z]|-Team|Connect-ExchangeOnline|Connect-IPPSSession|AdminAuditLog/.test(text)) {
    return 'm365-compliance';
  }
  if (/\baz\s+[a-z]|-Az[A-Z]|Invoke-AzRestMethod/.test(text)) return 'azure';
  return 'graph';
}

export function cleanOutput(s: string | undefined): string {
  return String(s ?? '').replace(/STAMPER_EXECUTION_SUCCESS/g, '').replace(/\s+/g, ' ').trim();
}

export function hasData(id: string, stdout: string | undefined): boolean {
  if (NO_DATA_OBSERVED[id]) return false;
  const c = cleanOutput(stdout);
  if (!c) return false;
  if (/^\{\s*"value"\s*:\s*\[\s*\]\s*\}$/.test(c)) return false;
  if (/^Count -+ 0$/.test(c)) return false;
  return true;
}

function rowProblems(label: string, r: RunSummary | undefined): string[] {
  if (!r) return [];
  const p: string[] = [];
  if (r.rowCount !== 1) p.push(`${label}: ${r.rowCount} evidence rows (expected exactly 1)`);
  else if (r.conforming !== 1) p.push(`${label}: evidence row does not conform to the AdminOps evidence schema`);
  return p;
}

export function classify(o: OpObservation): OpVerdict {
  const family = familyOf(o);
  const tier3 = /3/.test(o.tier);
  const problems: string[] = [];
  const denies: string[] = [];

  for (const [label, r] of [['dry', o.dry], ['pending', o.pending], ['live', o.live], ['deny-sim-only', o.denySimOnly], ['deny-cmmc', o.denyCmmc], ['deny-cui', o.denyCui]] as const) {
    problems.push(...rowProblems(label, r));
  }

  // Deny cases.
  if (o.denySimOnly?.rowOutcome !== 'denied_sim_only' || o.denySimOnly?.success) problems.push(`sim-only rail did not deny (${o.denySimOnly?.rowOutcome})`);
  else denies.push('sim-only');
  if (o.l2) {
    if (o.denyCmmc?.rowOutcome !== 'denied_cmmc' || o.denyCmmc?.success) problems.push(`CMMC gate did not deny an L2 op on an L1 tenant (${o.denyCmmc?.rowOutcome})`);
    else denies.push('cmmc');
  }
  if (o.cuiApplicable) {
    const out = o.denyCui?.rowOutcome;
    if (tier3 && out === 'blocked_pending_approval') denies.push('cui(SoD first)');
    // Nothing boundary-checked could bind on this tenant: the op fails unbound before any
    // resource reaches the boundary check (nothing is sent) — not a boundary bypass.
    else if (!o.denyCui?.success && /Parameter binding failed/.test(o.denyCui?.error ?? '')) denies.push('cui(n/a: unbound)');
    else if (out !== 'denied_cui' || o.denyCui?.success) problems.push(`CUI boundary did not deny an out-of-boundary resource (${out})`);
    else denies.push('cui');
  }

  // Tier-3 two-person round trip.
  if (tier3) {
    if (o.pending?.rowOutcome !== 'blocked_pending_approval' || o.pending?.http !== 202) problems.push('Tier-3 op did not stop at a pending approval');
    if (o.selfApprovalStatus !== 409) problems.push(`self-approval not refused (HTTP ${o.selfApprovalStatus})`);
    if (o.approvalStatus !== 200) problems.push(`second-person approval failed (HTTP ${o.approvalStatus})`);
    if (o.rejectionStatus !== undefined && o.rejectionStatus !== 200) problems.push(`rejection failed (HTTP ${o.rejectionStatus})`);
    if (problems.length === 0) denies.push('sod');
  }

  // W4-AO1: the adapter's dry-run placeholder must never reach a response or a row.
  for (const [label, r] of [['dry', o.dry], ['live', o.live]] as const) {
    if (r && /\[dry-run\] PowerShell commands validated|DRY RUN: PowerShell execution skipped/.test(`${r.stdout} ${r.pre ?? ''} ${r.post ?? ''}`)) {
      problems.push(`${label}: the dry-run placeholder was recorded as output/state`);
    }
  }

  // Dry run: never a write, never a server error; Tier-3 dry runs stop at the gate.
  const d = o.dry;
  if (d) {
    if (d.setApplied) problems.push('dry run applied the set_command');
    if (d.http >= 500) problems.push(`dry run returned HTTP ${d.http}`);
    if (!tier3 && d.rowOutcome !== 'dry_run') problems.push(`dry run row outcome ${d.rowOutcome} (expected dry_run)`);
  }

  // Live: outcome must agree with the HTTP result.
  const l = o.live;
  if (!l) problems.push('no live run');
  else if (l.success && /^(denied_|failed)/.test(l.rowOutcome ?? '')) problems.push(`live success with outcome ${l.rowOutcome}`);
  else if (!l.success && l.rowOutcome === 'automated_success') problems.push('live failure recorded as automated_success');

  // FC-AO-2 (X1, founder decision): only an always-mutate class may be demoted for "no observed
  // change". An idempotent op carrying the X1 rationale is an AO-side fault.
  if (l && X1_RATIONALE.test(l.verdictRationale ?? '') && !ALWAYS_MUTATE.has(String(o.idempotency ?? ''))) {
    problems.push(`X1: idempotent op (${o.idempotency}) was demoted for no observed change`);
  }

  if (problems.length > 0) return { id: o.id, status: 'FAILING', reason: problems.join('; '), family, denies };

  // HONEST-OPEN causes.
  if (l && !l.success && /Parameter binding failed/.test(l.error)) {
    return { id: o.id, status: 'HONEST-OPEN', reason: `tenant value unbound: ${firstUnbound(l.error)}`, req: REQ_SOURCE_KEYS, family, denies };
  }
  const req = REQ_BY_OP[o.id] ?? REQ_BY_FAMILY[family];
  if (l && !l.success) {
    return { id: o.id, status: 'HONEST-OPEN', reason: `sim error: ${cleanOutput(l.error).slice(0, 160)}`, req, family, denies };
  }
  if (o.writeShaped) {
    if (l?.stateReadError) return { id: o.id, status: 'HONEST-OPEN', reason: `write applied; post-state read failed on the sim: ${cleanOutput(l.stateReadError).slice(0, 140)}`, req, family, denies };
    if (l?.stateChanged !== true) return { id: o.id, status: 'HONEST-OPEN', reason: 'write applied but the paired read shows no change on the sim (pre == post)', req, family, denies };
    return { id: o.id, status: 'PASS', reason: 'live write changed the state its paired read observes; evidence row conforms; denies proven', family, denies };
  }
  // FC-AO-2: the production verdict agrees — a read AO itself judged empty (W4-AO5 / E-06) is not PASS.
  if (!hasData(o.id, l?.stdout) || /^Read returned no data/.test(l?.verdictRationale ?? '')) {
    return { id: o.id, status: 'HONEST-OPEN', reason: NO_DATA_OBSERVED[o.id] ?? 'read ran clean but the sim returned no data for it', req, family, denies };
  }
  return { id: o.id, status: 'PASS', reason: 'live read returned tenant data; evidence row conforms; denies proven', family, denies };
}

function firstUnbound(err: string): string {
  const keys = [...err.matchAll(/none of \[([^\]]+)\]/g)].map((m) => m[1].split(', ').pop());
  return keys.join(', ') || cleanOutput(err).slice(0, 120);
}
