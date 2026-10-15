// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState, useCallback, useMemo } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { Badge } from '@/shared/components/Display/Badge';
import { useCMMCRequirements } from '@/shared/hooks/useDataLoader';
import { RequirementDetailsPanel } from '@/features/rrt/components/RequirementDetailsModal';

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

const LEVEL_COLORS: Record<string, string> = {
  L1: 'bg-green-100 text-green-800',
  L2: 'bg-amber-100 text-amber-800',
  L3: 'bg-red-100 text-red-800',
};

interface CMMCViewerModalProps {
  open: boolean;
  onClose: () => void;
}

export function CMMCViewerModal({ open, onClose }: CMMCViewerModalProps) {
  const { data, loading, error } = useCMMCRequirements();
  const [selectedDomain, setSelectedDomain] = useState('');
  const [search, setSearch] = useState('');
  const [openPanels, setOpenPanels] = useState<string[]>([]);
  const [focusOrder, setFocusOrder] = useState<string[]>([]);
  const BASE_Z = 100;

  const requirements = useMemo(() => {
    if (!data) return [];
    return data.ces?.requirements || data.requirements || [];
  }, [data]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return requirements.filter((r) => {
      if (selectedDomain && r.domain !== selectedDomain) return false;
      if (
        term &&
        !r.requirement_id.toLowerCase().includes(term) &&
        !r.title.toLowerCase().includes(term) &&
        !r.requirement_text.toLowerCase().includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [requirements, selectedDomain, search]);

  const handleOpenPanel = useCallback((reqId: string) => {
    setOpenPanels((prev) => (prev.includes(reqId) ? prev : [...prev, reqId]));
    setFocusOrder((prev) => [...prev.filter((id) => id !== reqId), reqId]);
  }, []);

  const handleClosePanel = useCallback((reqId: string) => {
    setOpenPanels((prev) => prev.filter((id) => id !== reqId));
    setFocusOrder((prev) => prev.filter((id) => id !== reqId));
  }, []);

  const handleFocusPanel = useCallback((reqId: string) => {
    setFocusOrder((prev) => [...prev.filter((id) => id !== reqId), reqId]);
  }, []);

  const handleClose = useCallback(() => {
    setOpenPanels([]);
    setFocusOrder([]);
    onClose();
  }, [onClose]);

  return (
    <Dialog open={open} onClose={handleClose} className="relative z-40">
      <DialogBackdrop className="fixed inset-0 bg-black/30" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-4xl bg-white rounded-xl shadow-xl flex flex-col max-h-[85vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <DialogTitle className="text-lg font-semibold text-gray-900">
              CMMC Requirements Library
            </DialogTitle>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              &times;
            </button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-100 bg-gray-50">
            <select
              value={selectedDomain}
              onChange={(e) => setSelectedDomain(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="">All Domains</option>
              {Object.entries(DOMAIN_NAMES).map(([code, name]) => (
                <option key={code} value={code}>
                  {code} — {name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search requirements..."
              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
            <span className="text-xs text-gray-500 whitespace-nowrap">
              {filtered.length} of {requirements.length}
            </span>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
                <span className="ml-3 text-sm text-gray-500">Loading requirements...</span>
              </div>
            )}

            {error && (
              <div className="px-6 py-8 text-center">
                <p className="text-sm text-red-600">Failed to load requirements: {error.message}</p>
              </div>
            )}

            {!loading && !error && filtered.length === 0 && (
              <div className="px-6 py-8 text-center">
                <p className="text-sm text-gray-500">No requirements match your filters.</p>
              </div>
            )}

            {!loading && !error && filtered.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {filtered.map((req) => (
                  <li key={req.requirement_id}>
                    <button
                      onClick={() => handleOpenPanel(req.requirement_id)}
                      className="w-full text-left px-6 py-3 hover:bg-primary-50 transition-colors flex items-start gap-3"
                    >
                      <span className="flex-shrink-0 font-mono text-sm font-semibold text-gray-900 w-28">
                        {req.requirement_id}
                      </span>
                      <span
                        className={`flex-shrink-0 px-2 py-0.5 text-xs font-bold rounded-none ${LEVEL_COLORS[req.level] || 'bg-gray-100 text-gray-700'}`}
                      >
                        {req.level}
                      </span>
                      <Badge variant="info" size="sm">
                        {req.domain}
                      </Badge>
                      <span className="flex-1 text-sm text-gray-700 truncate">{req.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogPanel>
      </div>

      {/* RDP panels inside Dialog (so clicks don't trigger outside-click close) but outside DialogPanel (so they float independently) */}
      {openPanels.map((reqId, idx) => (
        <RequirementDetailsPanel
          key={reqId}
          requirementId={reqId}
          index={idx}
          zIndex={BASE_Z + focusOrder.indexOf(reqId)}
          onClose={handleClosePanel}
          onFocus={handleFocusPanel}
        />
      ))}
    </Dialog>
  );
}
