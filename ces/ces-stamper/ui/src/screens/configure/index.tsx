// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Configure screen (legacy workflow card 1, index.html L4166-4249, file picker L12583; PC-04):
// plan paths with hints, browse and cleanup, the Variables / Registry / Scan Variables launchers,
// and Bring to Baseline. Ids follow the legacy page (#configMissionPlanPath, #configManifestPath
// are demo-driver selectors).

import { useEffect } from 'react';
import { useTenantStore } from '../../store/tenant';
import { useTranslateStore } from '../../store/translate';
import {
  CLEANUP_NAMES,
  PATH_FILE_TYPES,
  PATH_INPUT_IDS,
  PATH_TYPES,
  baselineEnabled,
  fileMeta,
  pathHint,
  useConfigureStore,
} from '../../store/configure';
import type { PathType, Posture } from '../../store/configure';
import { CardScreen, ConsolePanel, WorkflowCard } from '../tenant/shared';
import { PrereqPanel } from '../tenant';

const PATH_FIELDS: Readonly<Record<PathType, { label: string; placeholder: string; tip: string; browse: string; cleanupTitle: string }>> = {
  missionPlan: {
    label: 'Mission Plan (JSON)',
    placeholder: 'plan-data/manual-mission-plan-*.json',
    tip: 'JSON file produced by the CES Mission Plan editor. Contains control coverage, vendor blocks, and what-to-do steps.',
    browse: 'Browse Mission Plans',
    cleanupTitle: 'Delete all but most recent Mission Plan',
  },
  manifest: {
    label: 'Tenant Manifest (JSON)',
    placeholder: 'plan-data/tenant-manifest-*.json',
    tip: 'JSON file describing this client tenant: identity values, config intents, and desired state. Provides variables for command templates.',
    browse: 'Browse Tenant Manifests',
    cleanupTitle: 'Delete all but most recent Tenant Manifest',
  },
  infraManifest: {
    label: 'Infrastructure Manifest (optional)',
    placeholder: 'plan-data/infrastructure-manifest-*.json (optional)',
    tip: 'JSON file with infrastructure resource names and variables. Merges infra variables (LAW, Key Vault, Storage, etc.) into the executable plan.',
    browse: 'Browse Infrastructure Manifests',
    cleanupTitle: 'Delete all but most recent Infrastructure Manifest',
  },
};

function PathField({ type }: { type: PathType }) {
  const value = useTranslateStore((s) => s[type]);
  const setPath = useConfigureStore((s) => s.setPath);
  const openFilePicker = useConfigureStore((s) => s.openFilePicker);
  const deleteOldFiles = useConfigureStore((s) => s.deleteOldFiles);
  const id = PATH_INPUT_IDS[type];
  const f = PATH_FIELDS[type];
  return (
    <>
      <label htmlFor={id} title={f.tip}>
        {f.label}
      </label>
      <div className="path-input-row">
        <input type="text" id={id} value={value} title={value} placeholder={f.placeholder} onChange={(e) => setPath(type, e.target.value)} />
        <button type="button" className="btn-browse" onClick={() => void openFilePicker(type)} title={f.browse} aria-label={f.browse}>
          <span aria-hidden="true">📁</span>
        </button>
        <button
          type="button"
          className="btn-cleanup"
          onClick={() => void deleteOldFiles(PATH_FILE_TYPES[type])}
          title={f.cleanupTitle}
          aria-label={`Clean up old ${CLEANUP_NAMES[PATH_FILE_TYPES[type]]}`}
        >
          <span aria-hidden="true">🗑</span>
        </button>
      </div>
      <div className="path-hint" id={`${id}_hint`} title={value}>
        {pathHint(value)}
      </div>
    </>
  );
}

function VariableScanResults() {
  const scan = useConfigureStore((s) => s.scan);
  if (!scan) return null;
  return (
    <div className="var-scan-results" role="region" aria-label="Missing required variables">
      <div className="var-scan-title">
        <strong>Missing Required Variables: {scan.count}</strong>
      </div>
      {scan.missing.map((m) => (
        <div className="var-scan-item" key={m.variable}>
          <div className="var-scan-name">
            {m.variable}
            {m.resolvable ? <span className="var-scan-resolvable"> 🔍 Auto-resolvable</span> : null}
          </div>
          <div className="var-scan-meta">
            Affects: {m.controlCount} control(s), {m.entryCount} registry entry(ies)
          </div>
          <div className="var-scan-meta">
            Controls: {m.controlIds.slice(0, 5).join(', ')}
            {m.controlIds.length > 5 ? ` +${m.controlIds.length - 5} more` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

function FilePicker() {
  const picker = useConfigureStore((s) => s.picker);
  const pickFile = useConfigureStore((s) => s.pickFile);
  const close = useConfigureStore((s) => s.closeFilePicker);

  useEffect(() => {
    if (!picker.open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [picker.open, close]);

  let list;
  if (picker.loading) list = <div className="file-picker-note">Loading...</div>;
  else if (picker.error) list = <div className="file-picker-note error">{picker.error}</div>;
  else if (picker.files.length === 0) list = <div className="file-picker-note">No JSON files in this directory</div>;
  else
    list = picker.files.map((f) => (
      <button type="button" key={f.path} className="file-picker-item" title={f.path} onClick={() => pickFile(f.path)}>
        <span className="fp-name">{f.name}</span>
        <span className="fp-meta">{fileMeta(f)}</span>
      </button>
    ));

  return (
    <div
      className={`file-picker-overlay${picker.open ? ' active' : ''}`}
      id="filePickerOverlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {picker.open ? (
        <div className="file-picker" role="dialog" aria-modal="true" aria-labelledby="filePickerTitle">
          <div className="file-picker-header">
            <span id="filePickerTitle">{picker.title}</span>
            <span id="filePickerDir" title={picker.dir}>
              {picker.dir}
            </span>
            <button type="button" onClick={close} title="Close" aria-label="Close file picker">
              ×
            </button>
          </div>
          <div className="file-picker-list" id="filePickerList">
            {list}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * FIN-15: the cost gate on Bring to Baseline (COST-GATE-SPEC §3.4-§3.5, CG-6). Every recurring
 * resource of the posture is listed off, with its estimate a month. DP-1: type the entry id and opt
 * in (recorded in cost-acks.json). DP-2: for this run, type `<entry id> <monthly cost>`. An item
 * without both is not built.
 */
function BaselineCostPanel() {
  const s = useConfigureStore();
  const slug = useTenantStore((t) => t.slug);
  const { posture, loadBaselineCost } = s;
  useEffect(() => {
    if (posture !== 'm365_only' && slug) void loadBaselineCost();
  }, [posture, slug, loadBaselineCost]);
  if (posture === 'm365_only') return null;
  const cost = s.baselineCost;
  return (
    <div className="baseline-cost" id="baselineCostPanel" role="region" aria-label="Recurring cost confirmations">
      <div>
        <strong>Recurring cost</strong>
      </div>
      <p className="path-hint">
        These resources start a monthly Azure cost and are off by default. Each one is built only after you opt in (DP-1) and then type its
        confirmation for this run (DP-2). Anything not confirmed is left out.
      </p>
      <label htmlFor="baselineOperator">Your name or ID</label>
      <input type="text" id="baselineOperator" value={s.baselineOperator} onChange={(e) => s.setBaselineOperator(e.target.value)} />
      {cost?.loading ? <div className="path-hint">Loading recurring items...</div> : null}
      {cost?.error ? <div className="path-hint error">{cost.error}</div> : null}
      {cost && !cost.loading && cost.items.length === 0 && !cost.error ? <div className="path-hint">No recurring items for this posture.</div> : null}
      {cost?.items.map((item) => {
        const dp1Id = `baselineDp1_${item.resourceType}`;
        const dp2Id = `baselineDp2_${item.resourceType}`;
        return (
          <div className="baseline-cost-item" key={item.entry_id} data-entry-id={item.entry_id}>
            <div>
              <strong>{item.label}</strong> ({item.entry_id}): about {item.estimate ?? 'unknown'} a month, {item.estimate_basis}; price date{' '}
              {item.price_date}. {item.acked ? 'DP-1 given.' : 'Off (no DP-1).'}
            </div>
            {item.acked ? (
              <>
                <label htmlFor={dp2Id}>DP-2 for this run: type {item.expected_dp2 ?? '(no price: cannot be confirmed)'}</label>
                <input
                  type="text"
                  id={dp2Id}
                  value={s.baselineDp2Typed[item.entry_id] ?? ''}
                  onChange={(e) => s.setBaselineDp2Typed(item.entry_id, e.target.value)}
                  disabled={!item.expected_dp2}
                />
              </>
            ) : (
              <>
                <label htmlFor={dp1Id}>DP-1 opt-in: type {item.entry_id}</label>
                <input type="text" id={dp1Id} value={s.baselineDp1Typed[item.entry_id] ?? ''} onChange={(e) => s.setBaselineDp1Typed(item.entry_id, e.target.value)} />
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => void s.ackBaselineCost(item.entry_id)}
                  disabled={!item.estimate || (s.baselineDp1Typed[item.entry_id] ?? '').trim() !== item.entry_id || !s.baselineOperator.trim()}
                >
                  Opt in (DP-1)
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConfigureCard() {
  const s = useConfigureStore();
  const connection = useTenantStore((t) => t.connection);
  const slug = useTenantStore((t) => t.slug);
  const canBaseline = baselineEnabled(connection, slug, s.baselineRunning);
  return (
    <WorkflowCard
      index={1}
      title="Configure"
      titleId="screen-title-configure"
      badge={{ text: 'Pending', className: 'status-default' }}
      collapsed={s.collapsed}
      onToggle={s.toggleCard}
      tooltip="Edit the tenant configuration that drives every downstream step."
    >
      {PATH_TYPES.map((type) => (
        <PathField key={type} type={type} />
      ))}

      <div className="configure-launcher">
        <button type="button" className="config-launch-btn" onClick={s.launchVariables}>
          <span className="config-launch-icon" aria-hidden="true">
            ⚙
          </span>
          <span className="config-launch-text">
            <span className="config-launch-label">Variables</span>
            <span className="config-launch-desc">Config + Plan variables</span>
          </span>
        </button>
        <button type="button" className="config-launch-btn" onClick={s.launchRegistry}>
          <span className="config-launch-icon" aria-hidden="true">
            📋
          </span>
          <span className="config-launch-text">
            <span className="config-launch-label">Registry</span>
            <span className="config-launch-desc">M365 &amp; Azure command entries</span>
          </span>
        </button>
        <button type="button" className="config-launch-btn" onClick={() => void s.scanVariables()}>
          <span className="config-launch-icon" aria-hidden="true">
            ⚠
          </span>
          <span className="config-launch-text">
            <span className="config-launch-label">Scan Variables</span>
            <span className="config-launch-desc">Validate required values</span>
          </span>
        </button>
      </div>
      <VariableScanResults />

      <hr className="spa-divider" />
      <div>
        <strong>Baseline Provisioning</strong>
      </div>
      <div className="baseline-row">
        <div>
          <label htmlFor="baselinePostureSelect">Posture</label>
          <select id="baselinePostureSelect" value={s.posture} onChange={(e) => s.setPosture(e.target.value as Posture)}>
            <option value="m365_only">M365 Only</option>
            <option value="m365_foundation">M365 + Foundation</option>
            <option value="m365_full_infra">M365 + Full Infra</option>
          </select>
        </div>
        <button type="button" className="btn btn-primary btn-small" id="btnBaseline" onClick={s.runBaseline} disabled={!canBaseline}>
          Bring to Baseline
        </button>
        <button type="button" className="btn btn-destructive btn-small" id="btnBaselineHalt" onClick={s.haltBaseline} hidden={!s.baselineRunning}>
          Halt
        </button>
      </div>
      <BaselineCostPanel />
      <div id="baselineStatus" aria-live="polite">
        {s.baselineStatus}
      </div>
    </WorkflowCard>
  );
}

function ConfigureToast() {
  const toast = useConfigureStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div className={`spa-toast ${toast.type}`} role="status">
      {toast.message}
    </div>
  );
}

export default function ConfigureScreen() {
  return (
    <CardScreen
      screen="configure"
      titleId="screen-title-configure"
      card={<ConfigureCard />}
      console={
        <ConsolePanel>
          <PrereqPanel />
        </ConsolePanel>
      }
    >
      <FilePicker />
      <ConfigureToast />
    </CardScreen>
  );
}
