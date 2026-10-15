// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// ---------------------------------------------------------------------------
// CSV export of mission plan tasks with 5-category LOE breakdown
// ---------------------------------------------------------------------------

function escapeCsvField(value: string | number | undefined | null): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function row(...fields: (string | number | undefined | null)[]): string {
  return fields.map(escapeCsvField).join(',');
}

/**
 * Generate and download a CSV proposal export from mission plan data.
 *
 * @param planData - The mission plan `.data` object (contains manual_plan, etc.)
 * @param customerName - Display name for the customer
 */
export function exportProposalCsv(planData: any, customerName: string): void {
  const csv = buildProposalCsv(planData, customerName);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `proposal-${customerName.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function buildProposalCsv(planData: any, customerName: string): string {
  const mp = planData.manual_plan || {};
  const ces = mp.ces || {};
  const hrp = mp.outputs?.human_readable_mission_plan || {};
  const inputs = mp.inputs || {};
  const si = inputs.si_baseline?.si_baseline || {};
  const posture = inputs.readiness_posture || {};
  const summary = posture.control_status_summary || {};
  const steps: any[] = hrp.steps || [];

  const lines: string[] = [];

  // ── Header section ──
  lines.push(row('CMMC Compliance Proposal'));
  lines.push(row('Customer', customerName));
  lines.push(row('Target Level', hrp.target_level || si.target?.target_cmmc_level || 'L2'));
  lines.push(row('Plan Mode', hrp.plan_mode || ces.plan_mode || ''));
  lines.push(row('Generated', ces.generated_on || new Date().toISOString().slice(0, 10)));
  lines.push('');

  // ── SI Baseline summary ──
  lines.push(row('SI Baseline Summary'));
  lines.push(row('Deployment', si.scope?.deployment_posture || ''));
  lines.push(row('CUI Presence', si.target?.cui_presence || ''));
  lines.push(row('Boundary', si.scope?.boundary_strategy || ''));
  lines.push(row('In-Scope Users', si.scope?.in_scope_users || ''));
  lines.push(row('In-Scope Endpoints', si.scope?.in_scope_endpoints || ''));
  lines.push(row('Tenant Model', si.dependencies?.tenant_model || ''));
  lines.push(row('Assessment Route', si.target?.assessment_route || ''));
  lines.push('');

  // ── Readiness Posture summary ──
  lines.push(row('Readiness Posture Summary'));
  lines.push(row('Met', summary.met ?? ''));
  lines.push(row('Partial', summary.partial ?? ''));
  lines.push(row('Not Met', summary.not_met ?? ''));
  lines.push(row('Unknown', summary.unknown ?? ''));
  lines.push('');

  // ── Column headers ──
  lines.push(
    row(
      'Task ID',
      'Requirement',
      'Domain',
      'Priority',
      'Task Type',
      'Title',
      'Owner',
      'Config Manual (h)',
      'Config Automated (h)',
      'Dev LOE (h)',
      'Evidence Manual (h/yr)',
      'Evidence Automated (h/yr)',
      'Total Effort (h)',
    ),
  );

  // ── Effort accumulators ──
  const totals = {
    configManual: 0,
    configAuto: 0,
    devLoe: 0,
    evidenceManual: 0,
    evidenceAuto: 0,
    total: 0,
  };

  // ── Task rows ──
  for (const step of steps) {
    const ctrl = step.control_coverage?.[0];
    const ctrlId = ctrl?.control_id || '';
    const domain = step.requirement_context?.domain || extractDomain(ctrlId) || '';
    const ee = step.effort_estimate;

    const configManual = ee?.one_time_config_manual ?? 0;
    const configAuto = ee?.one_time_config_automated ?? 0;
    const devLoe = ee?.one_time_dev_loe ?? 0;
    const evidenceManual = ee?.recurring_evidence_manual ?? 0;
    const evidenceAuto = ee?.recurring_evidence_automated ?? 0;
    const totalEffort = step.estimated_effort_hours ?? 0;

    totals.configManual += configManual;
    totals.configAuto += configAuto;
    totals.devLoe += devLoe;
    totals.evidenceManual += evidenceManual;
    totals.evidenceAuto += evidenceAuto;
    totals.total += totalEffort;

    lines.push(
      row(
        step.step_id || '',
        ctrlId,
        domain,
        step.priority || '',
        step.task_type || '',
        step.title || '',
        step.owner_role || '',
        configManual,
        configAuto,
        devLoe,
        evidenceManual,
        evidenceAuto,
        totalEffort,
      ),
    );
  }

  // ── Summary rows ──
  lines.push('');
  lines.push(
    row(
      'TOTALS',
      '',
      '',
      '',
      '',
      '',
      '',
      totals.configManual,
      totals.configAuto,
      totals.devLoe,
      totals.evidenceManual,
      totals.evidenceAuto,
      totals.total,
    ),
  );

  const y1Manual = totals.configManual + totals.evidenceManual;
  const y1Auto = totals.configAuto + totals.devLoe + totals.evidenceAuto;

  lines.push(row('Year 1 Manual', '', '', '', '', '', '', '', '', '', '', '', y1Manual));
  lines.push(row('Year 1 Automated', '', '', '', '', '', '', '', '', '', '', '', y1Auto));
  lines.push(
    row('Year 2+ Manual (annual)', '', '', '', '', '', '', '', '', '', '', '', totals.evidenceManual),
  );
  lines.push(
    row(
      'Year 2+ Automated (annual)',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      totals.evidenceAuto,
    ),
  );

  return lines.join('\r\n');
}

function extractDomain(controlId: string): string {
  const match = controlId.match(/^([A-Z]{2})\./);
  return match ? match[1] : '';
}
