// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * AE-R7 / W4-EO2 — AdminOps knowledge-bank YAML lint (strict).
 *
 * The YAML set in knowledge-banks/adminops must match ces-ao's ao-commands.registry.json and
 * ces-shared's cmmc-l2-controls.reference.json (both read-only, by path) EXACTLY:
 *   - one YAML per registry command, and no YAML for an unknown command;
 *   - useCaseTitle === registry title;
 *   - controlId === the registry's first cmmcPractice, and every registry practice appears in
 *     controlId + relatedControlIds;
 *   - every control id is a reference control id (no "[VERIFY]" suffixes, no L2 spelling of an L1 id).
 * Before W4-EO2 this file only capped the drift (<= 24 titles, <= 135 ids); now any mismatch fails.
 *
 * Also: YAML-derived AdminOps text is labelled "designed procedure" unless a live, executed, SAT
 * AdminOps row exists for the control (AO golden rows through the real reader).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as yaml from 'js-yaml';
import { getCesRepository, closeAllCesRepositories } from 'ces-shared/persistence/node';
import { AdminOpsDataProvider } from '../../../src/eo/ssp/AdminOpsDataProvider';
import { SnippetDataResolver } from '../../../src/eo/ssp/SnippetDataResolver';
import { AdminOpsEvidenceReader } from '../../../src/eo/adminops/AdminOpsEvidenceReader';
import { liveSatAdminOpsControls } from '../../../src/eo/adminops/adminopsViews';
import { loadAoGolden } from './helpers/makeRealShapeRow';

const KB_DIR = path.resolve(__dirname, '../../../knowledge-banks/adminops');
const REGISTRY_PATH = path.resolve(__dirname, '../../../../ces-ao/src/registry/ao-commands.registry.json');
const CONTROLS_REF_PATH = path.resolve(__dirname, '../../../../ces-shared/src/data/cmmc-l2-controls.reference.json');

interface RegistryEntry { id: string; title: string; cmmcPractices: string[] }
interface KbYaml { useCaseId: string; useCaseTitle: string; controlId: string | string[]; relatedControlIds?: string[] }

/** Pure lint over a KB set — exported shape so the "fails on mismatch" case runs the same code. */
export function lintKnowledgeBanks(kbs: Array<{ file: string; kb: KbYaml }>, registry: RegistryEntry[], refIds: Set<string>): string[] {
  const problems: string[] = [];
  const byId = new Map(registry.map(r => [r.id, r]));
  const seen = new Map<string, string>();
  for (const { file, kb } of kbs) {
    const r = byId.get(kb.useCaseId);
    if (!r) { problems.push(`${file}: useCaseId ${kb.useCaseId} not in AO registry`); continue; }
    if (seen.has(kb.useCaseId)) problems.push(`${file}: duplicate useCaseId ${kb.useCaseId} (also ${seen.get(kb.useCaseId)})`);
    seen.set(kb.useCaseId, file);
    if (kb.useCaseTitle !== r.title) problems.push(`${file}: title "${kb.useCaseTitle}" != registry "${r.title}"`);
    if (typeof kb.controlId !== 'string') problems.push(`${file}: controlId must be a single id`);
    const primary = String(kb.controlId);
    if (primary !== r.cmmcPractices[0]) problems.push(`${file}: controlId ${primary} != registry primary ${r.cmmcPractices[0]}`);
    const all = [primary, ...(kb.relatedControlIds ?? [])];
    for (const p of r.cmmcPractices) if (!all.includes(p)) problems.push(`${file}: registry practice ${p} missing`);
    for (const id of all) if (!refIds.has(id)) problems.push(`${file}: ${id} not in cmmc-l2 reference`);
    if (new Set(all).size !== all.length) problems.push(`${file}: duplicate control ids`);
  }
  for (const r of registry) if (!seen.has(r.id)) problems.push(`registry ${r.id} (${r.title}) has no knowledge-bank YAML`);
  return problems;
}

function loadKbs(): Array<{ file: string; kb: KbYaml }> {
  return fs.readdirSync(KB_DIR).filter(f => /\.ya?ml$/.test(f))
    .map(f => ({ file: f, kb: yaml.load(fs.readFileSync(path.join(KB_DIR, f), 'utf-8')) as KbYaml }));
}

describe('AE-R7 / W4-EO2: AdminOps knowledge-bank YAML lint (strict)', () => {
  const registry: RegistryEntry[] = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  const refIds = new Set<string>(JSON.parse(fs.readFileSync(CONTROLS_REF_PATH, 'utf-8')).controls.map((c: { control_id: string }) => c.control_id));

  it('reads the AO registry and shared reference by path (read-only, not copied)', () => {
    expect(REGISTRY_PATH.split(path.sep).join('/')).toMatch(/\/ces-ao\/src\/registry\/ao-commands\.registry\.json$/);
    expect(CONTROLS_REF_PATH.split(path.sep).join('/')).toMatch(/\/ces-shared\/src\/data\/cmmc-l2-controls\.reference\.json$/);
    expect(registry.length).toBeGreaterThan(0);
    expect(refIds.size).toBe(110);
  });

  it('the realigned set has zero mismatches and one YAML per registry command', () => {
    const kbs = loadKbs();
    expect(lintKnowledgeBanks(kbs, registry, refIds)).toEqual([]);
    expect(kbs.length).toBe(registry.length);
  });

  it('the lint fails on each kind of mismatch', () => {
    const good = loadKbs();
    const mutate = (fn: (kb: KbYaml) => void) => good.map((g, i) => {
      const kb = JSON.parse(JSON.stringify(g.kb)) as KbYaml; if (i === 0) fn(kb); return { file: g.file, kb };
    });
    expect(lintKnowledgeBanks(mutate(kb => { kb.useCaseTitle += ' (old)'; }), registry, refIds).join('\n')).toMatch(/title/);
    expect(lintKnowledgeBanks(mutate(kb => { kb.controlId = String(kb.controlId).replace(/\.L1-/, '.L2-').replace(/^(\w\w)\.L2-(3\.\d+\.\d+)$/, '$1.L2-$2 [VERIFY]'); }), registry, refIds).length).toBeGreaterThan(0);
    expect(lintKnowledgeBanks(mutate(kb => { kb.useCaseId = 'Z-99'; }), registry, refIds).join('\n')).toMatch(/not in AO registry/);
    expect(lintKnowledgeBanks(good.slice(1), registry, refIds).join('\n')).toMatch(/has no knowledge-bank YAML/);
    expect(lintKnowledgeBanks(mutate(kb => { kb.relatedControlIds = [...(kb.relatedControlIds ?? []), 'CM.L2-3.4.1 [VERIFY]']; }), registry, refIds).join('\n')).toMatch(/not in cmmc-l2 reference/);
  });
});

describe('W4-EO2: YAML-derived AdminOps SSP text is labelled "designed procedure" unless a live row exists', () => {
  let tmp: string;
  beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'w4eo2-')); });
  afterAll(() => { closeAllCesRepositories(); fs.rmSync(tmp, { recursive: true, force: true }); });

  it('only the control with a live executed SAT golden row is "live execution"', () => {
    const golden = loadAoGolden() as Record<string, any>;
    const dbPath = path.join(tmp, 'ces.db');
    const repo = getCesRepository(dbPath);
    for (const [key, data] of Object.entries(golden)) repo.put('adminops_evidence', { id: `g:${key}`, ces: { tenantId: data.metadata.tenantId }, data });
    const live = liveSatAdminOpsControls(new AdminOpsEvidenceReader('golden-sim-tenant', dbPath).read().parsed);
    expect([...live]).toEqual(['AC.L1-3.1.1']);   // AO rows use the reference form (fixed by ces-ao W4-AO5)

    const provider = new AdminOpsDataProvider(KB_DIR);
    provider.initialize();
    provider.setLiveControls(live);
    // AC.L1-3.1.1: A-01's primary (registry id) — live via practice number.
    expect(provider.getByControlId('AC.L1-3.1.1')!.provenance).toBe('live execution');
    // AC.L2-3.1.5 has only a rejected / denied golden row: designed procedure.
    expect(provider.getByControlId('AC.L2-3.1.5')!.provenance).toBe('designed procedure');

    // Through SnippetDataResolver, the label rides along with every adminOps_* value.
    const resolver = new SnippetDataResolver({ adminOpsProvider: provider });
    const cn = resolver.buildControlNarrative('AC.L2-3.1.5', {} as any);
    expect(cn.mergedOdpValues?.adminOps_provenance).toBe('designed procedure');
  });

  it('with no live rows at all, every AdminOps knowledge bank is a designed procedure', () => {
    const provider = new AdminOpsDataProvider(KB_DIR);
    provider.initialize();
    const registry: RegistryEntry[] = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
    for (const r of registry) {
      expect({ id: r.id, p: provider.getByControlId(r.cmmcPractices[0])?.provenance }).toEqual({ id: r.id, p: 'designed procedure' });
    }
  });
});
