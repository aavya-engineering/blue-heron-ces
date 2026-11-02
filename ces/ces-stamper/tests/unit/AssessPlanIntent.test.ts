// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FX2-ST2 — Assess must not report plan intent as satisfied.
// A plan directive ("implement" / "validate", or the implicit default for an unlisted
// control) is intent, not evidence. Only a real tenant read (discovery `exists` with no
// NOT_SAT verdict) or a recorded real post-state (SAT evidence file, never a dry run)
// makes a control SAT. Everything else is `not_verified` and deducts its SPRS weight.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CmmcComplianceAnalyzer, computeSprsByCategory } from '../../src/core/CmmcComplianceAnalyzer';
import { evidenceFileForEntry } from '../../src/core/EvidenceReadinessAnalyzer';
import { resolveSharedDataPath } from '../../src/core/sharedData';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import type { CESControlDirective } from '../../src/types/ces-artifacts.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const reference = JSON.parse(fs.readFileSync(resolveSharedDataPath('cmmc-l2-controls.reference.json'), 'utf-8'));
const weights = new Map<string, number>(
  JSON.parse(fs.readFileSync(resolveSharedDataPath('sprs-weights.json'), 'utf-8')).controls.map((c: any) => [c.nist_ref, c.weight]),
);

const registries = () => [
  CommandRegistry.load(),
  CommandRegistry.load(path.join(ROOT, 'src/registry/infra-cmmc-l2-commands.registry.json')),
];
/** Every one of the 110 controls planned for configuration — pure intent. */
const allPlanned = (directive: 'implement' | 'validate' = 'implement'): CESControlDirective[] =>
  reference.controls.map((c: any) => ({ control_id: c.control_id, directive }));

/** Entry ids the production analyzer matches for a control (exact id + L2 variant). */
const entriesFor = (regs: CommandRegistry[], control: any): string[] => {
  const ids = new Set<string>();
  for (const cid of [control.control_id, `${control.family}.L2-${control.nist_ref}`]) {
    for (const r of regs) for (const e of r.lookupByControl(cid)) ids.add(e.entry_id);
  }
  return [...ids];
};
const firstControlWithEntries = (regs: CommandRegistry[]) =>
  reference.controls.find((c: any) => entriesFor(regs, c).length > 0);

describe('FX2-ST2 Assess: plan intent is not evidence', () => {
  it('a plan whose controls are only planned yields zero satisfied', () => {
    for (const directive of ['implement', 'validate'] as const) {
      const status = new CmmcComplianceAnalyzer(registries(), null, new Map(), undefined, undefined, undefined, allPlanned(directive)).analyze();
      expect({ directive, satisfied: status.satisfied.length }).toEqual({ directive, satisfied: 0 });
      expect(status.notVerified.length).toBe(110);
      expect(status.notVerified.every((cs) => cs.category === 'not_verified')).toBe(true);
    }
  });

  it('a control missing from the directive list defaults to planned, not satisfied', () => {
    const regs = registries();
    const only = [{ control_id: reference.controls[0].control_id, directive: 'manual' as const }];
    const status = new CmmcComplianceAnalyzer(regs, null, new Map(), undefined, undefined, undefined, only).analyze();
    expect(status.satisfied.length).toBe(0);
    expect(status.notVerified.length).toBe(109);
  });

  it('planned-only controls deduct their canonical SPRS weight', () => {
    const status = new CmmcComplianceAnalyzer(registries(), null, new Map(), undefined, undefined, undefined, allPlanned()).analyze();
    const sprs = computeSprsByCategory(status);
    const allWeights = reference.controls.reduce((s: number, c: any) => s + weights.get(c.nist_ref)!, 0);
    expect(sprs.not_verified).toBe(allWeights);
    expect(sprs.not_satisfied).toBe(allWeights);
    expect(sprs.score).toBe(110 - allWeights);
  });

  it('a real tenant read (discovery exists, SAT) makes that control satisfied — only that one', () => {
    const regs = registries();
    const control = firstControlWithEntries(regs);
    const discovery = new Map<string, any>(entriesFor(regs, control).map((id) => [id, { status: 'exists', verdict: 'SAT' }]));
    const status = new CmmcComplianceAnalyzer(regs, null, discovery, undefined, undefined, undefined, allPlanned()).analyze();
    const satisfiedIds = status.satisfied.map((cs) => cs.control.control_id);
    // Registry entries can serve several controls, so every SAT control must be fully read.
    expect(satisfiedIds).toContain(control.control_id);
    for (const cs of status.satisfied) {
      expect(cs.registryEntryDetails.length).toBeGreaterThan(0);
      expect(cs.registryEntryDetails.every((d) => d.status === 'exists')).toBe(true);
    }
  });

  it('a recorded real post-state on disk (SAT evidence) satisfies; a dry-run record does not', () => {
    const regs = registries();
    const control = firstControlWithEntries(regs);
    const ids = entriesFor(regs, control);
    const allEntries = regs.flatMap((r) => r.allEntries);
    // Not read live in this Assess: only the recorded execution evidence can prove it.
    const discovery = new Map<string, any>();
    const write = (dir: string, extra: Record<string, unknown>) => {
      for (const id of ids) {
        const e = allEntries.find((x) => x.entry_id === id)!;
        const f = path.join(dir, evidenceFileForEntry(id, e.label));
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify({ complianceVerdict: 'SAT', ...extra }));
      }
    };
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'fx2-st2-real-'));
    write(real, { post_state: { enabled: true } });
    const sat = new CmmcComplianceAnalyzer(regs, null, discovery, undefined, real, undefined, allPlanned()).analyze();
    expect(sat.satisfied.map((cs) => cs.control.control_id)).toContain(control.control_id);

    const dry = fs.mkdtempSync(path.join(os.tmpdir(), 'fx2-st2-dry-'));
    write(dry, { post_state: { dry_run: true } });
    const noSat = new CmmcComplianceAnalyzer(regs, null, discovery, undefined, dry, undefined, allPlanned()).analyze();
    expect(noSat.satisfied.map((cs) => cs.control.control_id)).not.toContain(control.control_id);
    expect(noSat.notVerified.map((cs) => cs.control.control_id)).toContain(control.control_id);
  });

  it('an empty read (missing) or a NOT_SAT read is NOT satisfied (wont_be_satisfied)', () => {
    const regs = registries();
    const control = firstControlWithEntries(regs);
    const ids = entriesFor(regs, control);
    for (const result of [{ status: 'missing' }, { status: 'exists', verdict: 'NOT_SAT' }]) {
      const discovery = new Map<string, any>(ids.map((id) => [id, result]));
      const status = new CmmcComplianceAnalyzer(regs, null, discovery, undefined, undefined, undefined, allPlanned()).analyze();
      expect(status.satisfied.map((cs) => cs.control.control_id)).not.toContain(control.control_id);
      expect(status.wontBeSatisfied.map((cs) => cs.control.control_id)).toContain(control.control_id);
    }
  });
});
