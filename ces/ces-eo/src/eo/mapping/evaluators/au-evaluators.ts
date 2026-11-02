// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { EvaluatorFn } from './index.js';
import { describeRead } from './helpers.js';
import { rowsOf, notAssessed, catalogName, cfgName, REQUIREMENT_DEFAULT_SOURCE, type Verdict, type EvaluatorContext } from './conditions.js';
import { assignmentStateOf, UNASSIGNED_SENTENCE } from './assignments.js';
import type { SignalResult } from 'ces-shared/types/signal';
import { COLLECTED } from '../../collect/Collector.js';
import { collectedRows, ualWorkload, actorOf, eventOf, eventTimeOf, IN_SCOPE_WORKLOADS } from '../../collect/views.js';

/** Point-in-time reads (W0.3) used only when no collected view is present. */
const ENTRA_FALLBACK: Record<string, string> = {
  [COLLECTED.DIRECTORY_AUDITS]: 'directoryAudits',
  [COLLECTED.SIGN_INS]: 'signInLogs',
};

export const auEvaluators: Record<string, EvaluatorFn> = {
  // EO-collection W2 (AU.L2-3.3.1): tests the condition on collected records, not presence.
  // Met when the unified audit log (collector C1a) holds records for the last 30 days, every record
  // carries its event and time, and the records cover the workloads in scope (Entra ID, Exchange,
  // SharePoint). A record without event or time → not_met. Unread or empty → not_assessed; a
  // workload with no records → not_assessed (quiet or not audited: examine needed).
  auditEventsEvaluator: (signals) => {
    const ual = collectedRows(signals, [COLLECTED.UNIFIED_AUDIT_LOG]);
    const states = ual.states.join('; ');
    if (!ual.read) {
      return { status: 'not_assessed', evidence: `Audit records: ${states} — not assessed (unread reads are not a negative finding)` };
    }
    const rows = ual.rows;
    if (rows.length === 0) {
      return { status: 'not_assessed', evidence: `Audit records: ${states}; no unified-audit-log records in the last 30 days — not assessed (an empty read is not a negative finding)` };
    }
    const incomplete = rows.filter((r) => !eventOf(r) || !eventTimeOf(r)).length;
    if (incomplete > 0) {
      return { status: 'not_met', evidence: `${incomplete} of ${rows.length} unified-audit-log record(s) in the last 30 days lack the event or its time (${states})` };
    }
    const perWorkload: Record<string, number> = {};
    for (const r of rows) { const w = ualWorkload(r); if (w) perWorkload[w] = (perWorkload[w] ?? 0) + 1; }
    const covered = IN_SCOPE_WORKLOADS.map((w) => `${w} ${perWorkload[w] ?? 0}`).join(', ');
    const missing = IN_SCOPE_WORKLOADS.filter((w) => !perWorkload[w]);
    if (missing.length > 0) {
      return {
        status: 'not_assessed',
        evidence: `${rows.length} unified-audit-log record(s) in the last 30 days (${covered}); none for ${missing.join(', ')} — quiet workload or not audited, examine needed`,
      };
    }
    return {
      status: 'met',
      evidence: `Unified-audit-log records exist for the last 30 days and cover the workloads in scope (${covered}); every record carries its event and time. Audit retention is verified separately.`,
    };
  },

  // EO-collection W2 (AU.L2-3.3.2): tests that collected records trace each action to its actor.
  // Met when the last 30 days' sign-ins (C3) and directory audits (C2) all name an actor and at
  // least one names an individual user. A record naming no actor → not_met. Records that name only
  // applications → not_assessed (no user action to trace). Unread or empty → not_assessed.
  auditReviewEvaluator: (signals) => {
    const got = collectedRows(signals, [COLLECTED.SIGN_INS, COLLECTED.DIRECTORY_AUDITS], ENTRA_FALLBACK);
    if (!got.read) {
      return { status: 'not_assessed', evidence: `Audit records: ${got.states.join('; ')} — not assessed (unread reads are not a negative finding)` };
    }
    if (got.rows.length === 0) {
      return { status: 'not_assessed', evidence: `Audit records: ${got.states.join('; ')}; no records in the last 30 days — not assessed (an empty read is not a negative finding)` };
    }
    const kinds = { user: 0, app: 0, none: 0 };
    for (const r of got.rows) kinds[actorOf(r).kind]++;
    const tally = `${kinds.user} attributed to a named user, ${kinds.app} to an application or service, ${kinds.none} to no one`;
    if (kinds.none > 0) {
      return { status: 'not_met', evidence: `${kinds.none} of ${got.rows.length} audit record(s) in the last 30 days name no actor, so those actions cannot be traced (${tally}; ${got.states.join('; ')})` };
    }
    if (kinds.user === 0) {
      return { status: 'not_assessed', evidence: `All ${got.rows.length} audit record(s) in the last 30 days name an application or service; no user action to trace — not assessed (${got.states.join('; ')})` };
    }
    return {
      status: 'met',
      evidence: `Every audit record in the last 30 days names its actor (${got.rows.length} records: ${tally}; ${got.states.join('; ')}), so user actions trace to the individual user`,
    };
  },

  // W0.4 (P0 #4): the presence of alerts does not show a reviewed, updated event list. The sim
  // holds no review record, so this is not assessed; the read is printed.
  sentinelWorkspaceEvaluator: (signals) => ({
    status: 'not_assessed',
    evidence: `Record-based; examine record needed (reviewed and updated list of logged event types). Read: ${describeRead(signals, 'securityAlerts')}`,
  }),

  // W0.4 (P0 #4): alerts existing do not show an audit-failure alert rule or who it notifies.
  // No alert-rule read exists, so this is not assessed; the read is printed.
  alertGroupEvaluator: (signals) => ({
    status: 'not_assessed',
    evidence: `Record-based; examine record needed (audit-logging-failure alert rule and notified personnel). Read: ${describeRead(signals, 'securityAlerts')}`,
  }),

  // EO-collection W2 (AU.L2-3.3.6): reduction and report generation on demand. Met when the
  // date-bounded Search-UnifiedAuditLog query (C1a: -StartDate/-EndDate windows) returned audit rows
  // for the last 30 days, which the evidence store keeps for on-demand analysis. Unread or empty →
  // not_assessed.
  auditReductionEvaluator: (signals) => {
    const ual = collectedRows(signals, [COLLECTED.UNIFIED_AUDIT_LOG]);
    const states = ual.states.join('; ');
    if (!ual.read) {
      return { status: 'not_assessed', evidence: `Audit reduction: ${states} — not assessed (the unified audit log was not read)` };
    }
    if (ual.rows.length === 0) {
      return { status: 'not_assessed', evidence: `Audit reduction: the date-bounded unified-audit-log query returned no rows for the last 30 days — not assessed (an empty read is not a negative finding)` };
    }
    const recordTypes = new Set(ual.rows.map((r) => String((r as Record<string, unknown>)?.RecordType ?? '')).filter(Boolean));
    return {
      status: 'met',
      evidence: `A date-bounded (StartDate/EndDate) unified-audit-log query returned ${ual.rows.length} record(s) across ${recordTypes.size} record type(s) for the last 30 days, kept in the evidence store for on-demand analysis and reporting`,
    };
  },

  // Synthetic-customer W5 cycle 7 (AU.L2-3.3.7): a condition test, no longer presence only.
  timeSourceEvaluator: (signals, ctx) => timeSyncVerdict(signals, ctx),
};

// ---------------------------------------------------------------- AU.L2-3.3.7 time synchronisation (W5 cycle 7)

const TIME_SYNC_WHAT = 'Time synchronisation';
const TIME_SYNC_READS = ['configurationPolicies', 'deviceConfigurations'];

/**
 * Settings-catalog definition ids of the Windows Time (NTP client) server setting, case-insensitive:
 * an id carrying `ntpserver` within the `w32time` family (ADMX-backed "Configure Windows NTP Client",
 * e.g. `device_vendor_msft_policy_config_admx_w32time_w32time_policy_configure_ntpclient_w32time_ntpclient_ntpserver`)
 * or the `timesync` family. Not verified live; the shape is the simulator's S1 policy.
 */
const NTP_SERVER_DEF_RE = /(w32time|timesync).*ntpserver/i;
/** Legacy carrier: a custom (OMA-URI) device configuration of the W32Time NTP client ADMX policy. */
const NTP_OMA_URI_RE = /w32time.*ntpclient/i;
/** The NtpServer data element of the ADMX value (`<data id="W32TIME_NtpServer" value="..."/>`). */
const NTP_OMA_VALUE_RE = /id\s*=\s*"W32TIME_NtpServer"\s+value\s*=\s*"([^"]*)"/i;

/** The string values of the NTP-server settings in a settings-catalog policy, group children included. */
function catalogNtpServers(policy: Record<string, unknown>): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (typeof o.settingDefinitionId === 'string' && NTP_SERVER_DEF_RE.test(o.settingDefinitionId)) {
      const v = (o.simpleSettingValue as Record<string, unknown> | undefined)?.value;
      if (typeof v === 'string') out.push(v);
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(policy.settings);
  return out;
}

/** The NtpServer values of a legacy custom (OMA-URI) device configuration. */
function legacyNtpServers(config: Record<string, unknown>): string[] {
  const oma = Array.isArray(config.omaSettings) ? config.omaSettings as Array<Record<string, unknown>> : [];
  return oma
    .filter(o => NTP_OMA_URI_RE.test(String(o?.omaUri ?? '')))
    .map(o => String(o.value ?? '').match(NTP_OMA_VALUE_RE)?.[1])
    .filter((v): v is string => v !== undefined);
}

/**
 * The host names of an NTP server list: space separated, each without its W32Time flag suffix
 * (`time.windows.com,0x9` -> `time.windows.com`), lower-cased.
 */
const ntpHosts = (v: string): string[] => v.split(/\s+/).map(h => h.split(',')[0].trim().toLowerCase()).filter(Boolean);

/**
 * AU.L2-3.3.7: an assigned Intune policy sets the Windows NTP client server.
 * - met: a settings-catalog policy (or legacy custom OMA-URI configuration) carries a non-empty NTP
 *   server, is assigned, and, when the TM row (`$.timeServer`, the answered `authoritative_time_source`)
 *   is present, a server host equals the answered host (flag suffix and case ignored);
 * - not met: the reads reached the control (a successful read, an empty one included: the tenant has no
 *   such policy) but no policy qualifies, the servers read printed; a carrier assigned to no group is
 *   named as such;
 * - not assessed: no read reached the control, the settings catalog was not read (the device configurations
 *   alone cannot show that no policy sets the server) or was read without its settings, or the only
 *   carriers carry no assignment information; the reads printed.
 */
function timeSyncVerdict(signals: SignalResult[], ctx: EvaluatorContext | undefined): Verdict {
  const what = TIME_SYNC_WHAT;
  const cat = rowsOf(signals, ['configurationPolicies']);
  const leg = rowsOf(signals, ['deviceConfigurations']);
  if (!cat && !leg) return notAssessed(what, 'neither the settings-catalog policies nor the device configurations were read', signals, TIME_SYNC_READS);
  const catRows = cat?.rows ?? [];

  const carriers = [
    ...catRows.map(r => ({ r, label: `settings-catalog policy '${catalogName(r)}'`, servers: catalogNtpServers(r) })),
    ...(leg?.rows ?? []).map(r => ({ r, label: `device configuration '${cfgName(r)}'`, servers: legacyNtpServers(r) })),
  ].filter(c => c.servers.some(v => v.trim() !== ''))
    .map(c => ({ ...c, state: assignmentStateOf(c.r) }));

  const check = ctx?.expected?.find(e => e.path.includes('timeServer') && typeof e.value === 'string' && e.value.trim() !== '');
  const answered = check ? ntpHosts(String(check.value)) : [];
  const source = check ? `organisation value: TM expected value (${check.source ?? 'tm'})` : REQUIREMENT_DEFAULT_SOURCE;
  const matches = (servers: string[]) => !check || servers.some(v => ntpHosts(v).some(h => answered.includes(h)));
  const shown = (c: { label: string; servers: string[] }) => `${c.label} sets NTP server ${c.servers.map(v => `'${v}'`).join(', ')}`;

  const ok = carriers.filter(c => c.state === 'assigned' && matches(c.servers));
  if (ok.length > 0) {
    const against = check
      ? `equals the organisation's authoritative time source '${String(check.value)}' (${source})`
      : `is non-empty (any server accepted: ${source})`;
    return { status: 'met', evidence: `${what}: ${ok.map(shown).join('; ')}, assigned to a group; the server ${against}` };
  }
  if (catRows.length > 0 && !catRows.some(p => Array.isArray(p.settings))) {
    return notAssessed(what, 'the settings-catalog policies were read without their settings ($expand=settings)', signals, TIME_SYNC_READS);
  }
  if (!cat) {
    const legacySeen = carriers.length > 0 ? carriers.map(shown).join('; ') : `${leg!.rows.length} device configuration(s) read, none sets the NTP server`;
    return notAssessed(what, `the settings-catalog policies (where the Windows NTP client policy is configured) were not read; ${legacySeen}`, signals, TIME_SYNC_READS);
  }
  const read = `${catRows.length} settings-catalog policy(ies)${leg ? ` and ${leg.rows.length} device configuration(s)` : ''} read`;
  if (carriers.length === 0) {
    return { status: 'not_met', evidence: `${what}: ${read}; none sets the Windows NTP client server (no time-synchronisation policy)` };
  }
  if (carriers.every(c => !matches(c.servers))) {
    return { status: 'not_met', evidence: `${what}: ${carriers.map(shown).join('; ')}; none equals the organisation's authoritative time source '${String(check!.value)}' (${source})` };
  }
  const unassigned = carriers.filter(c => c.state === 'unassigned' && matches(c.servers));
  if (unassigned.length > 0) {
    return { status: 'not_met', evidence: `${what}: ${unassigned.map(shown).join('; ')}, but it is ${UNASSIGNED_SENTENCE}, so it applies to no device` };
  }
  return notAssessed(what, `${carriers.map(shown).join('; ')}, but the read carries no assignment information, so EO cannot tell whether it applies to any device`, signals, TIME_SYNC_READS);
}
