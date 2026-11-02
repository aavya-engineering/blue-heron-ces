// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// W0.2c (EO-collection plan; REVIEW §5): every evidence record's metadata.executorIdentity is
// `stamper/<package version>@<ClientId from Get-MgContext>`, resolved once per run — never
// 'unknown', a tenant slug, or the bare 'stamper'. Resolved on the route paths and in
// StamperEngine.execute (the CLI path the e2e harness drives).
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import {
  STAMPER_PACKAGE_VERSION, NO_MGCONTEXT, MGCONTEXT_CLIENTID_COMMAND,
  formatExecutorIdentity, getExecutorIdentity, resolveExecutorIdentity, parseClientId,
} from '../../src/utils/executorIdentity';
import { buildStructuredEvidence } from '../../src/utils/structuredEvidence';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version as string;
const CLIENT_ID = '11111111-2222-4333-8444-555555555555';
const IDENTITY_RE = /^stamper\/\d+\.\d+\.\d+@\S+$/;

function stubSession(opts: { connected: boolean; stdout?: string; exitCode?: number; throws?: boolean }) {
  const calls: string[] = [];
  return {
    calls,
    getSessionState: () => ({ connected: opts.connected }),
    execute: async (_type: 'graph', cmd: string) => {
      calls.push(cmd);
      if (opts.throws) throw new Error('not connected');
      return { stdout: opts.stdout ?? '', exitCode: opts.exitCode ?? 0 };
    },
  };
}

describe('W0.2c executor identity', () => {
  it('uses the package version and the Get-MgContext ClientId', async () => {
    expect(STAMPER_PACKAGE_VERSION).toBe(PKG_VERSION);
    const s = stubSession({ connected: true, stdout: `${CLIENT_ID}\nSTAMPER_EXECUTION_SUCCESS\n` });
    const id = await resolveExecutorIdentity(s);
    expect(id).toBe(`stamper/${PKG_VERSION}@${CLIENT_ID}`);
    expect(getExecutorIdentity()).toBe(id);
    expect(s.calls).toEqual([MGCONTEXT_CLIENTID_COMMAND]);
    // no {...} in the probe: template resolution must never see a token in it
    expect(MGCONTEXT_CLIENTID_COMMAND).not.toMatch(/[{}]/);
  });

  it('resolves once per run: a later run with no session resets the ClientId part', async () => {
    await resolveExecutorIdentity(stubSession({ connected: true, stdout: CLIENT_ID }));
    expect(await resolveExecutorIdentity(undefined)).toBe(`stamper/${PKG_VERSION}@${NO_MGCONTEXT}`);
  });

  it('does not open a Graph session unless asked (connect: false and not connected)', async () => {
    const s = stubSession({ connected: false, stdout: CLIENT_ID });
    expect(await resolveExecutorIdentity(s)).toBe(`stamper/${PKG_VERSION}@${NO_MGCONTEXT}`);
    expect(s.calls).toHaveLength(0);
    expect(await resolveExecutorIdentity(s, { connect: true })).toBe(`stamper/${PKG_VERSION}@${CLIENT_ID}`);
  });

  it.each([
    ['the read throws', { connected: true, throws: true }],
    ['the read exits non-zero', { connected: true, exitCode: 1, stdout: 'x' }],
    ['the output is not an id', { connected: true, stdout: 'Get-MgContext: not signed in' }],
    ['the context has no ClientId (empty output)', { connected: true, stdout: '' }],
  ])('never yields unknown when %s', async (_why, opts) => {
    const id = await resolveExecutorIdentity(stubSession(opts));
    expect(id).toBe(`stamper/${PKG_VERSION}@${NO_MGCONTEXT}`);
    expect(id).not.toMatch(/unknown/);
  });

  it('parseClientId takes the last id-shaped line (connect banner and session sentinel skipped)', () => {
    expect(parseClientId(`WARNING: connected to Microsoft Graph\n${CLIENT_ID}\nSTAMPER_EXECUTION_SUCCESS\n`)).toBe(CLIENT_ID);
    expect(parseClientId('')).toBeUndefined();
    expect(parseClientId('Welcome To Microsoft Graph!')).toBeUndefined();
  });

  it('formatExecutorIdentity trims and falls back', () => {
    expect(formatExecutorIdentity('1.2.3', `  ${CLIENT_ID} `)).toBe(`stamper/1.2.3@${CLIENT_ID}`);
    expect(formatExecutorIdentity('1.2.3', '')).toBe(`stamper/1.2.3@${NO_MGCONTEXT}`);
  });

  it('buildStructuredEvidence records the resolved identity, not the tenant slug', async () => {
    await resolveExecutorIdentity(stubSession({ connected: true, stdout: CLIENT_ID }));
    const ev = buildStructuredEvidence(
      '{"value":[{"id":"p1"}]}', 0, '', null,
      { label: 'Read policy', engine: 'graph', get_command: 'Get-X' } as any,
      { id: 't1', controls: ['AC.L1-3.1.1'], action: { engine: 'graph', args: {} } } as any,
      { tenant_slug: 'muster-partial' },
    );
    expect(ev.metadata.executorIdentity).toBe(`stamper/${PKG_VERSION}@${CLIENT_ID}`);
    expect(ev.metadata.executorIdentity).toMatch(IDENTITY_RE);
  });

  it('every write site reads getExecutorIdentity(); each run path resolves it once', () => {
    const files = [
      'src/utils/structuredEvidence.ts',
      'src/evidence/EvidenceCollector.ts',
      'src/server/routes/execute.routes.ts',
      'src/server/routes/assess.routes.ts',
    ];
    let sites = 0;
    for (const f of files) {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf-8');
      for (const line of text.split('\n')) {
        if (!/executorIdentity\s*[:=]/.test(line) || /executorIdentity: string/.test(line)) continue;
        if (/executorIdentity,\s*$/.test(line)) continue; // shorthand property of the resolved const
        if (/resolveExecutorIdentity\(/.test(line)) continue; // the once-per-run resolution itself
        sites++;
        expect(line).toMatch(/getExecutorIdentity\(\)/);
      }
    }
    // structuredEvidence (1) + EvidenceCollector (2) + execute.routes (8) + assess.routes (4)
    expect(sites).toBe(15);
    // resolution points: the execute route, the assess route, and StamperEngine.execute (CLI)
    for (const f of ['src/server/routes/execute.routes.ts', 'src/server/routes/assess.routes.ts', 'src/core/StamperEngine.ts']) {
      expect(fs.readFileSync(path.join(ROOT, f), 'utf-8')).toMatch(/await resolveExecutorIdentity\(/);
    }
  });
});
