// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Cross-card flows of cards 0-2, in the legacy order (AD-4: same ordered requests):
// page load (cmmc-controls map, then tenants, then the tenant change), the tenant change
// itself (onTenantChange L6190) and Save Tenant (L10659).

import { stamperApi } from '../../api';
import { useWorkflowStore } from '../../store/workflow';
import {
  DEV_SLUG,
  accumulateRunLog,
  currentRunLog,
  initRunLog,
  rememberTenant,
  useTenantStore,
} from '../../store/tenant';
import type { LogLevel } from 'ces-ui-kit';
import { useConfigureStore } from '../../store/configure';
import { useAssessStore } from '../../store/assess';
import { watchTenant } from '../../store/execute';

/** Legacy page load: the control-map fetch fires first (script parse), then DOMContentLoaded loadTenants. */
export async function bootstrapConsole(): Promise<void> {
  if (useTenantStore.getState().bootstrapped) return;
  useTenantStore.setState({ bootstrapped: true });
  void useAssessStore.getState().loadControlMap();
  if (typeof window !== 'undefined') window.addEventListener('message', onPopoutMessage);
  await loadTenantsAndChange();
}

/** L4916: a pop-out that saved the tenant config makes the console reload its cached config. */
export function onPopoutMessage(e: MessageEvent): void {
  const data = e.data as { type?: string; tenant?: string } | null;
  if (data && data.type === 'config-saved' && data.tenant) void useTenantStore.getState().loadTenantConfig(data.tenant);
}

/** loadTenants L6163: the list, then onTenantChange for the restored tenant. */
export async function loadTenantsAndChange(): Promise<void> {
  const ok = await useTenantStore.getState().loadTenants();
  if (ok) await changeTenant(useTenantStore.getState().slug);
}

/** onTenantChange L6190. */
export async function changeTenant(slug: string): Promise<void> {
  // Cards 3 and 4 follow the workflow store's tenant (badges, gate, FG-4 target; idempotent).
  watchTenant();
  const tenant = useTenantStore.getState();
  tenant.setSlug(slug);
  rememberTenant(slug);
  tenant.setConnectionState('disconnected');
  tenant.resetGate();
  useAssessStore.getState().resetCmmcTiles();
  useWorkflowStore.getState().selectTenant(slug);
  useAssessStore.setState({ badge: { text: 'Pending', className: 'status-default' } });
  if (slug === DEV_SLUG) {
    useWorkflowStore.getState().setStepState('tenant', 'done');
    useWorkflowStore.getState().setStepState('configure', 'ready');
    await useConfigureStore.getState().loadDevPaths();
  } else {
    await useConfigureStore.getState().loadTenantPaths(slug);
  }
  await useTenantStore.getState().loadTenantConfig(slug);
  await useTenantStore.getState().loadTenantVariables(slug);
  await useAssessStore.getState().loadCachedState(slug);
}

/** logTenantOp L5416. */
function logTenantOp(action: string, slug: string, message: string, level: LogLevel): void {
  if (!currentRunLog()) initRunLog({ mode: 'tenant_config', planPath: '' });
  accumulateRunLog({ type: 'tenant_op', action, slug, message, level });
  useTenantStore.getState().appendLog(message, level);
}

/** saveTenant L10659. */
export async function saveTenant(): Promise<void> {
  const tenant = useTenantStore.getState();
  const jsonText = tenant.tenantJson.trim();
  if (!jsonText) {
    tenant.showStatus('Paste a tenant config JSON before saving.', 'error');
    return;
  }
  try {
    JSON.parse(jsonText);
  } catch (e) {
    tenant.showStatus(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`, 'error');
    return;
  }
  logTenantOp('add', '', 'Adding new tenant config...', 'info');
  try {
    let result: { ok?: boolean; error?: string; slug?: string; client_name?: string };
    let httpOk = true;
    try {
      result = (await stamperApi.createTenant(jsonText)) as typeof result;
    } catch (err) {
      const payload = (err as { payload?: unknown; status?: number }).payload;
      if (!payload || typeof payload !== 'object') throw err;
      httpOk = false;
      result = payload as typeof result;
    }
    if (!httpOk || !result || !result.ok) {
      const reason = (result && result.error) || 'Bad Request';
      logTenantOp('add', '', `Save failed: ${reason}`, 'error');
      useTenantStore.getState().showStatus(`Save failed: ${reason}`, 'error');
      return;
    }
    const saved = `Tenant saved: ${result.client_name} (${result.slug})`;
    logTenantOp('add', String(result.slug), saved, 'success');
    useTenantStore.getState().showStatus(saved, 'success');
    useTenantStore.getState().closeAddTenant();
    await loadTenantsAndChange();
    await changeTenant(String(result.slug));
  } catch (e) {
    const message = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
    logTenantOp('add', '', message, 'error');
    useTenantStore.getState().showStatus(message, 'error');
  }
}
