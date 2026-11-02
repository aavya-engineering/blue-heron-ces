// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIX-SCORE PL-121 (founder ruling 2026-11-01): "a setting built from an unanswered placeholder never counts".
// The shared guard (src/shared/musterPlaceholders.ts) on every route that decides a verdict from a read:
//   (1) the predicate; (2) OutputVerificationEngine.verify; (3) lookup.verifyEquivalent; (4) buildStructuredEvidence;
//   (5) judgeProhibitionRead / judgeEvidenceRead and markEmptyEvidenceRecord; (6) the CLI adapter end to end
//   (an evidence-only read and a get-then-set SET whose read after the SET shows the placeholder); (7) CLI = GUI.
// Read shapes are the R-F11 records (C:\ces-nb\evidence\gc-rf11-<slug>\ws\out\runs\run-*\...\evidence\).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import {
  isMusterPlaceholder, placeholderInRead, placeholderRationale, PLACEHOLDER_REASON, MUSTER_OPERATOR_PLACEHOLDERS,
} from '../../src/shared/musterPlaceholders';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { verifyEquivalent } from '../../src/registry/lookup';
import { buildStructuredEvidence } from '../../src/utils/structuredEvidence';
import {
  PowerShellAdapter, judgeEvidenceRead, judgeProhibitionRead, markEmptyEvidenceRecord, EMPTY_READ_REASON,
} from '../../src/adapters/PowerShellAdapter';
import { StamperConfig } from '../../src/config/StamperConfig';
import { evidenceDirForTenant, evidenceFileForEntry, taskEvidencePath } from '../../src/core/EvidenceReadinessAnalyzer';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import type { ExeTask, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stamper-fixscore-'));
const savedRoot = process.env.CES_PIPELINE_ROOT;
beforeAll(() => { process.env.CES_PIPELINE_ROOT = PIPELINE_ROOT; });
afterAll(() => {
  if (savedRoot === undefined) delete process.env.CES_PIPELINE_ROOT; else process.env.CES_PIPELINE_ROOT = savedRoot;
  fs.rmSync(PIPELINE_ROOT, { recursive: true, force: true });
});

const SSID = 'MUSTER-DEFAULT-SSID';
const MAIL = 'unset-security-email@example.invalid';
// R-F11 mp ac.l2-3.1.16.wifi-profile rawResponse (the profile the SET created)
const MP_WIFI = { id: 'deviceConfiguration-4', networkName: 'CUI-Network', wifiSecurityType: 'wpa2Enterprise', displayName: 'CMMC-WiFi-Secure', ssid: SSID, '@odata.type': '#microsoft.graph.windowsWifiConfiguration', isAssigned: true, assignments: [{ id: 'a1' }] };
const S1_WIFI = { ...MP_WIFI, ssid: 'S1-MACH-CORP' };
// R-F11 mp ac.l2-3.1.17.wireless-profile-evidence rawResponse
const MP_WIFI_EVIDENCE = { displayName: 'CMMC-WiFi-Secure', id: 'deviceConfiguration-4', odataType: '#microsoft.graph.windowsWifiConfiguration', ssid: SSID, wifiSecurityType: 'wpa2Enterprise' };

describe('FIX-SCORE (1): the placeholder predicate', () => {
  it("Muster's exact placeholders and their families are placeholders", () => {
    for (const p of MUSTER_OPERATOR_PLACEHOLDERS) expect([p, isMusterPlaceholder(p)]).toEqual([p, true]);
    for (const p of ['MUSTER-DEFAULT-SSID', 'muster-default-ssid', 'MUSTER-DEFAULT-GROUP', 'unset-security-email@example.invalid', 'unset-anything',
      'alerts@example.invalid', 'ops@corp.invalid', 'https://example.invalid/schemas/x.json', '  MUSTER-DEFAULT-SSID  ']) {
      expect([p, isMusterPlaceholder(p)]).toEqual([p, true]);
    }
  });
  it('real values are not', () => {
    for (const v of ['S1-MACH-CORP', 'S3-DEF-CORP', 'security@s1-mach.simtenant.onmicrosoft.us', 'it.support@s3-def.simtenant.onmicrosoft.us',
      'admin@example.com', 'invalidated', 'Invalid sign-in', 'host.invalid.com', 'unsettled', 'MUSTERDEFAULT', 'CMMC-WiFi-Secure', '', 'True']) {
      expect([v, isMusterPlaceholder(v)]).toEqual([v, false]);
    }
  });
  it('placeholderInRead: one object (nested, arrays), a listing (every item), a Graph envelope, plain text, the run marker', () => {
    expect(placeholderInRead(JSON.stringify(MP_WIFI))).toBe(SSID);
    expect(placeholderInRead(JSON.stringify(S1_WIFI))).toBeUndefined();
    expect(placeholderInRead(JSON.stringify([MP_WIFI]))).toBe(SSID); // a list of one is the object
    expect(placeholderInRead(JSON.stringify({ NotifyUser: ['security@s1-mach.simtenant.onmicrosoft.us', MAIL] }))).toBe(MAIL); // PH-13 FX rule
    expect(placeholderInRead(JSON.stringify({ a: { b: [{ c: MAIL }] } }))).toBe(MAIL);
    // a listing that also holds a real object still shows it
    expect(placeholderInRead(JSON.stringify([MP_WIFI, S1_WIFI]))).toBeUndefined();
    expect(placeholderInRead(JSON.stringify([MP_WIFI, { ...MP_WIFI, id: 'x' }]))).toBe(SSID);
    expect(placeholderInRead(JSON.stringify({ '@odata.context': 'x', value: [MP_WIFI, S1_WIFI] }))).toBeUndefined();
    expect(placeholderInRead(JSON.stringify({ value: [MP_WIFI] }))).toBe(SSID);
    expect(placeholderInRead(`ssid: ${SSID}\nwifiSecurityType: wpa2Enterprise`)).toBe(SSID);
    expect(placeholderInRead(`${JSON.stringify(MP_WIFI)}\nSTAMPER_EXECUTION_SUCCESS`)).toBe(SSID);
    for (const empty of ['', '[]', '{}', 'null', undefined, null]) expect(placeholderInRead(empty as any)).toBeUndefined();
  });
  it('Round 2: an ignore list leaves incidental paths out (case-insensitive, nested, per listing item)', () => {
    const mal = { Name: 'CMMC-Malware', EnableFileFilter: true, InternalSenderAdminAddress: MAIL };
    expect(placeholderInRead(JSON.stringify(mal))).toBe(MAIL);
    expect(placeholderInRead(JSON.stringify(mal), ['$.InternalSenderAdminAddress'])).toBeUndefined();
    expect(placeholderInRead(JSON.stringify(mal), ['$.internalsenderadminaddress'])).toBeUndefined();
    expect(placeholderInRead(JSON.stringify({ ...mal, Other: MAIL }), ['$.InternalSenderAdminAddress'])).toBe(MAIL);
    expect(placeholderInRead(JSON.stringify({ a: { b: MAIL, c: 'x' } }), ['$.a.b'])).toBeUndefined();
    expect(placeholderInRead(JSON.stringify([mal, { ...mal, Name: 'B' }]), ['$.InternalSenderAdminAddress'])).toBeUndefined();
    expect(placeholderInRead(JSON.stringify(MP_WIFI), ['$.InternalSenderAdminAddress'])).toBe(SSID);
  });
  it('the reason is the founder ruling, naming the value', () => {
    expect(PLACEHOLDER_REASON).toBe('built from an unanswered placeholder');
    expect(placeholderRationale(SSID)).toBe("built from an unanswered placeholder (the read shows 'MUSTER-DEFAULT-SSID')");
  });
});

describe('FIX-SCORE (2): OutputVerificationEngine.verify fails a read that shows a placeholder, whatever the rule', () => {
  const engine = new OutputVerificationEngine();
  const wifiRule = { evidence: { jsonpath: '$.wifiSecurityType', equals: 'wpa2Enterprise', checks: [{ jsonpath: '$.displayName', equals: 'CMMC-WiFi-Secure' }, { jsonpath: '$.assignments', min_items: 1 }] } };
  it('SAT on the S1 profile; NOT_SAT on the mp profile with the reason and the value', () => {
    expect(engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: JSON.stringify(S1_WIFI), exitCode: 0 }, wifiRule).passed).toBe(true);
    const r = engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: JSON.stringify(MP_WIFI), exitCode: 0 }, wifiRule);
    expect(r).toMatchObject({ passed: false, placeholder: SSID, reason: placeholderRationale(SSID) });
    expect(r.details.evidence_check).toBe(false);
  });
  it('an existing resource (stateChanged false) is not forgiven; an entry with no evidence rule is still guarded', () => {
    expect(engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: JSON.stringify(MP_WIFI), exitCode: 0 }, wifiRule, { stateChanged: false }).passed).toBe(false);
    expect(engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: JSON.stringify({ EmailAddresses: [MAIL] }), exitCode: 0 }, { evidence: { not_empty: true } }).passed).toBe(false);
    expect(engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: JSON.stringify({ EmailAddresses: ['a@b.us'] }), exitCode: 0 }, { evidence: { not_empty: true } }).passed).toBe(true);
  });
  it('a failed read is judged by the failure path, not the guard', () => {
    const r = engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: JSON.stringify(MP_WIFI), exitCode: 1 }, wifiRule);
    expect(r.placeholder).toBeUndefined();
  });
});

describe('FIX-SCORE (3): a tenant equivalent built from a placeholder is not verified by effect', () => {
  const registry = CommandRegistry.load(path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json'));
  const lookup = registry.allEntries.find(e => e.entry_id === 'AC.L2-3.1.16.wifi-profile')!.lookup!;
  it('S1-shaped equivalent passes; the same with the placeholder SSID fails with the reason', () => {
    const eq = { ...S1_WIFI, displayName: 'Corp WiFi' };
    expect(verifyEquivalent(JSON.stringify(eq), lookup, undefined, s => s.replace('{wifiSsid}', 'S1-MACH-CORP'))!.verification.passed).toBe(true);
    const v = verifyEquivalent(JSON.stringify({ ...eq, ssid: SSID }), lookup, undefined, s => s.replace('{wifiSsid}', SSID))!;
    expect(v.verification).toMatchObject({ passed: false, placeholder: SSID });
    expect(v.verification.reason).toBe(`existing equivalent 'Corp WiFi': ${placeholderRationale(SSID)}`);
  });
});

const read = (id: string, evidence: string[]): SubCommand => ({
  id, label: `Read ${id}`, set_command: '', get_command: '', engine: 'mgraph', sequence_hint: 0, idempotency: 'evidence-only',
  variables_required: [], variables_runtime: [], captures: [], on_failure: 'warn_continue', evidence_commands: evidence,
} as SubCommand);
function task(id: string, subs: SubCommand[], controls: string[], directive = 'validate'): ExeTask {
  return {
    id, type: 'validate', priority: 'p2', depends_on: [],
    action: { engine: 'mgraph', command: 'x', args: { _directive: directive, _sub_commands: subs } },
    inputs: [], outputs: [], controls, idempotency: 'safe', rollback: { strategy: 'none' },
  } as ExeTask;
}

describe('FIX-SCORE (4): buildStructuredEvidence: every record whose read shows a placeholder is NOT_SAT', () => {
  const sub = read('AC.L2-3.1.17.wireless-profile-evidence', ['Get-Wifi']);
  it('evidence-only: the mp read is NOT_SAT with the reason; the S1 read stays SAT', () => {
    const mp = buildStructuredEvidence(JSON.stringify(MP_WIFI_EVIDENCE, null, 4), 0, '', null, sub, task('t', [sub], ['AC.L2-3.1.17']), {});
    expect(mp).toMatchObject({ complianceVerdict: 'NOT_SAT', verdictRationale: placeholderRationale(SSID) });
    const s1 = buildStructuredEvidence(JSON.stringify({ ...MP_WIFI_EVIDENCE, ssid: 'S1-MACH-CORP' }), 0, '', null, sub, task('t', [sub], ['AC.L2-3.1.17']), {});
    expect(s1.complianceVerdict).toBe('SAT');
  });
  it('the read after a SET counts too; the command Stamper sent never does; Assess discovery keeps its rule', () => {
    const setSub = { ...read('X.set', []), set_command: `New-X -Ssid '${SSID}'`, idempotency: 'unsafe' } as SubCommand;
    const post = buildStructuredEvidence('{"id":"x"}', 0, '', null, setSub, task('t', [setSub], ['C']), { wifiSsid: SSID }, undefined, undefined, { postStateOutput: JSON.stringify(MP_WIFI) });
    expect(post).toMatchObject({ complianceVerdict: 'NOT_SAT', verdictRationale: placeholderRationale(SSID) });
    const sentOnly = buildStructuredEvidence('{"id":"x"}', 0, '', null, setSub, task('t', [setSub], ['C']), { wifiSsid: SSID });
    expect(sentOnly.complianceVerdict).toBe('SAT');
    const assess = buildStructuredEvidence(JSON.stringify(MP_WIFI), 0, '', null, sub, task('t', [sub], ['C']), {}, undefined, undefined, { assessOnly: true });
    expect(assess.complianceVerdict).toBe('SAT');
  });
});

describe('FIX-SCORE (4b): Round 2: the record and the equivalent honour the entry ignore list', () => {
  const mal = { Name: 'CMMC-Malware', EnableFileFilter: true, FileTypeAction: 'Reject', InternalSenderAdminAddress: MAIL };
  it('buildStructuredEvidence: SAT with the placeholder only at an ignored path; NOT_SAT without the ignore', () => {
    const base = { ...read('SI.L2-3.14.2.anti-malware', []), set_command: 'New-MalwareFilterPolicy', idempotency: 'get-then-set' } as SubCommand;
    const ignoring = { ...base, verification: { evidence: { jsonpath: '$.EnableFileFilter', equals: 'True' }, placeholder_ignore: ['$.InternalSenderAdminAddress'] } } as SubCommand;
    const t = task('t', [base], ['SI.L1-3.14.2']);
    expect(buildStructuredEvidence('{"Name":"CMMC-Malware"}', 0, '', null, ignoring, t, {}, undefined, undefined, { postStateOutput: JSON.stringify(mal) }).complianceVerdict).toBe('SAT');
    expect(buildStructuredEvidence('{"Name":"CMMC-Malware"}', 0, '', null, base, t, {}, undefined, undefined, { postStateOutput: JSON.stringify(mal) }).complianceVerdict).toBe('NOT_SAT');
  });
  it('OutputVerificationEngine.verify and verifyEquivalent take the ignore list', () => {
    const engine = new OutputVerificationEngine();
    const rule = { evidence: { jsonpath: '$.EnableFileFilter', equals: 'True' }, placeholder_ignore: ['$.InternalSenderAdminAddress'] };
    expect(engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: JSON.stringify(mal), exitCode: 0 }, rule).passed).toBe(true);
    expect(engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: JSON.stringify(mal), exitCode: 0 }, { evidence: rule.evidence }).passed).toBe(false);
    const registry = CommandRegistry.load(path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json'));
    const lookup = registry.allEntries.find(e => e.entry_id === 'SI.L2-3.14.2.anti-malware')!.lookup!;
    const eq = { ...mal, Name: 'Tenant malware policy', IsDefault: false };
    expect(verifyEquivalent(JSON.stringify(eq), lookup, undefined, undefined, ['$.InternalSenderAdminAddress'])!.verification.passed).toBe(true);
    expect(verifyEquivalent(JSON.stringify(eq), lookup, undefined)!.verification.passed).toBe(false);
  });
});

describe('FIX-SCORE (5): the evidence-read judgement and the record marker', () => {
  it('a placeholder read is not shown, with the reason; real and empty reads are unchanged', () => {
    expect(judgeEvidenceRead(0, JSON.stringify(MP_WIFI_EVIDENCE))).toEqual({ shown: false, reason: placeholderRationale(SSID) });
    expect(judgeProhibitionRead(0, JSON.stringify(MP_WIFI_EVIDENCE))).toEqual({ shown: false, reason: placeholderRationale(SSID) });
    expect(judgeEvidenceRead(0, JSON.stringify(S1_WIFI))).toEqual({ shown: true, reason: '' });
    expect(judgeEvidenceRead(0, '[]')).toEqual({ shown: false, reason: EMPTY_READ_REASON });
  });
  it('markEmptyEvidenceRecord keeps the placeholder reason; an empty record keeps the empty-read reason', () => {
    const ph: any = { rawResponse: JSON.stringify(MP_WIFI_EVIDENCE), outcome: 'automated_success', complianceVerdict: 'SAT', verdictRationale: 'x' };
    markEmptyEvidenceRecord(ph);
    expect(ph).toMatchObject({ complianceVerdict: 'NOT_SAT', verdictRationale: placeholderRationale(SSID), outcome: 'automated_success' });
    const empty: any = { rawResponse: '', outcome: 'automated_success', complianceVerdict: 'SAT' };
    markEmptyEvidenceRecord(empty);
    expect(empty).toMatchObject({ complianceVerdict: 'NOT_SAT', verdictRationale: EMPTY_READ_REASON, outcome: 'partial_success' });
  });
});

function makeConfig(): StamperConfig {
  return StamperConfig.fromTenantConfig({
    tenantId: 'test-tenant', appId: 'test-app', certThumbprint: 'test-thumbprint',
    certPath: '/path/to/cert', targetTenantDomain: 'test.onmicrosoft.us', clientName: 'Test Client',
  });
}
function record(tenant: string, taskId: string, sub: SubCommand): any {
  const evidFile = evidenceFileForEntry(sub.id, sub.label).replace(/\.txt$/, '.json');
  return JSON.parse(fs.readFileSync(taskEvidencePath(evidenceDirForTenant(tenant), taskId, evidFile), 'utf-8'));
}

describe('FIX-SCORE (6): the CLI adapter end to end', () => {
  it('evidence-only: the mp wireless read -> task output evidenceShown false with the reason, record NOT_SAT', async () => {
    const a = read('AC.L2-3.1.17.wireless-profile-evidence', ['Get-Wifi']);
    const manager = { execute: async () => ({ stdout: JSON.stringify(MP_WIFI_EVIDENCE, null, 4), stderr: '', exitCode: 0 }) };
    const adapter = new PowerShellAdapter(makeConfig(), manager as any, undefined, undefined, 'fixscore-ev');
    const r = await adapter.execute(task('t-ev', [a], ['AC.L2-3.1.17']), {}, false);
    expect(r.output).toMatchObject({ evidenceShown: false, evidenceReason: `AC.L2-3.1.17.wireless-profile-evidence: ${placeholderRationale(SSID)}` });
    expect(record('fixscore-ev', 't-ev', a)).toMatchObject({ complianceVerdict: 'NOT_SAT', verdictRationale: placeholderRationale(SSID) });
  });

  it('get-then-set (the registry wifi-profile entry): the read after the SET shows the placeholder -> the sub-command fails, record NOT_SAT with the reason', async () => {
    const registry = CommandRegistry.load(path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json'));
    const e = registry.allEntries.find(x => x.entry_id === 'AC.L2-3.1.16.wifi-profile')!;
    const sub = {
      id: e.entry_id, label: e.label, set_command: e.set_command, get_command: e.get_command, engine: e.engine, sequence_hint: e.sequence_hint,
      idempotency: e.idempotency, variables_required: e.variables_required, variables_runtime: e.variables_runtime, captures: e.captures,
      on_failure: e.on_failure, evidence_commands: e.evidence_commands, verification: e.verification, lookup: e.lookup, control_ids: e.control_ids,
    } as SubCommand;
    let created = false;
    const manager = {
      execute: async (_t: string, command: string) => {
        if (command.includes("-Method POST") && command.includes('/deviceConfigurations')) { created = true; return { stdout: JSON.stringify(MP_WIFI), stderr: '', exitCode: 0 }; }
        if (command.includes('deviceConfigurations')) return { stdout: created ? JSON.stringify(MP_WIFI) : '', stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const adapter = new PowerShellAdapter(makeConfig(), manager as any, undefined, undefined, 'fixscore-set');
    const r = await adapter.execute(task('t-set', [sub], ['AC.L2-3.1.16', 'AC.L2-3.1.17'], 'implement'), { wifiSsid: SSID, cuiGroupId: 'group-cui' }, false);
    expect(created).toBe(true);
    expect(r.success).toBe(false);
    const rec = record('fixscore-set', 't-set', sub);
    expect(rec).toMatchObject({ complianceVerdict: 'NOT_SAT', verdictRationale: placeholderRationale(SSID) });
    expect(rec.outcomeRationale).toContain(PLACEHOLDER_REASON);
  }, 20000);
});

describe('FIX-SCORE (7): CLI = GUI', () => {
  it("the GUI read-only branch judges with judgeProhibitionRead (which holds the guard); the GUI executes through this adapter", () => {
    const routes = fs.readFileSync(path.resolve(__dirname, '../../src/server/routes/execute.routes.ts'), 'utf-8');
    expect(routes).toMatch(/judgeProhibitionRead\(discovery\.exitCode, discovery\.rawOutput\)/);
    const runner = fs.readFileSync(path.resolve(__dirname, '../../src/core/TaskRunner.ts'), 'utf-8');
    expect(runner).toMatch(/new PowerShellAdapter\(/);
    const adapter = fs.readFileSync(path.resolve(__dirname, '../../src/adapters/PowerShellAdapter.ts'), 'utf-8');
    expect(adapter).toMatch(/export function judgeEvidenceRead[\s\S]{0,200}return judgeProhibitionRead\(/);
  });
});
