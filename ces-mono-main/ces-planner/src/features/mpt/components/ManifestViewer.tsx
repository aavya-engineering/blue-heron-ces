// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState } from 'react';
import { Card } from '@/shared/components/Display/Card';
import { Badge } from '@/shared/components/Display/Badge';

interface ManifestViewerProps {
  manifest: any;
}

export function ManifestViewer({ manifest }: ManifestViewerProps) {
  if (!manifest) return null;

  const ces = manifest.ces || {};
  const tm = manifest.tenant_manifest || {};

  const controls = tm.normative_controls || [];
  const assets = tm.assets || [];
  const intents = tm.config_intents || [];
  const monitors = tm.evidence_monitors || [];
  const driftPolicies = tm.drift_policies || [];
  const boundaryZones = tm.boundary_zones;
  const tenantIdentity = tm.tenant_identity;

  return (
    <div className="space-y-6">
      {/* Metadata */}
      <Card title="Manifest Overview">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <dt className="text-sm font-medium text-gray-500">Generated</dt>
            <dd className="mt-1 text-sm">{ces.generated_on || 'N/A'}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Manifest ID</dt>
            <dd className="mt-1 text-sm font-mono text-xs">{tm.manifest_id || 'N/A'}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Intent</dt>
            <dd className="mt-1 text-sm">{ces.intent || 'N/A'}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-gray-500">Tech Stack</dt>
            <dd className="mt-1 text-sm">{tm.tech_stack_id ?? 'N/A'}</dd>
          </div>
        </dl>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard label="Controls" value={controls.length} bg="bg-blue-50" text="text-blue-800" />
          <StatCard label="Assets" value={assets.length} bg="bg-green-50" text="text-green-800" />
          <StatCard label="Config Intents" value={intents.length} bg="bg-slate-50" text="text-slate-800" />
          <StatCard label="Monitors" value={monitors.length} bg="bg-amber-50" text="text-amber-800" />
          <StatCard label="Drift Policies" value={driftPolicies.length} bg="bg-red-50" text="text-red-800" />
        </div>
      </Card>

      {/* Tenant Identity */}
      {tenantIdentity && <TenantIdentitySection identity={tenantIdentity} />}

      {/* Normative Controls */}
      {controls.length > 0 && <NormativeControlsSection controls={controls} />}

      {/* Assets */}
      {assets.length > 0 && <AssetsSection assets={assets} />}

      {/* Config Intents */}
      {intents.length > 0 && <ConfigIntentsSection intents={intents} />}

      {/* Evidence Monitors */}
      {monitors.length > 0 && <EvidenceMonitorsSection monitors={monitors} />}

      {/* Drift Policies */}
      {driftPolicies.length > 0 && <DriftPoliciesSection policies={driftPolicies} />}

      {/* Boundary Zones */}
      {boundaryZones && <BoundaryZonesSection zones={boundaryZones} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------
function StatCard({
  label,
  value,
  bg,
  text,
}: {
  label: string;
  value: number;
  bg: string;
  text: string;
}) {
  return (
    <div className={`${bg} rounded-lg p-3 text-center`}>
      <div className={`text-2xl font-bold ${text}`}>{value}</div>
      <div className={`text-xs font-semibold uppercase tracking-wide ${text} opacity-80`}>
        {label}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tenant Identity
// ---------------------------------------------------------------------------
function TenantIdentitySection({ identity }: { identity: any }) {
  return (
    <Card title="Tenant Identity">
      <dl className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Field label="Tenant ID" value={identity.tenant_id} mono />
        <Field label="Primary Domain" value={identity.primary_domain} />
        <Field label="Display Name" value={identity.display_name} />
        <Field label="Cloud Environment" value={formatEnum(identity.cloud_environment)} />
        <Field label="Primary SKU" value={identity.primary_sku} />
        <Field label="License Count" value={identity.license_count} />
        {identity.custom_domains?.length > 0 && (
          <div className="col-span-full">
            <dt className="text-sm font-medium text-gray-500">Custom Domains</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {identity.custom_domains.map((d: string) => (
                <span key={d} className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                  {d}
                </span>
              ))}
            </dd>
          </div>
        )}
        {identity.addon_skus?.length > 0 && (
          <div className="col-span-full">
            <dt className="text-sm font-medium text-gray-500">Add-on SKUs</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {identity.addon_skus.map((s: string) => (
                <span key={s} className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                  {s}
                </span>
              ))}
            </dd>
          </div>
        )}
        {identity.service_activations && (
          <div className="col-span-full">
            <dt className="text-sm font-medium text-gray-500">Service Activations</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {Object.entries(identity.service_activations).map(([svc, active]) => (
                <span
                  key={svc}
                  className={`text-xs px-2 py-0.5 rounded ${
                    active
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {svc}: {active ? 'Active' : 'Inactive'}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Normative Controls
// ---------------------------------------------------------------------------
function NormativeControlsSection({ controls }: { controls: any[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <Card title={`Normative Controls (${controls.length})`}>
      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {controls.map((ctrl: any, idx: number) => {
          const id = ctrl.control_id || `ctrl-${idx}`;
          const isOpen = expandedId === id;
          const verifications = ctrl.verification || [];
          const evidenceArtifacts = ctrl.evidence_artifacts || [];

          return (
            <div
              key={id}
              className="border border-gray-200 rounded-lg overflow-hidden"
            >
              <button
                onClick={() => setExpandedId(isOpen ? null : id)}
                className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono bg-blue-100 text-blue-800 px-2 py-0.5 rounded flex-shrink-0">
                    {ctrl.control_id}
                  </span>
                  <span className="text-sm text-gray-900 truncate">
                    {ctrl.required_state}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  {verifications.length > 0 && (
                    <span className="text-xs text-gray-500">
                      {verifications.length} check{verifications.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  <span className="text-gray-400 text-xs">{isOpen ? '\u25B2' : '\u25BC'}</span>
                </div>
              </button>

              {isOpen && (
                <div className="p-3 space-y-3 border-t border-gray-200">
                  {verifications.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Verification Steps
                      </h4>
                      <div className="space-y-2">
                        {verifications.map((v: any, vi: number) => (
                          <div
                            key={v.id || vi}
                            className="pl-3 border-l-2 border-blue-300 text-sm"
                          >
                            <div className="text-gray-900">{v.description}</div>
                            <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500">
                              <span>
                                Method:{' '}
                                <Badge variant="neutral">{formatEnum(v.method)}</Badge>
                              </span>
                              <span>Expected: {v.expected}</span>
                            </div>
                            <div className="text-xs text-red-600 mt-0.5">
                              On fail: {v.on_fail}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {evidenceArtifacts.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Evidence Artifacts
                      </h4>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-500 border-b">
                            <th className="pb-1 pr-3">Type</th>
                            <th className="pb-1 pr-3">Description</th>
                            <th className="pb-1 pr-3">Collector</th>
                            <th className="pb-1">Retention</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evidenceArtifacts.map((ea: any, ei: number) => (
                            <tr key={ei} className="border-b border-gray-100">
                              <td className="py-1 pr-3">
                                <Badge variant="info">
                                  {formatEnum(ea.artifact_type)}
                                </Badge>
                              </td>
                              <td className="py-1 pr-3 text-gray-700">{ea.description}</td>
                              <td className="py-1 pr-3 text-gray-500">{ea.collector}</td>
                              <td className="py-1 text-gray-500">{ea.retention_days}d</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
function AssetsSection({ assets }: { assets: any[] }) {
  // Group by scope_category
  const grouped = new Map<string, any[]>();
  for (const a of assets) {
    const cat = a.scope_category || 'other';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(a);
  }

  return (
    <Card title={`Asset Registry (${assets.length})`}>
      <div className="space-y-4 max-h-[400px] overflow-y-auto">
        {Array.from(grouped.entries()).map(([category, items]) => (
          <div key={category}>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {formatEnum(category)} ({items.length})
            </h4>
            <div className="space-y-1">
              {items.map((asset: any, i: number) => (
                <div
                  key={asset.asset_id || i}
                  className="flex items-center justify-between p-2 bg-gray-50 rounded border border-gray-200"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="neutral">{formatEnum(asset.asset_type)}</Badge>
                    <span className="text-sm text-gray-700 truncate">
                      {asset.owner || asset.asset_id}
                    </span>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {(asset.tags || []).slice(0, 3).map((tag: string, ti: number) => (
                      <span
                        key={ti}
                        className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Config Intents
// ---------------------------------------------------------------------------
function ConfigIntentsSection({ intents }: { intents: any[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <Card title={`Config Intents (${intents.length})`}>
      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {intents.map((intent: any, idx: number) => {
          const id = intent.id || `ci-${idx}`;
          const isOpen = expandedId === id;

          return (
            <div key={id} className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedId(isOpen ? null : id)}
                className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {(intent.control_ids || []).map((cid: string) => (
                    <span
                      key={cid}
                      className="text-xs font-mono bg-primary-100 text-primary-800 px-2 py-0.5 rounded flex-shrink-0"
                    >
                      {cid}
                    </span>
                  ))}
                  <span className="text-sm text-gray-900 truncate">{intent.title}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  <Badge variant="neutral">{formatEnum(intent.query_method)}</Badge>
                  <span className="text-gray-400 text-xs">{isOpen ? '\u25B2' : '\u25BC'}</span>
                </div>
              </button>

              {isOpen && (
                <div className="p-3 border-t border-gray-200 space-y-2">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-xs font-medium text-gray-500">Source of Truth</span>
                      <div className="mt-0.5">
                        <Badge variant="info">{formatEnum(intent.source_of_truth)}</Badge>
                      </div>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-500">Query Method</span>
                      <div className="mt-0.5">
                        <Badge variant="neutral">{formatEnum(intent.query_method)}</Badge>
                      </div>
                    </div>
                  </div>
                  {intent.desired_config && (
                    <div>
                      <span className="text-xs font-medium text-gray-500">Desired Configuration</span>
                      <div className="mt-1 bg-gray-50 rounded p-2">
                        <dl className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {Object.entries(intent.desired_config).map(([k, v]) => (
                            <div key={k}>
                              <dt className="text-xs text-gray-500">{formatFieldName(k)}</dt>
                              <dd className="text-sm text-gray-900">{formatConfigValue(v)}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Evidence Monitors
// ---------------------------------------------------------------------------
function EvidenceMonitorsSection({ monitors }: { monitors: any[] }) {
  // Group by cadence
  const cadenceOrder = ['daily', 'weekly', 'monthly'];
  const grouped = new Map<string, any[]>();
  for (const m of monitors) {
    const cadence = m.cadence || 'other';
    if (!grouped.has(cadence)) grouped.set(cadence, []);
    grouped.get(cadence)!.push(m);
  }

  const sortedGroups = Array.from(grouped.entries()).sort(
    (a, b) => (cadenceOrder.indexOf(a[0]) ?? 99) - (cadenceOrder.indexOf(b[0]) ?? 99),
  );

  const cadenceBadge: Record<string, 'error' | 'warning' | 'info' | 'neutral'> = {
    daily: 'error',
    weekly: 'warning',
    monthly: 'info',
  };

  return (
    <Card title={`Evidence Monitors (${monitors.length})`}>
      <div className="space-y-4 max-h-[500px] overflow-y-auto">
        {sortedGroups.map(([cadence, items]) => (
          <div key={cadence}>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={cadenceBadge[cadence] || 'neutral'}>
                {cadence.toUpperCase()}
              </Badge>
              <span className="text-xs text-gray-500">{items.length} monitor{items.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-2">
              {items.map((m: any, i: number) => (
                <div
                  key={m.id || i}
                  className="p-3 bg-gray-50 rounded border border-gray-200"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm text-gray-900">{m.signal}</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(m.control_ids || []).map((cid: string) => (
                          <span
                            key={cid}
                            className="text-xs font-mono bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded"
                          >
                            {cid}
                          </span>
                        ))}
                      </div>
                    </div>
                    <Badge variant="neutral">{formatEnum(m.collection_method)}</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                    <span>Retention: {m.retention_days}d</span>
                  </div>
                  <div className="mt-1 text-xs text-red-600">
                    On drift: {m.on_drift}
                  </div>
                  {m.sentinel_workspace && (
                    <div className="mt-1 text-xs text-gray-500">
                      Sentinel: {m.sentinel_workspace} ({m.sentinel_resource_group})
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Drift Policies
// ---------------------------------------------------------------------------
function DriftPoliciesSection({ policies }: { policies: any[] }) {
  const severityVariant: Record<string, 'error' | 'warning' | 'info' | 'neutral'> = {
    critical: 'error',
    high: 'warning',
    medium: 'info',
    low: 'neutral',
  };

  return (
    <Card title={`Drift Policies (${policies.length})`}>
      <div className="space-y-3">
        {policies.map((dp: any, i: number) => (
          <div
            key={dp.id || i}
            className={`p-4 rounded-lg border ${
              dp.severity === 'critical'
                ? 'border-red-300 bg-red-50'
                : dp.severity === 'high'
                  ? 'border-orange-300 bg-orange-50'
                  : 'border-gray-200 bg-gray-50'
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <Badge variant={severityVariant[dp.severity] || 'neutral'}>
                {(dp.severity || 'medium').toUpperCase()}
              </Badge>
            </div>
            <div className="text-sm text-gray-900 mb-3">{dp.scope}</div>

            {dp.detection?.length > 0 && (
              <div className="mb-2">
                <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Detection
                </h5>
                <ul className="list-disc list-inside text-sm text-gray-700 space-y-0.5">
                  {dp.detection.map((d: string, di: number) => (
                    <li key={di}>{d}</li>
                  ))}
                </ul>
              </div>
            )}

            {dp.response_playbook?.length > 0 && (
              <div>
                <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Response Playbook
                </h5>
                <ol className="list-decimal list-inside text-sm text-gray-700 space-y-0.5">
                  {dp.response_playbook.map((r: string, ri: number) => (
                    <li key={ri}>{r}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Boundary Zones
// ---------------------------------------------------------------------------
function BoundaryZonesSection({ zones }: { zones: any }) {
  const definitions = zones.definitions || [];

  return (
    <Card title="Boundary Zones">
      {zones.cui_boundary_version && (
        <p className="text-xs text-gray-500 mb-3">
          CUI Boundary version: {zones.cui_boundary_version}
        </p>
      )}
      {definitions.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b">
              <th className="pb-1 pr-3">Key</th>
              <th className="pb-1 pr-3">Value</th>
              <th className="pb-1">Type</th>
            </tr>
          </thead>
          <tbody>
            {definitions.map((def: any, i: number) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="py-1.5 pr-3 font-mono text-xs text-gray-700">{def.key}</td>
                <td className="py-1.5 pr-3 text-gray-900">
                  {Array.isArray(def.value) ? def.value.join(', ') : String(def.value)}
                </td>
                <td className="py-1.5 text-xs text-gray-500">{def.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: any;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className={`mt-1 text-sm text-gray-900 ${mono ? 'font-mono text-xs' : ''}`}>
        {value ?? 'N/A'}
      </dd>
    </div>
  );
}

function formatEnum(val: string | undefined): string {
  if (!val) return 'N/A';
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatFieldName(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatConfigValue(val: unknown): string {
  if (val === null || val === undefined) return 'N/A';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (Array.isArray(val)) {
    if (val.length === 0) return 'None';
    if (typeof val[0] === 'object') return JSON.stringify(val, null, 2);
    return val.join(', ');
  }
  if (typeof val === 'object') return JSON.stringify(val, null, 2);
  return String(val);
}
