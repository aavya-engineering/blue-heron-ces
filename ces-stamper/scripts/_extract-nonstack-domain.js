// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Extract domain knowledge for all 22 Non-Stack controls from cse-fe-v2 domain files.
 * Outputs a consolidated research artifact.
 */
const fs = require('fs');
const yaml = require('js-yaml');

const domainDir = '../cse-fe-v2/data';

// Non-Stack control IDs
const nonStackIds = [
  'AT.L2-3.2.1', 'AT.L2-3.2.2', 'AT.L2-3.2.3',
  'AU.L2-3.3.6', 'AU.L2-3.3.7',
  'CM.L2-3.4.4', 'CM.L2-3.4.8',
  'IA.L2-3.5.8', 'IA.L2-3.5.10', 'IA.L2-3.5.11',
  'IR.L2-3.6.3',
  'MA.L2-3.7.1', 'MA.L2-3.7.2', 'MA.L2-3.7.3', 'MA.L2-3.7.6',
  'PS.L2-3.9.1', 'PS.L2-3.9.2',
  'RA.L2-3.11.1', 'RA.L2-3.11.2', 'RA.L2-3.11.3',
  'CA.L2-3.12.2', 'CA.L2-3.12.4',
];
const nsSet = new Set(nonStackIds);

// 1. Load Requirements Store
const rrsText = fs.readFileSync(`${domainDir}/domain CES CMMC Fundamental Requirements Store.yaml`, 'utf8');
const rrs = yaml.load(rrsText);

// Find entries for Non-Stack controls
const rrsEntries = {};
// Navigate structure - may be under catalogs.requirements or similar
function findRequirements(obj, path) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && item.requirement_id && nsSet.has(item.requirement_id)) {
        rrsEntries[item.requirement_id] = item;
      }
      findRequirements(item, path);
    }
  } else {
    for (const key of Object.keys(obj)) {
      findRequirements(obj[key], `${path}.${key}`);
    }
  }
}
findRequirements(rrs, 'root');

// 2. Load Assessor Approach Knowledge Base
const aakbText = fs.readFileSync(`${domainDir}/domain Assessor Approach Knowledge Base.yaml`, 'utf8');
const aakb = yaml.load(aakbText);

const assessorEntries = {};
const practices = aakb?.ces?.practices || [];
for (const p of practices) {
  if (nsSet.has(p.practice_id)) {
    assessorEntries[p.practice_id] = p;
  }
}

// 3. Load Evidence Archetype Catalog
const eacText = fs.readFileSync(`${domainDir}/domain Evidence Archetype Catalog.yaml`, 'utf8');
const eac = yaml.load(eacText);

// Build archetype map and find which archetypes map to non-stack controls
const archetypeMap = {};
const archetypesForControl = {};
for (const arch of (eac.evidence_archetypes || [])) {
  archetypeMap[arch.archetype_id] = arch;
  for (const pid of (arch.maps_to_cmmc_practices || [])) {
    if (nsSet.has(pid)) {
      if (!archetypesForControl[pid]) archetypesForControl[pid] = [];
      archetypesForControl[pid].push(arch);
    }
  }
}

// 4. Load Evidence Matrix
const emxText = fs.readFileSync(`${domainDir}/domain Assessor Evidence Matrix.yaml`, 'utf8');
const emx = yaml.load(emxText);

const emxEntries = {};
const mappings = emx?.ces?.mappings || [];
for (const m of mappings) {
  if (nsSet.has(m.practice_id)) {
    emxEntries[m.practice_id] = m;
  }
}

// 5. Load Tech Stack Compliance Mapping (for Non-Stack controls)
const tscmText = fs.readFileSync(`${domainDir}/domain Tech Stack Compliance Mapping.yaml`, 'utf8');
const tscm = yaml.load(tscmText);

const tscmEntries = {};
const reqs = tscm?.CMMC_Requirements || [];
for (const r of reqs) {
  if (nsSet.has(r.requirement_id)) {
    tscmEntries[r.requirement_id] = r;
  }
}

// Output consolidated findings
console.log('=== NON-STACK DOMAIN KNOWLEDGE EXTRACTION ===\n');
console.log(`Controls: ${nonStackIds.length}`);
console.log(`RRS entries found: ${Object.keys(rrsEntries).length}`);
console.log(`Assessor entries found: ${Object.keys(assessorEntries).length}`);
console.log(`Evidence Matrix entries found: ${Object.keys(emxEntries).length}`);
console.log(`Archetype mappings found: ${Object.keys(archetypesForControl).length}`);
console.log(`Tech Stack entries found: ${Object.keys(tscmEntries).length}\n`);

for (const cid of nonStackIds) {
  console.log(`--- ${cid} ---`);

  const rr = rrsEntries[cid];
  if (rr) {
    console.log(`  RRS title: ${rr.title || rr.requirement_text?.substring(0, 80)}`);
    if (rr.expected_evidence_archetypes) {
      console.log(`  Expected evidence archetypes: ${JSON.stringify(rr.expected_evidence_archetypes)}`);
    }
    if (rr.evidence_minimum) {
      console.log(`  Evidence minimum: ${JSON.stringify(rr.evidence_minimum)}`);
    }
    if (rr.scoping_rules) {
      console.log(`  Scoping: ${JSON.stringify(rr.scoping_rules).substring(0, 200)}`);
    }
  } else {
    console.log('  RRS: NOT FOUND');
  }

  const aa = assessorEntries[cid];
  if (aa) {
    console.log(`  Assessor intent: ${aa.assessor_intent}`);
    console.log(`  Methods: ${aa.assessor_methods?.join(', ')}`);
    console.log(`  Probes: ${aa.what_assessors_probe?.join('; ')}`);
    console.log(`  Failure modes: ${aa.common_failure_modes?.join('; ')}`);
  }

  const em = emxEntries[cid];
  if (em) {
    console.log(`  Evidence Matrix: ${JSON.stringify(em.evidence).substring(0, 200)}`);
  }

  const archs = archetypesForControl[cid];
  if (archs) {
    for (const a of archs) {
      console.log(`  Archetype: ${a.archetype_id} — ${a.name}`);
    }
  }

  console.log('');
}
