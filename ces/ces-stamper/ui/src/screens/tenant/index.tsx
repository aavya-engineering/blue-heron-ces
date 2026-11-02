// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Tenant screen (legacy workflow card 0, index.html L4110-4163; PC-02 and PC-03): tenant select,
// connection gate, dev fixture set, add tenant, preflight, and the console with the Missing
// Prerequisites panel. Ids follow the legacy page and the demo driver's STAMPER_SELECTORS.

import { useEffect, useRef } from 'react';
import { MissingPrerequisites } from 'ces-ui-kit';
import { CARD0_BADGE, DEV_SLUG, tenantOptionLabel, useTenantStore } from '../../store/tenant';
import type { FixtureSet } from '../../store/tenant';
import { CardScreen, ConsolePanel, WorkflowCard } from './shared';
import { changeTenant, saveTenant } from './flow';

const TENANT_JSON_PLACEHOLDER =
  '{"client":{"slug":"myclient","name":"My Client"},"tenant":{"tenant_id":"...","domain":"...","environment":"gcchigh"},"auth":{"app_id":"...","cert_thumbprint":"...","cert_path":"..."}}';

export function PrereqPanel() {
  const prereq = useTenantStore((s) => s.prereq);
  const installModule = useTenantStore((s) => s.installModule);
  const installAll = useTenantStore((s) => s.installAll);
  const importCert = useTenantStore((s) => s.importCert);
  if (!prereq) return null;
  return (
    <div className="prereq-panel">
      <MissingPrerequisites
        modules={prereq.modules}
        certificate={prereq.certificate}
        onInstall={(name) => void installModule(name)}
        onInstallAll={(names) => void installAll(names)}
        onImportCert={(path, password) => void importCert(path, password)}
      />
    </div>
  );
}

function TenantCard() {
  const s = useTenantStore();
  const isDev = s.slug === DEV_SLUG;
  const jsonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (s.addTenantOpen) jsonRef.current?.focus();
  }, [s.addTenantOpen]);

  const stateClass = s.connection !== 'disconnected' ? `tenant-${s.connection}` : '';

  return (
    <WorkflowCard
      index={0}
      title="Tenant"
      titleId="screen-title-tenant"
      badge={CARD0_BADGE}
      collapsed={s.collapsed}
      onToggle={s.toggleCard}
      className={stateClass}
      tooltip="Select tenant configuration and validate connection before starting workflow"
    >
      <label htmlFor="tenantSelect">Select Tenant</label>
      <div className="spa-row">
        <select id="tenantSelect" value={s.slug} onChange={(e) => void changeTenant(e.target.value)}>
          {s.tenants.map((t) => (
            <option key={t.slug} value={t.slug}>
              {tenantOptionLabel(t)}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-secondary btn-small" onClick={s.openAddTenant} title="Add a new tenant config" aria-label="Add a new tenant config">
          +
        </button>
      </div>

      <div id="connectionGateWrap" className="connection-gate" hidden={isDev}>
        <span className="connection-gate-label" id="connectionGateLabel">
          Connection:
        </span>
        <div className="gate-toggle" role="group" aria-labelledby="connectionGateLabel">
          <button
            type="button"
            id="gateDisallowBtn"
            className={`gate-toggle-btn${s.gateAllowed ? '' : ' gate-active-disallow'}`}
            aria-pressed={!s.gateAllowed}
            onClick={() => s.toggleGate(false)}
          >
            Disallow
          </button>
          <button
            type="button"
            id="gateAllowBtn"
            className={`gate-toggle-btn${s.gateAllowed ? ' gate-active-allow' : ''}`}
            aria-pressed={s.gateAllowed}
            onClick={() => s.toggleGate(true)}
          >
            Allow
          </button>
        </div>
        <span
          id="tenantConfigLabel"
          className={`tenant-config-label ${s.connection}`}
          title={s.connectionTitle}
          hidden={s.connection === 'disconnected'}
        >
          {s.slug || ''}
        </span>
      </div>

      <div id="fixtureSetWrap" hidden={!isDev}>
        <label htmlFor="fixtureSet" title="Synthetic: 12 steps, 17 controls — fast dev loop. Full Registry: 14 steps, 119 commands — exercises all engine types.">
          Dev Fixture Set
        </label>
        <select id="fixtureSet" value={s.fixtureSet} onChange={(e) => s.setFixtureSet(e.target.value as FixtureSet)}>
          <option value="full">Full Registry (14 steps, 119 commands)</option>
          <option value="synthetic">Synthetic (12 steps, 17 controls)</option>
        </select>
      </div>

      <div id="addTenantPanel" hidden={!s.addTenantOpen}>
        <label
          htmlFor="tenantJsonInput"
          title="Paste a complete tenant config JSON. Required fields: client.slug, tenant.tenant_id, auth.app_id. Saved to ./plan-data/<slug>/<slug>.json."
        >
          Paste Tenant Config JSON
        </label>
        <textarea
          id="tenantJsonInput"
          ref={jsonRef}
          rows={10}
          value={s.tenantJson}
          placeholder={TENANT_JSON_PLACEHOLDER}
          onChange={(e) => s.setTenantJson(e.target.value)}
        />
        <div className="btn-row">
          <button type="button" className="btn btn-primary btn-small" onClick={() => void saveTenant()}>
            Save Tenant
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={s.closeAddTenant}>
            Cancel
          </button>
        </div>
      </div>

      <div className="btn-row">
        <button type="button" className="btn btn-secondary grow" id="btnPreflight" onClick={s.preflight} disabled={s.preflightRunning}>
          {s.preflightRunning ? 'Checking...' : 'Preflight Permissions'}
        </button>
      </div>
    </WorkflowCard>
  );
}

export default function TenantScreen() {
  return (
    <CardScreen
      screen="tenant"
      titleId="screen-title-tenant"
      card={<TenantCard />}
      console={
        <ConsolePanel>
          <PrereqPanel />
        </ConsolePanel>
      }
    />
  );
}
