// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * W4-EO4 — claim accuracy. The measured numbers EvidenceOps may quote, pinned to the data:
 *   - 111 control snippet templates (src/eo/data/snippet-templates, loaded by SnippetTemplateEngine)
 *   + 7 narrative templates (src/shared/data/snippet-templates, loaded by DirectiveNarrativeBuilder,
 *     SectionTwoGenerator, SnippetDataResolver) = the templates in use;
 *   - 85 of the 110 reference controls have an automated (graph) signal in the control-signal
 *     registry EO evaluates. FC-EO-D (EO-03) built the 6-control gain (79 -> 85) as an EO-owned
 *     overlay (`src/eo/mapping/eoRegistryOverlay.ts`, since deleted); FC-EO-H (2026-09-28) confirms
 *     ces-shared 2.8.0 promoted all six verbatim into the shared registry itself, so the shared
 *     asset alone is now 85 — no overlay/merge remains in this module. 107 practice NUMBERS appear
 *     in the shared asset, but that is not signal coverage;
 *   - src/eo/generation/templates (the superseded, never-loaded set) is DELETED (FC-EO-C EO-06,
 *     2026-09-27): the folder is gone and no source module references it.
 * And no EO surface (UI, README, source, current docs) repeats the stale claims.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SignalToControlMapper } from '../../src/eo/mapping/SignalToControlMapper';
import { evaluatorRegistry } from '../../src/eo/mapping/evaluators/index';

const ROOT = path.resolve(__dirname, '../..');
const countHbs = (dir: string): number => (fs.readdirSync(dir, { recursive: true }) as string[])
  .filter(f => String(f).endsWith('.hbs')).length;

describe('W4-EO4: measured template and signal counts', () => {
  it('templates in use: 111 control snippets + 7 narrative templates', () => {
    expect(countHbs(path.join(ROOT, 'src/eo/data/snippet-templates'))).toBe(111);
    expect(countHbs(path.join(ROOT, 'src/shared/data/snippet-templates'))).toBe(7);
  });

  it('the template dirs counted are the ones the source actually loads', () => {
    const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf-8');
    expect(read('src/eo/generation/SnippetTemplateEngine.ts')).toContain("'../data/snippet-templates'");
    expect(read('src/eo/generation/DirectiveNarrativeBuilder.ts')).toContain("'src/shared/data/snippet-templates'");
  });

  it('FC-EO-C EO-06: src/eo/generation/templates is deleted and nothing references it', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/eo/generation/templates'))).toBe(false);
    const srcFiles = (fs.readdirSync(path.join(ROOT, 'src'), { recursive: true }) as string[])
      .filter(f => /\.ts$/.test(String(f)) && !/__tests__/.test(String(f)));
    const refs = srcFiles.filter(f => /generation[\\/]templates|['"]\.\/templates['"]|['"]templates\/(ac|sc|ia|partials)/.test(
      fs.readFileSync(path.join(ROOT, 'src', String(f)), 'utf-8')));
    expect(refs).toEqual([]);
    // Every .hbs left under src/ is in one of the two loaded template dirs (111 + 7), nowhere else.
    const hbs = (fs.readdirSync(path.join(ROOT, 'src'), { recursive: true }) as string[])
      .map(f => String(f).split(path.sep).join('/')).filter(f => f.endsWith('.hbs'));
    expect(hbs.filter(f => !/^(eo|shared)\/data\/snippet-templates\//.test(f))).toEqual([]);
    expect(hbs.length).toBe(111 + 7);
  });

  it('85 of 110 reference controls have an automated (graph) signal in the registry EO evaluates (shared asset alone, no overlay)', () => {
    const shared = JSON.parse(fs.readFileSync(require.resolve('ces-shared/data/control-signal-registry'), 'utf-8')) as
      Record<string, { signals?: Array<{ type: string }> }>;
    const reference = JSON.parse(fs.readFileSync(path.resolve(ROOT, '../ces-shared/src/data/cmmc-l2-controls.reference.json'), 'utf-8')) as
      { controls: Array<{ control_id: string }> };
    const refIds = new Set(reference.controls.map(c => c.control_id));
    expect(refIds.size).toBe(110);
    const automatedIn = (reg: Record<string, { signals?: Array<{ type: string }> }>) => Object.entries(reg)
      .filter(([id, e]) => refIds.has(id) && (e.signals ?? []).some(s => s.type === 'graph')).map(([id]) => id);
    // FC-EO-H (2026-09-28): ces-shared 2.8.0 promoted the 6 EO overlay entries into the shared
    // asset itself, so the shared registry alone is now 85 — the same 85 EO evaluates.
    expect(automatedIn(shared).length).toBe(85);
    const mapper = new SignalToControlMapper();
    const effective = Object.fromEntries(mapper.controlIds.map(id => [id, mapper.entryFor(id)!]));
    expect(automatedIn(effective).length).toBe(85);
    // The former overlay's 6 ids are present in BOTH sets now — no longer EO-exclusive.
    const overlayIds = ['AT.L2-3.2.1', 'AT.L2-3.2.3', 'AU.L2-3.3.5', 'PS.L2-3.9.2', 'RA.L2-3.11.2', 'SC.L2-3.13.7'];
    for (const id of overlayIds) {
      expect(automatedIn(shared)).toContain(id);
      expect(automatedIn(effective)).toContain(id);
    }
    // "107" is only the count of distinct practice numbers named — not signal coverage.
    const practiceNumbers = new Set(Object.keys(shared).map(id => id.replace(/^[A-Z]{2}\.L[12]-/, '')));
    expect(practiceNumbers.size).toBe(107);
  });

  it('the EO registry overlay is retired: no source file exists or is referenced', () => {
    for (const f of ['src/eo/mapping/eoRegistryOverlay.ts', 'src/eo/mapping/effectiveRegistry.ts']) {
      expect(fs.existsSync(path.join(ROOT, f))).toBe(false);
    }
    const srcFiles = (fs.readdirSync(path.join(ROOT, 'src'), { recursive: true }) as string[])
      .filter(f => /\.ts$/.test(String(f)));
    const refs = srcFiles.filter(f => /eoRegistryOverlay|effectiveRegistry|EO_REGISTRY_OVERLAY|mergeRegistryOverlay|loadEffectiveMicrosoftRegistry/
      .test(fs.readFileSync(path.join(ROOT, 'src', String(f)), 'utf-8')));
    expect(refs).toEqual([]);
  });

  it('the 12 CHANGELOG-named orphans (11 + manualGateEvaluator kept) plus mediaDisposalEvaluator are gone from evaluatorRegistry', () => {
    // FC-EO-H step 2: dropped-duplicate orphans from ces-shared 2.8.0's registry cleanup. Each
    // reference control they used to sit under already has its OWN distinct evaluator (confirmed
    // by re-checking the shared registry directly), so deleting these is not a coverage loss.
    // mediaDisposalEvaluator was MP.L2-3.8.3's evaluator (not in the CHANGELOG's 12 — it was
    // handled separately, replaced by a manual gate under the correct MP.L1-3.8.3 id) but is
    // orphaned by the same cleanup, so it is retired here too.
    const removed = [
      'cuiAccessEvaluator', 'transactionTypesEvaluator', 'externalConnectionsEvaluator',
      'sharepointSharingEvaluator', 'mfaEvaluator', 'authenticationEvaluator',
      'boundaryProtectionEvaluator', 'publicNetworkEvaluator', 'flawRemediationEvaluator',
      'maliciousCodeProtectionEvaluator', 'secureScoreEvaluator', 'mediaDisposalEvaluator',
    ];
    for (const name of removed) {
      expect((evaluatorRegistry as Record<string, unknown>)[name]).toBeUndefined();
    }
    // manualGateEvaluator is the 12th CHANGELOG name — CHANGELOG says "no loss" because it is a
    // shared, still-heavily-used manual-gate function, never itself orphaned.
    expect(typeof evaluatorRegistry.manualGateEvaluator).toBe('function');
  });

  it('every evaluator the shared Microsoft registry names exists (nothing silently loses an assessable control)', () => {
    const shared = JSON.parse(fs.readFileSync(require.resolve('ces-shared/data/control-signal-registry'), 'utf-8')) as
      Record<string, { evaluator: string }>;
    const namedByRegistry = new Set(Object.values(shared).map(e => e.evaluator));
    for (const name of namedByRegistry) {
      expect(typeof (evaluatorRegistry as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('dead-evaluator inventory is pinned to the known, pre-existing (unrelated) gap — not a new regression', () => {
    // Every Microsoft evaluator not referenced by any registry entry. The FC-EO-H cleanup (the 12
    // CHANGELOG orphans + mediaDisposalEvaluator) accounts for zero of these three — they predate
    // this session and are unrelated to the ces-shared 2.8.0 duplicate-key cleanup: G3 #3 built
    // riskDetectionPostureEvaluator/vulnerabilityPostureEvaluator and dlpEvaluator with real signal
    // logic (tests/assessment/evaluators/si-risk-vuln-coverage.test.ts) but never wired them into
    // the (ces-shared-owned) registry. Tracked: docs/requirements/REQ-ces-shared-dead-evaluator-coverage-gap.md.
    // If this list grows, that is a NEW regression this test will catch.
    const shared = JSON.parse(fs.readFileSync(require.resolve('ces-shared/data/control-signal-registry'), 'utf-8')) as
      Record<string, { evaluator: string }>;
    const namedByRegistry = new Set(Object.values(shared).map(e => e.evaluator));
    const dead = Object.keys(evaluatorRegistry).filter(name => !namedByRegistry.has(name));
    expect(dead.sort()).toEqual(['dlpEvaluator', 'riskDetectionPostureEvaluator', 'vulnerabilityPostureEvaluator']);
  });
});

describe('W4-EO4: no stale count claims on EO surfaces', () => {
  const STALE = [/\b126\s+(document\s+|snippet\s+|ssp\s+)?templates\b/i, /\b107\s*\/\s*110\b/, /\b107\s+of\s+110\s+(control\s+)?signals?\b/i];
  const SURFACES = ['README.md', 'public', 'src', 'docs'];
  // Historical plans keep their original numbers under a dated "historical" banner.
  const HISTORICAL = new Set(['docs/ssp-generator-action-plan.md', 'docs/context/ARCHITECTURE_DECISION_RECORD.md']);

  it('grep finds no stale claim', () => {
    const hits: string[] = [];
    const walk = (rel: string) => {
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) return;
      if (fs.statSync(abs).isDirectory()) { for (const f of fs.readdirSync(abs)) walk(path.join(rel, f)); return; }
      if (!/\.(md|ts|html|hbs|json|js)$/.test(rel) || /__tests__|node_modules/.test(rel)) return;
      const relPosix = rel.split(path.sep).join('/');
      if (HISTORICAL.has(relPosix)) return;
      fs.readFileSync(abs, 'utf-8').split(/\r?\n/).forEach((line, i) => {
        if (STALE.some(re => re.test(line))) hits.push(`${relPosix}:${i + 1}: ${line.trim()}`);
      });
    };
    SURFACES.forEach(walk);
    expect(hits).toEqual([]);
  });

  it('historical docs carry the banner with the measured numbers', () => {
    for (const f of HISTORICAL) {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf-8');
      expect({ f, banner: /Historical \(W4-EO4[^)]*\).*111 \+ 7 templates.*85 of 110/s.test(text) }).toEqual({ f, banner: true });
    }
  });
});
