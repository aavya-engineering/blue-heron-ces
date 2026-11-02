// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * EO-collection W1.4: the collector identity on every store record,
 * `ces-eo/<package version>@<ClientId>`. The ClientId is read from `(Get-MgContext).ClientId` on
 * the tenant's own Graph session, once per session. When no context can be read the ClientId part
 * is `no-mgcontext` (the same convention as Stamper's W0.2c identity). Never throws.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CollectorInfo } from './types.js';

export const COLLECTOR_NAME = 'ces-eo/ComplianceSignalFetcher';
export const NO_MGCONTEXT = 'no-mgcontext';
export const CLIENT_ID_PROBE = '(Get-MgContext).ClientId';

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readEoVersion(): string {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++) {
      const pj = path.join(dir, 'package.json');
      if (fs.existsSync(pj)) {
        const p = JSON.parse(fs.readFileSync(pj, 'utf-8')) as { name?: string; version?: string };
        if (p.name === 'ces-eo' && p.version) return p.version;
      }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  } catch { /* fall through */ }
  return '0.0.0';
}

export const EO_VERSION = readEoVersion();

/** The last ClientId-shaped line of the probe's output, or `no-mgcontext`. */
export function parseClientId(stdout: string): string {
  const lines = stdout.replace(/EO_EXECUTION_SUCCESS\s*$/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) if (ID_RE.test(lines[i])) return lines[i].toLowerCase();
  return NO_MGCONTEXT;
}

export function collectorInfo(clientId: string): CollectorInfo {
  return { name: COLLECTOR_NAME, version: EO_VERSION, identity: `ces-eo/${EO_VERSION}@${clientId}` };
}

interface ProbeSession {
  execute(engine: string, command: string): Promise<{ stdout: string }>;
}

const cache = new WeakMap<object, Promise<CollectorInfo>>();

/** Resolve (once per session object) the collector identity for reads made on `session`. */
export function resolveCollectorIdentity(session: ProbeSession | null | undefined, fallbackClientId?: string): Promise<CollectorInfo> {
  // When the probe cannot answer (no Mg context: e.g. EO reaching the simulator over HTTP), the tenant
  // config's appId is the ClientId EO would have used for Connect-MgGraph, so it is the truthful identity.
  const fallback = (): CollectorInfo => collectorInfo(fallbackClientId && fallbackClientId.trim() ? fallbackClientId.trim() : NO_MGCONTEXT);
  if (!session) return Promise.resolve(fallback());
  const hit = cache.get(session);
  if (hit) return hit;
  const p = session.execute('mgraph', CLIENT_ID_PROBE)
    .then((r) => { const id = parseClientId(r.stdout ?? ''); return id === NO_MGCONTEXT ? fallback() : collectorInfo(id); })
    .catch(() => fallback());
  cache.set(session, p);
  return p;
}
