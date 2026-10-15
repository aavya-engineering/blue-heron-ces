// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Generate a gap analysis MD for Non-Stack + Excluded controls.
 * For each: what we HAVE vs what we NEED vs best-practice recommendation.
 */
const fs = require('fs');
const yaml = require('js-yaml');

const domainDir = '../cse-fe-v2/data';

// Load all data sources
const ref = JSON.parse(fs.readFileSync('../ces-shared/src/data/cmmc-l2-controls.reference.json', 'utf8'));
const m365Raw = JSON.parse(fs.readFileSync('src/registry/cmmc-l2-commands.registry.json', 'utf8'));
const m365Reg = m365Raw.entries || m365Raw;
const infraRaw = JSON.parse(fs.readFileSync('src/registry/infra-cmmc-l2-commands.registry.json', 'utf8'));
const infraReg = infraRaw.entries || infraRaw;

const mp = JSON.parse(fs.readFileSync('plan-data/vfsgov-xtra/plans/manual-mission-plan-2026-04-14T00-27-54-661Z.json', 'utf8'));
const hr = mp.outputs.human_readable_mission_plan;

// Domain files
const rrs = yaml.load(fs.readFileSync(`${domainDir}/domain CES CMMC Fundamental Requirements Store.yaml`, 'utf8'));
const eac = yaml.load(fs.readFileSync(`${domainDir}/domain Evidence Archetype Catalog.yaml`, 'utf8'));
const aakb = yaml.load(fs.readFileSync(`${domainDir}/domain Assessor Approach Knowledge Base.yaml`, 'utf8'));

// Build maps
const controlAction = {};
const controlMeta = {};
for (const c of hr.controls) {
  controlAction[c.requirement_id] = c.stamper_action;
  controlMeta[c.requirement_id] = c;
}

const exclusions = {};
for (const ex of hr.scope_exclusions) {
  exclusions[ex.requirement_id] = ex;
}

// RRS entries
const rrsEntries = {};
function findReqs(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && item.requirement_id) rrsEntries[item.requirement_id] = item;
      findReqs(item);
    }
  } else {
    for (const key of Object.keys(obj)) findReqs(obj[key]);
  }
}
findReqs(rrs);

// Archetype map
const archetypeMap = {};
for (const arch of (eac.evidence_archetypes || [])) {
  archetypeMap[arch.archetype_id] = arch;
  // Also lowercase key
  archetypeMap[arch.archetype_id.toLowerCase()] = arch;
}

// Assessor practices
const assessorMap = {};
for (const p of (aakb?.ces?.practices || [])) {
  assessorMap[p.practice_id] = p;
}

// Registry -> control map
const controlToM365 = {};
for (const entry of m365Reg) {
  for (const cid of (entry.control_ids || [])) {
    if (!controlToM365[cid]) controlToM365[cid] = [];
    controlToM365[cid].push(entry);
  }
}
const controlToInfra = {};
for (const entry of infraReg) {
  for (const cid of (entry.control_ids || [])) {
    if (!controlToInfra[cid]) controlToInfra[cid] = [];
    controlToInfra[cid].push(entry);
  }
}

// Check evidence files
function getEvidenceFiles(cid) {
  const family = cid.split('.')[0].toLowerCase();
  const familyDirs = {
    'ac': 'access_control', 'at': 'awareness_training', 'au': 'audit_accountability',
    'cm': 'config_management', 'ia': 'identification_auth', 'ir': 'incident_response',
    'ma': 'maintenance', 'mp': 'media_protection', 'pe': 'physical_protection',
    'ps': 'personnel_security', 'ra': 'risk_assessment', 'ca': 'security_assessment',
    'sc': 'system_comms', 'si': 'system_integrity',
  };
  const dir = `plan-data/vfsgov-xtra/evidence/${familyDirs[family] || 'other'}`;
  const prefix = cid.toLowerCase().replace(/\./g, '.').replace(/-/g, '-');
  try {
    const files = fs.readdirSync(dir);
    return files.filter(f => f.startsWith(prefix.split('.')[0].toLowerCase() + '.' + prefix.split('.')[1].toLowerCase()));
  } catch { return []; }
}

// Ref map
const refMap = {};
for (const ctrl of ref.controls) refMap[ctrl.control_id] = ctrl;

// Family names
const familyMap = {};
for (const f of ref.families) familyMap[f.abbreviation] = f.name;

// Family order
const familyOrder = ref.families.map(f => f.abbreviation);

// Separate controls
const nonStack = ref.controls.filter(c => controlAction[c.control_id] === 'Non-Stack');
const excluded = ref.controls.filter(c => controlAction[c.control_id] === 'Excluded');

const lines = [];
lines.push('# CMMC L2 Non-Stack & Excluded Controls — Evidence Gap Analysis');
lines.push('');
lines.push(`**Date:** ${new Date().toISOString().split('T')[0]}`);
lines.push('**Tenant:** vfsgov-xtra');
lines.push('**Source:** Latest execution (2026-04-14), CES domain files, CMMC reference');
lines.push('');
lines.push('## Purpose');
lines.push('');
lines.push('For each Non-Stack (22) and Excluded (21) control, this document compares:');
lines.push('- **HAVE** — what Stamper currently generates as evidence');
lines.push('- **NEED** — what the CES domain files and CMMC assessor guidance expect');
lines.push('- **RECOMMENDATION** — best-practice suggestion to close any gap');
lines.push('');
lines.push('Legend: \u2705 = covered, \u26a0\ufe0f = partial, \u274c = gap');
lines.push('');
lines.push('---');
lines.push('');

// ─────────────────── NON-STACK ───────────────────
lines.push('## NON-STACK Controls (22)');
lines.push('');
lines.push('These are process, policy, or physical controls that cannot be fully automated. They require manual attestation, document uploads, or hybrid evidence (automated query + manual supplement).');
lines.push('');

// Group by family
const nsFamilies = {};
for (const c of nonStack) {
  const fam = c.family;
  if (!nsFamilies[fam]) nsFamilies[fam] = [];
  nsFamilies[fam].push(c);
}

for (const fam of familyOrder) {
  const controls = nsFamilies[fam];
  if (!controls || controls.length === 0) continue;

  lines.push(`### ${fam} — ${familyMap[fam]}`);
  lines.push('');

  for (const ctrl of controls) {
    const cid = ctrl.control_id;
    const practice = ctrl.practice.split('\n')[0].replace(/\s+/g, ' ').trim();
    const meta = controlMeta[cid];
    const rr = rrsEntries[cid];
    const assessor = assessorMap[cid];

    lines.push(`#### ${cid} — ${practice}`);
    lines.push('');

    // === HAVE ===
    lines.push('**HAVE:**');
    const m365 = controlToM365[cid] || [];
    const infra = controlToInfra[cid] || [];
    const allEntries = [...m365, ...infra];

    if (allEntries.length === 0) {
      lines.push('- No registry entry');
    } else {
      for (const entry of allEntries) {
        const label = entry.label || entry.entry_id || entry.id;
        const engine = entry.session || entry.engine || 'unknown';
        const evCmds = entry.evidence_commands || [];
        const manOnly = entry.manual_only ? ' (manual_only)' : '';
        const evOnly = entry.evidence_only ? ' (evidence_only)' : '';

        let evDesc = 'none';
        if (evCmds.length > 0) {
          const isPlaceholder = evCmds.every(ec => typeof ec === 'string' && ec.startsWith('Write-Output'));
          if (isPlaceholder) {
            evDesc = 'Write-Output placeholder only';
          } else {
            evDesc = evCmds.map(ec => {
              if (typeof ec === 'string') return ec.split('|')[0].trim().substring(0, 80);
              return JSON.stringify(ec).substring(0, 80);
            }).join('; ');
          }
        }

        const hasGet = (entry.get_command || (entry.sub_commands || []).some(sc => sc.get_command)) ? 'yes' : 'no';
        lines.push(`- **${engine}** — ${label}${manOnly}${evOnly}`);
        lines.push(`  - get_command: ${hasGet}`);
        lines.push(`  - evidence_commands: ${evDesc}`);
      }
    }

    // Evidence files
    const evFiles = getEvidenceFiles(cid);
    if (evFiles.length > 0) {
      lines.push(`- Evidence files: ${evFiles.join(', ')}`);
    } else {
      lines.push('- Evidence files: none found');
    }
    lines.push('');

    // === NEED ===
    lines.push('**NEED (per domain files):**');
    if (rr && rr.evidence_minimum) {
      const mustHave = rr.evidence_minimum.must_have || [];
      const niceToHave = rr.evidence_minimum.nice_to_have || [];
      for (const emxId of mustHave) {
        const arch = archetypeMap[emxId] || archetypeMap[emxId.toUpperCase()];
        if (arch) {
          lines.push(`- \u2757 **MUST HAVE** — ${arch.archetype_id}: ${arch.name}`);
          lines.push(`  - ${arch.description}`);
          lines.push(`  - Assessor expects: ${(arch.assessor_methods_expected || []).join(', ')}`);
          lines.push(`  - Acceptable forms: ${(arch.acceptable_forms_examples || []).join('; ')}`);
        } else {
          lines.push(`- \u2757 **MUST HAVE** — ${emxId} (archetype not found in catalog)`);
        }
      }
      for (const emxId of niceToHave) {
        const arch = archetypeMap[emxId] || archetypeMap[emxId.toUpperCase()];
        if (arch) {
          lines.push(`- \u25cb Nice to have — ${arch.archetype_id}: ${arch.name}`);
        } else {
          lines.push(`- \u25cb Nice to have — ${emxId}`);
        }
      }
    } else {
      lines.push('- No evidence_minimum defined in RRS');
    }

    if (assessor) {
      lines.push(`- Assessor intent: ${assessor.assessor_intent}`);
      lines.push(`- Failure modes: ${(assessor.common_failure_modes || []).join('; ')}`);
    }
    lines.push('');

    // === RECOMMENDATION ===
    lines.push('**RECOMMENDATION:**');

    // Analyze gap
    const evCmds = allEntries.flatMap(e => e.evidence_commands || []);
    const hasRealEvCmd = evCmds.some(ec => typeof ec === 'string' && !ec.startsWith('Write-Output'));
    const hasPlaceholder = evCmds.some(ec => typeof ec === 'string' && ec.startsWith('Write-Output'));
    const hasGetCmd = allEntries.some(e => e.get_command || (e.sub_commands || []).some(sc => sc.get_command));
    const mustHave = (rr?.evidence_minimum?.must_have || []);

    if (hasRealEvCmd && mustHave.length > 0) {
      // Has evidence command — check if it maps to the required archetypes
      lines.push('- \u2705 Has automated evidence collection. Verify output covers required EMX archetypes:');
      for (const emxId of mustHave) {
        const arch = archetypeMap[emxId] || archetypeMap[emxId.toUpperCase()];
        lines.push(`  - ${emxId}: ${arch ? arch.name : '(unknown)'}`);
      }
      lines.push('- Consider adding EMX archetype ID to evidence file metadata for traceability');
    } else if (hasGetCmd && !hasRealEvCmd) {
      // Has get_command but no evidence command — easy fix
      lines.push('- \u26a0\ufe0f **Gap: get_command exists but no evidence_command.** Copy/adapt the get_command into an `evidence_commands` array so the evidence collector captures live data.');
      if (hasPlaceholder) {
        lines.push('- Replace `Write-Output` placeholder with the actual PowerShell query.');
      }
      lines.push('- Suggested evidence_command:');
      for (const entry of allEntries) {
        if (entry.get_command) {
          const cmd = entry.get_command.split('|')[0].trim();
          lines.push(`  - `+ '`' + cmd.substring(0, 120) + ' | ConvertTo-Json -Depth 5`');
        }
        for (const sc of (entry.sub_commands || [])) {
          if (sc.get_command) {
            const cmd = sc.get_command.split('|')[0].trim();
            lines.push(`  - `+ '`' + cmd.substring(0, 120) + ' | ConvertTo-Json -Depth 5`');
            break; // just first sub_command
          }
        }
      }
    } else if (hasPlaceholder && !hasGetCmd) {
      // Pure manual — no technical query possible
      lines.push('- \u274c **Gap: No automatable evidence.** This control requires manual evidence upload.');
      lines.push('- **Best Practice:** Replace `Write-Output` placeholder with structured JSON prompt that:');
      lines.push('  1. Identifies the required EMX archetype(s)');
      lines.push('  2. Lists specific artifacts the operator must upload (format, fields, examples)');
      lines.push('  3. References the NIST control and assessor expectation');
      lines.push('- Consider adding a GUI upload widget on the Evidence card for manual artifacts');
    } else if (allEntries.length === 0) {
      lines.push('- \u274c **Gap: No registry entry at all.** Add a manual_gate or evidence_only entry to the registry.');
    } else {
      // Fallback
      lines.push('- Review and enrich evidence collection for this control');
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }
}

// ─────────────────── EXCLUDED ───────────────────
lines.push('## EXCLUDED Controls (21)');
lines.push('');
lines.push('These controls are out of scope per the Strategic Intent baseline. Each still needs a documented justification that an assessor will review. The question is: does Stamper capture the exclusion rationale in a form the assessor can consume?');
lines.push('');

const exFamilies = {};
for (const c of excluded) {
  const fam = c.family;
  if (!exFamilies[fam]) exFamilies[fam] = [];
  exFamilies[fam].push(c);
}

for (const fam of familyOrder) {
  const controls = exFamilies[fam];
  if (!controls || controls.length === 0) continue;

  lines.push(`### ${fam} — ${familyMap[fam]}`);
  lines.push('');

  for (const ctrl of controls) {
    const cid = ctrl.control_id;
    const practice = ctrl.practice.split('\n')[0].replace(/\s+/g, ' ').trim();
    const ex = exclusions[cid];

    lines.push(`#### ${cid} — ${practice}`);
    lines.push('');

    // === HAVE ===
    lines.push('**HAVE:**');
    if (ex) {
      lines.push(`- Exclusion justification: "${ex.justification}"`);
      if (ex.si_field) lines.push(`  - SI field: ${ex.si_field} = ${ex.si_value}`);
    } else {
      lines.push('- \u274c No exclusion record found');
    }

    // Check if there are still registry entries (some excluded controls have them)
    const m365 = controlToM365[cid] || [];
    const infra = controlToInfra[cid] || [];
    if (m365.length + infra.length > 0) {
      lines.push(`- Registry entries still present: ${[...m365, ...infra].map(e => e.label || e.entry_id).join(', ')}`);
    }
    lines.push('');

    // === NEED ===
    lines.push('**NEED:**');
    lines.push('- Documented exclusion rationale traceable to Strategic Intent baseline');
    lines.push('- Assessor-consumable artifact (not just internal JSON metadata)');
    if (ex) {
      lines.push(`- Justification anchored to SI field: \`${ex.si_field}\` = \`${ex.si_value}\``);
    }
    lines.push('');

    // === RECOMMENDATION ===
    lines.push('**RECOMMENDATION:**');
    if (ex && ex.justification) {
      lines.push('- \u2705 Exclusion rationale is documented in Mission Plan');
      lines.push('- **Best Practice:** Generate a formal "Scope Exclusion Statement" evidence artifact per control that includes:');
      lines.push(`  1. Control ID and practice text`);
      lines.push(`  2. Exclusion justification: "${ex.justification}"`);
      lines.push(`  3. SI baseline reference: ${ex.si_field} = ${ex.si_value}`);
      lines.push('  4. Compensating controls (if any)');
      lines.push('  5. Approval authority and date');
      lines.push('- This can be auto-generated from the Mission Plan data and exported as a PDF/JSON artifact');
    } else {
      lines.push('- \u274c **Gap: No documented exclusion.** Add scope_exclusion entry to Mission Plan with SI baseline reference.');
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }
}

// Summary
lines.push('## Summary');
lines.push('');

let nsGaps = 0, nsPartial = 0, nsCovered = 0;
for (const c of nonStack) {
  const entries = [...(controlToM365[c.control_id] || []), ...(controlToInfra[c.control_id] || [])];
  const evCmds = entries.flatMap(e => e.evidence_commands || []);
  const hasReal = evCmds.some(ec => typeof ec === 'string' && !ec.startsWith('Write-Output'));
  const hasGet = entries.some(e => e.get_command || (e.sub_commands || []).some(sc => sc.get_command));
  if (hasReal) nsCovered++;
  else if (hasGet) nsPartial++;
  else nsGaps++;
}

let exGaps = 0, exCovered = 0;
for (const c of excluded) {
  if (exclusions[c.control_id]) exCovered++;
  else exGaps++;
}

lines.push('| Category | Covered | Partial | Gap |');
lines.push('|----------|---------|---------|-----|');
lines.push(`| Non-Stack (22) | ${nsCovered} | ${nsPartial} | ${nsGaps} |`);
lines.push(`| Excluded (21) | ${exCovered} | — | ${exGaps} |`);
lines.push('');
lines.push('### Priority Actions');
lines.push('');
lines.push('1. **Tier 1 (Quick Win):** Add `evidence_commands` to the 9 Non-Stack controls that have get_commands but no evidence collection');
lines.push('2. **Tier 2 (Structured Prompts):** Replace 4 `Write-Output` placeholders with structured JSON including EMX archetype references');
lines.push('3. **Tier 3 (Scope Exclusion Artifacts):** Auto-generate formal exclusion statement documents from Mission Plan data for all 21 excluded controls');
lines.push('4. **Tier 4 (Evidence Card Upload):** Add GUI upload widget for manual evidence artifacts (training records, sanitization logs, SSP)');
lines.push('');

const output = lines.join('\n');
const outPath = 'docs/CMMC-L2-Evidence-Gap-Analysis.md';
fs.writeFileSync(outPath, output, 'utf8');
console.log(`Written ${lines.length} lines to ${outPath}`);
console.log(`Non-Stack: ${nsCovered} covered, ${nsPartial} partial, ${nsGaps} gaps`);
console.log(`Excluded: ${exCovered} covered, ${exGaps} gaps`);
