// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Extract CMMC L2 control implementation details from the latest MP + EP + registries.
 * Groups controls by directive: AUTOMATED, EXCLUDED, NON-STACK
 * Within each group, lists by family and control ID.
 */
const fs = require('fs');
const path = require('path');

// Load CMMC reference
const ref = JSON.parse(fs.readFileSync('../ces-shared/src/data/cmmc-l2-controls.reference.json', 'utf8'));

// Load registries
const m365Raw = JSON.parse(fs.readFileSync('src/registry/cmmc-l2-commands.registry.json', 'utf8'));
const m365Reg = m365Raw.entries || m365Raw;
const infraRaw = JSON.parse(fs.readFileSync('src/registry/infra-cmmc-l2-commands.registry.json', 'utf8'));
const infraReg = infraRaw.entries || infraRaw;

// Load MP for directives
const mp = JSON.parse(fs.readFileSync('plan-data/vfsgov-xtra/plans/manual-mission-plan-2026-04-14T00-27-54-661Z.json', 'utf8'));
const hr = mp.outputs.human_readable_mission_plan;

// Load the latest EP
const ep = JSON.parse(fs.readFileSync('plan-data/vfsgov-xtra/plans/executable-plan-2026-04-14T02-22-31-962Z.json', 'utf8'));

// Load execution report
const report = JSON.parse(fs.readFileSync('plan-data/vfsgov-xtra/plans/execution-report-2026-04-14T02-30-33.json', 'utf8'));

// Build control -> stamper_action map from MP
const controlAction = {};
const controlMeta = {};
for (const c of hr.controls) {
  controlAction[c.requirement_id] = c.stamper_action; // 'Automated', 'Excluded', 'Non-Stack'
  controlMeta[c.requirement_id] = c;
}

// Build exclusions map
const exclusions = {};
for (const ex of hr.scope_exclusions) {
  exclusions[ex.requirement_id] = ex;
}

// Build control -> registry entries map
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

// Build control -> EP tasks map
const controlToTasks = {};
const g = ep.execution_graph;
for (const key of Object.keys(g)) {
  const task = g[key];
  for (const cid of (task.controls || [])) {
    if (!controlToTasks[cid]) controlToTasks[cid] = [];
    controlToTasks[cid].push(task);
  }
}

// Family name map
const familyMap = {};
for (const f of ref.families) {
  familyMap[f.abbreviation] = f.name;
}

// Reference control data (practice text, family, level)
const refMap = {};
for (const ctrl of ref.controls) {
  refMap[ctrl.control_id] = ctrl;
}

// Group controls by directive, then by family
const groups = {
  'Automated': {},
  'Non-Stack': {},
  'Excluded': {},
};

for (const ctrl of ref.controls) {
  const cid = ctrl.control_id;
  const action = controlAction[cid] || 'Automated'; // default
  const fam = ctrl.family;
  if (!groups[action]) groups[action] = {};
  if (!groups[action][fam]) groups[action][fam] = [];
  groups[action][fam].push(ctrl);
}

// Helper: generate bullets for a control
function generateBullets(cid) {
  const bullets = [];
  const meta = controlMeta[cid];

  // Exclusion reason
  if (exclusions[cid]) {
    const ex = exclusions[cid];
    bullets.push(`**Exclusion Reason:** ${ex.justification || 'Excluded from scope'}`);
  }

  // Gap classifications from MP
  if (meta && meta.gap_classifications && meta.gap_classifications.length > 0) {
    bullets.push(`**Gap Classifications:** ${meta.gap_classifications.join(', ')}`);
  }

  // M365 registry entries
  const m365Entries = controlToM365[cid] || [];
  for (const entry of m365Entries) {
    const label = entry.label || entry.id;
    const engine = entry.session || entry.engine || 'unknown';

    if (entry.sub_commands && entry.sub_commands.length > 0) {
      for (const sc of entry.sub_commands) {
        const scLabel = sc.label || sc.id || label;
        let desc = '';
        if (sc.get_command) {
          const getCmd = sc.get_command.split('|')[0].trim().substring(0, 120);
          desc += `Verifies via \`${getCmd}\``;
        }
        if (sc.set_command && !entry.manual_only) {
          const setCmd = sc.set_command.split(';')[0].trim().substring(0, 120);
          desc += desc ? '; ' : '';
          desc += `Configures via \`${setCmd}\``;
        }
        if (entry.manual_only || entry.evidence_only) {
          desc += desc ? ' ' : '';
          desc += '*(evidence-only)*';
        }
        if (desc) bullets.push(`**${engine}** — ${scLabel}: ${desc}`);
      }
    } else {
      let desc = '';
      if (entry.get_command) {
        desc = `Verifies via \`${entry.get_command.split('|')[0].trim().substring(0, 100)}\``;
      }
      if (entry.set_command && !entry.manual_only) {
        desc += desc ? '; ' : '';
        desc += `Configures via \`${entry.set_command.split(';')[0].trim().substring(0, 100)}\``;
      }
      if (entry.manual_only || entry.evidence_only) {
        desc += ' *(evidence-only)*';
      }
      if (desc) bullets.push(`**${engine}** — ${label}: ${desc}`);
    }
  }

  // Infra registry entries
  const infraEntries = controlToInfra[cid] || [];
  for (const entry of infraEntries) {
    const label = entry.label || entry.entry_id || entry.id;
    const engine = entry.engine || 'az';

    if (entry.sub_commands && entry.sub_commands.length > 0) {
      for (const sc of entry.sub_commands) {
        const scLabel = sc.label || sc.id || label;
        let desc = '';
        if (sc.get_command) {
          desc += `Verifies via \`${sc.get_command.split('|')[0].trim().substring(0, 120)}\``;
        }
        if (sc.set_command) {
          desc += desc ? '; ' : '';
          desc += `Configures via \`${sc.set_command.split(';')[0].trim().substring(0, 120)}\``;
        }
        if (desc) bullets.push(`**${engine}** — ${scLabel}: ${desc}`);
      }
    } else {
      let desc = '';
      if (entry.get_command) {
        desc += `Verifies via \`${entry.get_command.split('|')[0].trim().substring(0, 120)}\``;
      }
      if (entry.set_command && !entry.manual_only) {
        desc += desc ? '; ' : '';
        desc += `Configures via \`${entry.set_command.split(';')[0].trim().substring(0, 120)}\``;
      }
      if (entry.manual_only || entry.evidence_only) {
        desc += desc ? ' ' : '';
        desc += '*(evidence-only)*';
      }
      if (desc) bullets.push(`**${engine}** — ${label}: ${desc}`);
    }
  }

  // EP tasks (only show for controls with no registry entries)
  const epTasks = controlToTasks[cid] || [];
  const hasRegistryEntries = m365Entries.length > 0 || infraEntries.length > 0;
  for (const task of epTasks) {
    const taskType = task.type || 'unknown';
    const layer = task.action?.args?._layer ?? '?';
    const layerName = task.action?.args?._layer_name || '';
    const taskDirective = task.action?.args?._directive || '';
    const engine = task.action?.engine || '';

    if (!hasRegistryEntries) {
      const cmd = (task.action?.command || '').split(';')[0].trim().substring(0, 120);
      const cmdStr = cmd ? `: \`${cmd}\`` : '';
      bullets.push(`**EP Task** — Layer ${layer} (${layerName}), engine=${engine}: ${taskType}${cmdStr}`);
    }
  }

  if (bullets.length === 0) {
    bullets.push('*No implementation details available*');
  }

  return bullets;
}

// Generate markdown
const lines = [];
lines.push('# CMMC Level 2 — Control Implementation Summary');
lines.push('');
lines.push(`**Tenant:** vfsgov-xtra`);
lines.push(`**Execution Date:** ${report.started_at || '2026-04-14'}`);
lines.push(`**Status:** ${report.status} — ${report.summary.total_tasks} tasks (${report.summary.completed} completed, ${report.summary.skipped} skipped, ${report.summary.failed} failed)`);
lines.push(`**Controls:** ${ref.total_controls} across ${ref.families.length} families`);
lines.push('');

// Counts table
const actionCounts = { Automated: 0, Excluded: 0, 'Non-Stack': 0 };
for (const c of ref.controls) {
  const a = controlAction[c.control_id] || 'Automated';
  actionCounts[a] = (actionCounts[a] || 0) + 1;
}
lines.push('| Directive | Controls |');
lines.push('|-----------|----------|');
lines.push(`| Automated | ${actionCounts['Automated']} |`);
lines.push(`| Non-Stack | ${actionCounts['Non-Stack']} |`);
lines.push(`| Excluded | ${actionCounts['Excluded']} |`);
lines.push(`| **Total** | **${ref.total_controls}** |`);
lines.push('');
lines.push('---');
lines.push('');

// Family order from reference
const familyOrder = ref.families.map(f => f.abbreviation);

const directiveLabels = {
  'Automated': 'AUTOMATED — Registry-backed commands with get/set/evidence lifecycle',
  'Non-Stack': 'NON-STACK — Process, policy, or physical controls requiring manual attestation',
  'Excluded': 'EXCLUDED — Out of scope per Strategic Intent baseline',
};

for (const action of ['Automated', 'Non-Stack', 'Excluded']) {
  const groupFamilies = groups[action] || {};
  const totalInGroup = Object.values(groupFamilies).reduce((s, arr) => s + arr.length, 0);

  lines.push(`## ${directiveLabels[action]} (${totalInGroup})`);
  lines.push('');

  for (const fam of familyOrder) {
    const controls = groupFamilies[fam];
    if (!controls || controls.length === 0) continue;

    lines.push(`### ${fam} — ${familyMap[fam]}`);
    lines.push('');

    for (const ctrl of controls) {
      const cid = ctrl.control_id;
      const practice = ctrl.practice.split('\n')[0].replace(/\s+/g, ' ').trim();

      lines.push(`#### ${cid} — ${practice}`);
      lines.push('');

      const bullets = generateBullets(cid);
      for (const b of bullets) {
        lines.push(`- ${b}`);
      }
      lines.push('');
    }
  }
}

// Write output
const output = lines.join('\n');
const outPath = 'docs/CMMC-L2-Control-Implementation.md';
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, output, 'utf8');
console.log(`Written ${lines.length} lines to ${outPath}`);
console.log(`Controls: ${ref.controls.length}`);
console.log(`Automated: ${actionCounts['Automated']}, Non-Stack: ${actionCounts['Non-Stack']}, Excluded: ${actionCounts['Excluded']}`);
