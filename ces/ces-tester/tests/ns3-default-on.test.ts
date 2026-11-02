// Founder decision D-7 (2026-10-31; LOG-GC-PKG-C1.md): the NS-3 EO record posts run by default in E7; CES_NS3_EO_RECORDS=0
// turns them off. Source-order test over src/flow/muster-e2e-run.ts (the gate) and src/flow/eo-records.ts (the env name).
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NS3_ENABLE_ENV } from '../src/flow/eo-records.js';

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'flow', 'muster-e2e-run.ts'), 'utf8');

describe('NS-3 EO record posts on by default (D-7)', () => {
  it('keeps the env name as the off switch', () => {
    expect(NS3_ENABLE_ENV).toBe('CES_NS3_EO_RECORDS');
  });
  it('posts whenever the customer has records, unless the env is "0"', () => {
    expect(src).toContain("if (recordsPresent && process.env[NS3_ENABLE_ENV] !== '0') {");
    expect(src).not.toContain("process.env[NS3_ENABLE_ENV] === '1'");
    expect(src).toContain('NS-3 (on by default, D-7; ${NS3_ENABLE_ENV}=0 turns it off)');
  });
  it('still posts after the FLOW-3 intake and before E8.6, the interview posts and connect', () => {
    const at = (s: string) => {
      const i = src.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    const gate = at("process.env[NS3_ENABLE_ENV] !== '0'");
    // FIN-19: the intake record is muster-api's own receipt when it delivered at E4, else E7's post.
    expect(at('const intake = fromMuster ?? (await postEoIntake(')).toBeLessThan(gate);
    expect(gate).toBeLessThan(at("await execStep(defs.find((d) => d.id === 'E8.6')!);"));
    expect(gate).toBeLessThan(at('const iv = await postInterviewRecords('));
    expect(gate).toBeLessThan(at("const c = await readSse({ url: `${EO_URL}/api/connect?tenant=${slug}`"));
  });
});
