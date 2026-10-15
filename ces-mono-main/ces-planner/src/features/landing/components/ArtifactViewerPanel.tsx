// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState, useRef, useCallback, useEffect } from 'react';
import { Badge } from '@/shared/components/Display/Badge';
import { ArtifactContent } from '@/shared/components/Display/ArtifactViewerModal';
import { PlanViewer } from '@/features/mpt/components/PlanViewer';
import { ManifestViewer } from '@/features/mpt/components/ManifestViewer';
import { formatExclusionsReportAsText } from '@/features/mpt/services/exclusionsReportGenerator';
import { formatTraceabilityReportAsText } from '@/features/mpt/services/traceabilityReportGenerator';
import { formatControlAssessmentReportAsText } from '@/features/mpt/services/controlAssessmentReportGenerator';

const CASCADE_OFFSET = 30;

const TYPE_LABELS: Record<string, string> = {
  'manual-mission-plan': 'Manual Plan',
  proposal: 'Proposal',
  'tenant-manifest': 'Manifest',
  'exclusions-report': 'Exclusions',
  'traceability-report': 'Traceability',
  'control-assessment-report': 'Assessment Report',
};

const TYPE_COLORS: Record<string, 'info' | 'success' | 'warning' | 'error' | 'neutral'> = {
  'manual-mission-plan': 'info',
  proposal: 'warning',
  'tenant-manifest': 'neutral',
  'exclusions-report': 'error',
  'traceability-report': 'success',
  'control-assessment-report': 'info',
};

interface ArtifactViewerPanelProps {
  artifact: { type: string; filename: string; path: string };
  index: number;
  zIndex: number;
  onClose: (path: string) => void;
  onFocus: (path: string) => void;
}

export function ArtifactViewerPanel({
  artifact,
  index,
  zIndex,
  onClose,
  onFocus,
}: ArtifactViewerPanelProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dragging state
  const [position, setPosition] = useState({
    x: 120 + index * CASCADE_OFFSET,
    y: 60 + index * CASCADE_OFFSET,
  });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      try {
        const response = await fetch(
          `/api/download-artifact?path=${encodeURIComponent(artifact.path)}`,
        );
        if (!response.ok) throw new Error('Failed to fetch artifact');
        const json = await response.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [artifact.path]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      onFocus(artifact.path);
      dragging.current = true;
      dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
      e.preventDefault();
    },
    [position, artifact.path, onFocus],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    };
    const handleMouseUp = () => {
      dragging.current = false;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const renderContent = () => {
    if (loading) return null;
    if (error) return <p className="text-sm text-red-600 p-4">{error}</p>;
    if (!data) return <p className="text-sm text-gray-500 p-4">No data</p>;

    if (artifact.type === 'manual-mission-plan') {
      return <PlanViewer plan={data} />;
    }

    if (artifact.type === 'tenant-manifest') {
      return <ManifestViewer manifest={data} />;
    }

    if (artifact.type === 'exclusions-report') {
      const text = formatExclusionsReportAsText(data);
      return <pre className="text-xs text-gray-800 whitespace-pre-wrap p-4">{text}</pre>;
    }

    if (artifact.type === 'traceability-report') {
      const text = formatTraceabilityReportAsText(data);
      return <pre className="text-xs text-gray-800 whitespace-pre-wrap p-4">{text}</pre>;
    }

    if (artifact.type === 'control-assessment-report') {
      const text = formatControlAssessmentReportAsText(data);
      return <pre className="text-xs text-gray-800 whitespace-pre-wrap p-4">{text}</pre>;
    }

    // proposal / tenant-manifest: generic renderer
    return (
      <div className="p-4">
        <ArtifactContent data={data} />
      </div>
    );
  };

  return (
    <div
      onMouseDown={() => onFocus(artifact.path)}
      className="fixed flex flex-col bg-white rounded-xl shadow-2xl border border-gray-300 overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        maxWidth: 720,
        width: '100%',
        maxHeight: 'calc(100vh - 80px)',
        zIndex,
      }}
    >
      {/* Draggable header */}
      <div
        onMouseDown={handleMouseDown}
        className="flex-shrink-0 border-b border-gray-200 bg-gray-50 px-6 py-4 cursor-move select-none"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant={TYPE_COLORS[artifact.type] || 'neutral'}>
              {TYPE_LABELS[artifact.type] || artifact.type}
            </Badge>
            {loading && (
              <div className="h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            )}
            <span className="text-sm font-medium text-gray-900 truncate">{artifact.filename}</span>
          </div>
          <button
            onClick={() => onClose(artifact.path)}
            className="flex-shrink-0 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">{renderContent()}</div>
    </div>
  );
}
