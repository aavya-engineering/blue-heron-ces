// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SIBaseline, CUIBoundaryOutput, BTCConfirmationOutput, ReadinessPosture } from '../types/artifacts';

export interface ConsistencyIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  details?: string;
}

export interface ConsistencyContext {
  siBaseline?: SIBaseline | null;
  cuiBoundary?: CUIBoundaryOutput | null;
  btcConfirmation?: BTCConfirmationOutput | null;
  readinessPosture?: ReadinessPosture | null;
}

type ConsistencyRule = (ctx: ConsistencyContext) => ConsistencyIssue | null;

// ---------------------------------------------------------------------------
// Rule: SI byod_posture vs CUI managed_device / byod_model
// ---------------------------------------------------------------------------
const checkSICUIByod: ConsistencyRule = (ctx) => {
  const si = ctx.siBaseline;
  const cui = ctx.cuiBoundary;
  if (!si || !cui) return null;

  const byod = si.si_baseline?.operations?.byod_posture;
  const cuiDevice = cui.cui_boundary?.['CUI.DEV.001'] as string | undefined;
  if (!byod || !cuiDevice) return null;

  if (byod === 'not_allowed' && cuiDevice && !cuiDevice.toLowerCase().includes('managed')) {
    return {
      id: 'si-cui-byod',
      severity: 'warning',
      message: 'SI Baseline says BYOD not allowed, but CUI Boundary indicates non-managed device model.',
      details: `SI byod_posture: ${byod}, CUI device model: ${cuiDevice}`,
    };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Rule: SI devops_touches_cui vs CUI devops_in_scope
// ---------------------------------------------------------------------------
const checkSICUIDevops: ConsistencyRule = (ctx) => {
  const si = ctx.siBaseline;
  const cui = ctx.cuiBoundary;
  if (!si || !cui) return null;

  const devops = si.si_baseline?.operations?.devops_touches_cui;
  const cuiDevops = cui.cui_boundary?.['CUI.DEVOPS.001'] as string | undefined;
  if (devops === undefined || devops === null || !cuiDevops) return null;

  const cuiSaysNo = cuiDevops.toLowerCase().startsWith('no');
  if (devops && cuiSaysNo) {
    return {
      id: 'si-cui-devops',
      severity: 'warning',
      message: 'SI Baseline says DevOps touches CUI, but CUI Boundary says DevOps is not in scope.',
      details: `SI devops_touches_cui: true, CUI DEVOPS.001: ${cuiDevops}`,
    };
  }
  if (!devops && !cuiSaysNo) {
    return {
      id: 'si-cui-devops',
      severity: 'warning',
      message: 'SI Baseline says DevOps does not touch CUI, but CUI Boundary says DevOps is in scope.',
      details: `SI devops_touches_cui: false, CUI DEVOPS.001: ${cuiDevops}`,
    };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Rule: SI collaboration_mode vs CUI guest_access_policy
// ---------------------------------------------------------------------------
const checkSICUISharing: ConsistencyRule = (ctx) => {
  const si = ctx.siBaseline;
  const cui = ctx.cuiBoundary;
  if (!si || !cui) return null;

  const collab = si.si_baseline?.operations?.collaboration_mode;
  const cuiEgress = cui.cui_boundary?.['CUI.LC.EGR.001'] as string | undefined;
  if (!collab || !cuiEgress) return null;

  const cuiSaysNo = cuiEgress.toLowerCase().includes('no');
  if (['teams_first', 'email_first', 'mixed'].includes(collab) && cuiSaysNo) {
    return {
      id: 'si-cui-sharing',
      severity: 'warning',
      message: 'SI Baseline indicates collaborative sharing, but CUI Boundary says no external sharing.',
      details: `SI collaboration_mode: ${collab}, CUI egress: ${cuiEgress}`,
    };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Rule: CUI staleness — SI generated_on newer than CUI generated_on
// ---------------------------------------------------------------------------
const checkCUIStaleness: ConsistencyRule = (ctx) => {
  const si = ctx.siBaseline;
  const cui = ctx.cuiBoundary;
  if (!si || !cui) return null;

  const siDate = si.ces?.generated_on;
  const cuiDate = cui.ces?.generated_on;
  if (!siDate || !cuiDate) return null;

  if (siDate > cuiDate) {
    return {
      id: 'cui-staleness',
      severity: 'info',
      message: 'SI Baseline is newer than the CUI Boundary. Consider regenerating the CUI Boundary.',
      details: `SI generated: ${siDate}, CUI generated: ${cuiDate}`,
    };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Rule: BTC staleness — CUI generated_on newer than BTC generated_on
// ---------------------------------------------------------------------------
const checkBTCStaleness: ConsistencyRule = (ctx) => {
  const cui = ctx.cuiBoundary;
  const btc = ctx.btcConfirmation;
  if (!cui || !btc) return null;

  const cuiDate = cui.ces?.generated_on;
  const btcDate = btc.ces?.generated_on;
  if (!cuiDate || !btcDate) return null;

  if (cuiDate > btcDate) {
    return {
      id: 'btc-staleness',
      severity: 'info',
      message: 'CUI Boundary is newer than the BTC Confirmation. Consider re-running BTC verification.',
      details: `CUI generated: ${cuiDate}, BTC generated: ${btcDate}`,
    };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Rule: CUI says "isolated" identity but BTC identity gate failed
// ---------------------------------------------------------------------------
const checkCUIIdentityVsBTCGate: ConsistencyRule = (ctx) => {
  const cui = ctx.cuiBoundary;
  const btc = ctx.btcConfirmation;
  if (!cui || !btc) return null;

  const identityAnswer = cui.cui_boundary?.['CUI.ID.001'] as string | undefined;
  if (!identityAnswer || !identityAnswer.toLowerCase().includes('isolated')) return null;

  const gates = btc.btc_confirmation?.gate_status;
  if (!gates) return null;

  for (const [, gate] of Object.entries(gates)) {
    if (gate.domain.toLowerCase().includes('identity') && !gate.pass) {
      return {
        id: 'cui-identity-vs-btc-gate',
        severity: 'warning',
        message: 'CUI Boundary says identity is isolated, but BTC identity gate failed.',
        details: `CUI identity: ${identityAnswer}, BTC gate failure: ${gate.reason}`,
      };
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Rule: CUI says "managed only" devices but BTC device gate failed
// ---------------------------------------------------------------------------
const checkCUIDeviceVsBTCGate: ConsistencyRule = (ctx) => {
  const cui = ctx.cuiBoundary;
  const btc = ctx.btcConfirmation;
  if (!cui || !btc) return null;

  const deviceAnswer = cui.cui_boundary?.['CUI.DEV.001'] as string | undefined;
  if (!deviceAnswer || !deviceAnswer.toLowerCase().includes('managed')) return null;

  const gates = btc.btc_confirmation?.gate_status;
  if (!gates) return null;

  for (const [, gate] of Object.entries(gates)) {
    if (gate.domain.toLowerCase().includes('device') && !gate.pass) {
      return {
        id: 'cui-device-vs-btc-gate',
        severity: 'warning',
        message: 'CUI Boundary says managed devices only, but BTC device gate failed.',
        details: `CUI device model: ${deviceAnswer}, BTC gate failure: ${gate.reason}`,
      };
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Rule: BTC gate failed in domain but all RP requirements in that domain are met (stale RP)
// ---------------------------------------------------------------------------
const checkBTCGateVsRPStatus: ConsistencyRule = (ctx) => {
  const btc = ctx.btcConfirmation;
  const rp = ctx.readinessPosture;
  if (!btc || !rp) return null;

  const gates = btc.btc_confirmation?.gate_status;
  const results = rp.ces?.requirement_results;
  if (!gates || !results || results.length === 0) return null;

  for (const [, gate] of Object.entries(gates)) {
    if (gate.pass) continue;

    const domainUpper = gate.domain.toUpperCase();
    // Find RP requirements in this domain (requirement_id starts with domain prefix)
    const domainResults = results.filter(
      (r) => r.requirement_id.split('.')[0]?.toUpperCase() === domainUpper,
    );
    if (domainResults.length === 0) continue;

    const allMet = domainResults.every((r) => r.status === 'met');
    if (allMet) {
      return {
        id: 'btc-gate-vs-rp-status',
        severity: 'warning',
        message: `BTC gate failed for ${gate.domain} domain, but all RP requirements in that domain are marked as met. The Readiness Posture may be stale.`,
        details: `BTC gate failure: ${gate.reason}, RP domain requirements: ${domainResults.length} (all met)`,
      };
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const RULES: ConsistencyRule[] = [
  checkSICUIByod,
  checkSICUIDevops,
  checkSICUISharing,
  checkCUIStaleness,
  checkBTCStaleness,
  checkCUIIdentityVsBTCGate,
  checkCUIDeviceVsBTCGate,
  checkBTCGateVsRPStatus,
];

export function checkConsistency(ctx: ConsistencyContext): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  for (const rule of RULES) {
    const issue = rule(ctx);
    if (issue) issues.push(issue);
  }
  return issues;
}
