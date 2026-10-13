// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * Catalog discovery — builds the catalog from the sources on every call.
 *
 * There is no hand-maintained list to drift. Each kind is discovered from its
 * canonical source: scenario files, deck xlsx files, ACT_GROUPS, DEMO_SCENARIOS,
 * and the hard-coded pipelines (run, run-m2, run-all).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  Runnable,
  RunnableKind,
  RunMode,
  ModeSpec,
  MetaOverlay,
  MetaEntry,
} from './types.js';
import { ACT_GROUPS, type ActGroup } from '../demo/acts/act-roster.js';
import { DEMO_SCENARIOS } from '../demo/scenario-registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runnableId(kind: RunnableKind, name: string): string {
  return `${kind}:${name}`;
}

function applyMeta(base: Runnable, meta: MetaEntry | undefined): Runnable {
  if (!meta) return base;
  return {
    ...base,
    name: meta.title ?? base.name,
    summary: meta.summary ?? base.summary,
    tags: meta.tags ?? base.tags,
    audience: meta.audience ?? base.audience,
    retired: meta.retired ?? base.retired,
    notes: meta.notes ?? base.notes,
  };
}

// ---------------------------------------------------------------------------
// Scenario discovery
// ---------------------------------------------------------------------------

async function discoverScenarios(
  projectRoot: string,
  meta: MetaOverlay,
): Promise<Runnable[]> {
  const scenariosDir = path.join(projectRoot, 'scenarios');
  let entries: string[];
  try {
    entries = await fs.readdir(scenariosDir);
  } catch {
    return [];
  }

  const runnables: Runnable[] = [];
  for (const entry of entries.filter((f) => f.endsWith('.json')).sort()) {
    const name = path.basename(entry, '.json');
    const id = runnableId('scenario', name);
    const filePath = path.join('scenarios', entry);

    // Try to read description from the scenario file
    let description = '';
    try {
      const raw = JSON.parse(await fs.readFile(path.join(scenariosDir, entry), 'utf8'));
      description = raw.description ?? '';
    } catch { /* non-fatal */ }

    const base: Runnable = {
      id,
      kind: 'scenario',
      name,
      summary: description || `Test scenario: ${name}`,
      sourcePath: filePath,
      modes: [
        { mode: 'test', argv: ['run-scenario', filePath], label: 'headless test' },
      ],
      modules: [],
      tags: name.startsWith('zz-') ? ['deliberate-fail'] : [],
      audience: 'internal',
      retired: false,
      notes: '',
      usesActs: [],
      presentedInDecks: [],
      testFiles: [],
    };
    runnables.push(applyMeta(base, meta[id]));
  }

  // Also discover eval configs (scenarios/eval/*.json) — these run via demo:eval
  const evalDir = path.join(scenariosDir, 'eval');
  let evalEntries: string[];
  try {
    evalEntries = await fs.readdir(evalDir);
  } catch {
    evalEntries = [];
  }
  for (const entry of evalEntries.filter((f) => f.endsWith('.json')).sort()) {
    const name = path.basename(entry, '.json');
    const id = runnableId('scenario', `eval/${name}`);
    const filePath = path.join('scenarios', 'eval', entry);

    let description = '';
    try {
      const raw = JSON.parse(await fs.readFile(path.join(evalDir, entry), 'utf8'));
      description = raw.description ?? '';
    } catch { /* non-fatal */ }

    const base: Runnable = {
      id,
      kind: 'scenario',
      name: `eval/${name}`,
      summary: description || `Eval config: ${name}`,
      sourcePath: filePath,
      modes: [
        { mode: 'test', argv: ['demo:eval', '--config', name], label: 'eval run' },
      ],
      modules: [],
      tags: ['eval'],
      audience: 'internal',
      retired: false,
      notes: '',
      usesActs: [],
      presentedInDecks: [],
      testFiles: [],
    };
    runnables.push(applyMeta(base, meta[id]));
  }

  return runnables;
}

// ---------------------------------------------------------------------------
// Deck discovery
// ---------------------------------------------------------------------------

/**
 * Extract op ids from a deck xlsx without pulling in the full xlsx-loader
 * runtime (which needs read-excel-file). We do a lightweight scan: read the
 * deck file, find the `op` column, and collect unique op ids.
 */
async function readDeckOpIds(deckPath: string): Promise<string[]> {
  try {
    const { readSheet } = await import('read-excel-file/node');
    const rows = await readSheet(deckPath);
    if (rows.length < 2) return [];

    const header = rows[0].map((h) =>
      String(h ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ''),
    );
    const opCol = header.indexOf('op');
    if (opCol === -1) return [];

    const ops = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
      const val = rows[i][opCol];
      if (val && typeof val === 'string' && val.trim()) {
        ops.add(val.trim());
      }
    }
    return [...ops].sort();
  } catch {
    return [];
  }
}

/**
 * Extract tools (modules) from a deck xlsx.
 */
async function readDeckTools(deckPath: string): Promise<string[]> {
  try {
    const { readSheet } = await import('read-excel-file/node');
    const rows = await readSheet(deckPath);
    if (rows.length < 2) return [];

    const header = rows[0].map((h) =>
      String(h ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ''),
    );
    const toolsCol = header.findIndex((h) => h === 'tools' || h === 'tool' || h === 'cestools' || h === 'modules');
    if (toolsCol === -1) return [];

    const tools = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
      const val = rows[i][toolsCol];
      if (val && typeof val === 'string') {
        for (const t of val.split(',')) {
          const trimmed = t.trim().toLowerCase();
          if (trimmed) tools.add(trimmed);
        }
      }
    }
    return [...tools].sort();
  } catch {
    return [];
  }
}

/**
 * Derive which act groups a deck uses: groups whose full opIds are a subset of
 * the deck's op set.
 */
function deckActGroups(deckOpIds: string[]): string[] {
  const deckOps = new Set(deckOpIds);
  return ACT_GROUPS
    .filter((g) => g.opIds.every((op) => deckOps.has(op)))
    .map((g) => g.id);
}

async function discoverDecks(
  projectRoot: string,
  meta: MetaOverlay,
): Promise<Runnable[]> {
  const demosDir = path.join(projectRoot, 'demos');
  let entries: string[];
  try {
    entries = await fs.readdir(demosDir);
  } catch {
    return [];
  }

  const runnables: Runnable[] = [];
  for (const entry of entries.filter((f) => f.endsWith('.xlsx') && !f.startsWith('~$')).sort()) {
    const name = path.basename(entry, '.xlsx');
    const id = runnableId('deck', name);
    const filePath = path.join('demos', entry);
    const fullPath = path.join(demosDir, entry);

    const opIds = await readDeckOpIds(fullPath);
    const tools = await readDeckTools(fullPath);
    const actGroupIds = deckActGroups(opIds);

    const modes: ModeSpec[] = [
      {
        mode: 'test',
        argv: ['demo:show', '--check', filePath],
        label: 'headless deck check',
      },
      {
        mode: 'demo',
        argv: ['demo:show', filePath],
        label: 'presented run',
      },
    ];

    const base: Runnable = {
      id,
      kind: 'deck',
      name,
      summary: `Demo deck: ${name}`,
      sourcePath: filePath,
      modes,
      modules: tools,
      tags: [],
      audience: 'customer',
      retired: false,
      notes: '',
      usesActs: actGroupIds,
      presentedInDecks: [],
      testFiles: [],
    };
    runnables.push(applyMeta(base, meta[id]));
  }

  return runnables;
}

// ---------------------------------------------------------------------------
// Act discovery
// ---------------------------------------------------------------------------

function discoverActs(meta: MetaOverlay): Runnable[] {
  return ACT_GROUPS.map((g: ActGroup) => {
    const id = runnableId('act', g.id);
    const tiers: ModeSpec[] = [
      { mode: 'test', argv: ['demo:acts-test', '--docs-only', '--act', g.id], label: 'docs-only check' },
      { mode: 'test', argv: ['demo:acts-test', '--quick', '--act', g.id], label: 'quick test' },
      { mode: 'test', argv: ['demo:acts-test', '--full', '--act', g.id], label: 'full test' },
    ];

    // Modules from expectedArming
    const modules: string[] = ['stacksim'];
    if (g.expectedArming.withAoGui) modules.push('ao');
    if (g.expectedArming.withEo) modules.push('eo');
    if (g.expectedArming.withStamperGui) modules.push('stamper');
    if (g.expectedArming.withMuster) modules.push('muster');

    const base: Runnable = {
      id,
      kind: 'act',
      name: g.id,
      summary: `Demo act group: ${g.id} (${g.dossierEntries.join(', ')})`,
      sourcePath: undefined,
      modes: tiers,
      modules: modules.sort(),
      tags: [],
      audience: 'internal',
      retired: false,
      notes: `Dossier: ${g.dossierEntries.join(', ')}. Checks: ${g.checkIds.join(', ')}.`,
      usesActs: [],
      presentedInDecks: [], // filled in cross-link pass
      testFiles: [],        // filled in cross-link pass
    };
    return applyMeta(base, meta[id]);
  });
}

// ---------------------------------------------------------------------------
// Pipeline discovery
// ---------------------------------------------------------------------------

function discoverPipelines(meta: MetaOverlay): Runnable[] {
  const pipelines: Runnable[] = [];

  // The three demo scenarios (needle, eval, e2e)
  for (const ds of DEMO_SCENARIOS) {
    const id = runnableId('pipeline', `demo-${ds.id}`);
    const modes: ModeSpec[] = [
      { mode: 'test', argv: ['demo:run', '--scenario', ds.id], label: `demo:run ${ds.id}` },
    ];
    if (ds.id === 'e2e') {
      modes[0] = {
        mode: 'test',
        argv: ['demo:e2e', '--config', 'demo-dib-small'],
        label: 'demo:e2e end-to-end',
      };
    }
    const base: Runnable = {
      id,
      kind: 'pipeline',
      name: `demo-${ds.id}`,
      summary: ds.description,
      modes,
      modules: ['stacksim', 'muster', 'stamper', 'ao', 'eo'],
      tags: [],
      audience: 'internal',
      retired: false,
      notes: '',
      usesActs: [],
      presentedInDecks: [],
      testFiles: [],
    };
    pipelines.push(applyMeta(base, meta[id]));
  }

  // Hard-coded pipelines: run-all, run (M1), run-m2, demo:preflight, demo:reset
  const hardcoded: Array<{ name: string; summary: string; argv: string[]; label: string }> = [
    { name: 'run-all', summary: 'Run all scenarios serially (M3)', argv: ['run-all'], label: 'all scenarios' },
    { name: 'run-m1', summary: 'M1 single-scenario smoke test', argv: ['run'], label: 'M1 run' },
    { name: 'run-m2', summary: 'M2 scenario-file-backed run', argv: ['run-m2'], label: 'M2 run' },
    { name: 'demo-preflight', summary: 'Demo preflight checks', argv: ['demo:preflight'], label: 'preflight' },
    { name: 'demo-reset', summary: 'Reset demo state', argv: ['demo:reset'], label: 'reset' },
  ];
  for (const h of hardcoded) {
    const id = runnableId('pipeline', h.name);
    const base: Runnable = {
      id,
      kind: 'pipeline',
      name: h.name,
      summary: h.summary,
      modes: [{ mode: 'test', argv: h.argv, label: h.label }],
      modules: [],
      tags: [],
      audience: 'internal',
      retired: false,
      notes: '',
      usesActs: [],
      presentedInDecks: [],
      testFiles: [],
    };
    pipelines.push(applyMeta(base, meta[id]));
  }

  return pipelines;
}

// ---------------------------------------------------------------------------
// Cross-linking pass
// ---------------------------------------------------------------------------

async function discoverTestFiles(projectRoot: string): Promise<Map<string, string[]>> {
  const testsDir = path.join(projectRoot, 'tests');
  let entries: string[];
  try {
    entries = await fs.readdir(testsDir);
  } catch {
    return new Map();
  }

  // Map act ids to test files: tests/demo-acts-<id>*.test.ts
  const map = new Map<string, string[]>();
  for (const entry of entries) {
    const match = entry.match(/^demo-acts-([a-z0-9-]+)\.test\.ts$/);
    if (match) {
      const actId = match[1];
      const existing = map.get(actId) ?? [];
      existing.push(path.join('tests', entry));
      map.set(actId, existing);
    }
  }
  return map;
}

function crossLink(runnables: Runnable[], testFileMap: Map<string, string[]>): Runnable[] {
  // Build deck→acts index for reverse lookup (act→decks)
  const actToDecks = new Map<string, string[]>();
  for (const r of runnables) {
    if (r.kind === 'deck') {
      for (const actId of r.usesActs) {
        const existing = actToDecks.get(actId) ?? [];
        existing.push(r.id);
        actToDecks.set(actId, existing);
      }
    }
  }

  return runnables.map((r) => {
    if (r.kind === 'act') {
      return {
        ...r,
        presentedInDecks: actToDecks.get(r.name) ?? [],
        testFiles: testFileMap.get(r.name) ?? [],
      };
    }
    return r;
  });
}

// ---------------------------------------------------------------------------
// Meta overlay
// ---------------------------------------------------------------------------

export async function loadMetaOverlay(projectRoot: string): Promise<MetaOverlay> {
  const metaPath = path.join(projectRoot, 'catalog', 'meta.json');
  try {
    const raw = await fs.readFile(metaPath, 'utf8');
    return JSON.parse(raw) as MetaOverlay;
  } catch {
    return {};
  }
}

export async function saveMetaOverlay(
  projectRoot: string,
  overlay: MetaOverlay,
): Promise<void> {
  const metaPath = path.join(projectRoot, 'catalog', 'meta.json');
  await fs.mkdir(path.dirname(metaPath), { recursive: true });
  await fs.writeFile(metaPath, JSON.stringify(overlay, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CatalogOptions {
  projectRoot: string;
  /** Override meta instead of reading from disk. */
  meta?: MetaOverlay;
  /** Include retired runnables (default false). */
  includeRetired?: boolean;
  /** Filter by kind. */
  kind?: RunnableKind;
}

export async function buildCatalog(opts: CatalogOptions): Promise<Runnable[]> {
  const { projectRoot, includeRetired = false, kind } = opts;
  const meta = opts.meta ?? (await loadMetaOverlay(projectRoot));

  const [scenarios, decks, acts, pipelines, testFileMap] = await Promise.all([
    discoverScenarios(projectRoot, meta),
    discoverDecks(projectRoot, meta),
    Promise.resolve(discoverActs(meta)),
    Promise.resolve(discoverPipelines(meta)),
    discoverTestFiles(projectRoot),
  ]);

  let all = crossLink([...scenarios, ...decks, ...acts, ...pipelines], testFileMap);

  if (!includeRetired) {
    all = all.filter((r) => !r.retired);
  }
  if (kind) {
    all = all.filter((r) => r.kind === kind);
  }

  return all.sort((a, b) => a.id.localeCompare(b.id));
}

/** Export the known CLI command names for catalog:check validation. */
export const COMMAND_NAMES: readonly string[] = [
  'run',
  'run-m2',
  'run-scenario',
  'run-all',
  'dashboard',
  'coverage',
  'demo:preflight',
  'demo:reset',
  'demo:run',
  'demo:dashboard',
  'demo:eval',
  'demo:e2e',
  'demo:show',
  'demo:acts-test',
];
