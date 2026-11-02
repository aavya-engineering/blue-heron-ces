#!/usr/bin/env node
// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * fix-evidence-json.js
 *
 * Fixes evidence file quality issues in the M365 CMMC L2 registry
 * using line-level text replacements to preserve original JSON formatting.
 *
 * Fix A: 4 IA get_commands (bare Invoke-MgGraphRequest for auth method configs)
 *        → append | ConvertTo-Json -Depth 5
 * Fix B: ~24 evidence_commands ending with Select-Object but no ConvertTo-Json
 *        → append | ConvertTo-Json -Depth 3
 * Fix C: 3 bare Invoke-MgGraphRequest get_commands (no evidence_commands, no Select)
 *        → append | ConvertTo-Json -Depth 5
 */

const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, '..', 'src', 'registry', 'cmmc-l2-commands.registry.json');

let content = fs.readFileSync(REGISTRY_PATH, 'utf-8');
const lines = content.split('\n');

let fixACount = 0;
let fixBCount = 0;
let fixCCount = 0;

// Fix A entry IDs — match get_command lines for these entries
const FIX_A_IDS = new Set([
  'IA.L2-3.5.3.mfa-authenticator',
  'IA.L2-3.5.3.fido2-enable',
  'IA.L2-3.5.9.tap-config',
  'IA.L2-3.5.10.cert-auth',
]);

// Fix C entry IDs
const FIX_C_IDS = new Set([
  'AC.L2-3.1.8.smart-lockout',
  'AC.L2-3.1.16.wifi-profile',
  'AC.L2-3.1.19.ios-mam',
]);

let currentEntryId = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Track which entry we're in
  const entryIdMatch = line.match(/"entry_id"\s*:\s*"([^"]+)"/);
  if (entryIdMatch) {
    currentEntryId = entryIdMatch[1];
  }

  // Fix A & C: get_command lines for targeted entries
  if (line.includes('"get_command"') && !line.includes('ConvertTo-Json')) {
    if (FIX_A_IDS.has(currentEntryId)) {
      // Append | ConvertTo-Json -Depth 5 before the closing quote
      lines[i] = line.replace(/("get_command"\s*:\s*".*?)(")(\s*,?\s*)$/, '$1 | ConvertTo-Json -Depth 5$2$3');
      fixACount++;
      console.log(`Fix A [line ${i + 1}]: ${currentEntryId}`);
    } else if (FIX_C_IDS.has(currentEntryId)) {
      lines[i] = line.replace(/("get_command"\s*:\s*".*?)(")(\s*,?\s*)$/, '$1 | ConvertTo-Json -Depth 5$2$3');
      fixCCount++;
      console.log(`Fix C [line ${i + 1}]: ${currentEntryId}`);
    }
  }

  // Fix B: evidence_commands lines ending with Select-Object <props> but no ConvertTo-Json
  // These lines are inside "evidence_commands": [...] arrays
  if (!line.includes('"get_command"') && !line.includes('"set_command"') &&
      line.includes('Select-Object') && !line.includes('ConvertTo-Json')) {
    // Must be inside an evidence_commands array — check it's a string value line
    if (/^\s*".*Select-Object\s+\S+\s*"/.test(line)) {
      lines[i] = line.replace(/(Select-Object\s+\S+)\s*(")/, '$1 | ConvertTo-Json -Depth 3$2');
      fixBCount++;
      console.log(`Fix B [line ${i + 1}]: ${currentEntryId}`);
    }
  }
}

const result = lines.join('\n');

// Validate the result is still valid JSON
try {
  JSON.parse(result);
} catch (e) {
  console.error('ERROR: Result is not valid JSON!', e.message);
  process.exit(1);
}

fs.writeFileSync(REGISTRY_PATH, result, 'utf-8');

console.log(`\nDone. Fix A: ${fixACount}, Fix B: ${fixBCount}, Fix C: ${fixCCount} (total: ${fixACount + fixBCount + fixCCount})`);
