// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { SIBaseline, TenantConfigProfileOutput } from '@/shared/types/artifacts';
import type { TaskCatalog, PlanMode, Task } from '../types';
import type { PlaybookEntry } from '@/shared/types/domain';
import { generateId } from '@/shared/utils/idGenerator';
import { useLoeRateStore } from '@/shared/stores/loeRateStore';
import { stepsForMilestone } from './milestoneCompiler';

// ---------------------------------------------------------------------------
// Inline cost_proposal_sow (embedded in Manual + Exec Plan outputs)
// ---------------------------------------------------------------------------
export function buildInlineCostProposal(
  taskCatalog: TaskCatalog,
  milestones: any[],
  steps: any[],
  siBaseline: SIBaseline,
  planMode: PlanMode,
): Record<string, unknown> {
  const rate = useLoeRateStore.getState().rates.laborRatePerHour;
  const lineItems: any[] = [];

  for (const ms of milestones) {
    const msSteps = stepsForMilestone(ms, steps, taskCatalog);
    const controls = [
      ...new Set(msSteps.flatMap((s: any) => (s.control_coverage || []).map((c: any) => c.control_id))),
    ];
    const hours = msSteps.reduce((sum: number, s: any) => sum + (s.estimated_effort_hours || 0), 0);
    lineItems.push({
      id: `line_${ms.id}`,
      name: ms.name,
      type: 'labor',
      qty: hours || 40,
      unit: 'hours',
      unit_price: rate,
      extended_price: (hours || 40) * rate,
      mapping: {
        milestones: [ms.id],
        steps: msSteps.map((s: any) => s.id),
        controls,
      },
    });
  }

  if (lineItems.length === 0) {
    lineItems.push({
      id: 'line_default',
      name: 'Compliance Implementation',
      type: 'labor',
      qty: 40,
      unit: 'hours',
      unit_price: rate,
      extended_price: 40 * rate,
      mapping: { milestones: [], steps: [], controls: [] },
    });
  }

  const level = siBaseline.si_baseline?.target?.target_cmmc_level || 'L2';

  return {
    proposal_id: generateId('prop'),
    assumptions: [
      'Client provides necessary access to all in-scope systems',
      'Existing infrastructure documentation is current and accurate',
      'Key stakeholders are available for interviews and validation',
      `Target CMMC level is ${level}`,
    ],
    line_items: lineItems,
    sow: {
      statement_of_work: `Implement and validate CMMC ${level} compliance controls via ${planMode} approach, including gap remediation, evidence collection, and assessment preparation.`,
      deliverables: [
        'Implemented security controls per CMMC requirements',
        'Complete compliance documentation package',
        'Evidence artifacts organized by control requirement',
        'Assessment readiness verification report',
      ],
      acceptance_criteria: [
        'All identified control gaps remediated',
        'Evidence artifacts verified against assessor requirements',
        'Cross-artifact validation passed',
        'Readiness gate criteria met',
      ],
      out_of_scope: [
        'Hardware procurement and physical installation',
        'Third-party software licensing costs',
        'Ongoing managed security services post-assessment',
      ],
      customer_dependencies: [
        'Provide administrative access to in-scope systems',
        'Designate compliance team points of contact',
        'Make subject matter experts available for interviews',
        'Approve configuration changes in a timely manner',
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Inline tenant_manifest (embedded in Manual + Exec Plan outputs)
// ---------------------------------------------------------------------------
export function buildInlineTenantManifest(
  taskCatalog: TaskCatalog,
  _assessorKB: any,
  siBaseline: SIBaseline,
  vendorCaps?: any,
  tenantConfig?: TenantConfigProfileOutput | null,
): Record<string, unknown> {
  const siData = siBaseline.si_baseline as Record<string, any>;
  const techStackId: number = siData?.technology_stack?.tech_stack_id || 1;
  const tasks = taskCatalog.tasks;

  // Build playbook lookup for enrichment
  const playbookEntries: PlaybookEntry[] = vendorCaps?.playbook?.playbook || [];
  const playbookByAction = new Map<string, PlaybookEntry>();
  for (const entry of playbookEntries) {
    playbookByAction.set(entry.action_id, entry);
  }

  const normativeControls =
    tasks.length > 0
      ? tasks.map((t) => ({
          control_id: t.requirement_id,
          required_state: `${t.title} — implemented and verified`,
          verification: t.how_to_verify.map((step, i) => ({
            id: generateId(`chk_${i}`),
            description: step,
            method: 'config_export' as const,
            expected: `Verification passes for ${t.requirement_id}`,
            on_fail: `Remediate ${t.requirement_id} and re-verify`,
          })),
          evidence_artifacts: t.expected_artifacts,
        }))
      : [
          {
            control_id: 'general',
            required_state: 'All CMMC controls implemented',
            verification: [
              {
                id: generateId('chk'),
                description: 'Verify compliance',
                method: 'manual',
                expected: 'All controls met',
                on_fail: 'Remediate gaps',
              },
            ],
            evidence_artifacts: [],
          },
        ];

  const configIntents =
    tasks.length > 0
      ? tasks.map((t) => {
          const taskPlaybookData = getPlaybookDataForTask(t, playbookByAction);
          const hasPortal = taskPlaybookData.portalPaths.length > 0;
          const hasPs = taskPlaybookData.psCommands.length > 0;

          return {
            id: generateId('ci'),
            title: t.title,
            control_ids: [t.requirement_id],
            desired_config: taskPlaybookData.implementations.length > 0
              ? {
                  requirement: t.requirement_id,
                  state: 'compliant',
                  m365_config: taskPlaybookData.implementations,
                  portal_paths: taskPlaybookData.portalPaths,
                }
              : { requirement: t.requirement_id, state: 'compliant' },
            source_of_truth: hasPortal
              ? ('platform_setting' as const)
              : hasPs
                ? ('iac' as const)
                : t.impl_engine === 'terraform' || t.impl_engine === 'bicep' || t.impl_engine === 'cloudformation'
                  ? ('iac' as const)
                  : ('platform_setting' as const),
            query_method: hasPs
              ? ('api' as const)
              : t.impl_engine === 'api'
                ? ('api' as const)
                : ('export' as const),
          };
        })
      : [
          {
            id: generateId('ci'),
            title: 'General compliance',
            control_ids: ['general'],
            desired_config: { state: 'compliant' },
            source_of_truth: 'platform_setting' as const,
            query_method: 'manual' as const,
          },
        ];

  const evidenceMonitors =
    tasks.length > 0
      ? tasks.map((t) => {
          const taskPlaybookData = getPlaybookDataForTask(t, playbookByAction);
          const hasEvidenceCommands = taskPlaybookData.evidenceCommands.length > 0;

          return {
            id: generateId('em'),
            control_ids: [t.requirement_id],
            signal: hasEvidenceCommands
              ? taskPlaybookData.evidenceCommands.join('; ')
              : `Compliance state for ${t.requirement_id}`,
            collection_method: hasEvidenceCommands
              ? ('api_poll' as const)
              : ('manual' as const),
            cadence: t.priority === 'p0' ? 'daily' : 'weekly',
            retention_days: 365,
            on_drift: `Alert compliance team and remediate ${t.requirement_id}`,
          };
        })
      : [
          {
            id: generateId('em'),
            control_ids: ['general'],
            signal: 'General compliance monitoring',
            collection_method: 'manual' as const,
            cadence: 'weekly',
            retention_days: 365,
            on_drift: 'Alert compliance team',
          },
        ];

  const driftPolicies = buildDriftPolicies(tasks);

  const assets: any[] = [];
  if (tenantConfig?.tenant_config) {
    const tc = tenantConfig.tenant_config;
    for (const upn of tc.identity_architecture.break_glass_accounts) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'break_glass_account',
        scope_category: 'privileged_access',
        tags: ['tcp', 'break-glass', 'emergency-access'],
        owner: upn,
      });
    }
    for (const upn of tc.privileged_access.global_admins) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'admin_account',
        scope_category: 'privileged_access',
        tags: ['tcp', 'global-admin'],
        owner: upn,
      });
    }
    for (const upn of tc.privileged_access.security_admins) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'admin_account',
        scope_category: 'privileged_access',
        tags: ['tcp', 'security-admin'],
        owner: upn,
      });
    }
    for (const upn of tc.privileged_access.compliance_admins) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'admin_account',
        scope_category: 'privileged_access',
        tags: ['tcp', 'compliance-admin'],
        owner: upn,
      });
    }
    for (const site of tc.data_protection.cui_sharepoint_sites) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'data_boundary',
        scope_category: 'CUI',
        tags: ['tcp', 'cui-sharepoint'],
        owner: site,
      });
    }
    for (const channel of tc.data_protection.cui_teams_channels) {
      assets.push({
        asset_id: generateId('asset'),
        asset_type: 'data_boundary',
        scope_category: 'CUI',
        tags: ['tcp', 'cui-teams'],
        owner: channel,
      });
    }
  }

  return {
    manifest_id: generateId('manifest'),
    tech_stack_id: typeof techStackId === 'number' ? techStackId : 1,
    normative_controls: normativeControls,
    assets,
    config_intents: configIntents,
    evidence_monitors: evidenceMonitors,
    drift_policies: driftPolicies,
  };
}

function getPlaybookDataForTask(
  task: Task,
  playbookByAction: Map<string, PlaybookEntry>,
): {
  implementations: string[];
  portalPaths: string[];
  psCommands: string[];
  evidenceCommands: string[];
} {
  const implementations: string[] = [];
  const portalPaths: string[] = [];
  const psCommands: string[] = [];
  const evidenceCommands: string[] = [];

  // Extract action IDs from the task's impl_args if available
  const taskPsCommands = (task.impl_args as Record<string, unknown>)?.powershell_commands;
  if (Array.isArray(taskPsCommands)) {
    psCommands.push(...taskPsCommands);
  }

  // Walk through all playbook entries to find matches for this task's requirement
  for (const [, entry] of playbookByAction) {
    // Match playbook entries whose action_id prefix corresponds to patterns for this requirement
    // Action IDs follow the pattern like "IAM-001-01" — we check via the task's vendor_help_refs
    const taskRefs = task.vendor_help_refs || [];
    const matchesTask = taskRefs.some(
      (ref) => ref.vendor === 'Microsoft' && ref.product === entry.m365_service,
    );

    if (matchesTask || psCommands.some((cmd) => entry.powershell?.includes(cmd))) {
      implementations.push(entry.implementation);
      if (entry.portal_path) portalPaths.push(entry.portal_path);
      if (entry.evidence_commands) {
        for (const cmd of entry.evidence_commands) {
          if (!cmd.startsWith('#') && !evidenceCommands.includes(cmd)) {
            evidenceCommands.push(cmd);
          }
        }
      }
    }
  }

  return { implementations, portalPaths, psCommands, evidenceCommands };
}

function buildDriftPolicies(tasks: Task[]): any[] {
  const policies: any[] = [];
  const crit = tasks.filter((t) => t.priority === 'p0');
  const high = tasks.filter((t) => t.priority === 'p1');

  if (crit.length > 0) {
    policies.push({
      id: generateId('dp'),
      scope: `Critical controls: ${crit.map((t) => t.requirement_id).join(', ')}`,
      severity: 'critical',
      detection: ['Continuous monitoring via evidence monitors', 'Configuration drift alerts'],
      response_playbook: [
        'Immediately notify compliance lead',
        'Initiate emergency remediation',
        'Document incident and resolution',
      ],
    });
  }
  if (high.length > 0) {
    policies.push({
      id: generateId('dp'),
      scope: `High priority controls: ${high.map((t) => t.requirement_id).join(', ')}`,
      severity: 'high',
      detection: ['Daily configuration compliance checks', 'Evidence freshness monitoring'],
      response_playbook: [
        'Notify compliance team within 24 hours',
        'Schedule remediation',
        'Update evidence artifacts',
      ],
    });
  }
  if (policies.length === 0) {
    policies.push({
      id: generateId('dp'),
      scope: 'All CMMC controls',
      severity: 'medium',
      detection: ['Weekly compliance scans', 'Monthly evidence reviews'],
      response_playbook: [
        'Evaluate drift impact',
        'Schedule remediation in next sprint',
        'Update compliance documentation',
      ],
    });
  }
  return policies;
}
