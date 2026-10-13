// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

// build-demo-scenario.mjs — generates scenarios/demo-dib-small.json from
// scenarios/demo-dib-small.config.json (GP-STACKSIM-1 M4, founder-approved
// 2026-07-25 with a "build it for easy change" rider).
//
// The CONFIG is the editable source of truth for the demo tenant: staff
// roster, group/device names, and the named gap toggles. This script turns
// it into the resolver-path mutation steps ScenarioEngine replays. Flow:
//
//   edit scenarios/demo-dib-small.config.json
//   npm run demo:build     (regenerate the scenario)
//   npm run demo:reset     (rebuild the tenant; also runs demo:build)
//
// tests/integration/demo-profile.test.ts imports buildDemoScenario() and
// fails if the committed scenario drifts from the config, so hand-edits to
// the generated file can't silently diverge.
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_PATH = path.join(ROOT, 'scenarios', 'demo-dib-small.config.json');
const OUT_PATH = path.join(ROOT, 'scenarios', 'demo-dib-small.json');

/** "Dana Okafor" -> "dana.okafor" (explicit `upn` field overrides). */
export function upnLocalPart(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/ +/g, '.');
}

export function buildDemoScenario(cfg) {
  const steps = [];

  const users = [...cfg.staff];
  if (cfg.gaps.sharedLogin) users.push(cfg.sharedAccount);

  users.forEach((u, i) => {
    const local = u.upn ?? upnLocalPart(u.name);
    steps.push({
      kind: 'uri',
      method: 'PATCH',
      uri: `/v1.0/users/user-${i + 1}`,
      body: {
        displayName: u.name,
        userPrincipalName: `${local}@${cfg.domain}`,
        jobTitle: u.title,
        department: u.department,
      },
      note: u.note ?? '',
    });
  });

  for (const g of cfg.groups) {
    const body = g.keepSeededName
      ? { description: g.description }
      : { displayName: g.name, description: g.description };
    steps.push({
      kind: 'uri',
      method: 'PATCH',
      uri: `/v1.0/groups/${g.seedId}`,
      body,
      note: g.note ?? '',
    });
  }

  for (const d of cfg.devices) {
    const body = { deviceName: d.name };
    if (d.kiosk && cfg.gaps.kioskUnencrypted) {
      body.complianceState = 'noncompliant';
      body.isEncrypted = false;
    }
    steps.push({
      kind: 'uri',
      method: 'PATCH',
      uri: `/v1.0/deviceManagement/managedDevices/${d.seedId}`,
      body,
      note: d.note ?? '',
    });
  }

  steps.push({
    kind: 'uri',
    method: 'PATCH',
    uri: '/v1.0/identity/conditionalAccess/policies/caPolicy-1',
    body: {
      displayName: 'Require MFA - all users',
      state: cfg.gaps.mfaReportOnly ? 'enabledForReportingButNotEnforced' : 'enabled',
      grantControls: { operator: 'OR', builtInControls: ['mfa'] },
    },
    note: cfg.gaps.mfaReportOnly
      ? "GAP (the headline): the MSP set up an MFA policy six months ago in report-only mode and never flipped it to enforced - iam-001/iam-004 read 'no'; Stamper's stamp closes it live during the demo"
      : 'MFA enforced - the headline identity gap is toggled OFF in this build (gaps.mfaReportOnly)',
  });

  const mfaFact = cfg.gaps.mfaReportOnly ? 'no' : 'yes';
  return {
    name: 'demo-dib-small',
    description: cfg.description,
    stance: 'm365_azure',
    countOverrides: { users: users.length },
    steps,
    expectedFacts: {
      'iam-001': mfaFact,
      'iam-004': mfaFact,
      'ep-001': 'yes',
      'ep-002': 'yes',
    },
  };
}

export function loadDemoConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

// CLI entry: regenerate the committed scenario file.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scenario = buildDemoScenario(loadDemoConfig());
  writeFileSync(OUT_PATH, JSON.stringify(scenario, null, 2) + '\n', 'utf8');
  console.log(`demo:build -> wrote ${OUT_PATH} (${scenario.steps.length} steps, ${scenario.countOverrides.users} users)`);
}
