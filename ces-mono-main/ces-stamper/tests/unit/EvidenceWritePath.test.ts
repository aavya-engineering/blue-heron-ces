// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set CES_PIPELINE_ROOT before any ces-shared imports resolve the default
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ces-evpath-'));
process.env.CES_PIPELINE_ROOT = tmpRoot;

import { evidenceDirForTenant, tenantBaseDir } from '../../src/core/EvidenceReadinessAnalyzer';
import { getStamperTenantRoot } from 'ces-shared/storage';

describe('Evidence write path (MS-R8)', () => {
  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('evidenceDirForTenant resolves under getStamperTenantRoot', () => {
    const slug = 'contoso';
    const evidDir = evidenceDirForTenant(slug);
    const tenantRoot = getStamperTenantRoot(slug);
    expect(evidDir.startsWith(tenantRoot)).toBe(true);
    expect(evidDir).toBe(path.join(tenantRoot, 'evidence'));
  });

  it('tenantBaseDir equals getStamperTenantRoot', () => {
    const slug = 'fabrikam';
    expect(tenantBaseDir(slug)).toBe(getStamperTenantRoot(slug));
  });

  it('evidence written to tenant dir is readable from the shared root', () => {
    const slug = 'writetest';
    const evidDir = evidenceDirForTenant(slug);
    fs.mkdirSync(evidDir, { recursive: true });
    const testFile = path.join(evidDir, 'test-evidence.json');
    fs.writeFileSync(testFile, JSON.stringify({ verdict: 'SAT' }));
    const readBack = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
    expect(readBack.verdict).toBe('SAT');
    const tenantRoot = getStamperTenantRoot(slug);
    expect(fs.existsSync(path.join(tenantRoot, 'evidence', 'test-evidence.json'))).toBe(true);
  });
});

describe('EvidenceOpsClient is deleted (MS-R8)', () => {
  it('EvidenceOpsClient.ts no longer exists', () => {
    const clientPath = path.resolve(__dirname, '../../src/integrations/EvidenceOpsClient.ts');
    expect(fs.existsSync(clientPath)).toBe(false);
  });

  it('execute.routes.ts does not import EvidenceOpsClient', () => {
    const routesPath = path.resolve(__dirname, '../../src/server/routes/execute.routes.ts');
    const content = fs.readFileSync(routesPath, 'utf-8');
    expect(content).not.toContain('EvidenceOpsClient');
  });

  it('execute.routes.ts does not reference stamp-capture', () => {
    const routesPath = path.resolve(__dirname, '../../src/server/routes/execute.routes.ts');
    const content = fs.readFileSync(routesPath, 'utf-8');
    expect(content).not.toContain('stamp-capture');
  });
});
