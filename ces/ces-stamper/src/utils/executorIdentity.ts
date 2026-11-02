// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W0.2c (EO-collection plan, REVIEW §5): the identity written to every evidence record's
 * `metadata.executorIdentity` — `stamper/<package version>@<ClientId>`, where ClientId is the
 * app id of the Graph session (`Get-MgContext`). Resolved once per execute or assess run and read
 * by every evidence write site, so a record never carries `unknown`, a tenant slug or the bare
 * `'stamper'`. When no Graph context can be read (dry run, dev tenant, session not connected) the
 * ClientId part is `no-mgcontext`, which states exactly that.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** ClientId placeholder when no Graph context was read. */
export const NO_MGCONTEXT = 'no-mgcontext';

function readPackageVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        if (pkg?.name === 'ces-stamper' && typeof pkg.version === 'string') return pkg.version;
      } catch { /* keep walking */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

/** ces-stamper's package version (package.json), read once. */
export const STAMPER_PACKAGE_VERSION = readPackageVersion();

export function formatExecutorIdentity(version: string, clientId?: string | null): string {
  const id = typeof clientId === 'string' && clientId.trim() !== '' ? clientId.trim() : NO_MGCONTEXT;
  return `stamper/${version}@${id}`;
}

let current = formatExecutorIdentity(STAMPER_PACKAGE_VERSION);

/** The identity every evidence write site records (last resolved; `@no-mgcontext` before that). */
export function getExecutorIdentity(): string {
  return current;
}

/**
 * The probe: the context's ClientId as a bare line. Works whether Get-MgContext returns an object
 * or a hashtable, and carries no `{...}` that template resolution could mistake for a token.
 */
export const MGCONTEXT_CLIENTID_COMMAND = '(Get-MgContext).ClientId';

/** The last output line that looks like an id (connect banners, warnings and the session's
 *  success sentinel are skipped); undefined when there is none. */
export function parseClientId(stdout: string): string | undefined {
  const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '' && !/^STAMPER_\w+$/.test(l));
  const last = lines[lines.length - 1];
  return last !== undefined && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(last) ? last : undefined;
}

/** The slice of SessionManager this module needs. */
export interface MgContextSession {
  execute(type: 'graph', command: string): Promise<{ stdout: string; exitCode: number }>;
  getSessionState?(type: 'graph'): { connected: boolean };
}

/**
 * Resolve and set the identity for this run from the Graph session's `Get-MgContext` ClientId.
 * `connect: false` reads it only when the Graph session is already connected (the execute route
 * pre-connects exactly the sessions its plan needs); `connect: true` lets the read open it.
 * Any failure leaves the ClientId part as `no-mgcontext`. Never throws.
 */
export async function resolveExecutorIdentity(
  session: MgContextSession | undefined,
  options: { connect: boolean } = { connect: false },
): Promise<string> {
  let clientId: string | undefined;
  if (session && (options.connect || session.getSessionState?.('graph')?.connected)) {
    try {
      const r = await session.execute('graph', MGCONTEXT_CLIENTID_COMMAND);
      if (r.exitCode === 0) clientId = parseClientId(r.stdout);
    } catch { /* no Graph context: keep the placeholder */ }
  }
  current = formatExecutorIdentity(STAMPER_PACKAGE_VERSION, clientId);
  return current;
}
