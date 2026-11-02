// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * D-11: scheduled signal capture is on by default, every 24 h, and can still be turned off
 * (including with the string "false", which z.coerce.boolean() used to read as on).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadEoConfig } from '../../../src/eo/config/EoConfig';

const KEYS = [
  'ENABLE_SCHEDULED_SIGNAL_CAPTURE', 'SIGNAL_CAPTURE_INTERVAL_HOURS', 'REGISTRY_PATH', 'STORAGE_ROOT',
  'TENANT_SLUG', 'TENANT_CONFIG', 'ACTIVE_TENANT_SLUG', 'CES_TENANT_ROOT', 'CES_PIPELINE_ROOT',
] as const;

describe('EoConfig scheduled capture defaults (D-11)', () => {
  const saved: Record<string, string | undefined> = {};
  let tmp: string;

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eo-cfg-d11-'));
    for (const k of KEYS) delete process.env[k];
    process.env.REGISTRY_PATH = path.join(tmp, 'registry.json');
    process.env.STORAGE_ROOT = path.join(tmp, 'eo');
    process.env.CES_TENANT_ROOT = path.join(tmp, 'empty-registry');
    process.env.CES_PIPELINE_ROOT = path.join(tmp, 'pipeline');
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('is on, daily, when neither variable is set', async () => {
    const c = await loadEoConfig();
    expect(c.enableScheduledSignalCapture).toBe(true);
    expect(c.signalCaptureIntervalHours).toBe(24);
  });

  it.each(['false', 'FALSE', '0', 'no', 'off', ' Off '])('is off when ENABLE_SCHEDULED_SIGNAL_CAPTURE=%p', async (v) => {
    process.env.ENABLE_SCHEDULED_SIGNAL_CAPTURE = v;
    const c = await loadEoConfig();
    expect(c.enableScheduledSignalCapture).toBe(false);
  });

  it.each(['true', '1', 'yes', 'on'])('is on when ENABLE_SCHEDULED_SIGNAL_CAPTURE=%p', async (v) => {
    process.env.ENABLE_SCHEDULED_SIGNAL_CAPTURE = v;
    const c = await loadEoConfig();
    expect(c.enableScheduledSignalCapture).toBe(true);
  });

  it('honours SIGNAL_CAPTURE_INTERVAL_HOURS', async () => {
    process.env.SIGNAL_CAPTURE_INTERVAL_HOURS = '6';
    const c = await loadEoConfig();
    expect(c.signalCaptureIntervalHours).toBe(6);
  });
});
