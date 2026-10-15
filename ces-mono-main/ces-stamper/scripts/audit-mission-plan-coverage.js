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
 * Audit script: verifies that mission plan steps are covered by registry entries.
 * Loads BOTH M365 and infra registries, reads the latest mission plan,
 * and classifies each step as registry-covered, vendor-fallback, or manual-only.
 *
 * Usage: node scripts/audit-mission-plan-coverage.js [path-to-mission-plan.json]
 */

const fs = require('fs');
const path = require('path');

// --- Load registries (raw JSON, no TS imports needed) ---
const m365RegPath = path.resolve(__dirname, '..', 'src', 'registry', 'cmmc-l2-commands.registry.json');
const infraRegPath = path.resolve(__dirname, '..', 'src', 'registry', 'infra-cmmc-l2-commands.registry.json');

function loadRegistry(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`Registry not found: ${filePath}`);
    return [];
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return data.entries || [];
}

const m365Entries = loadRegistry(m365RegPath);
const infraEntries = loadRegistry(infraRegPath);
const allEntries = [...m365Entries, ...infraEntries];

// Build control_id -> entries index (same logic as CommandRegistry.buildIndexes)
const byControl = new Map();
for (const entry of allEntries) {
  for (const cid of entry.control_ids || []) {
    if (!byControl.has(cid)) byControl.set(cid, []);
    byControl.get(cid).push(entry);
  }
}

// Also build M365-only index to detect infra-only coverage
const byControlM365 = new Map();
for (const entry of m365Entries) {
  for (const cid of entry.control_ids || []) {
    if (!byControlM365.has(cid)) byControlM365.set(cid, []);
    byControlM365.get(cid).push(entry);
  }
}

console.log(`Loaded ${m365Entries.length} M365 entries, ${infraEntries.length} infra entries (${allEntries.length} total)`);
console.log(`Merged registry covers ${byControl.size} unique control IDs\n`);

// --- Find mission plan ---
let missionPlanPath = process.argv[2];
if (!missionPlanPath) {
  const planDir = path.resolve(__dirname, '..', 'plan-data');
  if (!fs.existsSync(planDir)) {
    console.error('No plan-data/ directory found. Pass a mission plan path as argument.');
    process.exit(1);
  }
  const files = fs.readdirSync(planDir)
    .filter(f => f.startsWith('manual-mission-plan') && f.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    console.error('No mission plan files found in plan-data/');
    process.exit(1);
  }
  missionPlanPath = path.join(planDir, files[files.length - 1]);
}

console.log(`Mission plan: ${path.basename(missionPlanPath)}\n`);
const mp = JSON.parse(fs.readFileSync(missionPlanPath, 'utf-8'));
// Mission plan steps live at outputs.human_readable_mission_plan.steps
const steps = mp.outputs?.human_readable_mission_plan?.steps
  || mp.mission_plan?.steps
  || [];

if (steps.length === 0) {
  console.error('No steps found in mission plan.');
  process.exit(1);
}

// --- Classify each step ---
const MANUAL_TYPES = new Set(['policy', 'process', 'training']);
const results = { covered: [], vendorFallback: [], manualOnly: [], infraOnly: [] };

for (const step of steps) {
  const controlIds = (step.control_coverage || []).map(c => c.control_id);
  const taskType = step.task_type || 'unknown';
  const hasVendorCommands = (step.actions || []).some(a =>
    a.vendor?.implementation || (a.vendor?.evidence_commands?.length > 0)
  );

  // Get registry matches
  const matchedEntries = [];
  const seen = new Set();
  for (const cid of controlIds) {
    for (const entry of (byControl.get(cid) || [])) {
      if (!seen.has(entry.entry_id)) {
        seen.add(entry.entry_id);
        matchedEntries.push(entry);
      }
    }
  }

  // Check M365-only matches
  const m365MatchedEntries = [];
  const seenM365 = new Set();
  for (const cid of controlIds) {
    for (const entry of (byControlM365.get(cid) || [])) {
      if (!seenM365.has(entry.entry_id)) {
        seenM365.add(entry.entry_id);
        m365MatchedEntries.push(entry);
      }
    }
  }

  const info = {
    id: step.id,
    title: step.title,
    taskType,
    controlIds,
    matchCount: matchedEntries.length,
    m365MatchCount: m365MatchedEntries.length,
    services: (step.actions || []).map(a => a.vendor?.m365_service).filter(Boolean),
  };

  if (MANUAL_TYPES.has(taskType) && matchedEntries.length === 0) {
    results.manualOnly.push(info);
  } else if (matchedEntries.length > 0) {
    results.covered.push(info);
    // Flag if ONLY infra entries match (these were previously missed)
    if (m365MatchedEntries.length === 0) {
      results.infraOnly.push(info);
    }
  } else {
    results.vendorFallback.push(info);
  }
}

// --- Print summary ---
console.log('='.repeat(80));
console.log('MISSION PLAN COVERAGE AUDIT');
console.log('='.repeat(80));
console.log(`Total steps:        ${steps.length}`);
console.log(`Registry-covered:   ${results.covered.length} (${(100 * results.covered.length / steps.length).toFixed(1)}%)`);
console.log(`  Infra-only:       ${results.infraOnly.length} (would have been missed without merge)`);
console.log(`Vendor-fallback:    ${results.vendorFallback.length}`);
console.log(`Manual-only:        ${results.manualOnly.length}`);
console.log('');

if (results.infraOnly.length > 0) {
  console.log('-'.repeat(80));
  console.log('INFRA-ONLY STEPS (now covered after merge fix):');
  console.log('-'.repeat(80));
  for (const s of results.infraOnly) {
    console.log(`  ${s.id}`);
    console.log(`    Title:    ${s.title}`);
    console.log(`    Controls: ${s.controlIds.join(', ')}`);
    console.log(`    Entries:  ${s.matchCount} (all infra)`);
    console.log(`    Services: ${s.services.join(', ') || '(none)'}`);
    console.log('');
  }
}

if (results.vendorFallback.length > 0) {
  console.log('-'.repeat(80));
  console.log('VENDOR-FALLBACK STEPS (no registry entries match):');
  console.log('-'.repeat(80));
  for (const s of results.vendorFallback) {
    console.log(`  ${s.id}`);
    console.log(`    Title:    ${s.title}`);
    console.log(`    Type:     ${s.taskType}`);
    console.log(`    Controls: ${s.controlIds.join(', ')}`);
    console.log(`    Services: ${s.services.join(', ') || '(none)'}`);
    console.log('');
  }
}

console.log('Done.');
