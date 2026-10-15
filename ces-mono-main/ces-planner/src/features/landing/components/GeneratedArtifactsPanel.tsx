// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card } from '@/shared/components/Display/Card';
import { Badge } from '@/shared/components/Display/Badge';
import { formatPlanAsText, formatPlanAsHTML, formatManifestAsHTML } from '@/shared/utils/exportPlan';
import { formatExclusionsReportAsText } from '@/features/mpt/services/exclusionsReportGenerator';
import { formatTraceabilityReportAsHTML } from '@/features/mpt/services/traceabilityReportGenerator';
import { ArtifactViewerPanel } from './ArtifactViewerPanel';
import { STAMPER_BASE_PATH, STAMPER_EXPORT_KEY } from '@/shared/config';

interface Artifact {
  type: string;
  filename: string;
  path: string;
  size: number;
  createdAt: string;
  customerName: string;
  category: string;
  cesId?: string;
}

interface GeneratedArtifactsPanelProps {
  refreshTrigger?: number;
}

interface CustomerChain {
  customerName: string;
  artifacts: Artifact[];
  totalSize: number;
}

const TYPE_LABELS: Record<string, string> = {
  'si-baseline': 'SI Baseline',
  'cui-boundary': 'CUI Boundary',
  'btc-confirmation': 'BTC Confirmation',
  'rr-question-set': 'Question Set',
  'readiness-posture': 'Posture',
  'manual-mission-plan': 'Manual Plan',
  'proposal': 'Proposal',
  'tenant-manifest': 'Manifest',
  'exclusions-report': 'Exclusions',
  'traceability-report': 'Traceability',
  'control-assessment-report': 'Assessment Report',
  'tech-ref-plan': 'Tech Ref Guide',
  'infrastructure-manifest': 'Infra Manifest',
  'customer': 'Customer',
  'policy-inputs': 'Policy Inputs',
};

const TYPE_COLORS: Record<string, 'info' | 'success' | 'warning' | 'error' | 'neutral'> = {
  'si-baseline': 'info',
  'cui-boundary': 'warning',
  'btc-confirmation': 'warning',
  'rr-question-set': 'success',
  'readiness-posture': 'warning',
  'manual-mission-plan': 'info',
  'proposal': 'warning',
  'tenant-manifest': 'neutral',
  'exclusions-report': 'error',
  'traceability-report': 'success',
  'control-assessment-report': 'info',
  'tech-ref-plan': 'info',
  'infrastructure-manifest': 'success',
  'customer': 'neutral',
  'policy-inputs': 'warning',
};

const TIER_ORDER: Record<string, number> = {
  'customer': 0,
  'si-baseline': 1,
  'cui-boundary': 1.5,
  'btc-confirmation': 1.6,
  'rr-question-set': 2,
  'readiness-posture': 3,
  'manual-mission-plan': 4,
  'proposal': 4,
  'tenant-manifest': 4,
  'exclusions-report': 4,
  'traceability-report': 4,
  'control-assessment-report': 4,
  'tech-ref-plan': 4,
  'infrastructure-manifest': 4,
  'policy-inputs': 1.7,
};

const FORMATTED_DOWNLOAD_TYPES = new Set([
  'manual-mission-plan',
  'proposal',
  'tenant-manifest',
  'exclusions-report',
  'traceability-report',
  'control-assessment-report',
  'tech-ref-plan',
  'infrastructure-manifest',
]);

const INPUT_TYPES = new Set([
  'customer',
  'si-baseline',
  'cui-boundary',
  'btc-confirmation',
  'rr-question-set',
  'readiness-posture',
  'tenant-config-profile',
  'policy-inputs',
]);

export function GeneratedArtifactsPanel({ refreshTrigger }: GeneratedArtifactsPanelProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [managing, setManaging] = useState(false);
  const [newPaths, setNewPaths] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);
  const prevPathsRef = useRef<Set<string>>(new Set());
  const [selectedCustomers, setSelectedCustomers] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirmingDeletePath, setConfirmingDeletePath] = useState<string | null>(null);
  const [confirmingBatchDelete, setConfirmingBatchDelete] = useState(false);
  const [expandedChains, setExpandedChains] = useState<Set<string>>(new Set());

  // Stamper export state — per-customer path map
  const [stamperPaths, setStamperPaths] = useState<Record<string, string>>(() => {
    try {
      const stored = localStorage.getItem(STAMPER_EXPORT_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed;
      }
    } catch { /* ignore parse errors from old single-string format */ }
    return {};
  });
  const getStamperPath = (customerName: string) =>
    stamperPaths[customerName] || STAMPER_BASE_PATH;
  const setStamperPath = (customerName: string, value: string) =>
    setStamperPaths((prev) => ({ ...prev, [customerName]: value }));
  const [savingToStamper, setSavingToStamper] = useState(false);

  // Viewer panel state
  const [openArtifacts, setOpenArtifacts] = useState<Artifact[]>([]);
  const [focusOrder, setFocusOrder] = useState<string[]>([]);
  const BASE_Z = 100;

  const handleOpenViewer = useCallback((artifact: Artifact) => {
    setOpenArtifacts((prev) => {
      if (prev.some((a) => a.path === artifact.path)) return prev;
      return [...prev, artifact];
    });
    setFocusOrder((prev) => [...prev.filter((p) => p !== artifact.path), artifact.path]);
  }, []);

  const handleCloseViewer = useCallback((path: string) => {
    setOpenArtifacts((prev) => prev.filter((a) => a.path !== path));
    setFocusOrder((prev) => prev.filter((p) => p !== path));
  }, []);

  const handleFocusViewer = useCallback((path: string) => {
    setFocusOrder((prev) => [...prev.filter((p) => p !== path), path]);
  }, []);

  const fetchArtifacts = async (detectNew = false) => {
    try {
      const response = await fetch('/api/list-artifacts');
      if (!response.ok) throw new Error('Failed to fetch artifacts');
      const data = await response.json();
      const filtered: Artifact[] = (data.artifacts || []).filter(
        (a: Artifact) => !INPUT_TYPES.has(a.type),
      );

      if (detectNew && prevPathsRef.current.size > 0) {
        const fresh = new Set<string>();
        const freshCustomers = new Set<string>();
        for (const a of filtered) {
          if (!prevPathsRef.current.has(a.path)) {
            fresh.add(a.path);
            freshCustomers.add(a.customerName || 'unknown');
          }
        }
        if (fresh.size > 0) {
          setNewPaths(fresh);
          setExpanded(true);
          // Auto-expand new customer chains in file manager
          setExpandedChains((prev) => {
            const next = new Set(prev);
            for (const cid of freshCustomers) next.add(cid);
            return next;
          });
          // Clear highlight after 4 seconds
          setTimeout(() => setNewPaths(new Set()), 4000);
          // Scroll panel into view
          setTimeout(() => {
            panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 100);
        }
      }

      prevPathsRef.current = new Set(filtered.map((a) => a.path));
      setArtifacts(filtered);
      setError(null);
    } catch (err) {
      console.warn('Could not fetch artifacts:', err);
      setError('Artifact management not available');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArtifacts();
  }, []);

  // Re-fetch when refreshTrigger changes (after generation)
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      fetchArtifacts(true);
    }
  }, [refreshTrigger]);

  // Persist stamper paths to localStorage
  useEffect(() => {
    localStorage.setItem(STAMPER_EXPORT_KEY, JSON.stringify(stamperPaths));
  }, [stamperPaths]);

  // Chain grouping: group by customerId, sort within by tier
  const chains = useMemo<CustomerChain[]>(() => {
    const byCustomer = new Map<string, Artifact[]>();
    for (const a of artifacts) {
      const name = a.customerName || 'unknown';
      const list = byCustomer.get(name) || [];
      list.push(a);
      byCustomer.set(name, list);
    }
    return Array.from(byCustomer.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([customerName, arts]) => ({
        customerName,
        artifacts: arts.sort(
          (a, b) => (TIER_ORDER[a.type] ?? 99) - (TIER_ORDER[b.type] ?? 99),
        ),
        totalSize: arts.reduce((sum, a) => sum + a.size, 0),
      }));
  }, [artifacts]);

  const toggleChain = (customerName: string) => {
    setExpandedChains((prev) => {
      const next = new Set(prev);
      if (next.has(customerName)) next.delete(customerName);
      else next.add(customerName);
      return next;
    });
  };

  const toggleCustomer = (customerName: string) => {
    setSelectedCustomers((prev) => {
      const next = new Set(prev);
      if (next.has(customerName)) next.delete(customerName);
      else next.add(customerName);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedCustomers.size === chains.length) {
      setSelectedCustomers(new Set());
    } else {
      setSelectedCustomers(new Set(chains.map((c) => c.customerName)));
    }
  };

  const executeDeleteSelected = async () => {
    if (selectedCustomers.size === 0) return;

    const toDelete = artifacts.filter(
      (a) => selectedCustomers.has(a.customerName || 'unknown') && !INPUT_TYPES.has(a.type),
    );

    setDeleting(true);
    try {
      for (const artifact of toDelete) {
        const response = await fetch('/api/delete-artifact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: artifact.path }),
        });
        if (!response.ok) throw new Error(`Failed to delete ${artifact.filename}`);
      }
      setSelectedCustomers(new Set());
      setConfirmingBatchDelete(false);
      await fetchArtifacts();
    } catch {
      setConfirmingBatchDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const executeDeleteSingle = async (artifact: Artifact) => {
    try {
      const response = await fetch('/api/delete-artifact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: artifact.path }),
      });
      if (!response.ok) throw new Error('Failed to delete');
      setConfirmingDeletePath(null);
      fetchArtifacts();
    } catch {
      setConfirmingDeletePath(null);
    }
  };

  const handleSaveAs = async (artifact: Artifact) => {
    try {
      const response = await fetch(
        `/api/download-artifact?path=${encodeURIComponent(artifact.path)}`,
      );
      if (!response.ok) throw new Error('Failed to fetch');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = artifact.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(
        `/api/download-artifact?path=${encodeURIComponent(artifact.path)}`,
        '_blank',
      );
    }
  };

  const handleDownload = async (artifact: Artifact) => {
    if (FORMATTED_DOWNLOAD_TYPES.has(artifact.type)) {
      try {
        const response = await fetch(
          `/api/download-artifact?path=${encodeURIComponent(artifact.path)}`,
        );
        if (!response.ok) throw new Error('Failed to fetch');
        const json = await response.json();

        // Exclusions report downloads as formatted text
        if (artifact.type === 'exclusions-report') {
          const text = formatExclusionsReportAsText(json);
          const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = artifact.filename.replace(/\.json$/, '.txt');
          a.click();
          URL.revokeObjectURL(url);
          return;
        }

        // Traceability report downloads as styled HTML
        if (artifact.type === 'traceability-report') {
          const html = formatTraceabilityReportAsHTML(json);
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = artifact.filename.replace(/\.json$/, '.html');
          a.click();
          URL.revokeObjectURL(url);
          return;
        }

        // Control assessment report downloads as styled HTML
        if (artifact.type === 'control-assessment-report') {
          const { formatControlAssessmentReportAsHTML } = await import(
            '@/features/mpt/services/controlAssessmentReportGenerator'
          );
          const html = formatControlAssessmentReportAsHTML(json);
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = artifact.filename.replace(/\.json$/, '.html');
          a.click();
          URL.revokeObjectURL(url);
          return;
        }

        // Tech Ref Guide downloads as styled HTML
        if (artifact.type === 'tech-ref-plan') {
          const { formatTechRefPlanAsHTML } = await import('@/shared/utils/exportTechRefPlan');
          const html = formatTechRefPlanAsHTML(json);
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = artifact.filename.replace(/\.json$/, '.html');
          a.click();
          URL.revokeObjectURL(url);
          return;
        }

        // Manual plans download as styled HTML
        if (artifact.type === 'manual-mission-plan') {
          const html = formatPlanAsHTML(json);
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = artifact.filename.replace(/\.json$/, '.html');
          a.click();
          URL.revokeObjectURL(url);
          return;
        }

        // Tenant manifest downloads as styled HTML
        if (artifact.type === 'tenant-manifest') {
          const html = formatManifestAsHTML(json);
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = artifact.filename.replace(/\.json$/, '.html');
          a.click();
          URL.revokeObjectURL(url);
          return;
        }

        // Proposal falls back to text
        const text = formatPlanAsText({ proposal: json });
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = artifact.filename.replace(/\.json$/, '.txt');
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        // Fallback to raw download
        window.open(
          `/api/download-artifact?path=${encodeURIComponent(artifact.path)}`,
          '_blank',
        );
      }
      return;
    }
    // Non-plan types: save as raw JSON
    handleSaveAs(artifact);
  };

  const getStamperBundle = (customerName: string) => {
    const customerArtifacts = artifacts.filter((a) => a.customerName === customerName);
    const mp = customerArtifacts.find((a) => a.type === 'manual-mission-plan') || null;
    const tm = customerArtifacts.find((a) => a.type === 'tenant-manifest') || null;
    const im = customerArtifacts.find((a) => a.type === 'infrastructure-manifest') || null;
    return { mp, tm, im, isComplete: mp !== null && tm !== null };
  };

  const handleSaveToStamper = async (customerName: string) => {
    const bundle = getStamperBundle(customerName);
    if (!bundle.isComplete) {
      alert('Cannot export to Stamper: Mission Plan and Tenant Manifest are both required.');
      return;
    }

    const artifactList: Array<{ type: string; path: string }> = [];
    if (bundle.mp) artifactList.push({ type: bundle.mp.type, path: bundle.mp.path });
    if (bundle.tm) artifactList.push({ type: bundle.tm.type, path: bundle.tm.path });
    if (bundle.im) artifactList.push({ type: bundle.im.type, path: bundle.im.path });

    setSavingToStamper(true);
    try {
      const response = await fetch('/api/save-to-stamper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifacts: artifactList, targetDir: getStamperPath(customerName) }),
      });

      if (!response.ok) {
        const err = await response.json();
        alert(`Stamper export failed: ${err.error || 'Unknown error'}`);
        return;
      }

      await response.json();
      await fetchArtifacts();
    } catch (err) {
      alert(`Stamper export failed: ${String(err)}`);
    } finally {
      setSavingToStamper(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const tierIndent = (type: string) => {
    const tier = TIER_ORDER[type] ?? 0;
    if (tier <= 1) return '';
    if (tier === 2) return 'ml-4';
    if (tier === 3) return 'ml-8';
    return 'ml-12';
  };

  const renderArtifactRow = (artifact: Artifact, showChainLine: boolean) => {
    const indent = tierIndent(artifact.type);
    const tier = TIER_ORDER[artifact.type] ?? 0;
    const isNew = newPaths.has(artifact.path);

    return (
      <div
        key={artifact.path}
        className={`flex items-center justify-between p-2 rounded border cursor-pointer ${indent} ${
          isNew
            ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-200 animate-pulse'
            : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
        }`}
        onClick={() => handleOpenViewer(artifact)}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {showChainLine && tier > 1 && (
            <span className="text-gray-300 text-xs select-none">&#x2514;</span>
          )}
          <Badge variant={TYPE_COLORS[artifact.type] || 'neutral'}>
            {TYPE_LABELS[artifact.type] || artifact.type}
          </Badge>
          {artifact.cesId && (
            <span className="text-xs font-mono text-gray-500" title="CES ID">
              {artifact.cesId}
            </span>
          )}
          <span className="text-sm text-gray-700 truncate" title={artifact.filename}>
            {artifact.filename}
          </span>
          <span className="text-xs text-gray-400 whitespace-nowrap">
            {formatSize(artifact.size)}
          </span>
        </div>
        <div className="flex items-center gap-1 ml-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => handleSaveAs(artifact)}
            className="p-1 text-green-600 hover:bg-green-100 rounded"
            title="Save As"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
              />
            </svg>
          </button>
          <button
            onClick={() => handleDownload(artifact)}
            className="p-1 text-blue-600 hover:bg-blue-100 rounded"
            title="Download (formatted)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
          </button>
          {!INPUT_TYPES.has(artifact.type) &&
            (confirmingDeletePath === artifact.path ? (
              <>
                <button
                  onClick={() => setConfirmingDeletePath(null)}
                  className="px-2 py-0.5 text-xs font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 rounded"
                >
                  Cancel
                </button>
                <button
                  onClick={() => executeDeleteSingle(artifact)}
                  className="px-2 py-0.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded"
                >
                  Confirm
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmingDeletePath(artifact.path)}
                className="p-1 text-red-600 hover:bg-red-100 rounded"
                title="Delete"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            ))}
        </div>
      </div>
    );
  };

  if (error) {
    return null;
  }

  if (loading) {
    return (
      <Card title="Generated Artifacts">
        <p className="text-sm text-gray-500">Loading...</p>
      </Card>
    );
  }

  if (artifacts.length === 0) {
    return (
      <Card title="Generated Artifacts">
        <p className="text-sm text-gray-500">
          No generated artifacts yet. Complete workflow steps to see artifacts here.
        </p>
      </Card>
    );
  }

  if (managing) {
    return (
      <div ref={panelRef}>
      <Card
        title={`File Manager (${chains.length} chain${chains.length !== 1 ? 's' : ''})`}
        headerAction={
          <button
            onClick={() => {
              setManaging(false);
              setSelectedCustomers(new Set());
            }}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
          >
            Done
          </button>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={selectedCustomers.size === chains.length && chains.length > 0}
                onChange={toggleAll}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              Select all
            </label>
            {selectedCustomers.size > 0 &&
              (confirmingBatchDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-600 font-medium">
                    Delete {selectedCustomers.size} chain
                    {selectedCustomers.size !== 1 ? 's' : ''}?
                  </span>
                  <button
                    onClick={() => setConfirmingBatchDelete(false)}
                    className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 rounded-md"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={executeDeleteSelected}
                    disabled={deleting}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-red-300 rounded-md"
                  >
                    {deleting ? 'Deleting...' : 'Confirm'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmingBatchDelete(true)}
                  className="px-3 py-1.5 text-sm font-medium border border-red-300 text-red-700 hover:bg-red-50 rounded-md"
                >
                  Delete {selectedCustomers.size} chain
                  {selectedCustomers.size !== 1 ? 's' : ''}
                </button>
              ))}
          </div>

          {chains.map((chain) => {
            const bundle = getStamperBundle(chain.customerName);
            return (
            <div
              key={chain.customerName}
              className={`rounded-lg border ${
                selectedCustomers.has(chain.customerName)
                  ? 'border-red-300 bg-red-50'
                  : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-3 p-3">
                <input
                  type="checkbox"
                  checked={selectedCustomers.has(chain.customerName)}
                  onChange={() => toggleCustomer(chain.customerName)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <button
                  onClick={() => toggleChain(chain.customerName)}
                  className="flex-1 flex items-center justify-between text-left"
                >
                  <span className="text-sm font-medium text-gray-900">
                    {chain.customerName}
                  </span>
                  <span className="text-xs text-gray-500">
                    {chain.artifacts.length} file{chain.artifacts.length !== 1 ? 's' : ''} &middot;{' '}
                    {formatSize(chain.totalSize)}
                    <span className="ml-2">
                      {expandedChains.has(chain.customerName) ? '\u25B2' : '\u25BC'}
                    </span>
                  </span>
                </button>
              </div>
              {bundle.isComplete && (
                <div className="px-3 pb-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500 whitespace-nowrap">Stamper dir:</label>
                    <input
                      type="text"
                      value={getStamperPath(chain.customerName)}
                      onChange={(e) => setStamperPath(chain.customerName, e.target.value)}
                      className="flex-1 text-xs font-mono px-2 py-1 border border-gray-300 rounded bg-gray-50"
                      placeholder="../stamper/plan-data/tenant-slug"
                    />
                  </div>
                  <button
                    onClick={() => handleSaveToStamper(chain.customerName)}
                    disabled={savingToStamper}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded-md"
                  >
                    {savingToStamper
                      ? 'Saving...'
                      : bundle.im
                        ? 'Save MP + TM + IM to Stamper'
                        : 'Save MP + TM to Stamper'}
                  </button>
                </div>
              )}
              {expandedChains.has(chain.customerName) && (() => {
                const inputs = chain.artifacts.filter((a) => INPUT_TYPES.has(a.type));
                const outputs = chain.artifacts.filter((a) => !INPUT_TYPES.has(a.type));
                const showLabels = inputs.length > 0 && outputs.length > 0;
                return (
                  <div className="px-3 pb-3 space-y-1">
                    {showLabels && (
                      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider pt-1">
                        Inputs
                      </div>
                    )}
                    {inputs.map((a) => renderArtifactRow(a, true))}
                    {showLabels && (
                      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider pt-2">
                        Outputs
                      </div>
                    )}
                    {outputs.map((a) => renderArtifactRow(a, true))}
                  </div>
                );
              })()}
              {!expandedChains.has(chain.customerName) && (
                <div className="flex flex-wrap gap-1 px-3 pb-3">
                  {chain.artifacts.map((a) => (
                    <Badge key={a.path} variant={TYPE_COLORS[a.type] || 'neutral'}>
                      {TYPE_LABELS[a.type] || a.type}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            );
          })}
        </div>
      </Card>
      </div>
    );
  }

  const displayedArtifacts = expanded ? artifacts : artifacts.slice(0, 5);

  return (
    <div ref={panelRef}>
    <Card
      title={`Generated Artifacts (${artifacts.length})`}
      headerAction={
        <button
          onClick={() => setManaging(true)}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
        >
          File Manager
        </button>
      }
    >
      <div className="space-y-2">
        {displayedArtifacts.map((artifact) => renderArtifactRow(artifact, false))}

        {artifacts.length > 5 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full py-2 text-sm text-blue-600 hover:text-blue-800"
          >
            {expanded ? 'Show less' : `Show ${artifacts.length - 5} more...`}
          </button>
        )}

        <div className="pt-2 border-t border-gray-200">
          <button
            onClick={() => fetchArtifacts()}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Refresh list
          </button>
        </div>
      </div>

      {openArtifacts.map((a, i) => (
        <ArtifactViewerPanel
          key={a.path}
          artifact={a}
          index={i}
          zIndex={BASE_Z + focusOrder.indexOf(a.path)}
          onClose={handleCloseViewer}
          onFocus={handleFocusViewer}
        />
      ))}
    </Card>
    </div>
  );
}
