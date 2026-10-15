// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Fragment, useState, useMemo } from 'react';
import clsx from 'clsx';
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react';
import { Badge } from '@/shared/components/Display/Badge';
import { renderLinkedText } from '@/shared/utils/renderLinks';
import type { DerivedActionStatus, ActionStatus } from '../types';
import type { TechRefIndex } from '@/shared/services/techRefIndex';

interface BulkReviewTableProps {
  actionStatuses: DerivedActionStatus[];
  techRefIndex?: TechRefIndex | null;
  onUpdateStatus: (actionId: string, status: ActionStatus) => void;
  onAcceptAll: () => void;
  onBack: () => void;
}

const STATUS_OPTIONS: { value: ActionStatus; label: string }[] = [
  { value: 'implemented', label: 'Implemented' },
  { value: 'partial', label: 'Partial' },
  { value: 'not_implemented', label: 'Not Implemented' },
  { value: 'not_applicable', label: 'N/A' },
];

const STATUS_COLORS: Record<ActionStatus, string> = {
  implemented: 'border-l-green-500',
  partial: 'border-l-yellow-500',
  not_implemented: 'border-l-red-500',
  not_applicable: 'border-l-gray-400',
};

const STATUS_BADGE_VARIANT: Record<ActionStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
  implemented: 'success',
  partial: 'warning',
  not_implemented: 'error',
  not_applicable: 'neutral',
};

const SIGNAL_BADGE_VARIANT: Record<string, 'info' | 'warning' | 'neutral'> = {
  configure: 'info',
  customize: 'warning',
  manual: 'neutral',
};

const SOURCE_LABELS: Record<string, string> = {
  license_gate: 'License',
  scope_gate: 'Scope',
  inherent: 'Inherent',
  archetype_default: 'Archetype',
  preamble_override: 'Preamble',
  si_override: 'SI',
  btc_risk_flag: 'BTC Risk',
  advisor_override: 'Advisor',
};

export function BulkReviewTable({
  actionStatuses,
  techRefIndex,
  onUpdateStatus,
  onAcceptAll,
  onBack,
}: BulkReviewTableProps) {
  const [statusFilter, setStatusFilter] = useState<ActionStatus | 'all'>('all');
  const [capabilityFilter, setCapabilityFilter] = useState<string>('all');
  const [searchText, setSearchText] = useState('');
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set());

  const toggleExpanded = (actionId: string) => {
    setExpandedActions((prev) => {
      const next = new Set(prev);
      if (next.has(actionId)) next.delete(actionId);
      else next.add(actionId);
      return next;
    });
  };

  // Compute counts
  const counts = useMemo(() => {
    const c = { implemented: 0, partial: 0, not_implemented: 0, not_applicable: 0 };
    for (const a of actionStatuses) {
      c[a.status]++;
    }
    return c;
  }, [actionStatuses]);

  const overrideCount = useMemo(
    () => actionStatuses.filter((a) => a.overridden).length,
    [actionStatuses]
  );

  // Unique capabilities
  const capabilities = useMemo(() => {
    const set = new Set<string>();
    for (const a of actionStatuses) set.add(a.capability);
    return Array.from(set).sort();
  }, [actionStatuses]);

  // Filter actions
  const filtered = useMemo(() => {
    return actionStatuses.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (capabilityFilter !== 'all' && a.capability !== capabilityFilter) return false;
      if (searchText) {
        const lower = searchText.toLowerCase();
        return (
          a.action_text.toLowerCase().includes(lower) ||
          a.action_id.toLowerCase().includes(lower) ||
          a.m365_service.toLowerCase().includes(lower) ||
          a.practice_id.toLowerCase().includes(lower)
        );
      }
      return true;
    });
  }, [actionStatuses, statusFilter, capabilityFilter, searchText]);

  // Group by capability
  const grouped = useMemo(() => {
    const map = new Map<string, DerivedActionStatus[]>();
    for (const a of filtered) {
      const group = map.get(a.capability) ?? [];
      group.push(a);
      map.set(a.capability, group);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const formatCapability = (cap: string) =>
    cap.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="max-w-7xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold font-serif text-gray-900 mb-2">
          Review Derived Action Statuses
        </h1>
        <p className="text-gray-600">
          Review the derived statuses below. Override any action by changing its status dropdown.
          When satisfied, accept to generate the Readiness Posture.
        </p>
      </div>

      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <button
          onClick={() => setStatusFilter('all')}
          className={clsx(
            'px-3 py-1.5 rounded-none text-sm font-medium transition-colors',
            statusFilter === 'all'
              ? 'bg-gray-800 text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
          )}
        >
          All ({actionStatuses.length})
        </button>
        {(
          [
            ['implemented', 'success'],
            ['partial', 'warning'],
            ['not_implemented', 'error'],
            ['not_applicable', 'neutral'],
          ] as const
        ).map(([status, variant]) => (
          <button
            key={status}
            onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
            className={clsx(
              'px-3 py-1.5 rounded-none text-sm font-medium transition-colors',
              statusFilter === status
                ? variant === 'success'
                  ? 'bg-green-600 text-white'
                  : variant === 'warning'
                    ? 'bg-yellow-500 text-white'
                    : variant === 'error'
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
            )}
          >
            {status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} (
            {counts[status]})
          </button>
        ))}
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={capabilityFilter}
          onChange={(e) => setCapabilityFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-green-500 focus:border-green-500"
        >
          <option value="all">All Capabilities</option>
          {capabilities.map((cap) => (
            <option key={cap} value={cap}>
              {formatCapability(cap)}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search actions, services, practices..."
          className="flex-1 min-w-[200px] rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-green-500 focus:border-green-500"
        />
      </div>

      {/* Capability sections */}
      <div className="space-y-4">
        {grouped.map(([capability, actions]) => {
          const capImplemented = actions.filter((a) => a.status === 'implemented').length;
          const pct = Math.round((capImplemented / actions.length) * 100);

          return (
            <Disclosure key={capability} defaultOpen>
              {({ open }) => (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <DisclosureButton className="w-full px-4 py-3 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors">
                    <div className="flex items-center gap-3">
                      <svg
                        className={clsx(
                          'w-4 h-4 text-gray-500 transition-transform',
                          open && 'rotate-90'
                        )}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                      <span className="font-medium text-gray-900">
                        {formatCapability(capability)}
                      </span>
                      <span className="text-sm text-gray-500">({actions.length} actions)</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-24 h-2 bg-gray-200 rounded-none overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-none"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
                    </div>
                  </DisclosureButton>

                  <DisclosurePanel>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-y border-gray-200">
                            <th className="px-3 py-2 text-left font-medium text-gray-600 w-28">
                              Action ID
                            </th>
                            <th className="px-3 py-2 text-left font-medium text-gray-600">
                              Description
                            </th>
                            <th className="px-3 py-2 text-left font-medium text-gray-600 w-24">
                              Signal
                            </th>
                            <th className="px-3 py-2 text-left font-medium text-gray-600 w-40">
                              M365 Service
                            </th>
                            <th className="px-3 py-2 text-left font-medium text-gray-600 w-40">
                              Status
                            </th>
                            <th className="px-3 py-2 text-left font-medium text-gray-600 w-24">
                              Source
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {actions.map((action) => {
                            const isExpanded = expandedActions.has(action.action_id);
                            const guidance = techRefIndex?.getGuidance(
                              action.practice_id,
                              action.m365_service
                            );
                            const gcchResp = techRefIndex?.getGcchResponsibilities(
                              action.practice_id
                            );
                            const control = techRefIndex?.getControl(action.practice_id);
                            const hasDetail = !!(guidance || gcchResp);

                            return (
                              <Fragment key={action.action_id}>
                                <tr
                                  className={clsx(
                                    'border-l-4',
                                    STATUS_COLORS[action.status],
                                    action.overridden && 'bg-blue-50/50',
                                    hasDetail && 'cursor-pointer'
                                  )}
                                  onClick={hasDetail ? () => toggleExpanded(action.action_id) : undefined}
                                >
                                  <td className="px-3 py-2 font-mono text-xs text-gray-600">
                                    {action.action_id}
                                  </td>
                                  <td className="px-3 py-2 text-gray-800" title={action.derivation_reason}>
                                    <div className="flex items-center gap-1.5">
                                      {hasDetail && (
                                        <svg
                                          className={clsx(
                                            'w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0',
                                            isExpanded && 'rotate-90'
                                          )}
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M9 5l7 7-7 7"
                                          />
                                        </svg>
                                      )}
                                      {action.action_text}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2">
                                    <Badge
                                      variant={SIGNAL_BADGE_VARIANT[action.signal] ?? 'neutral'}
                                      size="sm"
                                    >
                                      {action.signal}
                                    </Badge>
                                  </td>
                                  <td className="px-3 py-2 text-gray-600 text-xs">
                                    {action.m365_service}
                                  </td>
                                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                                    <select
                                      value={action.status}
                                      onChange={(e) =>
                                        onUpdateStatus(
                                          action.action_id,
                                          e.target.value as ActionStatus
                                        )
                                      }
                                      className={clsx(
                                        'rounded border px-2 py-1 text-xs font-medium w-full',
                                        action.status === 'implemented' &&
                                          'border-green-300 bg-green-50 text-green-800',
                                        action.status === 'partial' &&
                                          'border-yellow-300 bg-yellow-50 text-yellow-800',
                                        action.status === 'not_implemented' &&
                                          'border-red-300 bg-red-50 text-red-800',
                                        action.status === 'not_applicable' &&
                                          'border-gray-300 bg-gray-50 text-gray-600'
                                      )}
                                    >
                                      {STATUS_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                          {opt.label}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-3 py-2">
                                    <Badge
                                      variant={
                                        action.overridden
                                          ? STATUS_BADGE_VARIANT[action.status]
                                          : 'neutral'
                                      }
                                      size="sm"
                                    >
                                      {SOURCE_LABELS[action.derivation_source] ??
                                        action.derivation_source}
                                    </Badge>
                                  </td>
                                </tr>
                                {isExpanded && hasDetail && (
                                  <tr key={`${action.action_id}-detail`}>
                                    <td colSpan={6} className="px-6 py-3 bg-gray-50/50">
                                      <div className="space-y-3">
                                        {/* Implementation guidance */}
                                        {guidance && (
                                          <div>
                                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                                              Implementation Guidance — {guidance.service_name}
                                            </h4>
                                            <div className="text-sm text-gray-700 space-y-1.5">
                                              {guidance.paragraphs.map((p, i) => (
                                                <p key={i}>
                                                  {p.text_with_links
                                                    ? renderLinkedText(p.text_with_links)
                                                    : p.text}
                                                </p>
                                              ))}
                                            </div>
                                          </div>
                                        )}

                                        {/* GCC High customer responsibilities */}
                                        {gcchResp && gcchResp.length > 0 && (
                                          <div className="rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2">
                                            <h4 className="text-xs font-semibold text-yellow-800 uppercase tracking-wide mb-1">
                                              GCC High Customer Responsibilities
                                            </h4>
                                            <div className="text-sm text-yellow-900 space-y-1">
                                              {gcchResp.map((p, i) => (
                                                <p key={i}>
                                                  {p.text_with_links
                                                    ? renderLinkedText(p.text_with_links)
                                                    : p.text}
                                                </p>
                                              ))}
                                            </div>
                                          </div>
                                        )}

                                        {/* Primary services */}
                                        {control?.primary_services &&
                                          control.primary_services.length > 0 && (
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="text-xs text-gray-500 font-medium">
                                                Primary services:
                                              </span>
                                              {control.primary_services.map((svc) => (
                                                <Badge key={svc} variant="info" size="sm">
                                                  {svc}
                                                </Badge>
                                              ))}
                                            </div>
                                          )}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </DisclosurePanel>
                </div>
              )}
            </Disclosure>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No actions match the current filters.
        </div>
      )}

      {/* Footer */}
      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Back to Preamble
        </button>
        <div className="flex items-center gap-4">
          {overrideCount > 0 && (
            <span className="text-sm text-blue-600 font-medium">
              {overrideCount} override{overrideCount !== 1 ? 's' : ''}
            </span>
          )}
          <button
            onClick={onAcceptAll}
            className="px-6 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700"
          >
            Accept & Generate Posture
          </button>
        </div>
      </div>
    </div>
  );
}
