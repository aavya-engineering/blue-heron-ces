// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Card } from '@/shared/components/Display/Card';
import { Badge } from '@/shared/components/Display/Badge';
import { renderLinkedText } from '@/shared/utils/renderLinks';
import { GAP_CLASS_STYLE } from '@/shared/constants/cmmcConstants';
import type { GapClassification } from '../types';

const GAP_CLASS_BADGE_VARIANT: Record<string, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = {
  configure: 'success',
  customize: 'info',
  manual: 'warning',
  auto_generate: 'success',
  manual_alternative: 'warning',
  control_not_available: 'error',
  scoped_out: 'neutral',
};

interface PlanViewerProps {
  plan: any;
}

function renderWhatToDoItem(item: string, i: number): JSX.Element {
  if (item.startsWith('[GCC High Responsibility]')) {
    return (
      <li key={i} className="rounded px-1.5 py-0.5 bg-yellow-50 text-yellow-900">
        {item}
      </li>
    );
  }
  if (item.startsWith('[Microsoft Tech Ref]')) {
    return (
      <li key={i} className="rounded px-1.5 py-0.5 bg-blue-50 text-blue-800">
        {item}
      </li>
    );
  }
  // TCP lines are rendered in their own callout block — skip them here
  if (item.startsWith('[TCP Context]') || item.startsWith('[TCP Verification]')) {
    return <></>;
  }
  return <li key={i} className="truncate">{item}</li>;
}

/** Extract TCP lines from what_to_do and how_to_verify into a structured block. */
function TenantConfigCallout({ step }: { step: any }) {
  const wtd: string[] = step.what_to_do || [];
  const htv: string[] = step.how_to_verify || [];

  const tcpContext = wtd.filter((s: string) => s.startsWith('[TCP Context]'));
  const tcpVerify = htv.filter((s: string) => s.startsWith('[TCP Verification]'));

  if (tcpContext.length === 0 && tcpVerify.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border-2 border-primary-300 bg-primary-50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-primary-600 text-white">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="text-xs font-bold uppercase tracking-wider">Tenant Configuration</span>
      </div>
      <div className="px-3 py-2 space-y-2">
        {tcpContext.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-primary-700 uppercase tracking-wide mb-1">
              Apply these tenant-specific values
            </div>
            {tcpContext.map((line: string, i: number) => {
              const text = line.replace('[TCP Context] ', '');
              const colonIdx = text.indexOf(':');
              const label = colonIdx > 0 ? text.slice(0, colonIdx) : null;
              const value = colonIdx > 0 ? text.slice(colonIdx + 1).trim() : text;
              return (
                <div key={i} className="flex items-baseline gap-1.5 text-sm py-0.5">
                  <span className="text-primary-500 flex-shrink-0">{'\u25B8'}</span>
                  {label ? (
                    <>
                      <span className="font-semibold text-primary-900">{label}:</span>
                      <span className="text-primary-800 font-mono text-xs">{value}</span>
                    </>
                  ) : (
                    <span className="text-primary-800">{value}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {tcpVerify.length > 0 && (
          <div className="border-t border-primary-200 pt-2">
            <div className="text-xs font-semibold text-primary-700 uppercase tracking-wide mb-1">
              Verify after implementation
            </div>
            {tcpVerify.map((line: string, i: number) => (
              <div key={i} className="flex items-baseline gap-1.5 text-sm py-0.5">
                <span className="text-primary-500 flex-shrink-0">{'\u2713'}</span>
                <span className="text-primary-800">
                  {line.replace('[TCP Verification] ', '')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Render non-TCP how_to_verify lines. */
function VerificationChecklist({ step }: { step: any }) {
  const htv: string[] = step.how_to_verify || [];
  const nonTcp = htv.filter(
    (v: string) => !v.startsWith('[TCP Verification]'),
  );
  if (nonTcp.length === 0) return null;

  return (
    <div className="mt-2">
      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        Verification ({nonTcp.length})
      </span>
      <ul className="mt-1 space-y-0.5">
        {nonTcp.map((v: string, i: number) => (
          <li
            key={i}
            className={`text-sm pl-2 border-l-2 py-0.5 ${
              v.startsWith('[BTC Re-Verification]')
                ? 'border-red-400 bg-red-50 text-red-800'
                : 'border-gray-300 text-gray-600'
            }`}
          >
            {v}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PlanViewer({ plan }: PlanViewerProps) {
  if (!plan) return null;

  // Access the actual plan data from outputs.human_readable_mission_plan
  const planData = plan.outputs?.human_readable_mission_plan;
  if (!planData) return <div className="text-gray-500">Invalid plan structure</div>;

  const steps = planData.steps || [];
  const milestones = planData.milestones || [];

  // Calculate summary stats
  const totalEffortHours = steps.reduce((sum: number, s: any) => sum + (s.estimated_effort_hours || 0), 0);
  const estimatedDays = Math.ceil(totalEffortHours / 8); // Assuming 8 hours per day

  return (
    <div className="space-y-6">
      <Card title="Mission Summary">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {plan?.ces?.cesId && (
            <div>
              <dt className="text-sm font-medium text-gray-500">CES ID</dt>
              <dd className="mt-1 text-sm font-mono text-gray-600">{plan.ces.cesId}</dd>
            </div>
          )}
          <div>
            <dt className="text-sm font-medium text-gray-500">Target Level</dt>
            <dd className="mt-1 text-lg font-semibold">{planData.target_level || 'L2'}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Total Tasks</dt>
            <dd className="mt-1 text-lg font-semibold">{steps.length}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Estimated Effort</dt>
            <dd className="mt-1 text-lg font-semibold">
              {totalEffortHours} hours (~{estimatedDays} days)
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Plan Mode</dt>
            <dd className="mt-1">
              <Badge variant="info">{planData.plan_mode || 'build_new'}</Badge>
            </dd>
          </div>
          {planData.scope_exclusions && planData.scope_exclusions.length > 0 && (
            <div>
              <dt className="text-sm font-medium text-gray-500">Scoped-Out Controls</dt>
              <dd className="mt-1 text-lg font-semibold">{planData.scope_exclusions.length}</dd>
            </div>
          )}
        </dl>
      </Card>

      {milestones.length > 0 && (
        <Card title="Milestones">
          <div className="space-y-4">
            {milestones.map((milestone: any, index: number) => (
              <div key={milestone.id || index} className="p-4 bg-gray-50 rounded border border-gray-200">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-medium text-gray-900">{milestone.name}</h4>
                  <Badge variant="neutral">{milestone.id}</Badge>
                </div>
                <p className="text-sm text-gray-600 mb-2">{milestone.objective}</p>
                {milestone.exit_criteria && milestone.exit_criteria.length > 0 && (
                  <div className="text-xs text-gray-500">
                    <span className="font-medium">Exit Criteria:</span>
                    <ul className="list-disc list-inside mt-1">
                      {milestone.exit_criteria.map((c: string, i: number) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {milestone.target_date && (
                  <p className="text-xs text-gray-500 mt-2">Target: {milestone.target_date}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {steps.length > 0 && (
        <Card title="Implementation Steps">
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {steps.map((step: any, index: number) => (
              <div key={step.id || index} className="p-3 bg-gray-50 rounded border border-gray-200">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-900">{step.title}</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={step.priority === 'p0' ? 'error' : step.priority === 'p1' ? 'warning' : 'neutral'}>
                      {step.priority}
                    </Badge>
                    {(step.gap_classifications || []).map((gc: GapClassification) => (
                      <Badge key={gc} variant={GAP_CLASS_BADGE_VARIANT[gc]}>
                        {GAP_CLASS_STYLE[gc].label}
                      </Badge>
                    ))}
                    <span className="text-xs text-gray-500">
                      {step.estimated_effort_hours}h
                    </span>
                  </div>
                </div>
                {step.control_coverage && step.control_coverage.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {step.control_coverage.map((ctrl: any, i: number) => (
                      <span key={ctrl.control_id || i} className="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">
                        {typeof ctrl === 'string' ? ctrl : ctrl.control_id || '[unknown]'}
                      </span>
                    ))}
                  </div>
                )}
                {step.actions && step.actions.length > 0 && (
                  <div className="text-sm text-gray-600 mb-2">
                    <span className="font-medium">Actions:</span>
                    <div className="mt-1 space-y-1.5">
                      {step.actions.slice(0, 4).map((action: any, i: number) => (
                        <div key={action.action_id || i} className="pl-2 border-l-2 border-blue-300">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded font-medium">
                              {action.action_type}
                            </span>
                            <span className="truncate">{action.action}</span>
                          </div>
                          {action.evidence_outputs && action.evidence_outputs.length > 0 && (
                            <div className="text-xs text-gray-400 mt-0.5">
                              Evidence: {action.evidence_outputs.join(', ')}
                            </div>
                          )}
                          {action.vendor?.m365_service && (
                            <div className="text-xs text-gray-400">
                              {action.vendor.m365_service}
                              {action.vendor.portal_path ? ` — ${action.vendor.portal_path}` : ''}
                            </div>
                          )}
                          {action.vendor?.tech_ref_guidance && action.vendor.tech_ref_guidance.length > 0 && (
                            <div className="text-xs text-gray-500 mt-1 pl-2 border-l border-gray-200">
                              {action.vendor.tech_ref_guidance.slice(0, 3).map((para: string, j: number) => (
                                <p key={j}>{renderLinkedText(para)}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      {step.actions.length > 4 && (
                        <div className="text-gray-400 pl-2">+{step.actions.length - 4} more...</div>
                      )}
                    </div>
                  </div>
                )}
                {step.vendor_help_refs && step.vendor_help_refs.some((r: any) => r.url) && (
                  <div className="mt-2">
                    <span className="text-xs font-medium text-gray-500">Documentation:</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {step.vendor_help_refs.filter((r: any) => r.url).map((ref: any, i: number) => (
                        <a
                          key={i}
                          href={ref.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:text-blue-800 underline"
                        >
                          {ref.title} ({ref.product})
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                <TenantConfigCallout step={step} />
                {(() => {
                  const nonTcpWtd = (step.what_to_do || []).filter(
                    (s: string) =>
                      !s.startsWith('[TCP Context]') && !s.startsWith('[TCP Verification]'),
                  );
                  if (nonTcpWtd.length === 0) return null;
                  return (
                    <div className="text-sm text-gray-600 mt-2">
                      <span className="font-medium">
                        {step.actions && step.actions.length > 0
                          ? 'Supplemental Guidance:'
                          : 'Actions:'}
                      </span>
                      <ul className="list-disc list-inside">
                        {nonTcpWtd.slice(0, 5).map((action: string, i: number) =>
                          renderWhatToDoItem(action, i),
                        )}
                        {nonTcpWtd.length > 5 && (
                          <li className="text-gray-400">
                            +{nonTcpWtd.length - 5} more...
                          </li>
                        )}
                      </ul>
                    </div>
                  );
                })()}
                <VerificationChecklist step={step} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {planData.scope_exclusion_warnings && planData.scope_exclusion_warnings.length > 0 && (
        <Card title="Scope Exclusion Warnings">
          <ul className="space-y-2">
            {planData.scope_exclusion_warnings.map((warning: string, index: number) => (
              <li
                key={index}
                className="text-sm rounded border border-orange-300 bg-orange-50 text-orange-900 px-3 py-2"
              >
                {warning}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {planData.assessor_alignment_notes && planData.assessor_alignment_notes.length > 0 && (
        <Card title="Assessor Alignment Notes">
          <ul className="list-disc list-inside space-y-2">
            {planData.assessor_alignment_notes.map((note: string, index: number) => (
              <li key={index} className="text-sm text-gray-700">
                {note}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {planData.scope_exclusions && planData.scope_exclusions.length > 0 && (
        <Card title="Scope Exclusions">
          <div className="space-y-2">
            {planData.scope_exclusions.map(
              (
                exc: { requirement_id: string; justification: string; si_field: string; si_value: string },
                index: number,
              ) => (
                <div
                  key={exc.requirement_id || index}
                  className="rounded border border-green-200 bg-green-50 px-3 py-2"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm font-medium text-green-900">
                      {exc.requirement_id}
                    </span>
                    <span className="text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                      {exc.si_field}
                    </span>
                  </div>
                  <p className="text-sm text-green-900">{exc.justification}</p>
                  <p className="text-xs text-green-700 mt-1">
                    SI Value: <span className="font-mono">{exc.si_value}</span>
                  </p>
                </div>
              ),
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
