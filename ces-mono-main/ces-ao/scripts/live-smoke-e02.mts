// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// LIVE smoke test — runs E-02 (Unified Audit Log Health), a read-only Domain E
// command, against a REAL tenant with dryRun:false. This is the first thing to
// run once PowerShell 7 + modules + a real tenant JSON are in place.
//
// Usage (from cse-ao/):   npx tsx scripts/live-smoke-e02.mts <tenant-slug>
//
// It resolves auth from plan-data/<slug>/<slug>.json, executes E-02 live, and
// prints whether auth + the audit-log read succeeded and where evidence landed.
// E-02 is read-only — it changes nothing in the tenant.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadTenantConfig, resolveTenantJsonPath } from '@bhd-vfs/shared/config';
import { executeAoCommand } from '../src/execution/CommandExecutor.js';

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: npx tsx scripts/live-smoke-e02.mts <tenant-slug>');
  process.exit(2);
}

const registry = JSON.parse(
  readFileSync(new URL('../src/registry/ao-commands.registry.json', import.meta.url), 'utf-8')
);
const e02 = registry.find((c: any) => c.id === 'E-02');
if (!e02) {
  console.error('E-02 not found in registry');
  process.exit(2);
}

let tenantConfig;
try {
  const tenantPath = resolveTenantJsonPath(slug, resolve(process.cwd()));
  console.log(`Loading tenant config: ${tenantPath}`);
  tenantConfig = loadTenantConfig(tenantPath);
} catch (e: any) {
  console.error(`FAILED to load tenant config for "${slug}": ${e.message}`);
  console.error('Create plan-data/<slug>/<slug>.json with auth/tenant/endpoints (see docs/adminops/LIVE_SETUP.md).');
  process.exit(1);
}

console.log(`\nExecuting E-02 (Unified Audit Log Health) LIVE against "${slug}" (dryRun=false)...\n`);

try {
  // dryRun:false → real execution. E-02 is read-only.
  const result: any = await executeAoCommand(e02, tenantConfig, {}, false);

  console.log('success       :', result.success);
  console.log('exit_code     :', result.exit_code);
  console.log('verdict       :', result.evidence?.complianceVerdict ?? '(none)');
  console.log('evidence file :', result.evidencePath ?? '(not written)');
  if (result.stderr) console.log('stderr        :', String(result.stderr).slice(0, 500));
  console.log('\noutput (first 800 chars):\n' + String(result.stdout || '').slice(0, 800));

  if (result.success) {
    console.log('\n✅ Live read succeeded — auth + audit-log access + evidence persistence all work.');
    process.exit(0);
  } else {
    console.log('\n❌ Execution returned failure. If this is an auth error, fix the cert/app/consent before testing anything else.');
    process.exit(1);
  }
} catch (e: any) {
  console.error('\n❌ Threw before/while executing:', e.message);
  console.error('Most likely: pwsh not installed, a module missing, or cert/app/consent not yet valid.');
  process.exit(1);
}
