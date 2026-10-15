// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState, useRef, useEffect } from 'react';
import {
  useCUIQuestionBank,
  useBTCQuestionBank,
  useBTCActivationPackage,
  useRRQuestionBank,
} from '@/shared/hooks/useDataLoader';

export function DataVersionsPopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: cuiBank } = useCUIQuestionBank();
  const { data: btcBank } = useBTCQuestionBank();
  const { data: activationPkg } = useBTCActivationPackage();
  const { data: rrBank } = useRRQuestionBank();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const cuiVersion = cuiBank?.schema_version || cuiBank?.version || 'N/A';
  const btcVersion = btcBank?.schema_version || btcBank?.version || 'N/A';
  const activationVersion = activationPkg?.schema_version || activationPkg?.version || 'N/A';
  const rrVersion = rrBank?.metadata?.version || 'N/A';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="px-2 py-1 text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
        title="Data bank versions"
      >
        Banks
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Data Bank Versions
          </h3>
          <div className="space-y-1.5 text-sm">
            <VersionRow label="RR Question Bank" version={rrVersion} />
            <VersionRow label="CUI Question Bank" version={cuiVersion} />
            <VersionRow label="BTC Question Bank" version={btcVersion} />
            <VersionRow label="BTC Activation Pkg" version={activationVersion} />
          </div>
        </div>
      )}
    </div>
  );
}

function VersionRow({ label, version }: { label: string; version: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-600">{label}</span>
      <span className="text-xs font-mono text-gray-400">{version}</span>
    </div>
  );
}
