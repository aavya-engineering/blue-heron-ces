// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { GapSet, GapClassification, BoundaryRelevance } from '../types';
import { Badge } from '@/shared/components/Display/Badge';
import { Card } from '@/shared/components/Display/Card';

const GAP_CLASS_STYLE: Record<GapClassification, { variant: 'success' | 'info' | 'warning' | 'error' | 'neutral'; label: string }> = {
  configure: { variant: 'success', label: 'Configure' },
  customize: { variant: 'info', label: 'Customize' },
  manual: { variant: 'warning', label: 'Manual' },
  auto_generate: { variant: 'success', label: 'Auto-Generated' },
  manual_alternative: { variant: 'warning', label: 'Manual Alternative' },
  control_not_available: { variant: 'error', label: 'Not Available' },
  scoped_out: { variant: 'neutral', label: 'Scoped Out (N/A)' },
};

const BOUNDARY_STYLE: Record<BoundaryRelevance, { variant: 'success' | 'info' | 'neutral'; label: string }> = {
  in_boundary: { variant: 'success', label: 'In Boundary' },
  boundary_adjacent: { variant: 'info', label: 'Adjacent' },
  out_of_boundary: { variant: 'neutral', label: 'Out of Boundary' },
};

interface GapAnalysisPanelProps {
  gapSet: GapSet;
}

export function GapAnalysisPanel({ gapSet }: GapAnalysisPanelProps) {
  const totalTasks = gapSet.gaps.length;

  // Count gaps that include each classification (a gap can count in multiple buckets)
  let configureCount = 0;
  let customizeCount = 0;
  let manualCount = 0;
  let manualAltCount = 0;
  let notAvailableCount = 0;
  for (const g of gapSet.gaps) {
    const gc = g.gap_classifications;
    if (gc.includes('configure')) configureCount++;
    if (gc.includes('customize')) customizeCount++;
    if (gc.includes('manual') || gc.length === 0) manualCount++;
    if (gc.includes('manual_alternative')) manualAltCount++;
    if (gc.includes('control_not_available')) notAvailableCount++;
  }

  // Boundary relevance counts (only when boundary data is present)
  const hasBoundaryData = gapSet.gaps.some((g) => g.boundary_relevance);
  let inBoundaryCount = 0;
  let adjacentCount = 0;
  let outOfBoundaryCount = 0;
  if (hasBoundaryData) {
    for (const g of gapSet.gaps) {
      if (g.boundary_relevance === 'in_boundary') inBoundaryCount++;
      else if (g.boundary_relevance === 'boundary_adjacent') adjacentCount++;
      else if (g.boundary_relevance === 'out_of_boundary') outOfBoundaryCount++;
    }
  }

  return (
    <Card title="Compliance Analysis">
      <div className="mb-6">
        <div className="text-center mb-4">
          <div className="text-3xl font-bold text-gray-800">{totalTasks}</div>
          <div className="text-sm text-gray-500">Total Requirements</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center pt-3 border-t border-gray-200">
          <div>
            <div className="text-lg font-semibold text-green-600">{configureCount}</div>
            <div className="text-xs text-gray-500">Configure</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-blue-600">{customizeCount}</div>
            <div className="text-xs text-gray-500">Customize</div>
          </div>
          <div>
            <div className="text-lg font-semibold text-amber-600">{manualCount}</div>
            <div className="text-xs text-gray-500">Manual</div>
          </div>
        </div>
        {(manualAltCount > 0 || notAvailableCount > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-center pt-3 mt-3 border-t border-gray-200">
            {manualAltCount > 0 && (
              <div>
                <div className="text-lg font-semibold text-amber-600">{manualAltCount}</div>
                <div className="text-xs text-gray-500">Manual Alternative</div>
              </div>
            )}
            {notAvailableCount > 0 && (
              <div>
                <div className="text-lg font-semibold text-red-600">{notAvailableCount}</div>
                <div className="text-xs text-gray-500">Not Available</div>
              </div>
            )}
          </div>
        )}
        {hasBoundaryData && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center pt-3 mt-3 border-t border-gray-200">
            <div>
              <div className="text-lg font-semibold text-green-600">{inBoundaryCount}</div>
              <div className="text-xs text-gray-500">In Boundary</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-blue-600">{adjacentCount}</div>
              <div className="text-xs text-gray-500">Adjacent</div>
            </div>
            <div>
              <div className="text-lg font-semibold text-gray-500">{outOfBoundaryCount}</div>
              <div className="text-xs text-gray-500">Out of Boundary</div>
            </div>
          </div>
        )}
        {gapSet.scopeExclusions && gapSet.scopeExclusions.length > 0 && (
          <div className="grid grid-cols-1 gap-3 text-center pt-3 mt-3 border-t border-gray-200">
            <div>
              <div className="text-lg font-semibold text-green-600">
                {gapSet.scopeExclusions.length}
              </div>
              <div className="text-xs text-gray-500">Scope Exclusions</div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {gapSet.gaps.map((gap) => (
          <div
            key={gap.requirement_id}
            className="flex items-start justify-between p-3 bg-gray-50 rounded border border-gray-200"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="font-mono text-sm font-medium">{gap.requirement_id}</span>
                <Badge
                  variant={
                    gap.severity === 'HIGH'
                      ? 'error'
                      : gap.severity === 'MEDIUM'
                      ? 'warning'
                      : 'info'
                  }
                >
                  {gap.severity}
                </Badge>
                {gap.gap_classifications.map((gc) => (
                  <Badge key={gc} variant={GAP_CLASS_STYLE[gc].variant}>
                    {GAP_CLASS_STYLE[gc].label}
                  </Badge>
                ))}
                {gap.boundary_relevance && (
                  <Badge variant={BOUNDARY_STYLE[gap.boundary_relevance].variant}>
                    {BOUNDARY_STYLE[gap.boundary_relevance].label}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-gray-600 mb-2">{gap.gap_reason}</p>
              {gap.missing_evidence_archetypes.length > 0 && (
                <div className="text-xs text-gray-500">
                  Missing evidence: {gap.missing_evidence_archetypes.join(', ')}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
