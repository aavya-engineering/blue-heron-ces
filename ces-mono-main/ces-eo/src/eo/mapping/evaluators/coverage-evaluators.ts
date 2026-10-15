// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * FC-EO-D (EO-03) — evaluators for the six tenant signals added for automatic-signal coverage.
 * Promoted from an EO-owned overlay into the shared Microsoft control-signal registry itself in
 * ces-shared 2.8.0 (FC-EO-H, 2026-09-28); these evaluators are unchanged. Feasibility and verdict
 * rules: docs/SIGNAL-COVERAGE-2026-09-28.md.
 *
 * Integrity rules (every evaluator here):
 *   - a failed / missing read  → not_assessed (nothing could be observed);
 *   - an EMPTY read            → not_met (nothing evidences the control);
 *   - `met` only on observed tenant STATE that satisfies the whole requirement — never on the mere
 *     existence of a capability, licence or intent;
 *   - partial evidence         → partial (never met).
 */
import type { SignalResult } from 'ces-shared/types/signal';
import type { ControlStatus } from 'ces-shared/types/controls';
import type { EvaluatorFn } from './index.js';

type Verdict = { status: ControlStatus; evidence: string };
const DAY_MS = 24 * 60 * 60 * 1000;

/** The successful signal with this id, or undefined (absent / error / 403). */
function successSignal(signals: SignalResult[], signalId: string): SignalResult | undefined {
  return signals.find(s => s.signalId === signalId && s.status === 'success' && s.rawData != null);
}

/** Items of a Graph collection payload: a bare array, `{ value: [...] }`, or `{ results: [...] }`. */
export function listItems(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.value)) return d.value;
    if (Array.isArray(d.results)) return d.results;
    if (Array.isArray(d.Results)) return d.Results;
    // A single object serialized by ConvertTo-Json (one-element collection)
    if (Object.keys(d).length > 0 && !('value' in d) && !('results' in d)) return [d];
  }
  return [];
}

/**
 * Read a property from a Graph object in EITHER shape: flat Graph JSON (Invoke-MgGraphRequest,
 * the sim) or a Microsoft Graph PowerShell SDK object serialized by ConvertTo-Json, which carries
 * type-specific properties (e.g. `@odata.type`, `enableSplitTunneling`) under AdditionalProperties.
 */
export function prop(obj: any, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  if (key in obj) return obj[key];
  const upper = key.charAt(0).toUpperCase() + key.slice(1);
  if (upper in obj) return obj[upper];
  const ap = obj.AdditionalProperties ?? obj.additionalProperties;
  if (ap && typeof ap === 'object' && key in ap) return ap[key];
  return undefined;
}

const notRead = (what: string): Verdict =>
  ({ status: 'not_assessed', evidence: `${what} could not be read from the tenant (read failed or not permitted) — not evidenced` });

// ---------------------------------------------------------------------------------------------
// AT.L2-3.2.1 / AT.L2-3.2.3 — awareness training coverage
// ---------------------------------------------------------------------------------------------

/** Enabled member users holding at least one licence — the people who must be trained. */
function trainingPopulation(users: any[]): Map<string, string> {
  const pop = new Map<string, string>();
  for (const u of users) {
    if (prop(u, 'accountEnabled') !== true) continue;
    const userType = prop(u, 'userType');
    if (userType !== undefined && userType !== null && userType !== 'Member') continue;
    const licences = prop(u, 'assignedLicenses');
    if (!Array.isArray(licences) || licences.length === 0) continue;
    const id = String(prop(u, 'id') ?? '');
    if (id) pop.set(id, String(prop(u, 'userPrincipalName') ?? id));
  }
  return pop;
}

/** User ids with a COMPLETED training (optionally title-filtered) completed within `windowDays`. */
function trainedUserIds(coverage: any[], now: number, windowDays: number, titleFilter?: RegExp): Set<string> {
  const trained = new Set<string>();
  for (const row of coverage) {
    const user = prop(row, 'attackSimulationUser') as any;
    const userId = String(prop(user, 'userId') ?? '');
    if (!userId) continue;
    const trainings = prop(row, 'userTrainings');
    if (!Array.isArray(trainings)) continue;
    const ok = trainings.some((t: any) => {
      if (String(prop(t, 'trainingStatus') ?? '').toLowerCase() !== 'completed') return false;
      if (titleFilter && !titleFilter.test(String(prop(t, 'displayName') ?? ''))) return false;
      const done = Date.parse(String(prop(t, 'completionDateTime') ?? ''));
      return Number.isFinite(done) && now - done <= windowDays * DAY_MS && done <= now + DAY_MS;
    });
    if (ok) trained.add(userId);
  }
  return trained;
}

function trainingVerdict(signals: SignalResult[], label: string, titleFilter?: RegExp): Verdict {
  const cov = successSignal(signals, 'trainingUserCoverage');
  const users = successSignal(signals, 'directoryUsers');
  if (!cov) return notRead('Attack simulation training user coverage');
  if (!users) return notRead('Directory users');
  const population = trainingPopulation(listItems(users.rawData));
  if (population.size === 0) {
    return { status: 'not_met', evidence: `${label}: no licensed, enabled member users were read — nothing to evidence coverage against` };
  }
  const coverage = listItems(cov.rawData);
  if (coverage.length === 0) {
    return { status: 'not_met', evidence: `${label}: the training coverage report is empty — no completed training is recorded for any user` };
  }
  const trained = trainedUserIds(coverage, Date.now(), 365, titleFilter);
  const covered = [...population.keys()].filter(id => trained.has(id));
  const missing = [...population.entries()].filter(([id]) => !trained.has(id)).map(([, upn]) => upn);
  const summary = `${covered.length}/${population.size} licensed, enabled member users completed ${label} in the last 365 days`;
  if (missing.length === 0) return { status: 'met', evidence: `${summary} (Attack simulation training records)` };
  const sample = missing.slice(0, 5).join(', ') + (missing.length > 5 ? `, +${missing.length - 5} more` : '');
  if (covered.length === 0) return { status: 'not_met', evidence: `${summary}. Not trained: ${sample}` };
  return { status: 'partial', evidence: `${summary}. Not trained: ${sample}` };
}

// ---------------------------------------------------------------------------------------------
// PS.L2-3.9.2 — personnel actions (lifecycle workflows + residual access)
// ---------------------------------------------------------------------------------------------

/** Lifecycle-workflow task definitions that remove a leaver's access (Microsoft built-in tasks). */
export const LEAVER_ACCESS_TASK_IDS = new Set([
  '1dfdfcc7-52fa-4c2e-bf3a-e3919cc12950', // Disable user account
  '8d18588d-9ad3-4c0f-99d0-ec215f0e3dff', // Delete user account
]);
const LEAVER_ACCESS_TASK_NAME = /\b(disable|delete)\s+user\s+account\b/i;

function isEnforcedWorkflow(w: any): boolean {
  return prop(w, 'isEnabled') === true && prop(w, 'isSchedulingEnabled') === true;
}

function removesAccess(w: any): boolean {
  const tasks = prop(w, 'tasks');
  if (!Array.isArray(tasks)) return false;
  return tasks.some((t: any) =>
    prop(t, 'isEnabled') !== false &&
    (LEAVER_ACCESS_TASK_IDS.has(String(prop(t, 'taskDefinitionId') ?? '').toLowerCase()) ||
     LEAVER_ACCESS_TASK_NAME.test(String(prop(t, 'displayName') ?? ''))));
}

// ---------------------------------------------------------------------------------------------
// Evaluators
// ---------------------------------------------------------------------------------------------

export const coverageEvaluators: Record<string, EvaluatorFn> = {
  /** AT.L2-3.2.1 — every licensed, enabled member user completed security-awareness training ≤365 days. */
  awarenessTrainingCoverageEvaluator: (signals) =>
    trainingVerdict(signals, 'security awareness training'),

  /** AT.L2-3.2.3 — every such user completed an insider-threat training (title contains "insider") ≤365 days. */
  insiderThreatTrainingEvaluator: (signals) =>
    trainingVerdict(signals, 'insider-threat awareness training', /insider/i),

  /**
   * AU.L2-3.3.5 — audit review/analysis is correlated: Defender XDR incidents created in the last
   * 90 days that correlate alerts from ≥2 distinct detection sources.
   */
  incidentCorrelationEvaluator: (signals) => {
    const sig = successSignal(signals, 'securityIncidents');
    if (!sig) return notRead('Security incidents');
    const incidents = listItems(sig.rawData);
    if (incidents.length === 0) {
      return { status: 'not_met', evidence: 'No security incidents were read — no correlation of audit/alert records is evidenced' };
    }
    const now = Date.now();
    const recent = incidents.filter(i => {
      const t = Date.parse(String(prop(i, 'createdDateTime') ?? ''));
      return Number.isFinite(t) && now - t <= 90 * DAY_MS;
    });
    if (recent.length === 0) {
      return { status: 'not_met', evidence: `${incidents.length} incident(s) read, none created in the last 90 days — current correlation not evidenced` };
    }
    const sourcesOf = (i: any): Set<string> => {
      const alerts = prop(i, 'alerts');
      const set = new Set<string>();
      if (Array.isArray(alerts)) for (const a of alerts) {
        const s = prop(a, 'serviceSource') ?? prop(a, 'detectionSource');
        if (s) set.add(String(s));
      }
      return set;
    };
    const multi = recent.filter(i => sourcesOf(i).size >= 2);
    const allSources = new Set<string>();
    for (const i of recent) for (const s of sourcesOf(i)) allSources.add(s);
    if (multi.length > 0) {
      return {
        status: 'met',
        evidence: `${multi.length}/${recent.length} incident(s) in the last 90 days correlate alerts across ≥2 sources (${[...allSources].sort().join(', ')})`,
      };
    }
    return {
      status: 'partial',
      evidence: `${recent.length} incident(s) in the last 90 days, but none correlates alerts from more than one source — cross-source correlation not evidenced`,
    };
  },

  /**
   * PS.L2-3.9.2 — CUI systems protected during personnel actions: an enforced (enabled + scheduled)
   * leaver workflow that disables/deletes the account, an enforced mover workflow, and no disabled
   * account still holding a directory role assignment.
   */
  personnelActionAccessEvaluator: (signals) => {
    const wf = successSignal(signals, 'lifecycleWorkflows');
    const users = successSignal(signals, 'directoryUsers');
    const roles = successSignal(signals, 'roleAssignmentsAll');
    if (!wf) return notRead('Lifecycle workflows');
    if (!users) return notRead('Directory users');
    if (!roles) return notRead('Directory role assignments');
    const workflows = listItems(wf.rawData);
    if (workflows.length === 0) {
      return { status: 'not_met', evidence: 'No lifecycle workflows exist — access removal on termination/transfer is not enforced by the tenant' };
    }
    const disabledIds = new Set(listItems(users.rawData)
      .filter(u => prop(u, 'accountEnabled') === false).map(u => String(prop(u, 'id') ?? '')).filter(Boolean));
    const residual = listItems(roles.rawData).filter(r => disabledIds.has(String(prop(r, 'principalId') ?? '')));
    if (residual.length > 0) {
      return { status: 'not_met', evidence: `${residual.length} directory role assignment(s) still held by disabled account(s) — residual access after a personnel action` };
    }
    const leaver = workflows.filter(w => String(prop(w, 'category') ?? '').toLowerCase() === 'leaver' && isEnforcedWorkflow(w) && removesAccess(w));
    const mover = workflows.filter(w => String(prop(w, 'category') ?? '').toLowerCase() === 'mover' && isEnforcedWorkflow(w));
    const hygiene = `${disabledIds.size} disabled account(s), none holding a directory role`;
    if (leaver.length === 0) {
      return { status: 'not_met', evidence: `No enabled, scheduled leaver workflow that disables or deletes the account. ${hygiene}` };
    }
    if (mover.length === 0) {
      return { status: 'partial', evidence: `Leaver workflow enforced (${leaver.map(w => prop(w, 'displayName')).join(', ')}); no enabled, scheduled mover workflow — transfers not evidenced. ${hygiene}` };
    }
    return {
      status: 'met',
      evidence: `Leaver (${leaver.map(w => prop(w, 'displayName')).join(', ')}) and mover (${mover.map(w => prop(w, 'displayName')).join(', ')}) workflows enabled and scheduled; ${hygiene}`,
    };
  },

  /**
   * RA.L2-3.11.2 — vulnerability scanning is current: every device Defender vulnerability
   * management reports was assessed in the last 7 days, and every managed Windows/macOS device
   * appears in the assessment.
   */
  vulnScanRecencyEvaluator: (signals) => {
    const sig = successSignal(signals, 'tvmAssessmentRecency');
    if (!sig) return notRead('Defender vulnerability-assessment recency');
    const rows = listItems(sig.rawData);
    if (rows.length === 0) {
      return { status: 'not_met', evidence: 'Defender vulnerability management reports no assessed devices — scanning not evidenced' };
    }
    const now = Date.now();
    const stale = rows.filter(r => {
      const t = Date.parse(String(prop(r, 'LastAssessed') ?? prop(r, 'lastAssessed') ?? ''));
      return !Number.isFinite(t) || now - t > 7 * DAY_MS;
    });
    const devices = successSignal(signals, 'managedDevicesAll');
    const desktops = devices
      ? listItems(devices.rawData).filter(d => /^(windows|macos)/i.test(String(prop(d, 'operatingSystem') ?? '')))
      : [];
    const summary = `${rows.length - stale.length}/${rows.length} device(s) assessed in the last 7 days`;
    if (stale.length > 0) {
      const names = stale.slice(0, 5).map(r => String(prop(r, 'DeviceName') ?? prop(r, 'DeviceId') ?? '?')).join(', ');
      return { status: rows.length === stale.length ? 'not_met' : 'partial', evidence: `${summary}; stale: ${names}` };
    }
    if (desktops.length > rows.length) {
      return { status: 'partial', evidence: `${summary}, but ${desktops.length} managed Windows/macOS devices exist — ${desktops.length - rows.length} not covered by vulnerability assessment` };
    }
    return { status: 'met', evidence: `${summary} (Defender vulnerability management, continuous assessment)` };
  },

  /**
   * SC.L2-3.13.7 — split tunneling prevented: at least one managed VPN profile exists and EVERY
   * VPN profile explicitly sets enableSplitTunneling = false.
   */
  splitTunnelingEvaluator: (signals) => {
    const sig = successSignal(signals, 'deviceConfigurations');
    if (!sig) return notRead('Intune device configurations');
    const vpn = listItems(sig.rawData).filter(c => /vpnconfiguration$/i.test(String(prop(c, '@odata.type') ?? '')));
    if (vpn.length === 0) {
      return { status: 'not_met', evidence: 'No managed VPN profile exists — split-tunneling prevention for remote devices is not evidenced' };
    }
    const bad = vpn.filter(c => prop(c, 'enableSplitTunneling') !== false);
    if (bad.length > 0) {
      const names = bad.map(c => `${prop(c, 'displayName') ?? prop(c, 'id')} (enableSplitTunneling=${String(prop(c, 'enableSplitTunneling'))})`).join(', ');
      return { status: 'not_met', evidence: `${bad.length}/${vpn.length} VPN profile(s) do not disable split tunneling: ${names}` };
    }
    return { status: 'met', evidence: `All ${vpn.length} managed VPN profile(s) disable split tunneling (${vpn.map(c => prop(c, 'displayName')).join(', ')})` };
  },
};
