// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// G0 characterization tests for the shared pipeline-storage layout.
//
// These pin down the CURRENT on-disk path/naming behaviour exactly as it exists today.
// Goals G1 (identity/tenancy) and G2 (persistence harmonization) will change how artifacts
// are keyed and stored; this file is the safety net that makes "no silent layout change"
// enforceable. If one of these assertions changes, that change must be deliberate.
//
// Expectations are built with node:path so they stay correct on win32 and POSIX.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import path from 'node:path';

import * as storage from './node.js';
import {
  PLANNER_DEXIE_DB_NAME,
  PLANNER_DEXIE_DB_VERSION,
  PLANNER_DEXIE_STORE_TO_FS_PATH,
} from './DexieContract.js';

const TEST_ROOT = path.resolve('/tmp/ces-characterization-root');
const originalEnv = process.env.CES_PIPELINE_ROOT;

beforeEach(() => {
  // Pin the root so every derived path is deterministic regardless of host machine.
  process.env.CES_PIPELINE_ROOT = TEST_ROOT;
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.CES_PIPELINE_ROOT;
  } else {
    process.env.CES_PIPELINE_ROOT = originalEnv;
  }
});

describe('shared storage — pipeline root resolution', () => {
  it('resolves the root from CES_PIPELINE_ROOT', () => {
    expect(storage.getCesPipelineRoot()).toBe(TEST_ROOT);
  });

  it('places each module directly under the root', () => {
    expect(storage.getCesModuleRoot('Planner')).toBe(path.join(TEST_ROOT, 'Planner'));
    expect(storage.getCesModuleRoot('Stamper')).toBe(path.join(TEST_ROOT, 'Stamper'));
    expect(storage.getCesModuleRoot('EvidenceOps')).toBe(path.join(TEST_ROOT, 'EvidenceOps'));
    expect(storage.getCesModuleRoot('AdminOps')).toBe(path.join(TEST_ROOT, 'AdminOps'));
  });

  it('nests a storage/ dir under non-Planner modules', () => {
    expect(storage.getModuleStorageRoot('Stamper')).toBe(
      path.join(TEST_ROOT, 'Stamper', 'storage'),
    );
    expect(storage.getModuleStorageRoot('AdminOps')).toBe(
      path.join(TEST_ROOT, 'AdminOps', 'storage'),
    );
  });
});

describe('shared storage — Planner customer layout', () => {
  it('places customers under Planner/customers', () => {
    expect(storage.getPlannerCustomersRoot()).toBe(
      path.join(TEST_ROOT, 'Planner', 'customers'),
    );
  });

  it('derives a customer root from the sanitized name', () => {
    expect(storage.getPlannerCustomerRoot('Acme Corp')).toBe(
      path.join(TEST_ROOT, 'Planner', 'customers', 'Acme Corp'),
    );
  });

  it('sanitizes reserved characters in the customer root path', () => {
    expect(storage.getPlannerCustomerRoot('foo/bar:baz')).toBe(
      path.join(TEST_ROOT, 'Planner', 'customers', 'foo_bar_baz'),
    );
  });

  it('returns the customer root itself when no category is given', () => {
    expect(storage.getPlannerArtifactDirectory({ customerName: 'Acme' })).toBe(
      path.join(TEST_ROOT, 'Planner', 'customers', 'Acme'),
    );
  });

  it('appends inputs/ and outputs/ category dirs', () => {
    expect(
      storage.getPlannerArtifactDirectory({ customerName: 'Acme', category: 'inputs' }),
    ).toBe(path.join(TEST_ROOT, 'Planner', 'customers', 'Acme', 'inputs'));
    expect(
      storage.getPlannerArtifactDirectory({ customerName: 'Acme', category: 'outputs' }),
    ).toBe(path.join(TEST_ROOT, 'Planner', 'customers', 'Acme', 'outputs'));
  });

  it('builds a full artifact path with category + filename', () => {
    expect(
      storage.getPlannerArtifactPath({
        customerName: 'Acme',
        category: 'inputs',
        filename: 'si-baselines.json',
      }),
    ).toBe(
      path.join(TEST_ROOT, 'Planner', 'customers', 'Acme', 'inputs', 'si-baselines.json'),
    );
  });

  it('falls back to the directory when no filename is given', () => {
    expect(
      storage.getPlannerArtifactPath({ customerName: 'Acme', category: 'outputs' }),
    ).toBe(path.join(TEST_ROOT, 'Planner', 'customers', 'Acme', 'outputs'));
  });
});

describe('shared storage — Stamper plan-data layout', () => {
  it('places plan-data under Stamper', () => {
    expect(storage.getStamperPlanDataRoot()).toBe(
      path.join(TEST_ROOT, 'Stamper', 'plan-data'),
    );
  });

  it('keys a tenant directory by slug under plan-data', () => {
    expect(storage.getStamperTenantRoot('contoso')).toBe(
      path.join(TEST_ROOT, 'Stamper', 'plan-data', 'contoso'),
    );
  });

  it('exposes exactly the plans/evidence/logs/state subdirs', () => {
    const base = path.join(TEST_ROOT, 'Stamper', 'plan-data', 'contoso');
    expect(storage.getStamperTenantSubdir('contoso', 'plans')).toBe(path.join(base, 'plans'));
    expect(storage.getStamperTenantSubdir('contoso', 'evidence')).toBe(
      path.join(base, 'evidence'),
    );
    expect(storage.getStamperTenantSubdir('contoso', 'logs')).toBe(path.join(base, 'logs'));
    expect(storage.getStamperTenantSubdir('contoso', 'state')).toBe(path.join(base, 'state'));
  });
});

describe('shared storage — EC module + tenant root (M1, evidence-collector PLAN.md)', () => {
  it('places EC storage under EvidenceCollector/storage', () => {
    expect(storage.getEcModuleRoot()).toBe(
      path.join(TEST_ROOT, 'EvidenceCollector', 'storage'),
    );
  });

  it('keys a tenant directory by slug under EC storage', () => {
    expect(storage.getEcTenantRoot('contoso')).toBe(
      path.join(TEST_ROOT, 'EvidenceCollector', 'storage', 'contoso'),
    );
  });

  it('rejects an empty or whitespace-only slug', () => {
    expect(() => storage.getEcTenantRoot('')).toThrow();
    expect(() => storage.getEcTenantRoot('   ')).toThrow();
  });

  it('rejects a slug with leading/trailing whitespace', () => {
    expect(() => storage.getEcTenantRoot(' contoso')).toThrow();
    expect(() => storage.getEcTenantRoot('contoso ')).toThrow();
  });

  it('rejects a slug containing a .. traversal segment', () => {
    expect(() => storage.getEcTenantRoot('..')).toThrow();
    expect(() => storage.getEcTenantRoot('../../etc')).toThrow();
    expect(() => storage.getEcTenantRoot('contoso/../../etc')).toThrow();
  });

  it('rejects a slug containing a path separator', () => {
    expect(() => storage.getEcTenantRoot('contoso/evil')).toThrow();
    expect(() => storage.getEcTenantRoot('contoso\\evil')).toThrow();
  });

  it('rejects a slug that is an absolute path', () => {
    expect(() => storage.getEcTenantRoot('/etc/passwd')).toThrow();
  });

  it('rejects reserved characters (mirrors sanitizeCustomerName reserved set)', () => {
    for (const bad of ['a<b', 'a>b', 'a|b', 'a*b', 'a?b', 'a"b', 'a:b']) {
      expect(() => storage.getEcTenantRoot(bad), bad).toThrow();
    }
  });
});

describe('shared storage — customer-name sanitization', () => {
  it('replaces every reserved character with underscore', () => {
    // Reserved set: / \ < > | * ? " : and control chars.
    expect(storage.sanitizeCustomerName('a/b\\c<d>e|f*g?h"i:j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('preserves spaces, dots and ordinary punctuation', () => {
    expect(storage.sanitizeCustomerName('Acme Corp. (East)')).toBe('Acme Corp. (East)');
  });

  it('falls back to "unknown" when nothing usable remains', () => {
    expect(storage.sanitizeCustomerName('')).toBe('unknown');
    expect(storage.sanitizeCustomerName('   ')).toBe('unknown');
  });

  it('is idempotent — sanitizing a sanitized name is a no-op', () => {
    const once = storage.sanitizeCustomerName('foo/bar:baz');
    expect(storage.sanitizeCustomerName(once)).toBe(once);
  });
});

describe('shared storage — timestamped filenames', () => {
  it('uses the artifactId verbatim when provided: {type}_{artifactId}.json', () => {
    expect(storage.getTimestampedJsonFilename('si_baseline', 'SI-0001')).toBe(
      'si_baseline_SI-0001.json',
    );
  });

  it('falls back to a colon/dot-free ISO timestamp when no artifactId is given', () => {
    const name = storage.getTimestampedJsonFilename('readiness');
    // Format: readiness_<ISO with : and . replaced by ->.json — Windows-path safe.
    expect(name).toMatch(
      /^readiness_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/,
    );
    expect(name).not.toContain(':');
  });
});

describe('shared storage — Dexie contract (FE↔FS pinning)', () => {
  it('pins the database name and version', () => {
    expect(PLANNER_DEXIE_DB_NAME).toBe('CMMCComplianceTool');
    expect(PLANNER_DEXIE_DB_VERSION).toBe(6);
  });

  it('maps every Dexie store to its inputs/ or outputs/ FS sub-path', () => {
    expect(PLANNER_DEXIE_STORE_TO_FS_PATH).toEqual({
      si_baselines: 'inputs/si-baselines',
      cui_boundaries: 'outputs/cui-boundaries',
      btc_confirmations: 'outputs/btc-confirmations',
      tenant_config_profiles: 'outputs/tenant-config-profiles',
      policy_inputs: 'inputs/policy-inputs',
      readiness_postures: 'outputs/readiness-postures',
    });
  });
});
