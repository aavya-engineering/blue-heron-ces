// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_CONFIG } from '../../config';
import { useAppStore } from '../../stores/appStore';
import { CMMCViewerModal } from '../../../features/landing/components/CMMCViewerModal';
import { DataVersionsPopover } from './DataVersionsPopover';

export function Navigation() {
  const navigate = useNavigate();
  const [showCMMCViewer, setShowCMMCViewer] = useState(false);
  const { currentCustomerId, reset } = useAppStore();

  const handleChangeCustomer = () => {
    reset();
    navigate('/dashboard');
  };

  return (
    <>
    {/* ComplianceOne navigation: primary-navy bar, flat, sharp corners. */}
    <nav className="bg-primary-600 border-b-[1.5px] border-primary-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <img src="/ces-logo.svg" alt="CES" className="h-6 w-auto" />
            <h1 className="font-serif text-xl font-bold text-white">{APP_CONFIG.APP_NAME}</h1>
            {APP_CONFIG.DEV_MODE && (
              <span className="ml-3 px-2 py-1 text-xs font-medium bg-[#fef3c7] text-[#d97706]">
                DEV MODE
              </span>
            )}
          </div>
          <div className="flex items-center flex-wrap gap-2 sm:gap-4">
            <button
              onClick={() => setShowCMMCViewer(true)}
              className="px-3 py-1.5 text-sm font-semibold text-primary-700 bg-white hover:bg-slate-100 transition-colors"
            >
              CMMC VIEWER
            </button>
            {currentCustomerId && (
              <button
                onClick={handleChangeCustomer}
                className="text-sm text-white/80 hover:text-white"
              >
                Change Customer
              </button>
            )}
            <DataVersionsPopover />
            <span className="text-sm text-white/70">v{APP_CONFIG.VERSION}</span>
          </div>
        </div>
      </div>
    </nav>
    <CMMCViewerModal open={showCMMCViewer} onClose={() => setShowCMMCViewer(false)} />
  </>
  );
}
