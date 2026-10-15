// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// ---------------------------------------------------------------------------
// Human-readable plan export — converts JSON plan artifacts to formatted text
// ---------------------------------------------------------------------------

const DOMAIN_NAMES: Record<string, string> = {
  AC: 'Access Control',
  AT: 'Awareness & Training',
  AU: 'Audit & Accountability',
  CA: 'Security Assessment',
  CM: 'Configuration Management',
  IA: 'Identification & Authentication',
  IR: 'Incident Response',
  MA: 'Maintenance',
  MP: 'Media Protection',
  PE: 'Physical Protection',
  PS: 'Personnel Security',
  RA: 'Risk Assessment',
  SC: 'System & Comms Protection',
  SI: 'System & Info Integrity',
  SR: 'Supply Chain Risk Management',
};

const PRIORITY_LABELS: Record<string, string> = {
  p0: 'CRITICAL',
  p1: 'HIGH',
  p2: 'STANDARD',
  p3: 'LOW',
};

const LINE = '─'.repeat(80);
const DLINE = '═'.repeat(80);

// ---------------------------------------------------------------------------
// Main entry: format all four artifacts into one document
// ---------------------------------------------------------------------------

export function formatPlanAsText(planData: {
  manual_plan?: any;
  proposal?: any;
  tenant_manifest?: any;
}): string {
  const sections: string[] = [];

  // Header always uses the manual plan (which has outputs.human_readable_mission_plan)
  sections.push(formatHeader(planData.manual_plan));

  // CUI Boundary & BTC section (if present)
  const boundaryContext = planData.manual_plan?.outputs?.human_readable_mission_plan?.boundary_context;
  if (boundaryContext) {
    sections.push(formatBoundarySection(boundaryContext));
  }

  if (planData.manual_plan) {
    sections.push(formatManualPlan(planData.manual_plan));
  }

  if (planData.proposal) {
    sections.push(formatProposal(planData.proposal));
  }

  if (planData.tenant_manifest) {
    sections.push(formatManifestSummary(planData.tenant_manifest));
  }

  sections.push(formatFooter());

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Download triggers
// ---------------------------------------------------------------------------

export function exportPlanAsText(
  planData: {
    manual_plan?: any;
    proposal?: any;
    tenant_manifest?: any;
  },
  filename: string,
): void {
  const text = formatPlanAsText(planData);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.txt') ? filename : `${filename}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function formatHeader(plan: any): string {
  const ces = plan?.ces || {};
  const hrp = plan?.outputs?.human_readable_mission_plan || {};
  const inputs = plan?.inputs || {};
  const si = inputs.si_baseline?.si_baseline || {};
  const posture = inputs.readiness_posture || {};
  const summary = posture.control_status_summary || {};

  const steps = hrp.steps || [];
  const totalHours = steps.reduce((s: number, t: any) => s + (t.estimated_effort_hours || 0), 0);
  const byPriority = countByField(steps, 'priority');

  // Aggregate effort estimates across all steps
  const effortTotals = {
    configManual: 0,
    configAuto: 0,
    devLoe: 0,
    evidenceManual: 0,
    evidenceAuto: 0,
  };
  let hasEffortEstimate = false;
  for (const step of steps) {
    const ee = step.effort_estimate;
    if (ee) {
      hasEffortEstimate = true;
      effortTotals.configManual += ee.one_time_config_manual;
      effortTotals.configAuto += ee.one_time_config_automated;
      effortTotals.devLoe += ee.one_time_dev_loe;
      effortTotals.evidenceManual += ee.recurring_evidence_manual;
      effortTotals.evidenceAuto += ee.recurring_evidence_automated;
    }
  }

  const lines = [
    DLINE,
    center('CMMC COMPLIANCE MISSION PLAN'),
    center(ces.intent || ''),
    DLINE,
    '',
    `Generated:  ${ces.generated_on || 'N/A'}`,
    `Target:     CMMC ${hrp.target_level || 'L2'}`,
    `Mode:       ${formatPlanMode(hrp.plan_mode)}`,
    `Deployment: ${formatValue(si.scope?.deployment_posture)}`,
    `CUI:        ${formatValue(si.target?.cui_presence)}`,
    `Boundary:   ${formatValue(si.scope?.boundary_strategy)}`,
    '',
    LINE,
    bold('READINESS SNAPSHOT'),
    LINE,
    `  Met:     ${pad(summary.met, 4)}    Partial:  ${pad(summary.partial, 4)}`,
    `  Not Met: ${pad(summary.not_met, 4)}    Unknown:  ${pad(summary.unknown, 4)}`,
    '',
    bold('PLAN SCOPE'),
    `  Total Tasks:   ${steps.length}`,
    `  Total Effort:  ${totalHours} hours (~${Math.ceil(totalHours / 8)} days)`,
    `  Critical (p0): ${byPriority['p0'] || 0}`,
    `  High (p1):     ${byPriority['p1'] || 0}`,
    `  Standard (p2): ${byPriority['p2'] || 0}`,
    `  Low (p3):      ${byPriority['p3'] || 0}`,
  ];

  if (hasEffortEstimate) {
    const y1Manual = effortTotals.configManual + effortTotals.evidenceManual;
    const y1Auto = effortTotals.configAuto + effortTotals.devLoe + effortTotals.evidenceAuto;

    lines.push(
      '',
      bold('EFFORT SUMMARY'),
      `  One-Time Configuration:    Manual: ${effortTotals.configManual}h  |  Automated: ${effortTotals.configAuto}h`,
      `  One-Time Dev Investment:   ${effortTotals.devLoe}h`,
      `  Annual Evidence Ops:       Manual: ${effortTotals.evidenceManual}h  |  Automated: ${effortTotals.evidenceAuto}h`,
      '',
      `  Year 1 (Manual Path):     ${effortTotals.configManual} + ${effortTotals.evidenceManual} = ${y1Manual}h`,
      `  Year 1 (Automated Path):  ${effortTotals.configAuto} + ${effortTotals.devLoe} + ${effortTotals.evidenceAuto} = ${y1Auto}h`,
      `  Year 2+ (Manual):         ${effortTotals.evidenceManual}h/yr`,
      `  Year 2+ (Automated):      ${effortTotals.evidenceAuto}h/yr`,
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Manual Plan
// ---------------------------------------------------------------------------

function formatManualPlan(plan: any): string {
  const hrp = plan?.outputs?.human_readable_mission_plan || {};
  const milestones = hrp.milestones || [];
  const steps = hrp.steps || [];
  const notes = hrp.assessor_alignment_notes || [];
  const sow = plan?.outputs?.cost_proposal_sow || {};

  const sections: string[] = [];

  // ── Milestones ──
  if (milestones.length > 0) {
    sections.push(sectionHeader('MILESTONES'));
    milestones.forEach((ms: any) => {
      // MS-1 (Implementation) gets all steps; MS-2 (Assessment Readiness) gets none
      const msSteps = ms.id === 'MS-1' ? steps : [];
      const msHours = msSteps.reduce((s: number, t: any) => s + (t.estimated_effort_hours || 0), 0);

      sections.push([
        `  ${ms.id}  ${ms.name}`,
        `  Target: ${ms.target_date || 'TBD'}  |  Tasks: ${msSteps.length}  |  Effort: ${msHours}h`,
        `  Objective: ${ms.objective || ''}`,
        ...(ms.exit_criteria || []).map((c: string) => `    - ${c}`),
        '',
      ].join('\n'));
    });
  }

  // ── Implementation Steps (grouped by domain) ──
  sections.push(sectionHeader('IMPLEMENTATION STEPS'));

  const byDomain = groupByDomain(steps);
  const domains = Object.keys(byDomain).sort();

  for (const domain of domains) {
    const domainSteps = byDomain[domain];
    const domainName = DOMAIN_NAMES[domain] || domain;
    const domainHours = domainSteps.reduce(
      (s: number, t: any) => s + (t.estimated_effort_hours || 0),
      0,
    );

    sections.push(
      `  ${LINE}\n  ${domain} - ${domainName}  (${domainSteps.length} tasks, ${domainHours}h)\n  ${LINE}`,
    );

    for (const step of domainSteps) {
      sections.push(formatStep(step));
    }
  }

  // ── Assessor Alignment ──
  if (notes.length > 0) {
    sections.push(sectionHeader('ASSESSOR ALIGNMENT NOTES'));
    notes.forEach((note: string, i: number) => {
      sections.push(`  ${i + 1}. ${note}`);
    });
  }

  // ── Inline SOW summary ──
  if (sow.sow) {
    sections.push(formatInlineSOW(sow));
  }

  return sections.join('\n');
}

function formatStep(step: any): string {
  const ctrl = step.control_coverage?.[0];
  const ctrlId = ctrl?.control_id || '';
  const priority = PRIORITY_LABELS[step.priority] || step.priority;
  const ctx = step.requirement_context || {};

  const GAP_CLASS_LABELS: Record<string, string> = {
    configure: 'CONFIGURE',
    customize: 'CUSTOMIZE',
    manual: 'MANUAL',
  };
  const gapClasses: string[] = step.gap_classifications || [];
  const classLabels = gapClasses.map((gc: string) => GAP_CLASS_LABELS[gc]).filter(Boolean);
  const classTag = classLabels.length > 0 ? `  [${classLabels.join(' + ')}]` : '';

  const lines = [
    '',
    `    [${priority}]${classTag}  ${step.title}`,
    `    Control: ${ctrlId}  |  Type: ${step.task_type}  |  Owner: ${step.owner_role}  |  ${step.estimated_effort_hours}h`,
  ];

  // 5-category effort breakdown
  const ee = step.effort_estimate;
  if (ee) {
    lines.push('    Effort:');
    lines.push(`      Config:    ${ee.one_time_config_manual}h manual  |  ${ee.one_time_config_automated}h automated`);
    if (ee.one_time_dev_loe > 0) {
      lines.push(`      Dev:       ${ee.one_time_dev_loe}h (automation + tooling + doc gen)`);
    }
    lines.push(`      Evidence:  ${ee.recurring_evidence_manual}h/yr manual  |  ${ee.recurring_evidence_automated}h/yr automated`);
  }

  if (ctx.requirement_text) {
    lines.push(`    Requirement: ${truncate(ctx.requirement_text, 120)}`);
  }

  if (ctrl?.gap_rationale) {
    lines.push(`    Action needed: ${ctrl.gap_rationale}`);
  }

  // Structured implementation actions
  const actions = step.actions || [];
  if (actions.length > 0) {
    lines.push('    Implementation Actions:');
    actions.forEach((a: any, i: number) => {
      lines.push(`      ${i + 1}. [${a.action_type}] ${a.action}`);
      lines.push(`         Action ID: ${a.action_id}`);
      if (a.evidence_outputs?.length > 0) {
        lines.push(`         Evidence: ${a.evidence_outputs.join(', ')}`);
      }
      if (a.vendor) {
        if (a.vendor.m365_service) {
          lines.push(`         Service: ${a.vendor.m365_service}`);
        }
        if (a.vendor.implementation) {
          lines.push(`         Impl: ${a.vendor.implementation}`);
        }
        if (a.vendor.portal_path) {
          lines.push(`         Portal: ${a.vendor.portal_path}`);
        }
        if (a.vendor.powershell?.length > 0) {
          for (const cmd of a.vendor.powershell) {
            lines.push(`         PS> ${cmd}`);
          }
        }
        if (a.vendor.evidence_commands?.length > 0) {
          for (const cmd of a.vendor.evidence_commands) {
            lines.push(`         Evidence$ ${cmd}`);
          }
        }
        if (a.vendor.notes) {
          lines.push(`         Note: ${a.vendor.notes}`);
        }
        if (a.vendor.tech_ref_guidance) {
          lines.push('         Tech Ref Guidance:');
          const guidanceLines =
            typeof a.vendor.tech_ref_guidance === 'string'
              ? [a.vendor.tech_ref_guidance]
              : a.vendor.tech_ref_guidance;
          for (const g of guidanceLines) {
            lines.push(`           - ${stripLinks(g)}`);
          }
        }
      }
    });
  }

  // Documentation links
  const vendorHelpRefs: any[] = step.vendor_help_refs || [];
  if (vendorHelpRefs.length > 0) {
    lines.push('    Documentation Links:');
    for (const ref of vendorHelpRefs) {
      const product = ref.product || ref.vendor || '';
      const title = ref.title || '';
      const url = ref.url || '';
      const label = product ? `${product}: ${title}` : title;
      lines.push(`      - ${label}${url ? ` (${url})` : ''}`);
    }
  }

  // Categorize what_to_do lines into sections
  const implSteps: string[] = [];
  const cmmcGuidanceSteps: string[] = [];
  const deliverableSteps: string[] = [];
  const evidenceCollSteps: string[] = [];
  let currentBucket: 'impl' | 'cmmc' | 'deliverable' | 'evidence' = 'impl';
  for (const s of step.what_to_do || []) {
    if (s.startsWith('[Automated Evidence Collection]') || s.startsWith('[Evidence Collection')) {
      currentBucket = 'evidence';
      evidenceCollSteps.push(s);
    } else if (s.startsWith('[Evidence]')) {
      currentBucket = 'evidence';
      evidenceCollSteps.push(s);
    } else if (s.startsWith('[CMMC Guidance]') || s.startsWith('[Assessment Design]') || s.startsWith('[Common Pitfall]')) {
      currentBucket = 'cmmc';
      cmmcGuidanceSteps.push(s);
    } else if (s.startsWith('[Deliverable]')) {
      currentBucket = 'deliverable';
      deliverableSteps.push(s);
    } else if (s.startsWith('  ') && currentBucket === 'evidence') {
      evidenceCollSteps.push(s);
    } else if (s.startsWith('  ') && currentBucket === 'deliverable') {
      deliverableSteps.push(s);
    } else {
      currentBucket = 'impl';
      implSteps.push(s);
    }
  }

  if (implSteps.length > 0) {
    lines.push(actions.length > 0 ? '    Supplemental Guidance:' : '    Do:');
    implSteps.forEach((a: string) => lines.push(`      - ${a}`));
  }

  // CMMC procedural guidance — operationalization, assessment design, pitfalls
  if (cmmcGuidanceSteps.length > 0) {
    lines.push('');
    lines.push('    CMMC Compliance Guidance:');
    for (const s of cmmcGuidanceSteps) {
      if (s.startsWith('[CMMC Guidance]')) {
        lines.push(`      ${s.replace('[CMMC Guidance] ', '')}`);
      } else if (s.startsWith('[Assessment Design]')) {
        lines.push(`      Assessment: ${s.replace('[Assessment Design] ', '')}`);
      } else if (s.startsWith('[Common Pitfall]')) {
        lines.push(`      ⚠ Pitfall: ${s.replace('[Common Pitfall] ', '')}`);
      }
    }
  }

  // Deliverable content guide — document templates for non-systems artifacts
  if (deliverableSteps.length > 0) {
    lines.push('');
    lines.push('    Deliverable Content Guide:');
    for (const s of deliverableSteps) {
      if (s.startsWith('[Deliverable]')) {
        lines.push('');
        lines.push(`      >> ${s.replace('[Deliverable] ', '')}`);
      } else if (s.startsWith('  Content:')) {
        lines.push(`        Content: ${s.replace('  Content: ', '')}`);
      } else if (s.startsWith('  Assessor:')) {
        lines.push(`        Verify:  ${s.replace('  Assessor: ', '')}`);
      } else if (s.startsWith('  Create with:')) {
        lines.push(`        Create:  ${s.replace('  Create with: ', '')}`);
      } else if (s.startsWith('  Ref:')) {
        lines.push(`        ${s.trim()}`);
      } else {
        lines.push(`        ${s.trim()}`);
      }
    }
  }

  // Automated evidence collection — rendered as a distinct section
  if (evidenceCollSteps.length > 0) {
    lines.push('');
    lines.push('    Automated Evidence Collection:');
    for (const s of evidenceCollSteps) {
      if (s.startsWith('[Automated Evidence Collection]')) {
        lines.push('');
        lines.push(`      ${s.replace('[Automated Evidence Collection] ', '')}`);
      } else if (s.startsWith('[Evidence Collection')) {
        lines.push('');
        lines.push(`      ${s.replace(/^\[Evidence Collection[^\]]*\]\s*/, '** NO VENDOR AUTOMATION: ')}`);
      } else if (s.startsWith('[Evidence]')) {
        lines.push(`      ${s.replace('[Evidence] ', '')}`);
      } else if (s.startsWith('  Command:')) {
        lines.push(`        $ ${s.replace('  Command: ', '')}`);
      } else if (s.startsWith('  ')) {
        lines.push(`        ${s.trim()}`);
      } else {
        lines.push(`      ${s}`);
      }
    }
  }

  // Structured Microsoft Implementation Guidance (from tech_ref field)
  const tr = step.tech_ref;
  if (tr) {
    lines.push('');
    lines.push('    Microsoft Implementation Guidance:');

    if (tr.assessment_objectives?.length > 0) {
      lines.push('      Assessment Objectives:');
      for (const ao of tr.assessment_objectives) {
        lines.push(`        ${ao.id}: ${ao.text}`);
      }
    }

    for (const svc of tr.implementation_by_service || []) {
      lines.push(`      ${svc.service_name}:`);
      for (const para of svc.paragraphs || []) {
        lines.push(`        ${stripLinks(para.text_with_links || para.text)}`);
      }
    }

    if (tr.gcch_responsibilities?.length > 0) {
      lines.push('      GCC High Customer Responsibilities:');
      for (const r of tr.gcch_responsibilities) {
        lines.push(`        * ${stripLinks(r.text_with_links || r.text)}`);
      }
    }

    const eg = tr.evidence_guidance;
    if (eg) {
      lines.push('      Evidence Requirements:');
      if (eg.assessor_methods?.length > 0) {
        lines.push(`        Assessor methods: ${eg.assessor_methods.join(', ')}`);
      }
      for (const arch of eg.archetypes || []) {
        lines.push(`        ${arch.name} (target strength: ${arch.strength})`);
        for (const ex of arch.strength_examples || []) {
          lines.push(`          [${ex.strength}] ${ex.description}`);
        }
      }
      if (eg.anti_patterns?.length > 0) {
        lines.push('      Anti-Patterns:');
        for (const ap of eg.anti_patterns) {
          lines.push(`        - ${ap}`);
        }
      }
    }
  }

  // Verification
  if (step.how_to_verify?.length) {
    lines.push('    Verify:');
    step.how_to_verify.forEach((v: string) => lines.push(`      - ${v}`));
  }

  // Expected artifacts
  if (step.expected_artifacts?.length) {
    lines.push('    Evidence Required:');
    step.expected_artifacts.forEach((a: any, i: number) => {
      lines.push(`      [${i + 1}] ${(a.artifact_type || 'other').replace(/_/g, ' ')}`);
      if (a.description) {
        lines.push(`          ${a.description}`);
      }
      lines.push(`          Collector: ${a.collector || 'evidence_ops'}  |  Retain: ${a.retention_days || 365} days`);
    });
  }

  // Completion criteria (manual plan only)
  if (step.manual_completion_criteria?.length) {
    lines.push('    Done when:');
    step.manual_completion_criteria.forEach((c: string) => lines.push(`      [_] ${c}`));
  }

  // Dependencies
  if (step.dependencies?.length) {
    const deps = step.dependencies.map((d: string) => extractControlFromStepId(d));
    lines.push(`    Depends on: ${deps.join(', ')}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------

function formatProposal(proposal: any): string {
  const p = proposal?.proposal || {};
  const sections: string[] = [];

  sections.push(sectionHeader('PROPOSAL & PRICING'));

  // Summary
  sections.push([
    `  Customer:   ${p.customer?.name || 'N/A'}`,
    `  Provider:   ${p.offeror?.name || 'N/A'}`,
    `  Model:      ${formatValue(p.pricing_model)}`,
    `  Currency:   ${p.currency || 'USD'}`,
    `  Period:     ${p.period_of_performance?.start_date || '?'} to ${p.period_of_performance?.end_date || '?'}`,
    '',
  ].join('\n'));

  // Line items table with LOE breakdown
  const items = p.line_items || [];
  if (items.length > 0) {
    sections.push(bold('  LINE ITEMS'));
    const hdr = [
      'Requirement ID'.padEnd(18),
      'Domain'.padEnd(6),
      'Title'.padEnd(30),
      'Dev LOE (h)'.padStart(12),
      'Manual (h)'.padStart(11),
      'Auto (h)'.padStart(9),
      'Recur Man (h/yr)'.padStart(17),
      'Recur Auto (h/yr)'.padStart(18),
      'Total (h)'.padStart(10),
      'Price'.padStart(12),
    ].join(' ');
    sections.push(`  ${hdr}`);
    sections.push(`  ${'─'.repeat(hdr.length)}`);
    for (const item of items) {
      sections.push(
        `  ${(item.requirement_id || '').padEnd(18)} ${(item.domain || '').padEnd(6)} ${truncate(item.name, 28).padEnd(30)} ${String(item.dev_loe_hours ?? 0).padStart(12)} ${String(item.config_manual_hours ?? 0).padStart(11)} ${String(item.config_automated_hours ?? 0).padStart(9)} ${String(item.recurring_manual_hours_yr ?? 0).padStart(17)} ${String(item.recurring_automated_hours_yr ?? 0).padStart(18)} ${String(item.qty).padStart(10)} ${formatCurrency(item.extended_price).padStart(12)}`,
      );
    }
    sections.push(`  ${'─'.repeat(hdr.length)}`);

    const totals = p.totals || {};
    const pad = 18 + 1 + 6 + 1 + 30;
    sections.push(`  ${''.padEnd(pad)} ${''.padStart(12)} ${''.padStart(11)} ${''.padStart(9)} ${''.padStart(17)} ${''.padStart(18)} ${'Subtotal'.padStart(10)} ${formatCurrency(totals.subtotal).padStart(12)}`);
    if (totals.tax) {
      sections.push(`  ${''.padEnd(pad)} ${''.padStart(12)} ${''.padStart(11)} ${''.padStart(9)} ${''.padStart(17)} ${''.padStart(18)} ${'Tax'.padStart(10)} ${formatCurrency(totals.tax).padStart(12)}`);
    }
    if (totals.other_fees) {
      sections.push(`  ${''.padEnd(pad)} ${''.padStart(12)} ${''.padStart(11)} ${''.padStart(9)} ${''.padStart(17)} ${''.padStart(18)} ${'Fees'.padStart(10)} ${formatCurrency(totals.other_fees).padStart(12)}`);
    }
    sections.push(`  ${''.padEnd(pad)} ${''.padStart(12)} ${''.padStart(11)} ${''.padStart(9)} ${''.padStart(17)} ${''.padStart(18)} ${'TOTAL'.padStart(10)} ${formatCurrency(totals.total).padStart(12)}`);
    sections.push('');
  }

  // Milestones
  const milestones = p.period_of_performance?.milestones || [];
  if (milestones.length > 0) {
    sections.push(bold('  MILESTONE SCHEDULE'));
    for (const ms of milestones) {
      sections.push(`  ${ms.id}  ${ms.name.padEnd(40)} ${ms.target_date || 'TBD'}`);
      if (ms.acceptance_criteria?.length) {
        ms.acceptance_criteria.forEach((c: string) => sections.push(`        - ${c}`));
      }
    }
    sections.push('');
  }

  // Assumptions & Exclusions
  if (p.assumptions?.length) {
    sections.push(bold('  ASSUMPTIONS'));
    p.assumptions.forEach((a: string) => sections.push(`    - ${a}`));
    sections.push('');
  }

  if (p.exclusions?.length) {
    sections.push(bold('  EXCLUSIONS'));
    p.exclusions.forEach((e: string) => sections.push(`    - ${e}`));
    sections.push('');
  }

  // Full SOW
  const sow = p.sow;
  if (sow) {
    sections.push(bold('  STATEMENT OF WORK'));
    if (sow.overview) sections.push(`  ${sow.overview}`);
    sections.push('');

    if (sow.scope?.length) {
      sections.push('  Scope:');
      sow.scope.forEach((s: string) => sections.push(`    - ${s}`));
      sections.push('');
    }

    if (sow.deliverables?.length) {
      sections.push('  Deliverables:');
      sow.deliverables.forEach((d: string) => sections.push(`    - ${d}`));
      sections.push('');
    }

    if (sow.acceptance_criteria?.length) {
      sections.push('  Acceptance Criteria:');
      sow.acceptance_criteria.forEach((c: string) => sections.push(`    - ${c}`));
      sections.push('');
    }

    if (sow.roles_responsibilities) {
      const rr = sow.roles_responsibilities;
      if (rr.customer?.length) {
        sections.push('  Customer Responsibilities:');
        rr.customer.forEach((r: string) => sections.push(`    - ${r}`));
      }
      if (rr.offeror?.length) {
        sections.push('  Provider Responsibilities:');
        rr.offeror.forEach((r: string) => sections.push(`    - ${r}`));
      }
      sections.push('');
    }

    if (sow.out_of_scope?.length) {
      sections.push('  Out of Scope:');
      sow.out_of_scope.forEach((o: string) => sections.push(`    - ${o}`));
      sections.push('');
    }

    if (sow.customer_dependencies?.length) {
      sections.push('  Customer Dependencies:');
      sow.customer_dependencies.forEach((d: string) => sections.push(`    - ${d}`));
      sections.push('');
    }

    if (sow.schedule?.length) {
      sections.push('  Schedule:');
      sow.schedule.forEach((s: string) => sections.push(`    - ${s}`));
      sections.push('');
    }

    if (sow.pricing_terms?.length) {
      sections.push('  Pricing Terms:');
      sow.pricing_terms.forEach((t: string) => sections.push(`    - ${t}`));
      sections.push('');
    }
  }

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Inline SOW (from manual plan's cost_proposal_sow)
// ---------------------------------------------------------------------------

function formatInlineSOW(sow: any): string {
  const sections: string[] = [];
  sections.push(sectionHeader('COST SUMMARY'));

  const items = sow.line_items || [];
  if (items.length > 0) {
    sections.push(
      `  ${'Phase'.padEnd(40)} ${'Hrs'.padStart(6)} ${'Rate'.padStart(8)} ${'Cost'.padStart(12)}`,
    );
    sections.push(`  ${'─'.repeat(70)}`);
    for (const item of items) {
      sections.push(
        `  ${truncate(item.name, 38).padEnd(40)} ${String(item.qty).padStart(6)} ${formatCurrency(item.unit_price).padStart(8)} ${formatCurrency(item.extended_price).padStart(12)}`,
      );
    }
    sections.push('');
  }

  if (sow.assumptions?.length) {
    sections.push('  Assumptions:');
    sow.assumptions.forEach((a: string) => sections.push(`    - ${a}`));
  }

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Tenant Manifest Summary
// ---------------------------------------------------------------------------

function formatManifestSummary(manifest: any): string {
  const tm = manifest?.tenant_manifest || {};
  const sections: string[] = [];

  sections.push(sectionHeader('TENANT MANIFEST SUMMARY'));

  const controls = tm.normative_controls || [];
  const monitors = tm.evidence_monitors || [];
  const driftPolicies = tm.drift_policies || [];
  const configIntents = tm.config_intents || [];

  sections.push([
    `  Normative Controls:  ${controls.length}`,
    `  Config Intents:      ${configIntents.length}`,
    `  Evidence Monitors:   ${monitors.length}`,
    `  Drift Policies:      ${driftPolicies.length}`,
    '',
  ].join('\n'));

  // List normative controls compactly
  if (controls.length > 0) {
    sections.push(bold('  EXPECTED CONTROL STATES'));
    for (const ctrl of controls) {
      sections.push(
        `    ${ctrl.control_id.padEnd(16)} ${truncate(ctrl.required_state, 60)}`,
      );
    }
    sections.push('');
  }

  // Drift policies
  if (driftPolicies.length > 0) {
    sections.push(bold('  DRIFT POLICIES'));
    for (const dp of driftPolicies) {
      sections.push(`    [${(dp.severity || '').toUpperCase()}]  ${dp.scope}`);
      if (dp.response_playbook?.length) {
        dp.response_playbook.forEach((r: string) => sections.push(`      - ${r}`));
      }
    }
    sections.push('');
  }

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// CUI Boundary & Topology Verification
// ---------------------------------------------------------------------------

function formatBoundarySection(boundaryContext: any): string {
  const sections: string[] = [];
  sections.push(sectionHeader('CUI BOUNDARY & TOPOLOGY VERIFICATION'));

  if (boundaryContext.cui_boundary) {
    sections.push(bold('  CUI BOUNDARY DEFINITIONS'));
    const boundary = boundaryContext.cui_boundary;
    for (const [key, value] of Object.entries(boundary)) {
      const displayValue = Array.isArray(value) ? value.join(', ') : String(value);
      sections.push(`    ${key.padEnd(36)} ${displayValue}`);
    }
    sections.push('');
  }

  if (boundaryContext.btc_verification) {
    const btcv = boundaryContext.btc_verification;
    const gates = btcv.gate_status || {};
    const gateEntries = Object.entries(gates) as [string, any][];
    const passCount = gateEntries.filter(([, g]) => g.pass).length;
    const failCount = gateEntries.filter(([, g]) => !g.pass).length;

    sections.push(bold('  BTC VERIFICATION STATUS'));
    sections.push(`    Gates: ${passCount} PASS, ${failCount} FAIL (${gateEntries.length} total)`);
    sections.push(`    Evidence Items: ${btcv.evidence_count || 0}`);
    sections.push('');

    if (gateEntries.length > 0) {
      sections.push('  Gate Details:');
      for (const [sectionId, gate] of gateEntries) {
        const status = gate.pass ? 'PASS' : 'FAIL';
        sections.push(`    [${status}] ${sectionId} — ${gate.domain}: ${gate.reason}`);
      }
      sections.push('');
    }

    const riskFlags = btcv.risk_flags || [];
    if (riskFlags.length > 0) {
      sections.push(bold(`  RISK FLAGS (${riskFlags.length})`));
      for (const flag of riskFlags) {
        sections.push(`    [${(flag.severity || '').toUpperCase()}] ${flag.flag_id}: ${flag.description}`);
        sections.push(`      Domain: ${flag.domain} | Rule: ${flag.source_rule_id || 'N/A'}`);
      }
      sections.push('');
    }
  }

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function formatFooter(): string {
  return [
    DLINE,
    center('END OF MISSION PLAN'),
    `Generated by CES Mission Planning Tool on ${new Date().toISOString().slice(0, 10)}`,
    DLINE,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sectionHeader(title: string): string {
  return `\n${DLINE}\n${bold(title)}\n${DLINE}`;
}

function bold(text: string): string {
  return text.toUpperCase();
}

function center(text: string): string {
  const pad = Math.max(0, Math.floor((80 - text.length) / 2));
  return ' '.repeat(pad) + text;
}

function pad(value: any, width: number): string {
  return String(value ?? '?').padStart(width);
}

function truncate(str: string, maxLen: number): string {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen - 3) + '...';
}

function formatValue(val: string | undefined): string {
  if (!val) return 'N/A';
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatPlanMode(mode: string | undefined): string {
  if (!mode) return 'N/A';
  return mode.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCurrency(amount: number | undefined): string {
  if (amount == null) return '$0';
  return `$${amount.toLocaleString('en-US')}`;
}

function countByField(items: any[], field: string): Record<string, number> {
  const counts: Record<string, number> = {};
  items.forEach((item) => {
    const val = item[field] || 'unknown';
    counts[val] = (counts[val] || 0) + 1;
  });
  return counts;
}

function groupByDomain(steps: any[]): Record<string, any[]> {
  const groups: Record<string, any[]> = {};
  for (const step of steps) {
    const domain = step.requirement_context?.domain || extractDomainFromTitle(step.title) || 'OTHER';
    if (!groups[domain]) groups[domain] = [];
    groups[domain].push(step);
  }
  return groups;
}

function extractDomainFromTitle(title: string): string {
  // Try to extract domain from step title like "Access Control Policy (AC.L2-3.1.8)"
  const match = title?.match(/\(([A-Z]{2})\./);
  if (match) return match[1];
  // Try from step id like "step_task_AC.L2-3.1.8_..."
  const idMatch = title?.match(/^([A-Z]{2})\./);
  if (idMatch) return idMatch[1];
  return '';
}

function extractControlFromStepId(stepId: string): string {
  // "step_task_AC.L2-3.1.8_xxx" → "AC.L2-3.1.8"
  const match = stepId.match(/step_task_([A-Z]+\.[A-Z0-9]+-[\d.]+)/);
  return match ? match[1] : stepId;
}

// ---------------------------------------------------------------------------
// HTML Export — self-contained styled document
// ---------------------------------------------------------------------------

/** Escape HTML entities to prevent rendering issues in the browser. */
export function esc(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** HTML-escape text, then convert markdown `[text](url)` links to `<a>` tags. */
export function escWithLinks(str: string | undefined | null): string {
  if (!str) return '';
  return esc(str).replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" class="doc-link" target="_blank" rel="noopener noreferrer">$1</a>',
  );
}

/** Convert markdown `[text](url)` to plain `text (url)` for text export. */
function stripLinks(str: string | undefined | null): string {
  if (!str) return '';
  return str.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)');
}

const PRIORITY_COLORS: Record<string, string> = {
  p0: '#dc2626',
  p1: '#ea580c',
  p2: '#2563eb',
  p3: '#9ca3af',
};

const PRIORITY_BG: Record<string, string> = {
  p0: '#fef2f2',
  p1: '#fff7ed',
  p2: '#eff6ff',
  p3: '#f9fafb',
};

const ACTION_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  configuration: { bg: '#dbeafe', text: '#1e40af' },
  policy: { bg: '#e0e7ff', text: '#3730a3' },
  monitoring: { bg: '#fef3c7', text: '#92400e' },
  assessment: { bg: '#d1fae5', text: '#065f46' },
};
const ACTION_TYPE_DEFAULT = { bg: '#f3f4f6', text: '#374151' };

const ACTION_TYPE_TIPS: Record<string, string> = {
  configuration: 'A change to system settings, tenant config, or infrastructure — typically done in an admin portal or via script.',
  policy: 'A written policy, procedure, or governance document that must be created or updated to satisfy the requirement.',
  monitoring: 'An ongoing detection, alerting, or log-review activity that must be established and maintained.',
  assessment: 'A review, audit, or validation activity performed to confirm a control is operating correctly.',
};

const PRIORITY_TIPS: Record<string, string> = {
  p0: 'CRITICAL — Must be resolved immediately. Blocks certification and poses the highest compliance risk.',
  p1: 'HIGH — Should be addressed in the first milestone. Significant gap that assessors will flag.',
  p2: 'STANDARD — Normal-priority task. Address during the main implementation phase.',
  p3: 'LOW — Minor or enhancement-level item. Can be deferred without impacting certification readiness.',
};

const STAT_TIPS: Record<string, string> = {
  met: 'Met — Requirements where your current controls fully satisfy the CMMC practice. No remediation needed.',
  partial: 'Partial — Requirements where some controls are in place but gaps remain. Additional work is needed to achieve full compliance.',
  not_met: 'Not Met — Requirements where no effective controls are in place. Full implementation is required.',
  unknown: 'Unknown — Requirements that could not be assessed due to insufficient evidence or unclear scope.',
};

const GAP_CLASS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  configure: { bg: '#d1fae5', text: '#065f46', label: 'Configure' },
  customize: { bg: '#dbeafe', text: '#1e40af', label: 'Customize' },
  manual: { bg: '#fef3c7', text: '#92400e', label: 'Manual' },
};

const GAP_CLASS_TIPS: Record<string, string> = {
  configure: 'Configure — A service in your vendor stack directly satisfies this task. Enable and configure the existing capability.',
  customize: 'Customize — Your vendor stack can meet this requirement with additional scripting, customization, or configuration work.',
  manual: 'Manual — This requirement must be solved outside the vendor stack through manual processes, policies, or documentation.',
};


/**
 * Convert a manual mission plan JSON artifact into a self-contained HTML document.
 */
export function formatPlanAsHTML(plan: any): string {
  const ces = plan?.ces || {};
  const hrp = plan?.outputs?.human_readable_mission_plan || {};
  const inputs = plan?.inputs || {};
  const si = inputs.si_baseline?.si_baseline || {};
  const posture = inputs.readiness_posture || {};
  const summary = posture.control_status_summary || {};
  const steps = hrp.steps || [];
  const milestones = hrp.milestones || [];
  const notes = hrp.assessor_alignment_notes || [];
  const costSow = plan?.outputs?.cost_proposal_sow || {};

  const boundaryContext = hrp.boundary_context;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(ces.intent || 'CMMC Compliance Mission Plan')}</title>
<style>
${renderHTMLStyles()}
</style>
</head>
<body>
<div class="container">
${renderHTMLHeader(ces, hrp, si, summary, steps)}
${renderHTMLInputReferences(inputs)}
${renderHTMLReadinessSnapshot(summary, steps)}
${boundaryContext ? renderHTMLBoundarySection(boundaryContext) : ''}
${renderHTMLClassificationSummary(steps)}
${milestones.length > 0 ? renderHTMLMilestones(milestones, steps) : ''}
${renderHTMLImplementationSteps(steps)}
${notes.length > 0 ? renderHTMLAssessorNotes(notes) : ''}
${costSow.line_items ? renderHTMLCostProposal(costSow) : ''}
${renderHTMLFooter()}
</div>
</body>
</html>`;
}

/**
 * Download a manual mission plan as a standalone HTML file.
 */
export function exportPlanAsHTML(plan: any, filename: string): void {
  const html = formatPlanAsHTML(plan);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.html') ? filename : `${filename}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// HTML Styles
// ---------------------------------------------------------------------------

function renderHTMLStyles(): string {
  return `
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0; padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px; line-height: 1.6; color: #1f2937; background: #f9fafb;
}
.container { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
h1 { font-size: 24px; margin: 0 0 4px; color: #111827; }
h2 { font-size: 18px; margin: 32px 0 16px; color: #111827; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
h3 { font-size: 15px; margin: 24px 0 12px; color: #374151; }
.subtitle { font-size: 14px; color: #6b7280; margin: 0 0 24px; }
.section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px 24px; margin-bottom: 24px; }
.meta-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 24px; }
.meta-item { font-size: 13px; }
.meta-label { color: #6b7280; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; }
.meta-value { color: #111827; margin-top: 2px; }
.stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.stat-card { padding: 16px; border-radius: 8px; text-align: center; }
.stat-card .stat-value { font-size: 28px; font-weight: 700; }
.stat-card .stat-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
.stat-met { background: #d1fae5; color: #065f46; }
.stat-partial { background: #fef3c7; color: #92400e; }
.stat-not-met { background: #fee2e2; color: #991b1b; }
.stat-unknown { background: #f3f4f6; color: #6b7280; }
.milestone-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 20px; margin-bottom: 12px; }
.milestone-card .ms-header { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.milestone-card .ms-id { font-weight: 700; color: #2563eb; font-size: 13px; }
.milestone-card .ms-name { font-weight: 600; color: #111827; }
.milestone-card .ms-meta { font-size: 12px; color: #6b7280; }
.milestone-card .ms-objective { font-size: 13px; color: #4b5563; margin-top: 8px; }
.milestone-card .ms-criteria { margin-top: 8px; padding-left: 20px; font-size: 13px; color: #4b5563; }
.domain-header { background: #1f2937; color: #fff; padding: 12px 20px; border-radius: 8px 8px 0 0; margin-top: 24px; display: flex; justify-content: space-between; align-items: baseline; }
.domain-header .domain-title { font-weight: 700; font-size: 15px; }
.domain-header .domain-stats { font-size: 12px; opacity: 0.8; }
.step-card { border: 1px solid #e5e7eb; border-left: 4px solid #9ca3af; border-radius: 0 8px 8px 0; padding: 16px 20px; margin-bottom: 8px; background: #fff; }
.step-card:last-child { margin-bottom: 0; }
.step-header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.priority-badge { display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
[title] { cursor: help; }
.step-title { font-weight: 600; color: #111827; font-size: 14px; }
.step-meta { display: flex; flex-wrap: wrap; gap: 16px; font-size: 12px; color: #6b7280; margin-top: 6px; }
.step-meta span { white-space: nowrap; }
.blockquote { border-left: 3px solid #d1d5db; padding: 8px 16px; margin: 12px 0; background: #f9fafb; font-size: 13px; color: #4b5563; border-radius: 0 4px 4px 0; }
.actions-section { margin-top: 12px; }
.action-item { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 14px; margin-bottom: 8px; }
.action-type-badge { display: inline-block; padding: 1px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; margin-right: 8px; }
.action-text { font-size: 13px; color: #1f2937; }
.action-detail { font-size: 12px; color: #6b7280; margin-top: 4px; }
.action-detail strong { color: #374151; }
.cmd-block { background: #1f2937; color: #e5e7eb; padding: 8px 12px; border-radius: 4px; font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; font-size: 12px; overflow-x: auto; margin: 4px 0; white-space: pre-wrap; word-break: break-all; }
.guidance-section { margin-top: 12px; }
.guidance-category { font-size: 12px; font-weight: 600; color: #374151; text-transform: uppercase; letter-spacing: 0.05em; margin: 10px 0 6px; }
.guidance-list { margin: 0; padding-left: 20px; font-size: 13px; color: #4b5563; }
.guidance-list li { margin-bottom: 4px; }
.verify-list { margin: 10px 0 0; padding-left: 20px; }
.verify-list li { font-size: 13px; color: #4b5563; margin-bottom: 4px; }
.evidence-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
.evidence-table th { text-align: left; padding: 6px 10px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #374151; }
.evidence-table td { padding: 6px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
.checklist { list-style: none; padding-left: 0; margin: 10px 0 0; }
.checklist li { font-size: 13px; color: #4b5563; margin-bottom: 4px; padding-left: 24px; position: relative; }
.checklist li::before { content: '\\2610'; position: absolute; left: 0; color: #9ca3af; font-size: 16px; line-height: 1.2; }
.deps { font-size: 12px; color: #6b7280; margin-top: 8px; }
.deps strong { color: #374151; }
.notes-list { counter-reset: note; padding-left: 0; list-style: none; }
.notes-list li { counter-increment: note; font-size: 13px; color: #4b5563; margin-bottom: 8px; padding-left: 28px; position: relative; }
.notes-list li::before { content: counter(note) '.'; position: absolute; left: 0; font-weight: 700; color: #2563eb; }
.footer { text-align: center; font-size: 12px; color: #9ca3af; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
a.doc-link { color: #2563eb; text-decoration: underline; text-decoration-color: #93c5fd; text-underline-offset: 2px; }
a.doc-link:hover { color: #1d4ed8; text-decoration-color: #2563eb; }
.doc-links-section { margin: 12px 0; }
.doc-links-section .doc-link-item { display: flex; align-items: baseline; gap: 6px; font-size: 13px; margin-bottom: 4px; }
.doc-links-section .doc-link-product { font-weight: 600; color: #374151; }
.toc-nav { columns: 2; gap: 24px; list-style: none; padding: 0; margin: 0; }
.toc-nav li { break-inside: avoid; margin-bottom: 6px; font-size: 13px; }
.toc-nav a { color: #2563eb; text-decoration: none; }
.toc-nav a:hover { text-decoration: underline; }
.toc-nav .toc-count { color: #9ca3af; font-size: 12px; }
.cost-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }
.cost-table th { text-align: left; padding: 8px 12px; background: #1f2937; color: #fff; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
.cost-table td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
.cost-table tr:last-child td { border-bottom: none; }
.cost-table .total-row td { font-weight: 700; background: #f3f4f6; border-top: 2px solid #1f2937; }
.input-refs { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.input-ref-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 16px; }
.input-ref-card .ref-title { font-weight: 700; font-size: 12px; color: #374151; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
.input-ref-card .ref-item { font-size: 12px; color: #6b7280; display: flex; gap: 6px; margin-bottom: 2px; }
.input-ref-card .ref-item .ref-key { font-weight: 600; color: #374151; white-space: nowrap; }
.sow-section { margin-top: 16px; }
.sow-section h4 { font-size: 13px; font-weight: 700; color: #374151; margin: 12px 0 6px; text-transform: uppercase; letter-spacing: 0.03em; }
.sow-section ul { margin: 0; padding-left: 20px; font-size: 13px; color: #4b5563; }
.sow-section ul li { margin-bottom: 4px; }

@media print {
  body { background: #fff; font-size: 10pt; }
  .container { max-width: 100%; padding: 0; }
  .section { border: 1px solid #ccc; box-shadow: none; break-inside: avoid; }
  .domain-header { break-after: avoid; }
  .step-card { break-inside: avoid; }
  .milestone-card { break-inside: avoid; }
  h2 { break-after: avoid; }
}
`;
}

// ---------------------------------------------------------------------------
// HTML Section Renderers
// ---------------------------------------------------------------------------

function renderHTMLHeader(
  ces: any,
  hrp: any,
  si: any,
  summary: any,
  steps: any[],
): string {
  const totalHours = steps.reduce((s: number, t: any) => s + (t.estimated_effort_hours || 0), 0);
  void summary; // used in snapshot section separately

  return `
<h1>${esc(ces.intent || 'CMMC Compliance Mission Plan')}</h1>
<p class="subtitle">Generated ${esc(ces.generated_on || 'N/A')} &middot; ${esc(String(steps.length))} implementation steps &middot; ${esc(String(totalHours))} total hours</p>
<div class="section">
  <div class="meta-grid">
    <div class="meta-item"><div class="meta-label">Generated</div><div class="meta-value">${esc(ces.generated_on || 'N/A')}</div></div>
    <div class="meta-item"><div class="meta-label">Target Level</div><div class="meta-value">CMMC ${esc(hrp.target_level || 'L2')}</div></div>
    <div class="meta-item"><div class="meta-label">Plan Mode</div><div class="meta-value">${esc(formatPlanMode(hrp.plan_mode))}</div></div>
    <div class="meta-item"><div class="meta-label">Deployment</div><div class="meta-value">${esc(formatValue(si.scope?.deployment_posture))}</div></div>
    <div class="meta-item"><div class="meta-label">CUI</div><div class="meta-value">${esc(formatValue(si.target?.cui_presence))}</div></div>
    <div class="meta-item"><div class="meta-label">Boundary</div><div class="meta-value">${esc(formatValue(si.scope?.boundary_strategy))}</div></div>
  </div>
</div>`;
}

function renderHTMLReadinessSnapshot(summary: any, steps: any[]): string {
  const met = summary.met ?? 0;
  const partial = summary.partial ?? 0;
  const notMet = summary.not_met ?? 0;
  const unknown = summary.unknown ?? 0;
  const total = met + partial + notMet + unknown;

  // Classification breakdown — each step counted exactly once by primary classification
  let configureCount = 0;
  let customizeCount = 0;
  let manualCount = 0;
  for (const s of steps) {
    const pc = htmlPrimaryClassification(s);
    if (pc === 'configure') configureCount++;
    else if (pc === 'customize') customizeCount++;
    else manualCount++;
  }

  return `
<h2>Readiness Snapshot</h2>
<div class="section">
  <div class="stats-row">
    <div class="stat-card stat-met" title="${esc(STAT_TIPS.met)}"><div class="stat-value">${met}</div><div class="stat-label">Met</div></div>
    <div class="stat-card stat-partial" title="${esc(STAT_TIPS.partial)}"><div class="stat-value">${partial}</div><div class="stat-label">Partial</div></div>
    <div class="stat-card stat-not-met" title="${esc(STAT_TIPS.not_met)}"><div class="stat-value">${notMet}</div><div class="stat-label">Not Met</div></div>
    <div class="stat-card stat-unknown" title="${esc(STAT_TIPS.unknown)}"><div class="stat-value">${unknown}</div><div class="stat-label">Unknown</div></div>
  </div>
  <div style="text-align:center; font-size:12px; color:#6b7280; margin-top:-4px; margin-bottom:12px;">Total assessed: ${total}</div>
  <div style="border-top:1px solid #e5e7eb; padding-top:16px;">
    <div style="text-align:center; font-size:12px; font-weight:600; color:#6b7280; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px;">Plan Breakdown</div>
    <div class="stats-row" style="grid-template-columns: repeat(4, 1fr);">
      <div class="stat-card" style="background:#dbeafe; color:#1e40af;" title="Total implementation tasks in this plan"><div class="stat-value">${steps.length}</div><div class="stat-label">Total Tasks</div></div>
      <div class="stat-card" style="background:#d1fae5; color:#065f46;" title="${esc(GAP_CLASS_TIPS.configure)}"><div class="stat-value">${configureCount}</div><div class="stat-label">Configure</div></div>
      <div class="stat-card" style="background:#dbeafe; color:#1e40af;" title="${esc(GAP_CLASS_TIPS.customize)}"><div class="stat-value">${customizeCount}</div><div class="stat-label">Customize</div></div>
      <div class="stat-card" style="background:#fef3c7; color:#92400e;" title="${esc(GAP_CLASS_TIPS.manual)}"><div class="stat-value">${manualCount}</div><div class="stat-label">Manual</div></div>
    </div>
  </div>
</div>`;
}

/**
 * Derive a concise approach description for a step based on its classification
 * and the data sources available (vendor actions, what_to_do, task_type).
 *
 * - configure:  Name the M365 services — the stack directly satisfies.
 * - customize:  Describe PowerShell/scripting customization available.
 * - manual:     Describe manual work needed outside the stack.
 */
function deriveApproach(step: any, classification: string): string {
  const actions: any[] = step.actions || [];
  const vendorRefs: any[] = step.vendor_help_refs || [];
  const whatToDo: string[] = step.what_to_do || [];
  const taskType: string = step.task_type || '';

  if (classification === 'configure') {
    // Collect distinct M365 services and their implementations
    const services = new Map<string, string[]>();
    for (const a of actions) {
      const svc = a.vendor?.m365_service;
      if (svc) {
        if (!services.has(svc)) services.set(svc, []);
        const impl = a.vendor?.implementation;
        if (impl) services.get(svc)!.push(impl);
      }
    }
    if (services.size > 0) {
      const parts: string[] = [];
      for (const [svc, impls] of services) {
        const unique = [...new Set(impls)];
        if (unique.length > 0) {
          parts.push(`${svc}: ${unique.slice(0, 2).join('; ')}${unique.length > 2 ? ` (+${unique.length - 2} more)` : ''}`);
        } else {
          parts.push(svc);
        }
      }
      return `Configure — ${parts.join('. ')}`;
    }
    if (vendorRefs.length > 0) {
      const refs = [...new Set(vendorRefs.map((r: any) => `${r.product || r.vendor}: ${r.title}`))];
      return `Configure — ${refs.slice(0, 2).join('; ')}`;
    }
    return `Configure — Enable ${taskType} controls via vendor stack`;
  }

  if (classification === 'customize') {
    // Describe PowerShell/scripting automation available
    const psCommands: string[] = [];
    for (const a of actions) {
      if (a.vendor?.powershell?.length) psCommands.push(...a.vendor.powershell);
      if (a.vendor?.evidence_commands?.length) psCommands.push(...a.vendor.evidence_commands);
    }
    if (psCommands.length > 0) {
      const unique = [...new Set(psCommands.filter((c: string) => !c.startsWith('#') && !c.startsWith('Connect-')))];
      if (unique.length > 0) {
        return `Customize — ${unique.slice(0, 2).join('; ')}${unique.length > 2 ? ` (+${unique.length - 2} more)` : ''}`;
      }
    }
    if (vendorRefs.length > 0) {
      const refs = [...new Set(vendorRefs.map((r: any) => `${r.product || r.vendor}: ${r.title}`))];
      return `Customize — ${refs.slice(0, 2).join('; ')}`;
    }
    const implLine = whatToDo.find((s) => !s.startsWith('[') && !s.startsWith('  '));
    if (implLine) return `Customize — ${truncate(implLine, 110)}`;
    return `Customize — Scripting and customization for ${taskType} controls`;
  }

  // manual
  const implLine = whatToDo.find((s) => !s.startsWith('[') && !s.startsWith('  '));
  if (implLine) return `Manual — ${truncate(implLine, 110)}`;
  const deliverable = whatToDo.find((s) => s.startsWith('[Deliverable]'));
  if (deliverable) return `Manual — ${truncate(deliverable.replace('[Deliverable] ', ''), 110)}`;
  return `Manual — ${taskType} work required outside the vendor stack`;
}

function renderHTMLClassificationSummary(steps: any[]): string {
  const groups: Record<string, any[]> = {
    configure: [],
    customize: [],
    manual: [],
  };

  for (const step of steps) {
    const pc = htmlPrimaryClassification(step);
    groups[pc].push(step);
  }

  const renderGroup = (key: string): string => {
    const items = groups[key];
    const gcb = GAP_CLASS_BADGE[key];

    if (items.length === 0) {
      return `
    <h3 style="margin-top:16px;"><span class="priority-badge" title="${esc(GAP_CLASS_TIPS[key] || '')}" style="background:${gcb.bg}; color:${gcb.text};">${gcb.label}</span> &mdash; 0 items</h3>
    <p style="font-size:13px; color:#9ca3af; font-style:italic; margin-left:8px;">No items in this category.</p>`;
    }

    const rows = items.map((s: any) => {
      const ctrl = s.control_coverage?.[0]?.control_id || '';
      const approach = deriveApproach(s, key);
      return `<tr><td style="font-family:monospace; font-size:12px;">${esc(ctrl)}</td><td>${esc(s.title)}</td><td style="font-size:12px; color:#4b5563;">${esc(approach)}</td></tr>`;
    }).join('');

    return `
    <h3 style="margin-top:16px;"><span class="priority-badge" title="${esc(GAP_CLASS_TIPS[key] || '')}" style="background:${gcb.bg}; color:${gcb.text};">${gcb.label}</span> &mdash; ${items.length} item${items.length !== 1 ? 's' : ''}</h3>
    <table class="evidence-table"><thead><tr><th>Requirement</th><th>Title</th><th>Approach</th></tr></thead><tbody>${rows}</tbody></table>`;
  };

  return `
<h2>Compliance Classification Summary</h2>
<div class="section">
  ${renderGroup('configure')}
  ${renderGroup('customize')}
  ${renderGroup('manual')}
</div>`;
}

function htmlPrimaryClassification(step: any): string {
  const gc: string[] = step.gap_classifications || [];
  if (gc.includes('manual')) return 'manual';
  if (gc.includes('customize')) return 'customize';
  return 'configure';
}

function renderHTMLMilestones(milestones: any[], steps: any[]): string {
  const cards = milestones.map((ms: any) => {
    // MS-1 (Implementation) gets all steps; MS-2 (Assessment Readiness) gets none
    const msSteps = ms.id === 'MS-1' ? steps : [];
    const msHours = msSteps.reduce((s: number, t: any) => s + (t.estimated_effort_hours || 0), 0);
    const criteria = (ms.exit_criteria || []) as string[];

    return `
  <div class="milestone-card">
    <div class="ms-header">
      <div><span class="ms-id">${esc(ms.id)}</span> &nbsp; <span class="ms-name">${esc(ms.name)}</span></div>
      <div class="ms-meta">Target: ${esc(ms.target_date || 'TBD')} &middot; ${msSteps.length} tasks &middot; ${msHours}h</div>
    </div>
    ${ms.objective ? `<div class="ms-objective">${esc(ms.objective)}</div>` : ''}
    ${criteria.length > 0 ? `<ul class="ms-criteria">${criteria.map((c: string) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
  </div>`;
  }).join('');

  return `
<h2>Milestones</h2>
<div class="section">
  ${cards}
</div>`;
}

function renderHTMLImplementationSteps(steps: any[]): string {
  const byDomain = groupByDomain(steps);
  const domains = Object.keys(byDomain).sort();

  // Table of contents
  const tocItems = domains.map((domain) => {
    const domainSteps = byDomain[domain];
    const domainName = DOMAIN_NAMES[domain] || domain;
    return `<li><a href="#domain-${esc(domain)}">${esc(domain)} - ${esc(domainName)}</a> <span class="toc-count">(${domainSteps.length} tasks)</span></li>`;
  }).join('\n      ');

  const toc = `
<div class="section">
  <h3 style="margin-top:0">Quick Navigation</h3>
  <ul class="toc-nav">
      ${tocItems}
  </ul>
</div>`;

  const domainSections = domains.map((domain) => {
    const domainSteps = byDomain[domain];
    const domainName = DOMAIN_NAMES[domain] || domain;
    const domainHours = domainSteps.reduce(
      (s: number, t: any) => s + (t.estimated_effort_hours || 0),
      0,
    );

    const stepCards = domainSteps.map((step: any) => renderHTMLStep(step)).join('');

    return `
<div class="domain-header" id="domain-${esc(domain)}">
  <span class="domain-title">${esc(domain)} &mdash; ${esc(domainName)}</span>
  <span class="domain-stats">${domainSteps.length} tasks &middot; ${domainHours}h</span>
</div>
${stepCards}`;
  }).join('');

  return `
<h2>Implementation Steps</h2>
${toc}
${domainSections}`;
}

function renderHTMLStep(step: any): string {
  const ctrl = step.control_coverage?.[0];
  const ctrlId = ctrl?.control_id || '';
  const priority = step.priority || 'p2';
  const priorityLabel = PRIORITY_LABELS[priority] || priority;
  const borderColor = PRIORITY_COLORS[priority] || '#9ca3af';
  const badgeBg = PRIORITY_COLORS[priority] || '#9ca3af';
  const badgeTextBg = PRIORITY_BG[priority] || '#f9fafb';

  const gapClasses: string[] = step.gap_classifications || [];
  const classAttr = gapClasses.join(' ');

  const parts: string[] = [];

  // Header
  parts.push(`<div class="step-card" id="step-${esc(ctrlId)}" data-control="${esc(ctrlId)}" data-priority="${esc(priority)}" data-classification="${esc(classAttr)}" style="border-left-color: ${borderColor};">`);
  parts.push(`<div class="step-header">`);
  parts.push(`<span class="priority-badge" title="${esc(PRIORITY_TIPS[priority] || '')}" style="background: ${badgeTextBg}; color: ${badgeBg};">${esc(priorityLabel)}</span>`);
  for (const gc of gapClasses) {
    const gcb = GAP_CLASS_BADGE[gc];
    if (gcb) {
      parts.push(`<span class="priority-badge" title="${esc(GAP_CLASS_TIPS[gc] || '')}" style="background: ${gcb.bg}; color: ${gcb.text};">${gcb.label}</span>`);
    }
  }
  parts.push(`<span class="step-title">${esc(step.title)}</span>`);
  parts.push(`</div>`);

  // Meta row
  parts.push(`<div class="step-meta">`);
  if (ctrlId) parts.push(`<span title="The CMMC practice or control ID this step addresses.">Control: ${esc(ctrlId)}</span>`);
  if (step.task_type) parts.push(`<span title="The category of work: configuration, policy creation, monitoring setup, or assessment activity.">Type: ${esc(step.task_type)}</span>`);
  if (step.owner_role) parts.push(`<span title="The role or team responsible for completing this step.">Owner: ${esc(step.owner_role)}</span>`);
  parts.push(`<span title="Estimated total effort in hours to complete this step.">${step.estimated_effort_hours || 0}h</span>`);
  parts.push(`</div>`);

  // Requirement text
  const ctx = step.requirement_context || {};
  if (ctx.requirement_text) {
    parts.push(`<div class="blockquote">${esc(ctx.requirement_text)}</div>`);
  }

  // Action rationale
  if (ctrl?.gap_rationale) {
    parts.push(`<div style="font-size:13px; color:#1e40af; margin:8px 0;"><strong>Action needed:</strong> ${esc(ctrl.gap_rationale)}</div>`);
  }

  // Implementation Actions
  const actions = step.actions || [];
  if (actions.length > 0) {
    parts.push(`<div class="actions-section"><h3 style="margin-top:0">Implementation Actions</h3>`);
    for (const a of actions) {
      const typeColors = ACTION_TYPE_COLORS[a.action_type] || ACTION_TYPE_DEFAULT;
      parts.push(`<div class="action-item">`);
      parts.push(`<span class="action-type-badge" title="${esc(ACTION_TYPE_TIPS[a.action_type] || '')}" style="background:${typeColors.bg}; color:${typeColors.text};">${esc(a.action_type)}</span>`);
      parts.push(`<span class="action-text">${esc(a.action)}</span>`);

      if (a.evidence_outputs?.length > 0) {
        parts.push(`<div class="action-detail"><strong>Evidence:</strong> ${esc(a.evidence_outputs.join(', '))}</div>`);
      }

      if (a.vendor) {
        if (a.vendor.m365_service) {
          parts.push(`<div class="action-detail"><strong>Service:</strong> ${esc(a.vendor.m365_service)}</div>`);
        }
        if (a.vendor.implementation) {
          parts.push(`<div class="action-detail"><strong>Implementation:</strong> ${esc(a.vendor.implementation)}</div>`);
        }
        if (a.vendor.portal_path) {
          parts.push(`<div class="action-detail"><strong>Portal:</strong> ${esc(a.vendor.portal_path)}</div>`);
        }
        if (a.vendor.powershell?.length > 0) {
          for (const cmd of a.vendor.powershell) {
            parts.push(`<div class="cmd-block">PS&gt; ${esc(cmd)}</div>`);
          }
        }
        if (a.vendor.evidence_commands?.length > 0) {
          for (const cmd of a.vendor.evidence_commands) {
            parts.push(`<div class="cmd-block">Evidence$ ${esc(cmd)}</div>`);
          }
        }
        if (a.vendor.notes) {
          parts.push(`<div class="action-detail"><strong>Note:</strong> ${esc(a.vendor.notes)}</div>`);
        }
      }

      parts.push(`</div>`);
    }
    parts.push(`</div>`);
  }

  // Documentation links
  const vendorHelpRefs: any[] = step.vendor_help_refs || [];
  if (vendorHelpRefs.length > 0) {
    parts.push(`<div class="doc-links-section">`);
    parts.push(`<h3 style="margin-top:0; margin-bottom:8px;">Documentation Links</h3>`);
    for (const ref of vendorHelpRefs) {
      const product = ref.product || ref.vendor || '';
      const title = ref.title || '';
      const url = ref.url || '';
      parts.push(`<div class="doc-link-item">`);
      if (product) {
        parts.push(`<span class="doc-link-product">${esc(product)}:</span>`);
      }
      if (url) {
        parts.push(`<a href="${esc(url)}" class="doc-link" target="_blank" rel="noopener noreferrer">${esc(title)}</a>`);
      } else {
        parts.push(`<span>${esc(title)}</span>`);
      }
      parts.push(`</div>`);
    }
    parts.push(`</div>`);
  }

  // Structured tech ref section (replaces flat [Microsoft Tech Ref] strings)
  const tr = step.tech_ref;
  if (tr) {
    parts.push(`<div class="guidance-section" style="margin-top:16px;">`);
    parts.push(`<h3 style="margin-top:0">Microsoft Implementation Guidance</h3>`);

    // Assessment objectives
    if (tr.assessment_objectives?.length > 0) {
      parts.push(`<div class="guidance-category">Assessment Objectives</div>`);
      parts.push(`<ul class="guidance-list">`);
      for (const ao of tr.assessment_objectives) {
        parts.push(`<li><strong>${esc(ao.id)}:</strong> ${esc(ao.text)}</li>`);
      }
      parts.push(`</ul>`);
    }

    // Per-service implementation guidance with clickable links
    for (const svc of tr.implementation_by_service || []) {
      parts.push(`<div class="guidance-category">${esc(svc.service_name)}</div>`);
      for (const para of svc.paragraphs || []) {
        parts.push(`<p style="font-size:13px; color:#4b5563; margin:4px 0;">${escWithLinks(para.text_with_links || para.text)}</p>`);
      }
    }

    // GCC High customer responsibilities
    if (tr.gcch_responsibilities?.length > 0) {
      parts.push(`<div style="border-left: 3px solid #d97706; padding-left: 12px; margin: 12px 0;">`);
      parts.push(`<strong style="color:#92400e;">GCC High Customer Responsibilities</strong>`);
      for (const r of tr.gcch_responsibilities) {
        parts.push(`<p style="font-size:13px; color:#4b5563; margin:4px 0;">${escWithLinks(r.text_with_links || r.text)}</p>`);
      }
      parts.push(`</div>`);
    }

    // Evidence strength tiers + anti-patterns
    const eg = tr.evidence_guidance;
    if (eg) {
      parts.push(`<div class="guidance-category">Evidence Requirements</div>`);
      if (eg.assessor_methods?.length > 0) {
        parts.push(`<p style="font-size:13px; color:#4b5563; margin:4px 0;"><strong>Assessor methods:</strong> ${esc(eg.assessor_methods.join(', '))}</p>`);
      }
      for (const arch of eg.archetypes || []) {
        parts.push(`<div style="margin: 8px 0;">`);
        parts.push(`<strong>${esc(arch.name)}</strong> <span style="font-size:12px; color:#6b7280;">(target strength: ${esc(arch.strength)})</span>`);
        if (arch.strength_examples?.length > 0) {
          parts.push(`<ul class="guidance-list">`);
          for (const ex of arch.strength_examples) {
            parts.push(`<li><span style="font-weight:600;">[${esc(ex.strength)}]</span> ${esc(ex.description)}</li>`);
          }
          parts.push(`</ul>`);
        }
        parts.push(`</div>`);
      }
      if (eg.anti_patterns?.length > 0) {
        parts.push(`<div class="guidance-category" style="color:#b91c1c;">Anti-Patterns</div>`);
        parts.push(`<ul class="guidance-list">`);
        for (const ap of eg.anti_patterns) {
          parts.push(`<li style="color:#b91c1c;">${esc(ap)}</li>`);
        }
        parts.push(`</ul>`);
      }
    }

    parts.push(`</div>`);
  }

  // Supplemental guidance (what_to_do categorization)
  const implSteps: string[] = [];
  const cmmcGuidanceSteps: string[] = [];
  const deliverableSteps: string[] = [];
  const evidenceCollSteps: string[] = [];
  const tcpContextSteps: string[] = [];
  let currentBucket: 'impl' | 'cmmc' | 'deliverable' | 'evidence' | 'tcp' = 'impl';
  for (const s of step.what_to_do || []) {
    if (s.startsWith('[TCP Context]') || s.startsWith('[TCP Verification]')) {
      currentBucket = 'tcp';
      tcpContextSteps.push(s);
    } else if (s.startsWith('[Automated Evidence Collection]') || s.startsWith('[Evidence Collection')) {
      currentBucket = 'evidence';
      evidenceCollSteps.push(s);
    } else if (s.startsWith('[Evidence]')) {
      currentBucket = 'evidence';
      evidenceCollSteps.push(s);
    } else if (s.startsWith('[CMMC Guidance]') || s.startsWith('[Assessment Design]') || s.startsWith('[Common Pitfall]')) {
      currentBucket = 'cmmc';
      cmmcGuidanceSteps.push(s);
    } else if (s.startsWith('[Deliverable]')) {
      currentBucket = 'deliverable';
      deliverableSteps.push(s);
    } else if (s.startsWith('  ') && currentBucket === 'evidence') {
      evidenceCollSteps.push(s);
    } else if (s.startsWith('  ') && currentBucket === 'deliverable') {
      deliverableSteps.push(s);
    } else {
      currentBucket = 'impl';
      implSteps.push(s);
    }
  }

  const hasGuidance = implSteps.length > 0 || cmmcGuidanceSteps.length > 0 || deliverableSteps.length > 0 || evidenceCollSteps.length > 0 || tcpContextSteps.length > 0;
  if (hasGuidance) {
    parts.push(`<div class="guidance-section">`);
    parts.push(`<h3 style="margin-top:0">${actions.length > 0 ? 'Supplemental Guidance' : 'What To Do'}</h3>`);

    if (tcpContextSteps.length > 0) {
      const tcpCtx = tcpContextSteps.filter((s) => s.startsWith('[TCP Context]'));
      const tcpVer = tcpContextSteps.filter((s) => s.startsWith('[TCP Verification]'));

      parts.push(`<div style="border:2px solid #5eead4; border-radius:8px; overflow:hidden; margin:12px 0;">`);
      parts.push(`<div style="background:#0d9488; color:#fff; padding:8px 16px; display:flex; align-items:center; gap:8px;">`);
      parts.push(`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`);
      parts.push(`<span style="font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:0.08em;">Tenant Configuration</span>`);
      parts.push(`</div>`);
      parts.push(`<div style="background:#f0fdfa; padding:12px 16px;">`);

      if (tcpCtx.length > 0) {
        parts.push(`<div style="font-size:11px; font-weight:700; color:#0f766e; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:6px;">Apply these tenant-specific values</div>`);
        parts.push(`<table style="width:100%; border-collapse:collapse; font-size:13px;">`);
        for (const s of tcpCtx) {
          const text = s.replace('[TCP Context] ', '');
          const colonIdx = text.indexOf(':');
          if (colonIdx > 0) {
            const label = text.slice(0, colonIdx);
            const value = text.slice(colonIdx + 1).trim();
            parts.push(`<tr><td style="padding:3px 8px 3px 0; font-weight:600; color:#134e4a; white-space:nowrap; vertical-align:top;">${esc(label)}</td><td style="padding:3px 0; color:#115e59; font-family:'SF Mono','Fira Code',Consolas,monospace; font-size:12px;">${esc(value)}</td></tr>`);
          } else {
            parts.push(`<tr><td colspan="2" style="padding:3px 0; color:#134e4a;">${esc(text)}</td></tr>`);
          }
        }
        parts.push(`</table>`);
      }

      if (tcpVer.length > 0) {
        if (tcpCtx.length > 0) {
          parts.push(`<div style="border-top:1px solid #99f6e4; margin:10px 0;"></div>`);
        }
        parts.push(`<div style="font-size:11px; font-weight:700; color:#0f766e; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:6px;">Verify after implementation</div>`);
        for (const s of tcpVer) {
          parts.push(`<div style="display:flex; align-items:baseline; gap:6px; padding:2px 0; font-size:13px; color:#115e59;">
            <span style="color:#0d9488; font-weight:700; flex-shrink:0;">&#10003;</span>
            <span>${esc(s.replace('[TCP Verification] ', ''))}</span>
          </div>`);
        }
      }

      parts.push(`</div>`);
      parts.push(`</div>`);
    }

    if (implSteps.length > 0) {
      parts.push(`<div class="guidance-category">Implementation</div>`);
      parts.push(`<ul class="guidance-list">${implSteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`);
    }

    if (cmmcGuidanceSteps.length > 0) {
      parts.push(`<div class="guidance-category">CMMC Compliance Guidance</div>`);
      parts.push(`<ul class="guidance-list">`);
      for (const s of cmmcGuidanceSteps) {
        if (s.startsWith('[CMMC Guidance]')) {
          parts.push(`<li>${esc(s.replace('[CMMC Guidance] ', ''))}</li>`);
        } else if (s.startsWith('[Assessment Design]')) {
          parts.push(`<li><strong>Assessment:</strong> ${esc(s.replace('[Assessment Design] ', ''))}</li>`);
        } else if (s.startsWith('[Common Pitfall]')) {
          parts.push(`<li><strong>Pitfall:</strong> ${esc(s.replace('[Common Pitfall] ', ''))}</li>`);
        }
      }
      parts.push(`</ul>`);
    }

    if (deliverableSteps.length > 0) {
      parts.push(`<div class="guidance-category">Deliverables</div>`);
      parts.push(`<ul class="guidance-list">`);
      for (const s of deliverableSteps) {
        if (s.startsWith('[Deliverable]')) {
          parts.push(`<li><strong>${esc(s.replace('[Deliverable] ', ''))}</strong></li>`);
        } else if (s.startsWith('  Content:')) {
          parts.push(`<li style="margin-left:16px">Content: ${esc(s.replace('  Content: ', ''))}</li>`);
        } else if (s.startsWith('  Assessor:')) {
          parts.push(`<li style="margin-left:16px">Verify: ${esc(s.replace('  Assessor: ', ''))}</li>`);
        } else if (s.startsWith('  Create with:')) {
          parts.push(`<li style="margin-left:16px">Create: ${esc(s.replace('  Create with: ', ''))}</li>`);
        } else {
          parts.push(`<li style="margin-left:16px">${esc(s.trim())}</li>`);
        }
      }
      parts.push(`</ul>`);
    }

    if (evidenceCollSteps.length > 0) {
      parts.push(`<div class="guidance-category">Evidence Collection</div>`);
      parts.push(`<ul class="guidance-list">`);
      for (const s of evidenceCollSteps) {
        if (s.startsWith('[Automated Evidence Collection]')) {
          parts.push(`<li>${esc(s.replace('[Automated Evidence Collection] ', ''))}</li>`);
        } else if (s.startsWith('[Evidence Collection')) {
          parts.push(`<li><strong>No Vendor Automation:</strong> ${esc(s.replace(/^\[Evidence Collection[^\]]*\]\s*/, ''))}</li>`);
        } else if (s.startsWith('[Evidence]')) {
          parts.push(`<li>${esc(s.replace('[Evidence] ', ''))}</li>`);
        } else if (s.startsWith('  Command:')) {
          parts.push(`<li><div class="cmd-block">$ ${esc(s.replace('  Command: ', ''))}</div></li>`);
        } else if (s.startsWith('  ')) {
          parts.push(`<li style="margin-left:16px">${esc(s.trim())}</li>`);
        } else {
          parts.push(`<li>${esc(s)}</li>`);
        }
      }
      parts.push(`</ul>`);
    }

    parts.push(`</div>`);
  }

  // Verification
  if (step.how_to_verify?.length) {
    const baseVerify = step.how_to_verify.filter((v: string) => !v.startsWith('[TCP Verification]'));
    const tcpVerifyItems = step.how_to_verify.filter((v: string) => v.startsWith('[TCP Verification]'));

    parts.push(`<h3>Verification</h3>`);
    if (baseVerify.length > 0) {
      parts.push(`<ul class="verify-list">`);
      for (const v of baseVerify) {
        if (v.startsWith('[BTC Re-Verification]')) {
          parts.push(`<li style="background:#fef2f2; border-left:3px solid #ef4444; padding:4px 8px; border-radius:0 4px 4px 0; color:#991b1b;">${esc(v)}</li>`);
        } else {
          parts.push(`<li>${esc(v)}</li>`);
        }
      }
      parts.push(`</ul>`);
    }

    if (tcpVerifyItems.length > 0) {
      parts.push(`<div style="border:2px solid #5eead4; border-radius:8px; overflow:hidden; margin:10px 0;">`);
      parts.push(`<div style="background:#0d9488; color:#fff; padding:6px 14px; display:flex; align-items:center; gap:6px;">`);
      parts.push(`<span style="font-weight:700; font-size:11px; text-transform:uppercase; letter-spacing:0.08em;">TCP Verification</span>`);
      parts.push(`</div>`);
      parts.push(`<div style="background:#f0fdfa; padding:10px 14px;">`);
      for (const v of tcpVerifyItems) {
        parts.push(`<div style="display:flex; align-items:baseline; gap:6px; padding:3px 0; font-size:13px; color:#115e59;">
          <span style="color:#0d9488; font-weight:700; flex-shrink:0;">&#10003;</span>
          <span>${esc(v.replace('[TCP Verification] ', ''))}</span>
        </div>`);
      }
      parts.push(`</div>`);
      parts.push(`</div>`);
    }
  }

  // Evidence required
  if (step.expected_artifacts?.length) {
    parts.push(`<h3>Evidence Required</h3>`);
    parts.push(`<table class="evidence-table"><thead><tr><th>#</th><th>Type</th><th>Description</th><th>Collector</th><th>Retain</th></tr></thead><tbody>`);
    step.expected_artifacts.forEach((a: any, i: number) => {
      parts.push(`<tr><td>${i + 1}</td><td>${esc((a.artifact_type || 'other').replace(/_/g, ' '))}</td><td>${esc(a.description || '')}</td><td>${esc(a.collector || 'evidence_ops')}</td><td>${a.retention_days || 365} days</td></tr>`);
    });
    parts.push(`</tbody></table>`);
  }

  // Completion criteria
  if (step.manual_completion_criteria?.length) {
    parts.push(`<h3>Completion Criteria</h3>`);
    parts.push(`<ul class="checklist">${step.manual_completion_criteria.map((c: string) => `<li>${esc(c)}</li>`).join('')}</ul>`);
  }

  // Dependencies
  if (step.dependencies?.length) {
    const deps = step.dependencies.map((d: string) => esc(extractControlFromStepId(d)));
    parts.push(`<div class="deps"><strong>Depends on:</strong> ${deps.join(', ')}</div>`);
  }

  parts.push(`</div>`);
  return parts.join('\n');
}

function renderHTMLBoundarySection(boundaryContext: any): string {
  const parts: string[] = [];

  parts.push(`<h2>CUI Boundary &amp; Topology Verification</h2>`);
  parts.push(`<div class="section">`);

  if (boundaryContext.cui_boundary) {
    parts.push(`<h3 style="margin-top:0">CUI Boundary Definitions</h3>`);
    parts.push(`<table class="evidence-table"><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>`);
    for (const [key, value] of Object.entries(boundaryContext.cui_boundary)) {
      const displayValue = Array.isArray(value) ? (value as string[]).join(', ') : String(value);
      parts.push(`<tr><td style="font-family:monospace; font-size:12px;">${esc(key)}</td><td>${esc(displayValue)}</td></tr>`);
    }
    parts.push(`</tbody></table>`);
  }

  if (boundaryContext.btc_verification) {
    const btcv = boundaryContext.btc_verification;
    const gates = btcv.gate_status || {};
    const gateEntries = Object.entries(gates) as [string, any][];
    const passCount = gateEntries.filter(([, g]) => g.pass).length;
    const failCount = gateEntries.filter(([, g]) => !g.pass).length;

    parts.push(`<h3>BTC Verification Status</h3>`);
    parts.push(`<div class="stats-row" style="grid-template-columns: repeat(3, 1fr);">`);
    parts.push(`<div class="stat-card stat-met"><div class="stat-value">${passCount}</div><div class="stat-label">Gates Passed</div></div>`);
    parts.push(`<div class="stat-card stat-not-met"><div class="stat-value">${failCount}</div><div class="stat-label">Gates Failed</div></div>`);
    parts.push(`<div class="stat-card" style="background:#dbeafe; color:#1e40af;"><div class="stat-value">${btcv.evidence_count || 0}</div><div class="stat-label">Evidence Items</div></div>`);
    parts.push(`</div>`);

    if (gateEntries.length > 0) {
      parts.push(`<h3>Gate Details</h3>`);
      for (const [sectionId, gate] of gateEntries) {
        const bgColor = gate.pass ? '#d1fae5' : '#fee2e2';
        const textColor = gate.pass ? '#065f46' : '#991b1b';
        const status = gate.pass ? 'PASS' : 'FAIL';
        parts.push(`<div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; margin-bottom:6px; border-radius:6px; background:${bgColor};">`);
        parts.push(`<div><strong style="color:${textColor};">${esc(sectionId)}</strong> &mdash; ${esc(gate.domain)}<br/><span style="font-size:12px; color:#4b5563;">${esc(gate.reason)}</span></div>`);
        parts.push(`<span class="priority-badge" style="background:${textColor}; color:#fff;">${status}</span>`);
        parts.push(`</div>`);
      }
    }

    const riskFlags = btcv.risk_flags || [];
    if (riskFlags.length > 0) {
      parts.push(`<h3>Risk Flags (${riskFlags.length})</h3>`);
      for (const flag of riskFlags) {
        const severity = (flag.severity || 'medium').toUpperCase();
        const severityColor = flag.severity === 'critical' ? '#dc2626' : flag.severity === 'high' ? '#ea580c' : '#d97706';
        parts.push(`<div style="display:flex; align-items:start; gap:8px; padding:8px 12px; margin-bottom:6px; background:#fffbeb; border:1px solid #fde68a; border-radius:6px;">`);
        parts.push(`<span class="priority-badge" style="background:${severityColor}; color:#fff; flex-shrink:0;">${esc(severity)}</span>`);
        parts.push(`<div><strong>${esc(flag.flag_id)}</strong>: ${esc(flag.description)}<br/><span style="font-size:12px; color:#6b7280;">Domain: ${esc(flag.domain)}</span></div>`);
        parts.push(`</div>`);
      }
    }
  }

  parts.push(`</div>`);
  return parts.join('\n');
}

function renderHTMLAssessorNotes(notes: string[]): string {
  return `
<h2>Assessor Alignment Notes</h2>
<div class="section">
  <ol class="notes-list">
    ${notes.map((n) => `<li>${esc(n)}</li>`).join('\n    ')}
  </ol>
</div>`;
}

function renderHTMLInputReferences(inputs: any): string {
  const parts: string[] = [];
  const refs: string[] = [];

  // CUI boundary reference
  const cuiRef = inputs.cui_boundary_ref;
  if (cuiRef) {
    refs.push(`<div class="input-ref-card">
      <div class="ref-title">CUI Boundary</div>
      <div class="ref-item"><span class="ref-key">Artifact:</span> ${esc(cuiRef.artifact)}</div>
      <div class="ref-item"><span class="ref-key">Version:</span> ${esc(cuiRef.version)}</div>
      <div class="ref-item"><span class="ref-key">Generated:</span> ${esc(cuiRef.generated_on)}</div>
      ${cuiRef.cui_bank_version ? `<div class="ref-item"><span class="ref-key">CUI Bank:</span> ${esc(cuiRef.cui_bank_version)}</div>` : ''}
    </div>`);
  }

  // BTC confirmation reference
  const btcRef = inputs.btc_confirmation_ref;
  if (btcRef) {
    const gs = btcRef.gate_summary;
    refs.push(`<div class="input-ref-card">
      <div class="ref-title">BTC Confirmation</div>
      <div class="ref-item"><span class="ref-key">Artifact:</span> ${esc(btcRef.artifact)}</div>
      <div class="ref-item"><span class="ref-key">Version:</span> ${esc(btcRef.version)}</div>
      <div class="ref-item"><span class="ref-key">Generated:</span> ${esc(btcRef.generated_on)}</div>
      ${gs ? `<div class="ref-item"><span class="ref-key">Gates:</span> ${gs.pass} pass, ${gs.fail} fail (${gs.total} total)</div>` : ''}
    </div>`);
  }

  // TCP reference
  const tcpRef = inputs.tcp_ref;
  if (tcpRef) {
    refs.push(`<div class="input-ref-card">
      <div class="ref-title">Tenant Config Profile</div>
      <div class="ref-item"><span class="ref-key">Artifact:</span> ${esc(tcpRef.artifact)}</div>
      <div class="ref-item"><span class="ref-key">Version:</span> ${esc(tcpRef.version)}</div>
      <div class="ref-item"><span class="ref-key">Generated:</span> ${esc(tcpRef.generated_on)}</div>
      ${tcpRef.tcp_bank_version ? `<div class="ref-item"><span class="ref-key">TCP Bank:</span> ${esc(tcpRef.tcp_bank_version)}</div>` : ''}
    </div>`);
  }

  // Constraints
  const constraints = inputs.readiness_posture?.constraints;
  if (constraints) {
    refs.push(`<div class="input-ref-card">
      <div class="ref-title">Constraints</div>
      <div class="ref-item"><span class="ref-key">Time:</span> ${esc(String(constraints.time))}</div>
      <div class="ref-item"><span class="ref-key">Budget:</span> ${esc(String(constraints.budget))}</div>
      <div class="ref-item"><span class="ref-key">Tooling:</span> ${esc(String(constraints.tooling))}</div>
      <div class="ref-item"><span class="ref-key">Staffing:</span> ${esc(String(constraints.staffing))}</div>
    </div>`);
  }

  // Authoritative sources
  const authSources = inputs.authoritative_sources;
  if (authSources) {
    const allSources = [
      ...(authSources.government || []),
      ...(authSources.nist || []),
    ];
    if (allSources.length > 0) {
      refs.push(`<div class="input-ref-card">
        <div class="ref-title">Authoritative Sources</div>
        ${allSources.map((s: any) => `<div class="ref-item"><span class="ref-key">${esc(s.id)}:</span> ${esc(s.title)}${s.version ? ` (${esc(s.version)})` : ''}</div>`).join('\n')}
      </div>`);
    }
  }

  // Assessor knowledge references
  const assessorKnowledge = inputs.assessor_knowledge;
  if (assessorKnowledge) {
    refs.push(`<div class="input-ref-card">
      <div class="ref-title">Assessor Knowledge</div>
      <div class="ref-item"><span class="ref-key">Approach:</span> ${esc(assessorKnowledge.assessor_approach_ref)}</div>
      <div class="ref-item"><span class="ref-key">Evidence Matrix:</span> ${esc(assessorKnowledge.assessor_evidence_matrix_ref)}</div>
      ${assessorKnowledge.design_for_assessment_rules?.length ? `<div class="ref-item"><span class="ref-key">DFA Rules:</span> ${assessorKnowledge.design_for_assessment_rules.length} rules loaded</div>` : ''}
    </div>`);
  }

  if (refs.length === 0) return '';

  parts.push(`<h2>Input References</h2>`);
  parts.push(`<div class="section">`);
  parts.push(`<div class="input-refs">`);
  parts.push(refs.join('\n'));
  parts.push(`</div>`);

  // Key findings
  const keyFindings = inputs.readiness_posture?.key_findings;
  if (keyFindings?.length > 0) {
    const critFindings = keyFindings.filter((f: any) => f.status === 'NOT_MET' || f.severity === 'high' || f.severity === 'critical');
    if (critFindings.length > 0) {
      parts.push(`<h3 style="margin-top:16px">Key Findings (${keyFindings.length} total, ${critFindings.length} critical/not-met)</h3>`);
      parts.push(`<table class="evidence-table"><thead><tr><th>Control</th><th>Finding</th><th>Status</th><th>Severity</th></tr></thead><tbody>`);
      for (const f of critFindings.slice(0, 20)) {
        const statusColor = f.status === 'NOT_MET' ? '#991b1b' : f.status === 'PARTIAL' ? '#92400e' : '#6b7280';
        parts.push(`<tr><td>${esc(f.control_id)}</td><td>${esc(f.title)}</td><td style="color:${statusColor}; font-weight:600;">${esc(f.status)}</td><td>${esc(f.severity)}</td></tr>`);
      }
      if (critFindings.length > 20) {
        parts.push(`<tr><td colspan="4" style="text-align:center; color:#6b7280; font-style:italic;">…and ${critFindings.length - 20} more</td></tr>`);
      }
      parts.push(`</tbody></table>`);
    }
  }

  parts.push(`</div>`);
  return parts.join('\n');
}

function renderHTMLCostProposal(costSow: any): string {
  const parts: string[] = [];
  const lineItems = costSow.line_items || [];
  const sow = costSow.sow || {};
  const assumptions = costSow.assumptions || [];

  parts.push(`<h2>Cost Proposal &amp; Statement of Work</h2>`);
  parts.push(`<div class="section">`);

  // Line items table
  if (lineItems.length > 0) {
    const totalHours = lineItems.reduce((s: number, li: any) => s + (li.qty || 0), 0);
    const totalCost = lineItems.reduce((s: number, li: any) => s + (li.extended_price || 0), 0);

    parts.push(`<h3 style="margin-top:0">Cost Summary</h3>`);
    parts.push(`<table class="cost-table"><thead><tr><th>Phase</th><th style="text-align:right">Hours</th><th style="text-align:right">Rate</th><th style="text-align:right">Cost</th></tr></thead><tbody>`);
    for (const li of lineItems) {
      parts.push(`<tr><td>${esc(li.name)}</td><td style="text-align:right">${li.qty || 0}</td><td style="text-align:right">$${(li.unit_price || 0).toLocaleString()}</td><td style="text-align:right">$${(li.extended_price || 0).toLocaleString()}</td></tr>`);
    }
    parts.push(`<tr class="total-row"><td>Total</td><td style="text-align:right">${totalHours}</td><td></td><td style="text-align:right">$${totalCost.toLocaleString()}</td></tr>`);
    parts.push(`</tbody></table>`);
  }

  // SOW details
  parts.push(`<div class="sow-section">`);

  if (sow.statement_of_work) {
    parts.push(`<h4>Statement of Work</h4>`);
    parts.push(`<p style="font-size:13px; color:#4b5563;">${esc(sow.statement_of_work)}</p>`);
  }

  if (sow.deliverables?.length > 0) {
    parts.push(`<h4>Deliverables</h4>`);
    parts.push(`<ul>${sow.deliverables.map((d: string) => `<li>${esc(d)}</li>`).join('')}</ul>`);
  }

  if (sow.acceptance_criteria?.length > 0) {
    parts.push(`<h4>Acceptance Criteria</h4>`);
    parts.push(`<ul>${sow.acceptance_criteria.map((c: string) => `<li>${esc(c)}</li>`).join('')}</ul>`);
  }

  if (sow.out_of_scope?.length > 0) {
    parts.push(`<h4>Out of Scope</h4>`);
    parts.push(`<ul>${sow.out_of_scope.map((o: string) => `<li>${esc(o)}</li>`).join('')}</ul>`);
  }

  if (sow.customer_dependencies?.length > 0) {
    parts.push(`<h4>Customer Dependencies</h4>`);
    parts.push(`<ul>${sow.customer_dependencies.map((c: string) => `<li>${esc(c)}</li>`).join('')}</ul>`);
  }

  if (assumptions.length > 0) {
    parts.push(`<h4>Assumptions</h4>`);
    parts.push(`<ul>${assumptions.map((a: string) => `<li>${esc(a)}</li>`).join('')}</ul>`);
  }

  parts.push(`</div>`);
  parts.push(`</div>`);
  return parts.join('\n');
}

function renderHTMLFooter(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `
<div class="footer">
  <p>Generated by CES Mission Planning Tool on ${esc(date)}</p>
  <p>END OF MISSION PLAN</p>
</div>`;
}

// ---------------------------------------------------------------------------
// Tenant Manifest HTML Export — self-contained styled document
// ---------------------------------------------------------------------------

/**
 * Convert a tenant manifest JSON artifact into a self-contained HTML document.
 */
export function formatManifestAsHTML(manifest: any): string {
  const ces = manifest?.ces || {};
  const tm = manifest?.tenant_manifest || {};

  const controls = tm.normative_controls || [];
  const assets = tm.assets || [];
  const intents = tm.config_intents || [];
  const monitors = tm.evidence_monitors || [];
  const driftPolicies = tm.drift_policies || [];
  const boundaryZones = tm.boundary_zones;
  const tenantIdentity = tm.tenant_identity;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tenant Manifest — ${esc(ces.intent || 'CMMC Compliance')}</title>
<style>
${renderManifestHTMLStyles()}
</style>
</head>
<body>
<div class="container">
${renderManifestHeader(ces, tm, controls, assets, intents, monitors, driftPolicies)}
${tenantIdentity ? renderManifestTenantIdentity(tenantIdentity) : ''}
${controls.length > 0 ? renderManifestNormativeControls(controls) : ''}
${assets.length > 0 ? renderManifestAssets(assets) : ''}
${intents.length > 0 ? renderManifestConfigIntents(intents) : ''}
${monitors.length > 0 ? renderManifestEvidenceMonitors(monitors) : ''}
${driftPolicies.length > 0 ? renderManifestDriftPolicies(driftPolicies) : ''}
${boundaryZones ? renderManifestBoundaryZones(boundaryZones) : ''}
${renderManifestFooter()}
</div>
</body>
</html>`;
}

function renderManifestHTMLStyles(): string {
  return `
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0; padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px; line-height: 1.6; color: #1f2937; background: #f9fafb;
}
.container { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
h1 { font-size: 24px; margin: 0 0 4px; color: #111827; }
h2 { font-size: 18px; margin: 32px 0 16px; color: #111827; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
h3 { font-size: 15px; margin: 24px 0 12px; color: #374151; }
h4 { font-size: 13px; margin: 16px 0 8px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
.subtitle { font-size: 14px; color: #6b7280; margin: 0 0 24px; }
.section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px 24px; margin-bottom: 24px; }
.meta-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
.meta-item { font-size: 13px; }
.meta-label { color: #6b7280; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; }
.meta-value { color: #111827; margin-top: 2px; }
.stats-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 16px; }
.stat-card { padding: 16px; border-radius: 8px; text-align: center; }
.stat-card .stat-value { font-size: 28px; font-weight: 700; }
.stat-card .stat-label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
.badge { display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
.badge-blue { background: #dbeafe; color: #1e40af; }
.badge-green { background: #d1fae5; color: #065f46; }
.badge-purple { background: #e9d5ff; color: #6b21a8; }
.badge-amber { background: #fef3c7; color: #92400e; }
.badge-red { background: #fee2e2; color: #991b1b; }
.badge-gray { background: #f3f4f6; color: #374151; }
.badge-orange { background: #fff7ed; color: #9a3412; }
.control-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 20px; margin-bottom: 12px; background: #fff; }
.control-header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.control-id { font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; font-size: 12px; background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
.control-state { font-size: 14px; color: #111827; }
.verify-step { padding: 8px 12px; border-left: 3px solid #93c5fd; margin-bottom: 6px; background: #f9fafb; border-radius: 0 4px 4px 0; }
.verify-desc { font-size: 13px; color: #1f2937; }
.verify-meta { font-size: 12px; color: #6b7280; margin-top: 2px; }
.verify-fail { font-size: 12px; color: #dc2626; margin-top: 2px; }
.evidence-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
.evidence-table th { text-align: left; padding: 6px 10px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #374151; }
.evidence-table td { padding: 6px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
.asset-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; margin-bottom: 4px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; }
.asset-info { display: flex; align-items: center; gap: 8px; }
.asset-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.tag { display: inline-block; font-size: 11px; background: #f3f4f6; color: #6b7280; padding: 1px 6px; border-radius: 4px; }
.intent-card { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 10px; overflow: hidden; }
.intent-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: #f9fafb; }
.intent-body { padding: 12px 16px; }
.config-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; background: #f9fafb; border-radius: 6px; padding: 10px 14px; }
.config-key { font-size: 12px; color: #6b7280; }
.config-val { font-size: 13px; color: #111827; }
.monitor-card { padding: 12px 16px; margin-bottom: 8px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; }
.drift-card { padding: 16px 20px; margin-bottom: 12px; border-radius: 8px; }
.drift-critical { background: #fef2f2; border: 1px solid #fecaca; }
.drift-high { background: #fff7ed; border: 1px solid #fed7aa; }
.drift-medium { background: #f9fafb; border: 1px solid #e5e7eb; }
.playbook-list { counter-reset: step; padding-left: 0; list-style: none; margin: 8px 0 0; }
.playbook-list li { counter-increment: step; font-size: 13px; color: #4b5563; margin-bottom: 4px; padding-left: 24px; position: relative; }
.playbook-list li::before { content: counter(step) '.'; position: absolute; left: 0; font-weight: 700; color: #6b7280; }
.footer { text-align: center; font-size: 12px; color: #9ca3af; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; }

@media print {
  body { background: #fff; font-size: 10pt; }
  .container { max-width: 100%; padding: 0; }
  .section { border: 1px solid #ccc; box-shadow: none; break-inside: avoid; }
  .control-card { break-inside: avoid; }
  .drift-card { break-inside: avoid; }
  h2 { break-after: avoid; }
}
`;
}

function renderManifestHeader(
  ces: any,
  tm: any,
  controls: any[],
  assets: any[],
  intents: any[],
  monitors: any[],
  driftPolicies: any[],
): string {
  return `
<h1>Tenant Manifest</h1>
<p class="subtitle">${esc(ces.intent || '')} &middot; Generated ${esc(ces.generated_on || 'N/A')}</p>
<div class="section">
  <div class="meta-grid">
    <div class="meta-item"><div class="meta-label">Manifest ID</div><div class="meta-value" style="font-family:monospace; font-size:12px;">${esc(tm.manifest_id || 'N/A')}</div></div>
    <div class="meta-item"><div class="meta-label">Generated</div><div class="meta-value">${esc(ces.generated_on || 'N/A')}</div></div>
    <div class="meta-item"><div class="meta-label">Tech Stack</div><div class="meta-value">${esc(String(tm.tech_stack_id ?? 'N/A'))}</div></div>
    <div class="meta-item"><div class="meta-label">Version</div><div class="meta-value">${esc(ces.version || 'N/A')}</div></div>
  </div>
  <div class="stats-row">
    <div class="stat-card" style="background:#dbeafe; color:#1e40af;"><div class="stat-value">${controls.length}</div><div class="stat-label">Controls</div></div>
    <div class="stat-card" style="background:#d1fae5; color:#065f46;"><div class="stat-value">${assets.length}</div><div class="stat-label">Assets</div></div>
    <div class="stat-card" style="background:#e9d5ff; color:#6b21a8;"><div class="stat-value">${intents.length}</div><div class="stat-label">Config Intents</div></div>
    <div class="stat-card" style="background:#fef3c7; color:#92400e;"><div class="stat-value">${monitors.length}</div><div class="stat-label">Monitors</div></div>
    <div class="stat-card" style="background:#fee2e2; color:#991b1b;"><div class="stat-value">${driftPolicies.length}</div><div class="stat-label">Drift Policies</div></div>
  </div>
</div>`;
}

function renderManifestTenantIdentity(identity: any): string {
  const parts: string[] = [];
  parts.push(`<h2>Tenant Identity</h2>`);
  parts.push(`<div class="section">`);
  parts.push(`<div class="meta-grid">`);
  parts.push(`<div class="meta-item"><div class="meta-label">Tenant ID</div><div class="meta-value" style="font-family:monospace; font-size:12px;">${esc(identity.tenant_id)}</div></div>`);
  parts.push(`<div class="meta-item"><div class="meta-label">Primary Domain</div><div class="meta-value">${esc(identity.primary_domain)}</div></div>`);
  parts.push(`<div class="meta-item"><div class="meta-label">Display Name</div><div class="meta-value">${esc(identity.display_name)}</div></div>`);
  parts.push(`<div class="meta-item"><div class="meta-label">Cloud Environment</div><div class="meta-value">${esc(fmtEnum(identity.cloud_environment))}</div></div>`);
  parts.push(`<div class="meta-item"><div class="meta-label">Primary SKU</div><div class="meta-value">${esc(identity.primary_sku)}</div></div>`);
  parts.push(`<div class="meta-item"><div class="meta-label">License Count</div><div class="meta-value">${esc(String(identity.license_count))}</div></div>`);
  parts.push(`</div>`);

  if (identity.custom_domains?.length > 0) {
    parts.push(`<h4>Custom Domains</h4>`);
    parts.push(`<div style="display:flex; flex-wrap:wrap; gap:4px;">`);
    for (const d of identity.custom_domains) {
      parts.push(`<span class="tag">${esc(d)}</span>`);
    }
    parts.push(`</div>`);
  }

  if (identity.addon_skus?.length > 0) {
    parts.push(`<h4>Add-on SKUs</h4>`);
    parts.push(`<div style="display:flex; flex-wrap:wrap; gap:4px;">`);
    for (const s of identity.addon_skus) {
      parts.push(`<span class="tag">${esc(s)}</span>`);
    }
    parts.push(`</div>`);
  }

  if (identity.service_activations) {
    parts.push(`<h4>Service Activations</h4>`);
    parts.push(`<div style="display:flex; flex-wrap:wrap; gap:4px;">`);
    for (const [svc, active] of Object.entries(identity.service_activations)) {
      const cls = active ? 'badge-green' : 'badge-red';
      parts.push(`<span class="badge ${cls}">${esc(svc)}: ${active ? 'Active' : 'Inactive'}</span>`);
    }
    parts.push(`</div>`);
  }

  parts.push(`</div>`);
  return parts.join('\n');
}

function renderManifestNormativeControls(controls: any[]): string {
  const parts: string[] = [];
  parts.push(`<h2>Normative Controls (${controls.length})</h2>`);

  for (const ctrl of controls) {
    const verifications = ctrl.verification || [];
    const artifacts = ctrl.evidence_artifacts || [];

    parts.push(`<div class="control-card">`);
    parts.push(`<div class="control-header">`);
    parts.push(`<span class="control-id">${esc(ctrl.control_id)}</span>`);
    parts.push(`<span class="control-state">${esc(ctrl.required_state)}</span>`);
    parts.push(`</div>`);

    if (verifications.length > 0) {
      parts.push(`<h4>Verification Steps (${verifications.length})</h4>`);
      for (const v of verifications) {
        parts.push(`<div class="verify-step">`);
        parts.push(`<div class="verify-desc">${esc(v.description)}</div>`);
        parts.push(`<div class="verify-meta">Method: <span class="badge badge-gray">${esc(fmtEnum(v.method))}</span> &middot; Expected: ${esc(v.expected)}</div>`);
        parts.push(`<div class="verify-fail">On fail: ${esc(v.on_fail)}</div>`);
        parts.push(`</div>`);
      }
    }

    if (artifacts.length > 0) {
      parts.push(`<h4>Evidence Artifacts</h4>`);
      parts.push(`<table class="evidence-table"><thead><tr><th>Type</th><th>Description</th><th>Collector</th><th>Retention</th></tr></thead><tbody>`);
      for (const ea of artifacts) {
        parts.push(`<tr><td><span class="badge badge-blue">${esc(fmtEnum(ea.artifact_type))}</span></td><td>${esc(ea.description)}</td><td>${esc(ea.collector)}</td><td>${ea.retention_days || 365}d</td></tr>`);
      }
      parts.push(`</tbody></table>`);
    }

    parts.push(`</div>`);
  }

  return parts.join('\n');
}

function renderManifestAssets(assets: any[]): string {
  const parts: string[] = [];
  parts.push(`<h2>Asset Registry (${assets.length})</h2>`);
  parts.push(`<div class="section">`);

  // Group by scope_category
  const grouped = new Map<string, any[]>();
  for (const a of assets) {
    const cat = a.scope_category || 'other';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(a);
  }

  for (const [category, items] of grouped) {
    parts.push(`<h4>${esc(fmtEnum(category))} (${items.length})</h4>`);
    for (const asset of items) {
      const tags = (asset.tags || []).map((t: string) => `<span class="tag">${esc(t)}</span>`).join('');
      parts.push(`<div class="asset-row">`);
      parts.push(`<div class="asset-info"><span class="badge badge-gray">${esc(fmtEnum(asset.asset_type))}</span> <span style="font-size:13px;">${esc(asset.owner || asset.asset_id)}</span></div>`);
      parts.push(`<div class="asset-tags">${tags}</div>`);
      parts.push(`</div>`);
    }
  }

  parts.push(`</div>`);
  return parts.join('\n');
}

function renderManifestConfigIntents(intents: any[]): string {
  const parts: string[] = [];
  parts.push(`<h2>Config Intents (${intents.length})</h2>`);

  for (const intent of intents) {
    const controlBadges = (intent.control_ids || [])
      .map((cid: string) => `<span class="control-id">${esc(cid)}</span>`)
      .join(' ');

    parts.push(`<div class="intent-card">`);
    parts.push(`<div class="intent-header">`);
    parts.push(`<div style="display:flex; align-items:center; gap:8px;">${controlBadges} <span style="font-size:14px; font-weight:600;">${esc(intent.title)}</span></div>`);
    parts.push(`<div style="display:flex; gap:6px;"><span class="badge badge-purple">${esc(fmtEnum(intent.source_of_truth))}</span> <span class="badge badge-gray">${esc(fmtEnum(intent.query_method))}</span></div>`);
    parts.push(`</div>`);

    if (intent.desired_config) {
      parts.push(`<div class="intent-body">`);
      parts.push(`<div class="config-grid">`);
      for (const [k, v] of Object.entries(intent.desired_config)) {
        parts.push(`<div><div class="config-key">${esc(fmtFieldName(k))}</div><div class="config-val">${esc(fmtConfigVal(v))}</div></div>`);
      }
      parts.push(`</div>`);
      parts.push(`</div>`);
    }

    parts.push(`</div>`);
  }

  return parts.join('\n');
}

function renderManifestEvidenceMonitors(monitors: any[]): string {
  const parts: string[] = [];
  parts.push(`<h2>Evidence Monitors (${monitors.length})</h2>`);
  parts.push(`<div class="section">`);

  // Group by cadence
  const cadenceOrder = ['daily', 'weekly', 'monthly'];
  const grouped = new Map<string, any[]>();
  for (const m of monitors) {
    const c = m.cadence || 'other';
    if (!grouped.has(c)) grouped.set(c, []);
    grouped.get(c)!.push(m);
  }

  const sortedGroups = Array.from(grouped.entries()).sort(
    (a, b) => {
      const ai = cadenceOrder.indexOf(a[0]);
      const bi = cadenceOrder.indexOf(b[0]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    },
  );

  const cadenceBadgeClass: Record<string, string> = {
    daily: 'badge-red',
    weekly: 'badge-orange',
    monthly: 'badge-blue',
  };

  for (const [cadence, items] of sortedGroups) {
    parts.push(`<h3><span class="badge ${cadenceBadgeClass[cadence] || 'badge-gray'}">${esc(cadence.toUpperCase())}</span> &mdash; ${items.length} monitor${items.length !== 1 ? 's' : ''}</h3>`);

    for (const m of items) {
      const controlBadges = (m.control_ids || [])
        .map((cid: string) => `<span class="control-id">${esc(cid)}</span>`)
        .join(' ');

      parts.push(`<div class="monitor-card">`);
      parts.push(`<div style="display:flex; align-items:start; justify-content:space-between; gap:8px;">`);
      parts.push(`<div><div style="font-size:14px; color:#111827; margin-bottom:4px;">${esc(m.signal)}</div><div style="display:flex; flex-wrap:wrap; gap:4px;">${controlBadges}</div></div>`);
      parts.push(`<span class="badge badge-gray">${esc(fmtEnum(m.collection_method))}</span>`);
      parts.push(`</div>`);
      parts.push(`<div style="margin-top:8px; font-size:12px; color:#6b7280;">Retention: ${m.retention_days || 365}d</div>`);
      parts.push(`<div style="margin-top:4px; font-size:12px; color:#dc2626;">On drift: ${esc(m.on_drift)}</div>`);
      if (m.sentinel_workspace) {
        parts.push(`<div style="margin-top:4px; font-size:12px; color:#6b7280;">Sentinel: ${esc(m.sentinel_workspace)} (${esc(m.sentinel_resource_group || '')})</div>`);
      }
      parts.push(`</div>`);
    }
  }

  parts.push(`</div>`);
  return parts.join('\n');
}

function renderManifestDriftPolicies(policies: any[]): string {
  const parts: string[] = [];
  parts.push(`<h2>Drift Policies (${policies.length})</h2>`);

  const severityClass: Record<string, string> = {
    critical: 'drift-critical',
    high: 'drift-high',
    medium: 'drift-medium',
  };

  const severityBadge: Record<string, string> = {
    critical: 'badge-red',
    high: 'badge-orange',
    medium: 'badge-gray',
  };

  for (const dp of policies) {
    const sev = dp.severity || 'medium';
    parts.push(`<div class="drift-card ${severityClass[sev] || 'drift-medium'}">`);
    parts.push(`<span class="badge ${severityBadge[sev] || 'badge-gray'}">${esc(sev.toUpperCase())}</span>`);
    parts.push(`<div style="font-size:14px; color:#111827; margin-top:8px;">${esc(dp.scope)}</div>`);

    if (dp.detection?.length > 0) {
      parts.push(`<h4>Detection</h4>`);
      parts.push(`<ul style="margin:0; padding-left:20px; font-size:13px; color:#4b5563;">`);
      for (const d of dp.detection) {
        parts.push(`<li>${esc(d)}</li>`);
      }
      parts.push(`</ul>`);
    }

    if (dp.response_playbook?.length > 0) {
      parts.push(`<h4>Response Playbook</h4>`);
      parts.push(`<ol class="playbook-list">`);
      for (const r of dp.response_playbook) {
        parts.push(`<li>${esc(r)}</li>`);
      }
      parts.push(`</ol>`);
    }

    parts.push(`</div>`);
  }

  return parts.join('\n');
}

function renderManifestBoundaryZones(zones: any): string {
  const parts: string[] = [];
  const definitions = zones.definitions || [];

  parts.push(`<h2>Boundary Zones</h2>`);
  parts.push(`<div class="section">`);

  if (zones.cui_boundary_version) {
    parts.push(`<p style="font-size:13px; color:#6b7280; margin-bottom:12px;">CUI Boundary version: ${esc(zones.cui_boundary_version)}</p>`);
  }

  if (definitions.length > 0) {
    parts.push(`<table class="evidence-table"><thead><tr><th>Key</th><th>Value</th><th>Type</th></tr></thead><tbody>`);
    for (const def of definitions) {
      const val = Array.isArray(def.value) ? def.value.join(', ') : String(def.value);
      parts.push(`<tr><td style="font-family:monospace; font-size:12px;">${esc(def.key)}</td><td>${esc(val)}</td><td style="font-size:12px; color:#6b7280;">${esc(def.type)}</td></tr>`);
    }
    parts.push(`</tbody></table>`);
  }

  parts.push(`</div>`);
  return parts.join('\n');
}

function renderManifestFooter(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `
<div class="footer">
  <p>Generated by CES Mission Planning Tool on ${esc(date)}</p>
  <p>END OF TENANT MANIFEST</p>
</div>`;
}

// Manifest-local helpers (avoid name collisions with existing functions)
function fmtEnum(val: string | undefined): string {
  if (!val) return 'N/A';
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtFieldName(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function fmtConfigVal(val: unknown): string {
  if (val === null || val === undefined) return 'N/A';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (Array.isArray(val)) {
    if (val.length === 0) return 'None';
    if (typeof val[0] === 'object') return JSON.stringify(val, null, 2);
    return val.join(', ');
  }
  if (typeof val === 'object') return JSON.stringify(val, null, 2);
  return String(val);
}
