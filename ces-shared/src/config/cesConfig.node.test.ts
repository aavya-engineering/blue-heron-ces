// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G1 T4 — CES config node loader: path resolution + load/validate from disk.
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { loadCesConfig, getCesConfigPath } from './cesConfig.node.js';
import { CES_CONFIG_FILENAME } from './cesConfig.contract.js';

let tmpDir: string;
const env0 = { ...process.env };

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-cfg-'));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
afterEach(() => {
  // restore the two env vars these tests touch
  for (const k of ['CES_CONFIG_PATH', 'CES_PIPELINE_ROOT'] as const) {
    if (env0[k] === undefined) delete process.env[k];
    else process.env[k] = env0[k];
  }
});

function writeConfig(name: string, contents: string): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, contents);
  return p;
}

describe('loadCesConfig', () => {
  it('loads + validates a config from an explicit path', () => {
    const p = writeConfig(
      'good.json',
      JSON.stringify({ version: '1.0.0', customers: [{ customerName: 'Acme', tenantSlug: 'acme' }] }),
    );
    const cfg = loadCesConfig(p);
    expect(cfg.customers).toEqual([{ customerName: 'Acme', tenantSlug: 'acme' }]);
  });

  it('returns the empty config when the file is absent (valid: no bindings yet)', () => {
    const cfg = loadCesConfig(path.join(tmpDir, 'does-not-exist.json'));
    expect(cfg).toEqual({ version: '1.0.0', customers: [] });
  });

  it('throws on malformed JSON (never silently ignores a bad config)', () => {
    const p = writeConfig('bad.json', '{ not json ');
    expect(() => loadCesConfig(p)).toThrow(/failed to parse/);
  });

  it('throws on a structurally-invalid config', () => {
    const p = writeConfig('invalid.json', JSON.stringify({ version: '1', customers: [{ tenantSlug: 't' }] }));
    expect(() => loadCesConfig(p)).toThrow(/customerName/);
  });
});

describe('getCesConfigPath', () => {
  it('uses CES_CONFIG_PATH when set', () => {
    const explicit = path.join(tmpDir, 'custom-location.json');
    process.env.CES_CONFIG_PATH = explicit;
    expect(getCesConfigPath()).toBe(path.resolve(explicit));
  });

  it('defaults to {pipelineRoot}/ces.config.json', () => {
    delete process.env.CES_CONFIG_PATH;
    process.env.CES_PIPELINE_ROOT = path.join(tmpDir, 'root');
    expect(getCesConfigPath()).toBe(path.join(path.resolve(path.join(tmpDir, 'root')), CES_CONFIG_FILENAME));
  });
});
