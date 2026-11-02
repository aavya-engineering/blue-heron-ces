// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Static gallery of the kit shell. Every name here is fictional (AR6).
import { useState } from 'react';
import { AppShell, StepRail, STAMPER_STEPS, TabNav, TenantBanner, type RailStep, type StepState } from '../src';
import { PanelsGallery } from './PanelsGallery';
import { EditorsGallery } from './EditorsGallery';

const ALL_STATES: readonly StepState[] = ['locked', 'ready', 'running', 'done', 'failed'];

const MID_RUN: readonly RailStep[] = STAMPER_STEPS.map((step, index) => ({
  ...step,
  state: index < 3 ? 'done' : index === 3 ? 'running' : 'locked',
}));

const FAILED_RUN: readonly RailStep[] = STAMPER_STEPS.map((step, index) => ({
  ...step,
  state: index < 4 ? 'done' : index === 4 ? 'failed' : 'locked',
}));

const STATE_ROW: readonly RailStep[] = ALL_STATES.map((state) => ({ id: state, label: state, state }));

const CONSOLE_TABS = [
  { id: 'console', label: 'Console', controls: 'galleryConsolePanel' },
  { id: 'terminal', label: 'Terminal', controls: 'galleryTerminalPanel' },
] as const;

function nextState(state: StepState): StepState {
  return ALL_STATES[(ALL_STATES.indexOf(state) + 1) % ALL_STATES.length];
}

export function Gallery({ logoSrc }: { logoSrc?: string }) {
  const [steps, setSteps] = useState<readonly RailStep[]>(STAMPER_STEPS);
  const [tab, setTab] = useState<string>('console');

  return (
    <AppShell
      product="Stamper"
      version="kit 0.1.0"
      logoSrc={logoSrc}
      rail={<StepRail steps={steps} />}
      banner={<TenantBanner tenant="Ridgeline Machining" kind="GCC High" simulator simulatorProfile="s1-mach" />}
      footer="CES UI kit gallery. Fictional tenants only."
    >
      <section className="gal-section" aria-labelledby="gal-rail">
        <div className="ces-titleblock">
          <h2 id="gal-rail" className="tb-title">Step rail</h2>
          <span className="tb-designator">StepRail</span>
        </div>
        <p className="gal-note">
          The rail above is interactive below: select an unlocked step to move it to its next state.
        </p>
        <StepRail
          steps={steps}
          idPrefix="galleryRail"
          label="Interactive workflow steps"
          onSelect={(id) => setSteps((current) => current.map((s) => (s.id === id ? { ...s, state: nextState(s.state) } : s)))}
        />
        <button type="button" className="btn btn-secondary gal-reset" onClick={() => setSteps(STAMPER_STEPS)}>
          Reset steps
        </button>
        <h3 className="gal-subhead">Mid-run: translate running</h3>
        <StepRail steps={MID_RUN} idPrefix="galleryMid" label="Workflow steps, translate running" />
        <h3 className="gal-subhead">Execute failed</h3>
        <StepRail steps={FAILED_RUN} idPrefix="galleryFailed" label="Workflow steps, execute failed" />
        <h3 className="gal-subhead">Every state</h3>
        <StepRail steps={STATE_ROW} idPrefix="galleryStates" label="Every step state" />
      </section>

      <section className="gal-section" aria-labelledby="gal-tabs">
        <div className="ces-titleblock">
          <h2 id="gal-tabs" className="tb-title">Tabs</h2>
          <span className="tb-designator">TabNav</span>
        </div>
        <div className="gal-console">
          <div className="gal-console-header">
            <TabNav tabs={CONSOLE_TABS} active={tab} onChange={setTab} label="Output" idPrefix="galleryTab-" />
          </div>
          <div
            id="galleryConsolePanel"
            role="tabpanel"
            aria-labelledby="galleryTab-console"
            hidden={tab !== 'console'}
            className="console gal-console-body"
          >
            Connected to Ridgeline Machining (simulated).
          </div>
          <div
            id="galleryTerminalPanel"
            role="tabpanel"
            aria-labelledby="galleryTab-terminal"
            hidden={tab !== 'terminal'}
            className="console gal-console-body"
          >
            PS&gt; Get-OrganizationConfig
          </div>
        </div>
      </section>

      <section className="gal-section" aria-labelledby="gal-banner">
        <div className="ces-titleblock">
          <h2 id="gal-banner" className="tb-title">Tenant banner</h2>
          <span className="tb-designator">TenantBanner</span>
        </div>
        <TenantBanner id="galleryBannerLive" tenant="Larkspur Avionics" kind="Commercial" />
        <TenantBanner id="galleryBannerSim" tenant="Ridgeline Machining" kind="GCC High" simulator simulatorProfile="s1-mach" />
        <TenantBanner id="galleryBannerFixture" tenant="dev" kind="Fixture" simulator />
      </section>

      <PanelsGallery />
      <EditorsGallery />
    </AppShell>
  );
}
