// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const raw = readFileSync('public/data/primed RR Question Bank.yaml', 'utf8');
const bank = yaml.load(raw);
const ab = bank.ces.activity_bank;

// Collect all activities
const activities = [];
if (ab.universal && ab.universal.activities) {
  for (const a of Object.values(ab.universal.activities)) activities.push(a);
} else if (Array.isArray(ab.universal)) {
  activities.push(...ab.universal);
}
for (const level of ['L1', 'L2', 'L3']) {
  const lv = ab.level_specific[level];
  if (lv && lv.activities) {
    for (const a of Object.values(lv.activities)) activities.push(a);
  }
}

// Also load CMMC requirements store for objective text
const reqRaw = readFileSync('public/data/domain CES CMMC Fundamental Requirements Store.yaml', 'utf8');
const reqStore = yaml.load(reqRaw);
const allReqs = reqStore.ces ? (reqStore.ces.requirements || []) : [];
// Build requirement lookup
const reqLookup = {};
if (Array.isArray(allReqs)) {
  for (const r of allReqs) {
    if (r.requirement_id) reqLookup[r.requirement_id] = r;
  }
} else {
  for (const r of Object.values(allReqs)) {
    if (r.requirement_id) reqLookup[r.requirement_id] = r;
  }
}

const targets = [
  'AT.L2-3.2.1','AT.L2-3.2.2','AT.L2-3.2.3',
  'AU.L2-3.3.6','AU.L2-3.3.7',
  'CA.L2-3.12.2','CA.L2-3.12.4',
  'CM.L2-3.4.4','CM.L2-3.4.8',
  'IA.L2-3.5.10','IA.L2-3.5.11','IA.L2-3.5.8',
  'IR.L2-3.6.3',
  'MA.L2-3.7.1','MA.L2-3.7.2','MA.L2-3.7.3','MA.L2-3.7.6',
  'PS.L2-3.9.1',
  'RA.L2-3.11.1','RA.L2-3.11.2','RA.L2-3.11.3'
];

for (const t of targets) {
  const act = activities.find(a => a.mapped_requirements && a.mapped_requirements.includes(t));
  const req = reqLookup[t];

  console.log('===');
  console.log('REQ: ' + t);

  if (req) {
    console.log('OBJECTIVE: ' + (req.requirement_text || req.description || 'N/A').substring(0, 400));
  } else {
    console.log('OBJECTIVE: (not in requirements store)');
  }

  if (act) {
    // Evidence
    const evReqs = act.evidence_requests || [];
    for (let i = 0; i < evReqs.length; i++) {
      const e = evReqs[i];
      const forms = e.acceptable_forms ? e.acceptable_forms.join('; ') : 'unspecified';
      console.log('EVIDENCE[' + i + ']: ' + forms);
    }
    if (evReqs.length === 0) {
      const archetypes = act.expected_evidence_archetypes || [];
      if (archetypes.length > 0) {
        console.log('ARCHETYPES: ' + archetypes.map(a => typeof a === 'string' ? a : a.archetype_id || JSON.stringify(a)).join(', '));
      } else {
        console.log('EVIDENCE: None specified');
      }
    }
    console.log('METHODS: ' + (act.assessor_methods || []).join(', '));
  } else {
    console.log('(no matching activity in RR bank)');
  }
  console.log('');
}
