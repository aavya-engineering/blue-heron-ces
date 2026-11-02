// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Typed client, one function per JSON route of ces-stamper/src/server/routes/*.routes.ts.
// Request shapes (query keys, body keys) follow the route handlers, so the SPA sends what the
// legacy console sends (AD-4). Response bodies the SPA does not read yet are typed `unknown`;
// SPA1 to SPA3 narrow them as each screen lands. Streaming (SSE) routes are in ./sse.ts.

import { apiEventStream, apiRequest } from './http';
import type { StreamFrame } from './http';

export type UiMode = 'legacy' | 'react';

/** GET /health (health.routes.ts). `ui` and `simulator` are the W8-SPA0 read-only fields. */
export interface HealthStatus {
  status: 'ok';
  registries: { m365: boolean; infra: boolean; merged: boolean };
  evidenceCollector: { autostart: string };
  ui: { mode: UiMode; spaPath: string; spaBuilt: boolean };
  simulator: { active: boolean; serverUrl: string | null };
  timestamp: string;
}

export type ApprovalDecision = 'approve' | 'skip' | 'accomplish';

export interface ApproveBody {
  taskId?: string;
  subId?: string;
  layer?: number;
  decision: ApprovalDecision;
  gateType?: string;
}

export interface TranslateBody {
  missionPlan: string;
  manifest: string;
  output?: string;
  infraManifest?: string;
  tenant?: string;
  gapsOnly?: boolean;
  automatedOnly?: boolean;
}

export interface PlanVariablesBody {
  plan: string;
  variables: Record<string, unknown>;
  varsFile?: string;
}

export interface ResolveVariableBody {
  variable: string;
  tenant: string;
  plan?: string;
  varsFile?: string;
}

export type RegistryType = 'm365' | 'infra';

const enc = encodeURIComponent;

export const stamperApi = {
  // health.routes.ts
  health: () => apiRequest<HealthStatus>('GET', '/health'),

  // tenant.routes.ts
  listTenants: () => apiRequest<unknown>('GET', '/api/tenants'),
  getTenant: (slug: string) => apiRequest<unknown>('GET', `/api/tenants/${enc(slug)}`),
  updateTenant: (slug: string, json: string) => apiRequest<unknown>('PUT', `/api/tenants/${enc(slug)}`, { body: { json } }),
  createTenant: (json: string) => apiRequest<unknown>('POST', '/api/tenants', { body: { json } }),
  setTenantSecret: (slug: string, variable: string, value: string) =>
    apiRequest<unknown>('POST', `/api/tenants/${enc(slug)}/secrets`, { body: { variable, value } }),
  browseTenants: () => apiRequest<unknown>('GET', '/api/tenants-browse'),

  // variables.routes.ts
  getTenantVariables: (slug: string) => apiRequest<unknown>('GET', `/api/tenants/${enc(slug)}/variables`),
  putTenantVariables: (slug: string, variables: Record<string, unknown>) =>
    apiRequest<unknown>('PUT', `/api/tenants/${enc(slug)}/variables`, { body: { variables } }),
  getPlanVariables: (plan: string, varsFile?: string) =>
    apiRequest<unknown>('GET', '/api/plan-variables', { query: { plan, varsFile } }),
  savePlanVariables: (body: PlanVariablesBody) => apiRequest<unknown>('POST', '/api/plan-variables', { body }),
  resolvableVariables: () => apiRequest<unknown>('GET', '/api/resolvable-variables'),
  resolveVariable: (body: ResolveVariableBody) => apiRequest<unknown>('POST', '/api/resolve-variable', { body }),
  resolveAllVariables: (variables: unknown, tenant: string) =>
    apiRequest<unknown>('POST', '/api/resolve-all-variables', { body: { variables, tenant } }),
  validateVariables: (tenant: string) => apiRequest<unknown>('POST', '/api/validate-variables', { body: { tenant } }),

  // assess.routes.ts (GET /api/assess is a stream: sse.ts)
  getAssessState: (tenant: string) => apiRequest<unknown>('GET', '/api/assess-state', { query: { tenant } }),

  // gaps.routes.ts
  computeGaps: (tenant: string) => apiRequest<unknown>('GET', '/api/compute-gaps', { query: { tenant } }),

  // translate.routes.ts
  lastTranslate: (tenant: string) => apiRequest<unknown>('GET', '/api/last-translate', { query: { tenant } }),
  translate: (body: TranslateBody) => apiRequest<unknown>('POST', '/api/translate', { body }),
  validatePlan: (plan: string) => apiRequest<unknown>('POST', '/api/validate', { body: { plan } }),

  // execute.routes.ts (GET /api/execute and /api/preflight are streams: sse.ts)
  approve: (body: ApproveBody) => apiRequest<unknown>('POST', '/api/approve', { body }),
  abort: () => apiRequest<unknown>('POST', '/api/abort'),

  // connect.routes.ts (GET /api/connect and /api/prereqs/install are streams: sse.ts)
  prereqs: () => apiRequest<unknown>('GET', '/api/prereqs'),
  /** The reply is an event stream (install_progress, install_done), read frame by frame. */
  importCert: (certPath: string, password: string, onEvent: (frame: StreamFrame) => void) =>
    apiEventStream('/api/prereqs/import-cert', { certPath, password }, onEvent),

  // evidence.routes.ts
  evidenceScan: (tenant: string) => apiRequest<unknown>('GET', '/api/evidence-scan', { query: { tenant } }),
  evidenceContent: (tenant: string, entryId: string, format?: string) =>
    apiRequest<unknown>('GET', '/api/evidence-content', { query: { tenant, entryId, format } }),

  // registry.routes.ts
  listRegistry: (type: RegistryType) => apiRequest<unknown>('GET', `/api/registry/${enc(type)}`),
  getRegistryEntry: (type: RegistryType, entryId: string) =>
    apiRequest<unknown>('GET', `/api/registry/${enc(type)}/${enc(entryId)}`),
  putRegistryEntry: (type: RegistryType, entryId: string, entry: unknown) =>
    apiRequest<unknown>('PUT', `/api/registry/${enc(type)}/${enc(entryId)}`, { body: entry }),
  resolveRegistryCommand: (command: string, tenant?: string) =>
    apiRequest<unknown>('POST', '/api/registry/resolve', { body: { command, tenant } }),

  // utility.routes.ts
  browse: (query: { dir?: string; tenant?: string; pattern?: string }) =>
    apiRequest<unknown>('GET', '/api/browse', { query }),
  browseCleanup: (pattern: string, tenant?: string) =>
    apiRequest<unknown>('DELETE', '/api/browse-cleanup', { query: { tenant, pattern } }),
  browseFile: (path: string) => apiRequest<unknown>('GET', '/api/browse-file', { query: { path } }),
  devPaths: (full?: boolean) => apiRequest<unknown>('GET', '/api/dev-paths', { query: { full } }),
  planDataPaths: (tenant?: string) => apiRequest<unknown>('GET', '/api/plan-data-paths', { query: { tenant } }),
  fileToBase64: (filePath: string) => apiRequest<unknown>('POST', '/api/file-to-base64', { body: { filePath } }),
  validateFile: (path: string) => apiRequest<unknown>('GET', '/api/validate-file', { query: { path } }),
  readPlanFile: (path: string) => apiRequest<unknown>('GET', '/api/read-plan-file', { query: { path } }),
  saveRunLog: (log: unknown) => apiRequest<unknown>('POST', '/api/save-run-log', { body: { log } }),
  cmmcControls: () => apiRequest<unknown>('GET', '/api/cmmc-controls'),
} as const;

export type StamperApi = typeof stamperApi;
