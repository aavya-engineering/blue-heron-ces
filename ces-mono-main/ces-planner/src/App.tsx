// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './shared/components/Layout/AppShell';
import { LandingPage } from './features/landing/components/LandingPage';
import { SITPage } from './features/sit/components/SITPage';
import { CUIPage } from './features/cui/components/CUIPage';
import { BTCPage } from './features/btc/components/BTCPage';
import { TCPPage } from './features/tcp/components/TCPPage';
import { PolicyInputsPage } from './features/policy/components/PolicyInputsPage';
import { RRTPage } from './features/rrt/components/RRTPage';
import { CostEstimatorPage } from './features/cost-estimator/components/CostEstimatorPage';

import { useAppStore } from './shared/stores/appStore';
import { schemaLoader } from './shared/services/schemaLoader';
import { validationService } from './shared/validation/validators';
import { Alert } from './shared/components/Display/Alert';

function App() {
  const { currentCustomerId, initialized, setInitialized } = useAppStore();
  const [initError, setInitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function initialize() {
      try {
        console.log('Initializing app...');
        await schemaLoader.loadAllSchemas();
        await validationService.initialize();
        setInitialized(true);
        console.log('App initialized successfully');
      } catch (error) {
        console.error('Initialization error:', error);
        setInitError(error instanceof Error ? error.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    if (!initialized) {
      initialize();
    } else {
      setLoading(false);
    }
  }, [initialized, setInitialized]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mb-4"></div>
          <p className="text-lg text-gray-600">Initializing CES...</p>
          <p className="text-sm text-gray-500 mt-2">Loading schemas and validating data</p>
        </div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-lg w-full">
          <Alert variant="error" title="Initialization Error">
            <p className="mb-2">Failed to initialize the application:</p>
            <pre className="text-xs bg-red-100 p-2 rounded overflow-auto">{initError}</pre>
            <p className="mt-2">
              Please ensure all schema and data files are properly loaded in the public directory.
            </p>
          </Alert>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<LandingPage />} />
          <Route
            path="/sit"
            element={currentCustomerId ? <SITPage /> : <Navigate to="/dashboard" replace />}
          />
          <Route
            path="/tcp"
            element={currentCustomerId ? <TCPPage /> : <Navigate to="/dashboard" replace />}
          />
          <Route
            path="/cui"
            element={currentCustomerId ? <CUIPage /> : <Navigate to="/dashboard" replace />}
          />
          <Route
            path="/btc"
            element={currentCustomerId ? <BTCPage /> : <Navigate to="/dashboard" replace />}
          />
          <Route
            path="/policy-inputs"
            element={
              currentCustomerId ? <PolicyInputsPage /> : <Navigate to="/dashboard" replace />
            }
          />
          <Route
            path="/rrt"
            element={currentCustomerId ? <RRTPage /> : <Navigate to="/dashboard" replace />}
          />
          <Route path="/cost-estimator" element={<CostEstimatorPage />} />

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}

export default App;
