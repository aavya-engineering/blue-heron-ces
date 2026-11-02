// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W5 cycle 3 (EO rules part 2, items 2 and 5): policy vs tenant reconciliation. The organisation's
 * policy-inputs profile states organisation-defined parameter (ODP) values (PI.ODP.001-015); the
 * tenant reads show what is configured. Each value the tenant configures less strictly than the policy
 * states is one reconciliation row: "Policy states X; tenant configured Y; source rows". A row is a
 * finding for the organisation (its policy and its tenant disagree), not an objective failure: it never
 * changes a control status, the SPRS or the POA&M (cycle-2 decision on IA.L2-3.5.7). Written to the SSP
 * top level (`policyReconciliation[]`, which the harness GAPS register reads) and to the posture block.
 */
import { listOf } from '../mapping/evaluators/conditions.js';
import { EvidenceStore } from '../evidence/store/EvidenceStore.js';
import { POLICY_ODPS } from './OdpValueProvider.js';
import type { PostureReconciliation } from './PostureReconciliation.js';

/** One tenant read as the evidence store holds it (latest record of its source). */
export interface TenantRead {
  sourceId: string;
  recordId: string;
  query: string;
  collectedAt: string;
  payloadSha256: string;
  payload: unknown;
}

export interface PolicyReconciliationRow {
  controlId: string;
  odpId: string;
  odpKey: string;
  policyValue: string;
  tenantValue: string;
  /** The tenant object(s) and setting the tenant value comes from. */
  sourceRows: string[];
  /** The evidence-store read behind the tenant value. */
  readReference: string;
  statement: string;
}

/** The sources the reconciliation reads (EO signal ids, stored by the fetcher under these source ids). */
export const RECONCILIATION_SOURCES = ['directorySettings', 'domains', 'deviceConfigurations', 'compliancePolicies', 'conditionalAccess'] as const;

/**
 * W7-EO (founder ruling 2, 2026-10-29): the CES sign-in frequency baseline (AC.L2-3.1.11). No ODP carries an
 * answered sign-in frequency, so the policy side is the baseline; an enabled CA policy that signs users in less
 * often is one reconciliation row naming both values. Never a status change.
 */
export const SIGN_IN_FREQUENCY_BASELINE_HOURS = 8;
export const BASELINE_ID = 'CES.BASELINE';
const SIGN_IN_FREQUENCY_KEY = 'sign_in_frequency_hours';

/** Entra stores "passwords never expire" as this validity period. */
const NEVER_EXPIRES_DAYS = 2147483647;

type Bound = 'max' | 'min';
interface TenantValue { value: number; text: string; row: string }
interface Comparison {
  odpId: string;
  bound: Bound;
  unit: (n: number) => string;
  /** The tenant values per read, one per configuring object. */
  values: (reads: Map<string, TenantRead>) => Array<{ read: TenantRead; values: TenantValue[] }>;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const nameOf = (r: Record<string, unknown>): string => String(r.displayName ?? r.name ?? r.id ?? 'unnamed');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A directory setting value ('Password Rule Settings' `values: [{ name, value }]`). */
function settingValue(reads: Map<string, TenantRead>, name: string, scale: (n: number) => number, text: (raw: number) => string) {
  const read = reads.get('directorySettings');
  if (!read) return [];
  const values: TenantValue[] = [];
  for (const row of listOf(read.payload)) {
    const pair = (Array.isArray(row.values) ? row.values : []).find((v: any) => v && v.name === name) as { value?: unknown } | undefined;
    const raw = num(pair?.value);
    if (raw !== undefined) values.push({ value: scale(raw), text: text(raw), row: `directory setting '${nameOf(row)}' ${name} = ${String(pair!.value)}` });
  }
  return values.length ? [{ read, values }] : [];
}

/** A numeric property on each Intune object of one read (null / absent = not configured on that object). */
function objectValues(reads: Map<string, TenantRead>, sourceId: string, field: string, kind: string, unit: (n: number) => string) {
  const read = reads.get(sourceId);
  if (!read) return [];
  const values: TenantValue[] = [];
  for (const row of listOf(read.payload)) {
    const n = num(row[field]);
    if (n !== undefined) values.push({ value: n, text: unit(n), row: `${kind} '${nameOf(row)}' ${field} = ${n}` });
  }
  return values.length ? [{ read, values }] : [];
}

const minutes = (n: number) => plural(n, 'minute');
const COMPARISONS: Comparison[] = [
  {
    odpId: 'PI.ODP.001', bound: 'max', unit: n => plural(n, 'failed attempt'),
    values: r => settingValue(r, 'LockoutThreshold', n => n, n => plural(n, 'failed attempt')),
  },
  {
    odpId: 'PI.ODP.002', bound: 'min', unit: minutes,
    values: r => settingValue(r, 'LockoutDurationInSeconds', n => n / 60, n => `${n} seconds (${+(n / 60).toFixed(2)} minutes)`),
  },
  {
    odpId: 'PI.ODP.003', bound: 'max', unit: minutes,
    values: r => [
      ...objectValues(r, 'deviceConfigurations', 'passwordMinutesOfInactivityBeforeScreenTimeout', 'device configuration', minutes),
      ...objectValues(r, 'compliancePolicies', 'passwordMinutesOfInactivityBeforeLock', 'compliance policy', minutes),
    ],
  },
  {
    odpId: 'PI.ODP.004', bound: 'min', unit: n => plural(n, 'character'),
    values: r => [
      ...objectValues(r, 'deviceConfigurations', 'passwordMinimumLength', 'device configuration', n => plural(n, 'character')),
      ...objectValues(r, 'compliancePolicies', 'passwordMinimumLength', 'compliance policy', n => plural(n, 'character')),
    ],
  },
  {
    odpId: 'PI.ODP.005', bound: 'min', unit: n => plural(n, 'previous password'),
    values: r => [
      ...objectValues(r, 'deviceConfigurations', 'passwordPreviousPasswordBlockCount', 'device configuration', n => plural(n, 'previous password')),
      ...objectValues(r, 'compliancePolicies', 'passwordPreviousPasswordBlockCount', 'compliance policy', n => plural(n, 'previous password')),
    ],
  },
  {
    odpId: 'PI.ODP.006', bound: 'max', unit: n => plural(n, 'day'),
    values: r => {
      const read = r.get('domains');
      if (!read) return [];
      const values: TenantValue[] = [];
      for (const row of listOf(read.payload)) {
        const n = num(row.passwordValidityPeriodInDays);
        if (n === undefined) continue;
        values.push({ value: n >= NEVER_EXPIRES_DAYS ? Infinity : n, text: n >= NEVER_EXPIRES_DAYS ? 'passwords never expire' : plural(n, 'day'), row: `domain '${String(row.id ?? 'unnamed')}' passwordValidityPeriodInDays = ${n}` });
      }
      return values.length ? [{ read, values }] : [];
    },
  },
];

const readReference = (r: TenantRead): string =>
  `${r.sourceId} store record ${r.recordId} (${r.query}; collected ${r.collectedAt}; payload sha256 ${r.payloadSha256.slice(0, 12)})`;

/**
 * The reconciliation rows: for each compared ODP the profile answers, every tenant value configured less
 * strictly than the policy states (a maximum exceeded, a minimum not reached). Identical tenant values
 * from several objects of one read are one row listing every object. A stricter tenant value is
 * consistent with the policy and gives no row. `controlIdOf` maps an ODP's NIST number to the SSP's
 * control id. Ordered by ODP id (PI.ODP.001, the lockout threshold, first).
 */
export function buildPolicyReconciliation(
  odps: Record<string, unknown> | null | undefined,
  reads: Map<string, TenantRead>,
  controlIdOf: (nistRef: string) => string | undefined,
): PolicyReconciliationRow[] {
  if (!odps) return [];
  const rows: PolicyReconciliationRow[] = [];
  for (const cmp of COMPARISONS) {
    const def = POLICY_ODPS[cmp.odpId];
    const policy = num(odps[def.key]);
    if (policy === undefined) continue;
    const controlId = controlIdOf(def.nistRefs[0]) ?? def.nistRefs[0];
    for (const { read, values } of cmp.values(reads)) {
      const weaker = values.filter(v => (cmp.bound === 'max' ? v.value > policy : v.value < policy));
      const byText = new Map<string, TenantValue[]>();
      for (const v of weaker) byText.set(v.text, [...(byText.get(v.text) ?? []), v]);
      for (const [text, vs] of byText) {
        const policyValue = `${cmp.bound === 'max' ? 'at most' : 'at least'} ${cmp.unit(policy)} (${def.key})`;
        const sourceRows = vs.map(v => v.row);
        const ref = readReference(read);
        rows.push({
          controlId, odpId: cmp.odpId, odpKey: def.key, policyValue, tenantValue: text, sourceRows, readReference: ref,
          statement: `${controlId} ${cmp.odpId}: Policy states ${policyValue}; tenant configured ${text}; source rows: ${sourceRows.join('; ')} (${ref}). A finding for the organisation to reconcile its policy and its tenant; no control status changes.`,
        });
      }
    }
  }
  rows.push(...signInFrequencyRows(reads, controlIdOf));
  return rows;
}

/** W7-EO (ruling 2): enabled CA policies whose sign-in frequency is longer than the CES baseline, one row per value. */
function signInFrequencyRows(reads: Map<string, TenantRead>, controlIdOf: (nistRef: string) => string | undefined): PolicyReconciliationRow[] {
  const read = reads.get('conditionalAccess');
  if (!read) return [];
  const byText = new Map<string, string[]>();
  for (const row of listOf(read.payload)) {
    if (row.state !== 'enabled') continue;
    const f = (row.sessionControls as Record<string, any> | undefined)?.signInFrequency;
    const v = num(f?.value);
    if (!f?.isEnabled || v === undefined) continue;
    const hours = f.type === 'days' ? v * 24 : v;
    if (hours <= SIGN_IN_FREQUENCY_BASELINE_HOURS) continue;
    const text = plural(hours, 'hour');
    byText.set(text, [...(byText.get(text) ?? []), `conditional access policy '${nameOf(row)}' signInFrequency = ${v} ${String(f.type ?? 'hours')}`]);
  }
  const controlId = controlIdOf('3.1.11') ?? '3.1.11';
  const policyValue = `at most ${plural(SIGN_IN_FREQUENCY_BASELINE_HOURS, 'hour')} (CES baseline, founder ruling 2; ${SIGN_IN_FREQUENCY_KEY})`;
  const ref = readReference(read);
  return [...byText].map(([text, sourceRows]) => ({
    controlId, odpId: BASELINE_ID, odpKey: SIGN_IN_FREQUENCY_KEY, policyValue, tenantValue: text, sourceRows, readReference: ref,
    statement: `${controlId} ${BASELINE_ID}: Policy states ${policyValue}; tenant configured ${text}; source rows: ${sourceRows.join('; ')} (${ref}). A finding for the organisation to reconcile its wish and the baseline; the weaker policy earns no credit and no control status changes.`,
  }));
}

/**
 * The latest evidence-store record of each reconciliation source, with its payload. A missing store,
 * source or unreadable payload is left out (the comparison is then not made, and no row is invented).
 */
export function latestTenantReads(storageRoot: string, tenantId: string): Map<string, TenantRead> {
  const reads = new Map<string, TenantRead>();
  let store: EvidenceStore;
  try { store = EvidenceStore.forStorageRoot(storageRoot, tenantId); } catch { return reads; }
  for (const sourceId of RECONCILIATION_SOURCES) {
    try {
      const recs = store.query({ sourceId }).filter(r => r.status === 'success');
      const latest = recs[recs.length - 1];
      if (!latest) continue;
      reads.set(sourceId, {
        sourceId, recordId: latest.recordId, query: latest.query, collectedAt: latest.collectedAt,
        payloadSha256: latest.payloadSha256, payload: store.readPayload(latest),
      });
    } catch {
      // unreadable store record or payload: not compared
    }
  }
  return reads;
}

/**
 * Writes the rows onto a generated SSP: `policyReconciliation[]` at the top level, and in the posture
 * block (rows plus one statement each, after a lead statement). Never touches a status or a score.
 * Idempotent (a second call replaces the rows and adds no second statement).
 */
export function applyPolicyReconciliation<T extends { controlImplementations: Array<{ control_id: string; nist_ref: string }>; postureReconciliation?: PostureReconciliation; policyReconciliation?: PolicyReconciliationRow[] }>(
  ssp: T,
  odps: Record<string, unknown> | null | undefined,
  reads: Map<string, TenantRead>,
): T {
  if (!odps) return ssp;
  const byNist = new Map(ssp.controlImplementations.map(c => [c.nist_ref, c.control_id]));
  const rows = buildPolicyReconciliation(odps, reads, n => byNist.get(n));
  ssp.policyReconciliation = rows;
  const pr = ssp.postureReconciliation;
  if (pr) {
    pr.policyReconciliation = rows;
    pr.statements = pr.statements.filter(s => !s.startsWith(POLICY_LEAD) && !rows.some(r => r.statement === s) && !/^[A-Z]{2}\.L\d-\d+\.\d+\.\d+ (PI\.ODP\.\d{3}|CES\.BASELINE): Policy states /.test(s));
    pr.statements.push(rows.length === 0
      ? `${POLICY_LEAD}: no organisation-defined parameter that EO compares is configured less strictly in the tenant than the policy states.`
      : `${POLICY_LEAD}: ${rows.length} organisation-defined parameter value(s) differ between the policy and the tenant. Each is a finding for the organisation, not an objective failure; no control status, score or POA&M item changes.`);
    pr.statements.push(...rows.map(r => r.statement));
  }
  return ssp;
}

/** The lead of the posture statement for the policy reconciliation. */
export const POLICY_LEAD = 'Policy reconciliation (policy vs tenant)';
