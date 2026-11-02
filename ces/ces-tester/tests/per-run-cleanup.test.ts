// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Run 61 (per-run cleanup): an aborted E7 left the previous run's assessment passes 2 and 3 for V14 to read. Every
// per-run artefact goes before E1; the operator's console and verify logs, the package wrapper's V10 snapshots and its
// open tester-run log, and the simulator's tenant folders stay. Nothing here starts a server or the sim.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanPerRunArtefacts, perRunArtefacts } from '../src/flow/muster-e2e-run.js';

describe('per-run cleanup before E1', () => {
  it('removes every per-run artefact and keeps the operator, wrapper and simulator files', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'tester-clean-'));
    try {
      const out = path.join(ws, 'out'), pl = path.join(ws, 'pl');
      const file = (rel: string): void => { const p = path.join(ws, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, '{}'); };
      const gone = [
        'out/eo-assess.json', 'out/eo-assess-2.json', 'out/eo-assess-3.json', 'out/eo-assess-7b.json', 'out/eo-ledger.json', 'out/eo-connect.json',
        'out/ssp.json', 'out/ssp.docx', 'out/poam.json', 'out/scorecard-s1-mach.json', 'out/GAPS-s1-mach.json', 'out/GAPS-s1-mach.md',
        'out/steps.json', 'out/tester-run.json', 'out/coverage-ao.json', 'out/summary.json', 'out/verify.json', 'out/push-response.json',
        'out/ec-upload.json', 'out/ec-upload-request.json', 'out/adminops-e7a.json', 'out/e6x.json',
        'out/eo-package.zip', 'out/eo-package-build.json', 'out/eo-package/evidence-package-1/x.json',
        'out/plan/plan-trace.json', 'out/eo/assessments/a/drift.json', 'out/st/state/x.json', 'out/ao/sim/s1.pfx',
        'out/runs/forced/eo-assess.json', 'out/runs/latest.json',
        'out/logs/E7-assess-2.out', 'out/logs/E7-assess-3.out', 'out/logs/E1-scenario.err',
        'pl/Stamper/plan-data/s1-mach/plans/p.json', 'pl/Stamper/plan-data/s1-mach/state/s.json',
        'pl/Stamper/plan-data/s1-mach/evidence/e.json', 'pl/Stamper/plan-data/s1-mach/evidence-by-task/t/m.json',
      ];
      const kept = [
        'out/run60-s3-console.log', 'out/verify-rebaseline-run19.log', 'out/outside-before.json', 'out/outside-after.json',
        'out/logs/tester-run.out', 'out/logs/tester-run.err', 'out/baseline-p0/x.json', 'out/captures/c.json',
        'out/runs/run-20261029T030149Z/evidence/raw/manifest.json', 'out/executable-plan.json', 'out/stamper-cwd/x.json',
        'pl/Stamper/plan-data/s3-def/state/s.json', 'pl/Stamper/plan-data/s1-mach/other/keep.json',
        'ces/tenant-stacksim/.stacksim/tenants/s1-mach/tenant.json',
      ];
      for (const f of [...gone, ...kept]) file(f);
      const listed = perRunArtefacts(out, pl, 's1-mach').map((p) => path.relative(ws, p).split(path.sep).join('/'));
      for (const top of ['out/eo-package', 'out/plan', 'out/eo', 'out/st', 'out/ao', 'out/runs/forced', 'pl/Stamper/plan-data/s1-mach/plans']) expect(listed).toContain(top);
      const removed = cleanPerRunArtefacts(out, pl, 's1-mach');
      expect(removed.length).toBe(listed.length);
      for (const f of gone) expect(fs.existsSync(path.join(ws, f)), f).toBe(false);
      for (const f of kept) expect(fs.existsSync(path.join(ws, f)), f).toBe(true);
      expect(fs.existsSync(path.join(out, 'logs'))).toBe(true);
      expect(perRunArtefacts(out, pl, 's1-mach')).toEqual([]);
      expect(cleanPerRunArtefacts(path.join(ws, 'missing'), path.join(ws, 'missing-pl'), 's1-mach')).toEqual([]);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('the runner cleans before E1 and before the logs folder is used', () => {
    const src = fs.readFileSync(path.resolve('src', 'flow', 'muster-e2e-run.ts'), 'utf8');
    const real = src.indexOf('// ---------- real run ----------');
    const clean = src.indexOf('cleanPerRunArtefacts(P.out, P.pl, slug)', real);
    const logs = src.indexOf('fs.mkdirSync(P.logs, { recursive: true })', real);
    const exec = src.indexOf('const execStep = async', real);
    expect(real).toBeGreaterThan(-1);
    expect(clean).toBeGreaterThan(real);
    expect(clean).toBeLessThan(logs);
    expect(logs).toBeLessThan(exec);
  });
});
