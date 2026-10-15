// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';

describe('PipelineStorage', () => {
  const originalEnv = process.env.CES_PIPELINE_ROOT;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CES_PIPELINE_ROOT;
    } else {
      process.env.CES_PIPELINE_ROOT = originalEnv;
    }
  });

  describe('getCesPipelineRoot()', () => {
    it('honors CES_PIPELINE_ROOT env var', async () => {
      process.env.CES_PIPELINE_ROOT = '/tmp/test-pipeline';
      const { getCesPipelineRoot } = await import('./node.js');
      expect(getCesPipelineRoot()).toBe(path.resolve('/tmp/test-pipeline'));
    });

    it('defaults to C:\\CES_Pipeline on win32', async () => {
      delete process.env.CES_PIPELINE_ROOT;
      // Import fresh module — vitest caches modules, so we test the constant directly.
      const { DEFAULT_CES_PIPELINE_ROOT } = await import('./node.js');
      if (process.platform === 'win32') {
        expect(DEFAULT_CES_PIPELINE_ROOT).toBe('C:\\CES_Pipeline');
      } else {
        // On non-win32, the default is cwd-relative — just verify it's not the win32 path
        expect(DEFAULT_CES_PIPELINE_ROOT).not.toBe('C:\\CES_Pipeline');
      }
    });
  });

  describe('sanitizeCustomerName()', () => {
    it('strips reserved characters', async () => {
      const { sanitizeCustomerName } = await import('./node.js');
      expect(sanitizeCustomerName('foo/bar\\baz')).toBe('foo_bar_baz');
      expect(sanitizeCustomerName('name:with*reserved?chars')).toBe('name_with_reserved_chars');
    });

    it('returns fallback for empty result', async () => {
      const { sanitizeCustomerName } = await import('./node.js');
      expect(sanitizeCustomerName('')).toBe('unknown');
      expect(sanitizeCustomerName('   ')).toBe('unknown');
    });
  });

  describe('getStamperTenantSubdir()', () => {
    it('resolves under expected root', async () => {
      process.env.CES_PIPELINE_ROOT = '/tmp/ces-test';
      const { getStamperTenantSubdir } = await import('./node.js');
      const result = getStamperTenantSubdir('foo', 'logs');
      expect(result).toBe(path.resolve('/tmp/ces-test', 'Stamper', 'plan-data', 'foo', 'logs'));
    });
  });

  describe('PLANNER_DEXIE_DB_NAME', () => {
    it("equals 'CMMCComplianceTool'", async () => {
      const { PLANNER_DEXIE_DB_NAME } = await import('./DexieContract.js');
      expect(PLANNER_DEXIE_DB_NAME).toBe('CMMCComplianceTool');
    });
  });
});
