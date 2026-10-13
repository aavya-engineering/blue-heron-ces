// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Flow-through ground rule 1 (SIM ONLY): nothing may reach a real tenant.
 * Checked on the fully-merged Stamper child env BEFORE launch:
 *   - STACKSIM_SERVER_URL must be a loopback URL;
 *   - the FIRST PSModulePath entry must be stacksim's psmodules dir, and no
 *     other entry may hold a cloud module (Microsoft.Graph*, ExchangeOnline*,
 *     Az*, MicrosoftTeams, Microsoft.Online.SharePoint*) — so the only cloud
 *     cmdlets PowerShell can load are stacksim's shims, which resolve every
 *     -Uri against STACKSIM_SERVER_URL
 *     (tenant-stacksim/psmodules/Microsoft.Graph.Authentication/*.psm1:114-139).
 *     ces-tenant's launch env appends $PSHOME\Modules (core modules only).
 * Returns violations; empty = the launch is sim-only by construction.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const CLOUD_MODULE = /^(Microsoft\.Graph|ExchangeOnline|Az(\.|$)|AzureAD|MicrosoftTeams|Microsoft\.Online\.SharePoint|MSOnline)/i;

/** Real-tenant endpoints named in the flow-through ground rules. */
export const REAL_TENANT_HOSTS = ['graph.microsoft.us', 'management.usgovcloudapi.net', 'login.microsoftonline.us'];

export type ListDir = (dir: string) => string[];
const defaultListDir: ListDir = (dir) => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

function isUnder(child: string, root: string): boolean {
  const c = path.resolve(child).toLowerCase();
  const r = path.resolve(root).toLowerCase();
  return c === r || c.startsWith(r + path.sep);
}

export function simOnlyEnvViolations(
  env: NodeJS.ProcessEnv,
  stacksimRoot: string,
  listDir: ListDir = defaultListDir,
): string[] {
  const v: string[] = [];
  const url = env.STACKSIM_SERVER_URL;
  if (!url) v.push('STACKSIM_SERVER_URL is not set');
  else {
    try {
      const host = new URL(url).hostname;
      if (!LOOPBACK.has(host)) v.push(`STACKSIM_SERVER_URL host "${host}" is not loopback`);
    } catch {
      v.push(`STACKSIM_SERVER_URL "${url}" is not a URL`);
    }
  }
  const psKey = Object.keys(env).find((k) => k.toLowerCase() === 'psmodulepath');
  const entries = (psKey ? env[psKey] ?? '' : '').split(';').filter((e) => e.trim() !== '');
  if (entries.length === 0) {
    v.push('PSModulePath is empty (real modules could autoload from defaults)');
    return v;
  }
  if (!isUnder(entries[0], stacksimRoot)) v.push(`first PSModulePath entry is not stacksim: ${entries[0]}`);
  for (const e of entries) {
    if (isUnder(e, stacksimRoot)) continue;
    const cloud = listDir(e).filter((m) => CLOUD_MODULE.test(m));
    if (cloud.length > 0) v.push(`PSModulePath entry ${e} exposes real cloud modules: ${cloud.join(', ')}`);
  }
  return v;
}
