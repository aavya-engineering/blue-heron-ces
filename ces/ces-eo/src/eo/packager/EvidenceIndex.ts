// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// EO-collection W4.3 / W4.4: the assessor evidence index (the SSP's Appendix P evidence index as JSON).
//
// Built from the SSP's per-control `evidenceDetails` (SSP-uplift W3.1) and the evidence-store
// records. It holds:
// - entries[]          one per evidence detail per control, each with its 800-171A method label
//                      (MethodLabeler), and for store records the collector, query and window;
// - samplingWindows[]  per control family, the window the store records cover and the sample count
//                      (SamplingWindow);
// - examineCoverage[]  per control, each 800-171A examine item (data/examine-lists.json) against the
//                      evidence kinds present: covered / not covered.
// W5 cycle 4 (SC-3a): the reviewable table data/examine-coverage-map.json refines the regex rules per item text:
// class a adds the configuration kinds an item really asks for; class b attaches the latest returned, hashed
// evidence-store record of a tenant-wide source (audit log, account and device lists) that is not routed to the
// control; class e attaches an organisation record (EC upload) the SSP lists on a control (organisationRecords);
// class d reclassifies an item that is not automatable to documentary, with the reason. Attached entries carry
// `attachment: 'examine-item'`, the method examine and the record's hash.
// Pure apart from loading the examine lists and the map; never emits an absolute path. The run package's
// bundle.mjs calls buildEvidenceIndex from dist/ for bundle item 12.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { EvidenceRecord } from '../evidence/store/types.js';
import { FAMILY_POLICY_BASES } from '../ssp/OdpValueProvider.js';
import {
  methodForStoreSource, STAMPER_FILE_METHOD, ADMIN_OPS_SOURCE, ADMIN_OPS_CONFIRMED_APPLY_ENDPOINT, type AssessmentMethod,
} from './MethodLabeler.js';
import { familyOf, samplingWindowsByFamily, type FamilySamplingWindow } from './SamplingWindow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXAMINE_LISTS_PATH = path.resolve(__dirname, '../../../data/examine-lists.json');

export interface ExamineRequirement { requirement_id: string; requirement_text?: string; examine: string[]; examine_count?: number }
export interface ExamineLists {
  schema?: string;
  source: { file: string; sha256: string; [k: string]: unknown };
  requirements: ExamineRequirement[];
}

export function loadExamineLists(file: string = EXAMINE_LISTS_PATH): ExamineLists {
  return JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^﻿/, '')) as ExamineLists;
}

export const EXAMINE_COVERAGE_MAP_PATH = path.resolve(__dirname, '../../../data/examine-coverage-map.json');

/** W5 cycle 4: one row of data/examine-coverage-map.json (see the module comment for the classes). */
export interface ExamineCoverageRule {
  text: string;
  class: 'a' | 'b' | 'd' | 'e';
  addKinds?: EvidenceKind[];
  storeSources?: string[];
  recordKinds?: string[];
  reclassify?: 'documentary';
  /**
   * W5 cycle 5: the requirements (800-171 numbers, e.g. "3.3.4") the rule applies to. Without it the rule applies
   * to every requirement whose examine list carries the text; a scoped rule wins over an unscoped one there.
   */
  requirements?: string[];
  /**
   * W5 cycle 5: 'requirement' = the class-b source is the very record the item asks for (e.g. terms-of-use
   * acceptances for banner acknowledgements), not a tenant-wide record examined for the requirement's events;
   * its attachment carries no tenant-wide note (ruling R1 applies only to the others).
   */
  scope?: 'requirement';
  reason: string;
}
export interface ExamineCoverageMap { schema?: string; about?: string; items: ExamineCoverageRule[] }

export function loadExamineCoverageMap(file: string = EXAMINE_COVERAGE_MAP_PATH): ExamineCoverageMap {
  return JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^﻿/, '')) as ExamineCoverageMap;
}

/**
 * Kinds of evidence a control can hold. `ssp` and `poam` are the package's own documents.
 * `admin-ops change` / `admin-ops read` = a C10 (collect.adminOps) record of an AdminOps row: an apply
 * with a confirming read (AD-6, state verified), or any other row (a read-only op, a dry run, an
 * unconfirmed apply, a blocked or denied request: state not verified).
 */
export type EvidenceKind =
  | 'stamper-file' | 'configuration' | 'audit-log' | 'security-monitoring' | 'account-inventory'
  | 'device-inventory' | 'vulnerability-scan' | 'training-record' | 'admin-ops change' | 'admin-ops read' | 'ssp' | 'poam'
  | 'organisation-record';

const STORE_KIND: Record<string, EvidenceKind> = {
  directoryAudits: 'audit-log', signInLogs: 'audit-log', ediscoveryCases: 'audit-log',
  'collect.unifiedAuditLog': 'audit-log', 'collect.directoryAudits': 'audit-log', 'collect.signIns': 'audit-log', 'collect.pimActivations': 'audit-log',
  securityAlerts: 'security-monitoring', securityIncidents: 'security-monitoring', riskDetections: 'security-monitoring', secureScores: 'security-monitoring',
  'collect.securityAlerts': 'security-monitoring', 'collect.securityIncidents': 'security-monitoring', 'collect.riskDetections': 'security-monitoring',
  'collect.riskyUsers': 'security-monitoring', 'collect.secureScores': 'security-monitoring', 'collect.secureScoreControlProfiles': 'security-monitoring',
  directoryUsers: 'account-inventory', roleAssignments: 'account-inventory', roleAssignmentsAll: 'account-inventory', cuiGroup: 'account-inventory',
  // W5 cycle 8 (IA.L2-3.5.3): the per-user MFA registration report.
  userRegistrationDetails: 'account-inventory',
  managedDevices: 'device-inventory', managedDevicesAll: 'device-inventory', detectedApps: 'device-inventory', 'collect.deviceCompliance': 'device-inventory',
  vulnerabilities: 'vulnerability-scan', tvmAssessmentRecency: 'vulnerability-scan', 'collect.tvmAssessmentRecency': 'vulnerability-scan', 'collect.tvmVulnerabilities': 'vulnerability-scan',
  trainingUserCoverage: 'training-record',
  // W5 cycle 5 (SC-3a): the examine-coverage reads (ComplianceSignalFetcher.fetchExamineCoverageReads, protectionAlerts).
  defenderProtectionStates: 'security-monitoring', windowsMalwareInformation: 'security-monitoring',
  remoteActionAudits: 'audit-log', intuneWipeAuditEvents: 'audit-log',
  touAcceptances: 'account-inventory', accessReviews: 'account-inventory', sitePermissions: 'account-inventory',
  protectionAlerts: 'configuration',
};

/**
 * The evidence kind of an evidence-store source. A C10 (AdminOps) record is `admin-ops change` when its
 * endpoint names a confirmed apply, else `admin-ops read`. Other unlisted sources: configuration if the
 * method is examine, else security-monitoring.
 */
export function evidenceKindOfStoreSource(sourceId: string, endpoint?: string): EvidenceKind {
  if (sourceId === ADMIN_OPS_SOURCE) return endpoint === ADMIN_OPS_CONFIRMED_APPLY_ENDPOINT ? 'admin-ops change' : 'admin-ops read';
  return STORE_KIND[sourceId] ?? (methodForStoreSource(sourceId) === 'examine' ? 'configuration' : 'security-monitoring');
}

/**
 * Which evidence kinds can cover one examine item. First match wins (case-insensitive):
 * the SSP; the POA&M; documents (policy, procedures, plans, design documentation, agreements,
 * contracts: nothing automated covers them); training; configuration (a confirmed AdminOps change
 * counts: its confirming read shows the setting after the apply; an AdminOps read does not, AD-6);
 * audit logs and monitoring records; incidents and alerts; vulnerabilities and scans; devices,
 * components and software; accounts, roles and authorizations. Anything else is documentary.
 */
const EXAMINE_RULES: Array<{ re: RegExp; category: string; kinds: EvidenceKind[] }> = [
  { re: /system security plan/i, category: 'ssp', kinds: ['ssp'] },
  { re: /plan of action/i, category: 'poam', kinds: ['poam'] },
  { re: /\bpolic(y|ies)\b|\bprocedures?\b|\bplans?\b|design documentation|\bagreements?\b|\bcontracts?\b|\bcharters?\b/i, category: 'documentary', kinds: [] },
  { re: /training|awareness/i, category: 'training', kinds: ['training-record'] },
  { re: /configuration|settings|baseline/i, category: 'configuration', kinds: ['stamper-file', 'configuration', 'admin-ops change'] },
  { re: /audit (logs?|records?|review)|auditable events|monitoring records|monitoring\/audit|system monitoring/i, category: 'audit-log', kinds: ['audit-log', 'security-monitoring'] },
  { re: /incident|alert|intrusion|malicious|attack|monitoring/i, category: 'security-monitoring', kinds: ['security-monitoring'] },
  { re: /vulnerab|\bscan/i, category: 'vulnerability', kinds: ['vulnerability-scan'] },
  { re: /device|component|hardware|software|mobile|inventory|asset/i, category: 'devices', kinds: ['device-inventory'] },
  { re: /account|\broles?\b|privilege|group|\busers?\b|personnel|individual|authoriz/i, category: 'accounts', kinds: ['account-inventory'] },
];

/** W5 (SC-3b): one Muster-rendered policy document: its policy-set manifest entry and, when read, its text. */
export interface PolicyDocumentForCredit { name: string; sha256: string; text?: string }

/** The documentary items a Muster policy document can cover: its policies, procedures and plans. */
const POLICY_ITEM = /\bpolic(y|ies)\b|\bprocedures?\b|\bplans?\b/i;

/**
 * W5 (SC-3b): the hashed Muster policy document that covers a documentary examine item, or undefined.
 * Credited when (1) the item asks for a policy, procedure or plan; (2) a policy-set manifest document of
 * the control's family (FAMILY_POLICY_BASES) is given with its text; (3) the text hashes to the manifest's
 * sha256; and (4) the text names the requirement family ("Family 3.N" or a "3.N.x" requirement). A plan
 * item prefers the family's plan document. Without the text nothing is credited (the name cannot be checked).
 */
export function creditDocumentaryItem(controlId: string, itemText: string, docs: readonly PolicyDocumentForCredit[]): { document: string; sha256: string } | undefined {
  if (!POLICY_ITEM.test(itemText)) return undefined;
  const family = controlId.split('.')[0];
  const familyNumber = /^(\d+\.\d+)\./.exec(numericRef(controlId))?.[1];
  if (!familyNumber) return undefined;
  const esc = familyNumber.replace('.', '\\.');
  const names = new RegExp(`Family ${esc}(?!\\d)|(?<![\\d.])${esc}\\.\\d+`);
  const bases = [...(FAMILY_POLICY_BASES[family] ?? [])];
  if (/\bplans?\b/i.test(itemText)) bases.sort((a, b) => Number(/plan/.test(b)) - Number(/plan/.test(a)));
  for (const base of bases) {
    const doc = docs.find(d => d.name === `policies/${base}.md`);
    if (!doc?.text || !/^[0-9a-f]{64}$/.test(doc.sha256)) continue;
    if (createHash('sha256').update(doc.text, 'utf8').digest('hex') !== doc.sha256) continue;
    if (!names.test(doc.text)) continue;
    return { document: doc.name, sha256: doc.sha256 };
  }
  return undefined;
}

export function examineItemKinds(text: string): { category: string; kinds: EvidenceKind[] } {
  const hit = EXAMINE_RULES.find(r => r.re.test(text));
  return hit ? { category: hit.category, kinds: hit.kinds } : { category: 'documentary', kinds: [] };
}

/**
 * The coverage-map rule of one examine item (exact text, case-insensitive), or undefined. W5 cycle 5: a rule
 * scoped to the item's requirement (`requirements`) first, else the unscoped rule of the text.
 */
export function coverageRuleFor(map: ExamineCoverageMap, text: string, requirementId?: string): ExamineCoverageRule | undefined {
  const t = text.trim().toLowerCase();
  const same = map.items.filter(r => r.text.trim().toLowerCase() === t);
  return (requirementId !== undefined ? same.find(r => r.requirements?.includes(requirementId)) : undefined)
    ?? same.find(r => r.requirements === undefined);
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The latest returned (status success) store record of a source that carries a payload hash, or undefined. */
function latestReturned(records: readonly EvidenceRecord[], sourceId: string): EvidenceRecord | undefined {
  let best: EvidenceRecord | undefined;
  for (const r of records) {
    if (r.sourceId !== sourceId || r.status !== 'success' || !SHA256_HEX.test(r.payloadSha256 ?? '')) continue;
    if (!best || Date.parse(r.collectedAt) > Date.parse(best.collectedAt) || (r.collectedAt === best.collectedAt && r.seq > best.seq)) best = r;
  }
  return best;
}

/** The SSP evidence detail shapes (SspGenerator `EvidenceDetail`), read loosely so older SSPs index too. */
export interface IndexDetail {
  kind: 'stamper' | 'evidence-store' | string;
  method?: AssessmentMethod;
  path?: string; entryId?: string; verdict?: string; mode?: string; modeLabel?: string; payloadEmpty?: boolean;
  /** PH7-EO: a Stamper record run inside a manual gate (display only, never counted). */
  gateContext?: string;
  recordId?: string; sourceId?: string; objectiveIds?: string[];
  sha256: string; timestamp: string;
}
/** W5 cycle 4: an organisation record (EC upload) the SSP lists on a control (OrganisationRecords.applyOrganisationRecords). */
export interface IndexOrganisationRecord {
  itemId: string; file: string; sha256: string; recordKind: string; rows: number;
  dateFrom?: string; dateTo?: string; collectedAt?: string; method?: AssessmentMethod;
}
export interface IndexControl { control_id: string; family?: string; status?: string; evidenceDetails?: IndexDetail[]; organisationRecords?: IndexOrganisationRecord[] }

export interface EvidenceIndexEntry {
  controlId: string;
  family: string;
  kind: 'stamper' | 'evidence-store' | 'organisation-record';
  evidenceKind: EvidenceKind;
  method: AssessmentMethod;
  sha256: string;
  timestamp: string;
  path?: string; entryId?: string; verdict?: string; mode?: string; payloadEmpty?: true;
  /** PH7-EO: 'manual_gate' for a Stamper record run inside a manual gate (display only, never counted). */
  gateContext?: 'manual_gate';
  recordId?: string; sourceId?: string; objectiveIds?: string[];
  collector?: string; collectorIdentity?: string; query?: string; window?: { start: string | null; end: string }; recordStatus?: string;
  /** True when the store record named by the detail is not in the store given. */
  unresolved?: true;
  /** W5 cycle 4: attached by the examine coverage map for the listed examine items (not an SSP evidence detail). */
  attachment?: 'examine-item';
  examineItems?: number[];
  /** Organisation record (kind organisation-record): the EC item, its file and record kind. */
  ecItemId?: string; file?: string; recordKind?: string; rows?: number;
}

export interface ExamineItemCoverage {
  index: number; text: string; category: string; kinds: EvidenceKind[]; status: 'covered' | 'not covered';
  /** W5 (SC-3b): a documentary item covered by a hashed Muster policy document (creditDocumentaryItem). */
  creditedTo?: { document: string; sha256: string };
  /** W5 cycle 4: the hashed record the coverage map attached (class b: store record; class e: organisation record). */
  coveredBy?: { kind: 'evidence-store' | 'organisation-record'; sha256: string; recordId?: string; sourceId?: string; ecItemId?: string; file?: string;
    /** Ruling R1 (W5 cycle 4): a class-b attachment is a tenant-wide record (e.g. the audit log), not filtered to this requirement; the assessor examines it for the requirement's events. */
    scope?: 'tenant-wide' | 'requirement'; note?: string };
  /** W5 cycle 4 (class d): the item is not automatable; reclassified from the regex rule's category. */
  reclassified?: { from: string; to: 'documentary'; reason: string };
}
/** Ruling R1 (W5 cycle 4): wording carried by every class-b (tenant-wide store record) examine attachment. */
export const TENANT_WIDE_NOTE = 'Tenant-wide record attached for examination; not filtered to this requirement. The assessor examines it for the events or objects this requirement names.';

export interface ControlExamineCoverage {
  controlId: string;
  requirementId: string;
  kindsPresent: EvidenceKind[];
  total: number;
  covered: number;
  items: ExamineItemCoverage[];
}

export interface EvidenceIndex {
  schema: 'ces-eo/evidence-index@1';
  tenantId: string | null;
  tenantSlug: string | null;
  sspId: string | null;
  generatedAt: string;
  examineSource: { file: string; sha256: string };
  entries: EvidenceIndexEntry[];
  samplingWindows: FamilySamplingWindow[];
  examineCoverage: ControlExamineCoverage[];
  summary: {
    entries: number;
    byMethod: Record<AssessmentMethod, number>;
    controlsWithEvidence: number;
    examineItems: number;
    examineCovered: number;
    unresolvedStoreRefs: number;
    /** W5 cycle 4: entries attached by the examine coverage map, and items it reclassified to documentary. */
    attachedEntries: number;
    reclassifiedItems: number;
  };
}

export interface BuildEvidenceIndexInput {
  controls: readonly IndexControl[];
  records?: readonly EvidenceRecord[];
  examineLists?: ExamineLists;
  tenantId?: string | null;
  tenantSlug?: string | null;
  sspId?: string | null;
  generatedAt: string;
  /** W5 (SC-3b): the policy-set manifest documents (bundle item 1) with their text (bundle item 4), for the policy credit. */
  policyDocuments?: readonly PolicyDocumentForCredit[];
  /** W5 cycle 4: the examine coverage map (default: data/examine-coverage-map.json). */
  coverageMap?: ExamineCoverageMap;
}

const numericRef = (controlId: string): string => controlId.replace(/^[A-Z]+\.L[123]-/, '');
const ABSOLUTE_PATH_RE = /^(?:[A-Za-z]:[\\/]|[\\/])/;

/** A detail path as a relative, forward-slash path (never absolute). */
function relativePath(p: string | undefined): string | undefined {
  if (!p) return p;
  const norm = p.replace(/\\/g, '/');
  if (!ABSOLUTE_PATH_RE.test(norm)) return norm;
  const i = norm.lastIndexOf('/evidence/');
  return i >= 0 ? norm.slice(i + '/evidence/'.length) : path.posix.basename(norm);
}

/** The method of one SSP evidence detail (its own `method` when the SSP carries it). */
export function methodForDetail(d: IndexDetail): AssessmentMethod {
  if (d.method) return d.method;
  return d.kind === 'stamper' ? STAMPER_FILE_METHOD : methodForStoreSource(d.sourceId ?? '');
}

export function buildEvidenceIndex(input: BuildEvidenceIndexInput): EvidenceIndex {
  const lists = input.examineLists ?? loadExamineLists();
  const records = input.records ?? [];
  const byRecordId = new Map(records.map(r => [r.recordId, r]));
  const listByRef = new Map(lists.requirements.map(r => [r.requirement_id, r]));
  const map = input.coverageMap ?? loadExamineCoverageMap();
  // The tenant's organisation records: every hashed record the SSP lists on any control, once (by EC item id).
  const orgRecords: IndexOrganisationRecord[] = [];
  for (const c of input.controls) for (const o of c.organisationRecords ?? []) {
    if (SHA256_HEX.test(o.sha256 ?? '') && !orgRecords.some(x => x.itemId === o.itemId)) orgRecords.push(o);
  }
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  orgRecords.sort((a, b) => cmp(a.file, b.file) || cmp(a.itemId, b.itemId));
  let reclassifiedItems = 0;

  const entries: EvidenceIndexEntry[] = [];
  const examineCoverage: ControlExamineCoverage[] = [];
  for (const c of input.controls) {
    const family = c.family ?? familyOf(c.control_id);
    const present = new Set<EvidenceKind>(['ssp', 'poam']);
    for (const d of c.evidenceDetails ?? []) {
      const method = methodForDetail(d);
      if (d.kind === 'stamper') {
        present.add('stamper-file');
        entries.push({
          controlId: c.control_id, family, kind: 'stamper', evidenceKind: 'stamper-file', method,
          sha256: d.sha256, timestamp: d.timestamp, path: relativePath(d.path), entryId: d.entryId, verdict: d.verdict, mode: d.mode,
          ...(d.payloadEmpty ? { payloadEmpty: true as const } : {}),
          ...(d.gateContext === 'manual_gate' ? { gateContext: 'manual_gate' as const } : {}),
        });
      } else {
        const sourceId = d.sourceId ?? '';
        const r = d.recordId ? byRecordId.get(d.recordId) : undefined;
        // The record's endpoint names a C10 row's kind; an unresolved C10 detail falls back to its method
        // (methodForStoreSource gives test only for a confirmed apply, so the two agree).
        const endpoint = r?.endpoint ?? (sourceId === ADMIN_OPS_SOURCE && method === 'test' ? ADMIN_OPS_CONFIRMED_APPLY_ENDPOINT : undefined);
        const evidenceKind = evidenceKindOfStoreSource(sourceId, endpoint);
        present.add(evidenceKind);
        entries.push({
          controlId: c.control_id, family, kind: 'evidence-store', evidenceKind, method,
          sha256: d.sha256, timestamp: d.timestamp, recordId: d.recordId, sourceId, objectiveIds: d.objectiveIds ?? [],
          ...(r
            ? { collector: r.collector?.name, collectorIdentity: r.collector?.identity, query: r.query, window: r.window, recordStatus: r.status }
            : { unresolved: true as const }),
        });
      }
    }
    const req = listByRef.get(numericRef(c.control_id));
    if (req) {
      const attached = new Map<string, EvidenceIndexEntry>();
      const attach = (key: string, make: () => EvidenceIndexEntry, index: number) => {
        let e = attached.get(key);
        if (!e) { e = make(); attached.set(key, e); }
        e.examineItems = [...(e.examineItems ?? []), index];
      };
      const items = req.examine.map((text, i): ExamineItemCoverage => {
        const index = i + 1;
        const base = examineItemKinds(text);
        const rule = coverageRuleFor(map, text, req.requirement_id);
        if (rule?.reclassify === 'documentary' && base.category !== 'documentary') {
          reclassifiedItems++;
          const reclassified = { from: base.category, to: 'documentary' as const, reason: rule.reason };
          const credit = creditDocumentaryItem(c.control_id, text, input.policyDocuments ?? []);
          return credit
            ? { index, text, category: 'documentary', kinds: [], status: 'covered', creditedTo: credit, reclassified }
            : { index, text, category: 'documentary', kinds: [], status: 'not covered', reclassified };
        }
        const { category } = base;
        const automatable = category !== 'documentary' && category !== 'ssp' && category !== 'poam';
        const kinds = [...new Set([...base.kinds, ...(automatable ? rule?.addKinds ?? [] : [])])];
        const credit = category === 'documentary' ? creditDocumentaryItem(c.control_id, text, input.policyDocuments ?? []) : undefined;
        if (credit) return { index, text, category, kinds, status: 'covered', creditedTo: credit };
        if (kinds.some(k => present.has(k))) return { index, text, category, kinds, status: 'covered' };
        if (rule && automatable) {
          // Class e: the organisation's own record first; a tenant read of the same artefact is the fallback.
          const fromRecord = (): ExamineItemCoverage | undefined => {
            for (const kind of rule.recordKinds ?? []) {
              // A record the SSP lists on this control first, then any of the tenant's records of the kind.
              const o = (c.organisationRecords ?? []).find(x => x.recordKind === kind && SHA256_HEX.test(x.sha256 ?? '')) ?? orgRecords.find(x => x.recordKind === kind);
              if (!o) continue;
              attach(`org:${o.itemId}`, () => ({
                controlId: c.control_id, family, kind: 'organisation-record', evidenceKind: 'organisation-record', method: 'examine',
                sha256: o.sha256, timestamp: o.collectedAt ?? o.dateTo ?? '', ecItemId: o.itemId, file: o.file, recordKind: o.recordKind, rows: o.rows,
                ...(o.dateTo ? { window: { start: o.dateFrom ?? null, end: o.dateTo } } : {}),
                attachment: 'examine-item',
              }), index);
              return { index, text, category, kinds, status: 'covered', coveredBy: { kind: 'organisation-record', sha256: o.sha256, ecItemId: o.itemId, file: o.file } };
            }
            return undefined;
          };
          const rec = fromRecord();
          if (rec) return rec;
          for (const sourceId of rule.storeSources ?? []) {
            const r = latestReturned(records, sourceId);
            if (!r) continue;
            attach(`store:${r.recordId}`, () => ({
              controlId: c.control_id, family, kind: 'evidence-store', evidenceKind: evidenceKindOfStoreSource(r.sourceId, r.endpoint), method: 'examine',
              sha256: r.payloadSha256, timestamp: r.collectedAt, recordId: r.recordId, sourceId: r.sourceId, objectiveIds: [],
              collector: r.collector?.name, collectorIdentity: r.collector?.identity, query: r.query, window: r.window, recordStatus: r.status,
              attachment: 'examine-item',
              // W5 cycle 5: a requirement-specific record (rule scope 'requirement') carries no tenant-wide note.
              ...(rule.scope === 'requirement' ? {} : { note: TENANT_WIDE_NOTE }),
            }), index);
            const marker = rule.scope === 'requirement' ? { scope: 'requirement' as const } : { scope: 'tenant-wide' as const, note: TENANT_WIDE_NOTE };
            return { index, text, category, kinds, status: 'covered', coveredBy: { kind: 'evidence-store', sha256: r.payloadSha256, recordId: r.recordId, sourceId: r.sourceId, ...marker } };
          }
        }
        return { index, text, category, kinds, status: 'not covered' };
      });
      entries.push(...attached.values());
      examineCoverage.push({
        controlId: c.control_id, requirementId: req.requirement_id, kindsPresent: [...present].sort(),
        total: items.length, covered: items.filter(i => i.status === 'covered').length, items,
      });
    }
  }

  const byMethod: Record<AssessmentMethod, number> = { examine: 0, test: 0, interview: 0 };
  for (const e of entries) byMethod[e.method]++;
  return {
    schema: 'ces-eo/evidence-index@1',
    tenantId: input.tenantId ?? null,
    tenantSlug: input.tenantSlug ?? null,
    sspId: input.sspId ?? null,
    generatedAt: input.generatedAt,
    examineSource: { file: lists.source.file, sha256: lists.source.sha256 },
    entries,
    samplingWindows: samplingWindowsByFamily(records),
    examineCoverage,
    summary: {
      entries: entries.length,
      byMethod,
      controlsWithEvidence: input.controls.filter(c => (c.evidenceDetails ?? []).length > 0).length,
      examineItems: examineCoverage.reduce((n, c) => n + c.total, 0),
      examineCovered: examineCoverage.reduce((n, c) => n + c.covered, 0),
      unresolvedStoreRefs: entries.filter(e => e.unresolved).length,
      attachedEntries: entries.filter(e => e.attachment).length,
      reclassifiedItems,
    },
  };
}
