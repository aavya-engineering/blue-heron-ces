// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

import { useState, useEffect, useCallback } from 'react';
import { TimingProvider } from '@/features/timer/TimingContext';
import TimerBar from '@/features/timer/TimerBar';
import AssessmentPage from '@/features/assessment/AssessmentPage';
import ResultScreen from '@/features/scoring/ResultScreen';
import StaticRollup from '@/features/rollup/StaticRollup';
import QuickSession from '@/features/quick/QuickSession';
import ContractsPage from '@/features/contracts/ContractsPage';
import ShellNav from '@/features/app/ShellNav';
import DiscoveryOffer from '@/features/discovery/DiscoveryOffer';
import DiscoverySubTab from '@/features/discovery/DiscoverySubTab';
import BoundaryConfirmPanel from '@/features/discovery/BoundaryConfirmPanel';
import type { DiscoveryResult } from '@/__fixtures__/discoveryResults';
import { runDiscoveryOnApi } from '@/features/discovery/discoveryRunService';
import { runSimHarvest } from '@/features/assessment/harvestRunService';
import ReadinessTab from '@/features/readiness/ReadinessTab';
import PlanTab from '@/features/plan/PlanTab';
import { executeExportAndDownload } from '@/features/export/exportPipeline';
import { db } from '@/shared/db/schema';
import type { EngagementKind, InterviewFact } from '@/shared/types/engagement';
import type { ReadinessConsent } from '@/shared/types/readinessResult';

type View =
  | 'assessment'
  | 'result'
  | 'rollup'
  | 'quick-session'
  | 'contracts'
  | 'help'
  | 'discovery'
  | 'readiness'
  | 'plan';

interface AppState {
  view: View;
  engagementId: string | null;
  engagementKind: EngagementKind | null;
  /** In-progress session the assessment view should resume. */
  sessionId: string | null;
  /** Completed session shown by the result view. */
  completedSessionId: string | null;
  /** Current party ID, set after Begin Interview; used by ContractsPage. */
  partyId: string | null;
}

const APP_VERSION = 'v2.2.3';

// Theme toggle — same contract as the shared ces-theme-toggle.js
// (localStorage key "ces-theme", data-theme="dark" attribute on <html>).
// document/localStorage access is guarded so MusterNav stays renderable
// via renderToStaticMarkup in node-env unit tests (DW#3b).
function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'light'
  );

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    if (next === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem('ces-theme', next);
    setTheme(next);
  };

  return (
    <button
      id="ces-theme-toggle"
      onClick={toggle}
      aria-label="Toggle light/dark theme"
      title="Toggle light/dark theme"
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}

// Exported for narrow component testing (DW#3b)
export function MusterNav({
  kind,
  onNavigate,
}: {
  kind: EngagementKind | null;
  onNavigate: (v: View) => void;
}) {
  return (
    <header className="ces-header">
      <button
        className="header-brand"
        onClick={() => onNavigate('assessment')}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        <img src="/ces-logo.svg" alt="" className="header-logo" />
        <span>CES Muster</span>
        <span className="header-company">Blue Heron Defense — Muster</span>
      </button>
      <div className="header-controls">
        <button
          className="header-nav-btn"
          data-testid="quick-session-nav"
          onClick={() => onNavigate('quick-session')}
        >
          Quick Session
        </button>
        {/* Contracts button appears for BOTH engagement kinds */}
        <button
          className="header-nav-btn"
          data-testid="contracts-nav"
          onClick={() => onNavigate('contracts')}
        >
          Contracts
        </button>
        {kind === 'prime_and_subs' && (
          <button
            className="header-nav-btn"
            data-testid="rollup-nav"
            onClick={() => onNavigate('rollup')}
          >
            Rollup
          </button>
        )}
        <span className="header-version">{APP_VERSION}</span>
        <ThemeToggle />
      </div>
    </header>
  );
}

export default function App() {
  const [state, setState] = useState<AppState>({
    view: 'assessment',
    engagementId: null,
    engagementKind: null,
    sessionId: null,
    completedSessionId: null,
    partyId: null,
  });

  // Discovery branch sub-step: 'offer' (pros/cons + Run/Skip), 'running'
  // (sub-tab), or 'confirm' (GO-2 M1 boundary confirm/correct — rung 1's
  // "correction, not creation" step between the run and the interview).
  // 'Skip to Manual' navigates straight to the assessment view (M5 parity) and
  // never sets this to 'running'.
  const [discoveryStep, setDiscoveryStep] = useState<'offer' | 'running' | 'confirm'>('offer');
  // GO-2 M3: the results feeding the confirm step — the canned fixture for a
  // "run", or a parsed script-upload results file (import-file mode; one
  // mechanism, one downstream path).
  // W4-MU2 (MU-02): a "run" is now the REAL sim executor via muster-api
  // (discoveryRunService) — no canned rows; empty until a run or import lands.
  const [discoveryResults, setDiscoveryResults] = useState<DiscoveryResult[]>([]);
  const [discoveryRunBusy, setDiscoveryRunBusy] = useState(false);
  const [discoveryRunError, setDiscoveryRunError] = useState('');
  // W4-MU2 (MU-06): Graph harvest prefill (sim).
  const [harvestBusy, setHarvestBusy] = useState(false);
  const [harvestError, setHarvestError] = useState('');
  // PLAN-2 M1: facts[] carried by an imported readiness-result payload.
  const [payloadFacts, setPayloadFacts] = useState<InterviewFact[]>([]);
  // FC-MU-3: live consents from an imported / API-run readiness record.
  const [payloadConsents, setPayloadConsents] = useState<ReadinessConsent[]>([]);

  // On mount, detect any in-progress session and resume from where the user left off.
  useEffect(() => {
    const checkResume = async () => {
      const session = await db.interview_sessions
        .where('status')
        .equals('in_progress')
        .first();
      if (!session) return;
      const party = await db.assessed_parties.get(session.party_id);
      if (!party) return;
      const engagement = await db.engagements.get(party.engagement_id);
      if (!engagement) return;
      setState({
        view: 'assessment',
        engagementId: engagement.id,
        engagementKind: engagement.engagement_kind,
        sessionId: session.id,
        completedSessionId: null,
        partyId: party.id,
      });
    };
    void checkResume();
  }, []);

  const navigate = (view: View) => setState((prev) => ({ ...prev, view }));

  const handleEngagementReady = useCallback(
    (kind: EngagementKind, engagementId: string, partyId: string) => {
      // C2: thread the real party_id so ContractsPage attaches new contracts to
      // the party even mid-new-session (previously null until a resume).
      setState((prev) => ({ ...prev, engagementKind: kind, engagementId, partyId }));
    },
    []
  );

  const handleInterviewComplete = (sessionId: string) => {
    setState((prev) => ({ ...prev, view: 'result', completedSessionId: sessionId, sessionId: null }));
  };

  const handleExport = async () => {
    if (!state.completedSessionId) return;
    await executeExportAndDownload(state.completedSessionId);
  };

  return (
    <TimingProvider>
      <ShellNav onNavigate={navigate} planEnabled={!!state.completedSessionId} />
      <MusterNav kind={state.engagementKind} onNavigate={navigate} />

      <main style={{ minHeight: 'calc(100vh - 96px)' }}>
        {state.view === 'result' && (
          <div style={{ maxWidth: 800, margin: '0 auto', padding: '1rem' }}>
            <TimerBar />
          </div>
        )}

        {state.view === 'assessment' && (
          <AssessmentPage
            key={state.sessionId ?? 'fresh'}
            existingSessionId={state.sessionId ?? undefined}
            onEngagementReady={handleEngagementReady}
            onComplete={handleInterviewComplete}
          />
        )}

        {state.view === 'result' && state.completedSessionId && (
          <ResultScreen sessionId={state.completedSessionId} onExport={handleExport} />
        )}

        {state.view === 'rollup' && state.engagementKind === 'prime_and_subs' && (
          <section data-testid="roster-section">
            <StaticRollup />
          </section>
        )}

        {state.view === 'quick-session' && <QuickSession />}

        {state.view === 'contracts' && (
          <ContractsPage
            engagementKind={state.engagementKind}
            partyId={state.partyId}
          />
        )}

        {state.view === 'help' && (
          <div className="page" data-testid="help-view">
            <div className="ces-titleblock" style={{ marginBottom: 16 }}>
              <span className="tb-title">Help</span>
            </div>
            <p>
              Muster walks you through a discovery-first CMMC readiness assessment.
              Start on Situation to declare the engagement, use Discovery to
              auto-resolve objective coverage, then review your Readiness posture.
            </p>
          </div>
        )}

        {state.view === 'discovery' && discoveryStep === 'offer' && (
          <DiscoveryOffer
            runBusy={discoveryRunBusy}
            runError={discoveryRunError}
            harvestBusy={harvestBusy}
            harvestError={harvestError}
            onHarvestFromTenant={() => {
              setHarvestBusy(true);
              setHarvestError('');
              void runSimHarvest().then((o) => {
                setHarvestBusy(false);
                if (!o.ok) {
                  setHarvestError(o.message);
                  return;
                }
                // The store is written; the interview's mount-time prefill
                // reads it (AUTO-DETECTED answers, existing answers win).
                navigate('assessment');
              });
            }}
            onRunDiscovery={() => {
              setDiscoveryRunBusy(true);
              setDiscoveryRunError('');
              void runDiscoveryOnApi().then((o) => {
                setDiscoveryRunBusy(false);
                if (!o.ok) {
                  setDiscoveryRunError(o.message);
                  return;
                }
                setDiscoveryResults(o.results);
                setPayloadFacts(o.facts);
                setPayloadConsents(o.consents);
                setDiscoveryStep('running');
              });
            }}
            onSkip={() => navigate('assessment')}
            onImportResults={(results, importedFacts, importedConsents) => {
              setDiscoveryResults(results);
              setPayloadFacts(importedFacts ?? []);
              setPayloadConsents(importedConsents ?? []);
              setDiscoveryStep('confirm');
            }}
          />
        )}

        {state.view === 'discovery' && discoveryStep === 'running' && (
          <DiscoverySubTab results={discoveryResults} onContinue={() => setDiscoveryStep('confirm')} />
        )}

        {state.view === 'discovery' && discoveryStep === 'confirm' && (
          <BoundaryConfirmPanel
            results={discoveryResults}
            payloadFacts={payloadFacts}
            payloadConsents={payloadConsents}
            onContinue={() => navigate('assessment')}
          />
        )}

        {state.view === 'readiness' && (
          <ReadinessTab completedSessionId={state.completedSessionId} />
        )}

        {state.view === 'plan' && (
          <PlanTab completedSessionId={state.completedSessionId} />
        )}
      </main>

      <footer className="ces-footer">
        CES Muster {APP_VERSION} · Compliance Execution System · Blue Heron Defense
      </footer>
    </TimingProvider>
  );
}
