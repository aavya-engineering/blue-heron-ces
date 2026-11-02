// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIX-SCORE (2026-11-02).
// PL-121: every registry entry whose SET, GET, evidence reads or verification takes a value Muster can fill with
//   a visible placeholder (wifiSsid, securityEmail, cisoEmail; ces-muster operatorValues.ts OPERATOR_PLACEHOLDER),
//   with a SAT golden on the S1-shaped read and a NOT_SAT golden on the mp-shaped read (R-F11 records), under the
//   entry's own verification with its variables resolved as the adapter resolves them.
// PL-119: MP.L2-3.8.5.media-access reads after AC.L2-3.1.21.block-storage (STOP-RF11-1), and its sibling.
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { CommandRegistry } from '../../src/registry/CommandRegistry';
import { OutputVerificationEngine } from '../../src/core/OutputVerificationEngine';
import { PLACEHOLDER_VARIABLES, placeholderRationale } from '../../src/shared/musterPlaceholders';
import { orderByReadAfter } from '../../src/translators/captureDependencies';
import type { ExecutablePlan, ExeTask, SubCommand } from '../../src/types/schema.types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const main = CommandRegistry.load(path.resolve(__dirname, '../../src/registry/cmmc-l2-commands.registry.json'));
const infra = CommandRegistry.load(path.resolve(__dirname, '../../src/registry/infra-cmmc-l2-commands.registry.json'));
const all = [...main.allEntries, ...infra.allEntries];
const entry = (id: string) => all.find(e => e.entry_id === id)!;
const engine = new OutputVerificationEngine();

const MAIL = 'unset-security-email@example.invalid';
const SSID = 'MUSTER-DEFAULT-SSID';
const S1_MAIL = 'security@s1-mach.simtenant.onmicrosoft.us';
const resolve = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const verifyRead = (id: string, read: unknown, vars: Record<string, string>) => {
  const ev = entry(id).verification!.evidence!;
  const resolved = JSON.parse(resolve(JSON.stringify(ev), vars));
  return engine.verify({ stdout: '', stderr: '', exitCode: 0 }, { stdout: JSON.stringify(read), exitCode: 0 }, { evidence: resolved, placeholder_ignore: entry(id).verification!.placeholder_ignore });
};

describe('FIX-SCORE PL-121: the entries that take a placeholder-capable value', () => {
  it('exactly these five entries reference wifiSsid, securityEmail or cisoEmail (a new one must get goldens here)', () => {
    const hits = all.filter(e => {
      const text = JSON.stringify([e.set_command, e.get_command, e.evidence_commands, e.verification, e.variables_required, e.lookup]);
      return PLACEHOLDER_VARIABLES.some(v => text.includes(`{${v}}`) || text.includes(`"${v}"`));
    }).map(e => e.entry_id).sort();
    expect(hits).toEqual(['AC.L2-3.1.16.wifi-profile', 'AU.L2-3.3.4.audit-config-alert', 'AZ-MON-001', 'IR.L2-3.6.1.user-reporting', 'SI.L2-3.14.2.anti-malware']);
  });

  // [entry, S1-shaped read (SAT), S1 variables, mp-shaped read (NOT_SAT), mp variables, placeholder shown]
  const S1V = { wifiSsid: 'S1-MACH-CORP', securityEmail: S1_MAIL, cisoEmail: S1_MAIL };
  const MPV = { wifiSsid: SSID, securityEmail: MAIL, cisoEmail: MAIL };
  const wifi = (ssid: string) => ({ id: 'deviceConfiguration-4', networkName: 'CUI-Network', wifiSecurityType: 'wpa2Enterprise', displayName: 'CMMC-WiFi-Secure', ssid, '@odata.type': '#microsoft.graph.windowsWifiConfiguration', assignments: [{ id: 'a1', target: { groupId: 'g' } }] });
  const report = (m: string) => ({ Identity: 'DefaultReportSubmissionPolicy', EnableReportToMicrosoft: true, ReportJunkToCustomizedAddress: true, ReportJunkAddresses: [m], ReportNotJunkToCustomizedAddress: true, ReportNotJunkAddresses: [m], ReportPhishToCustomizedAddress: true, ReportPhishAddresses: [m] });
  const malware = (m: string) => ({ id: 'CMMC-Malware', Identity: 'CMMC-Malware', Name: 'CMMC-Malware', EnableFileFilter: true, FileTypeAction: 'Reject', EnableInternalSenderAdminNotifications: true, InternalSenderAdminAddress: m });
  const alert = (m: string) => ({ Name: 'CMMC-Audit-Logging-Changed', Disabled: false, Severity: 'High', Operation: ['Set-AdminAuditLogConfig'], NotifyUser: [m] });
  const actionGroup = (m: string) => ({ Name: 'CMMC-AlertGroup', ResourceGroupName: 'rg', Enabled: true, EmailAddresses: [m] });
  const cases: Array<[string, unknown, unknown, string]> = [
    ['AC.L2-3.1.16.wifi-profile', wifi('S1-MACH-CORP'), wifi(SSID), SSID],
    ['IR.L2-3.6.1.user-reporting', report(S1_MAIL), report(MAIL), MAIL],
    ['AU.L2-3.3.4.audit-config-alert', alert(S1_MAIL), alert(MAIL), MAIL],
    ['AZ-MON-001', actionGroup(S1_MAIL), actionGroup(MAIL), MAIL],
  ];
  it.each(cases)('%s: SAT on the S1-shaped read, NOT_SAT "built from an unanswered placeholder" on the mp-shaped read', (id, s1, mp, shown) => {
    expect(verifyRead(id, s1, S1V).passed).toBe(true);
    const r = verifyRead(id, mp, MPV);
    expect(r).toMatchObject({ passed: false, placeholder: shown, reason: placeholderRationale(shown) });
  });

  // Round 2 (founder 2026-11-02: the setting that provides the protection must not depend on a placeholder).
  it('SI.L2-3.14.2.anti-malware: SAT with the placeholder in the admin-notification address only; NOT_SAT when the filter is off or a placeholder sits elsewhere', () => {
    expect(entry('SI.L2-3.14.2.anti-malware').verification!.placeholder_ignore).toEqual(['$.InternalSenderAdminAddress']);
    expect(verifyRead('SI.L2-3.14.2.anti-malware', malware(S1_MAIL), S1V).passed).toBe(true);
    const adminOnly = verifyRead('SI.L2-3.14.2.anti-malware', malware(MAIL), MPV);
    expect(adminOnly.passed).toBe(true);
    expect(adminOnly.placeholder).toBeUndefined();
    expect(verifyRead('SI.L2-3.14.2.anti-malware', { ...malware(MAIL), EnableFileFilter: false }, MPV).passed).toBe(false);
    expect(verifyRead('SI.L2-3.14.2.anti-malware', { ...malware(MAIL), FileTypeAction: 'Allow' }, MPV).passed).toBe(false);
    const elsewhere = verifyRead('SI.L2-3.14.2.anti-malware', { ...malware(S1_MAIL), AdminDisplayName: MAIL }, MPV);
    expect(elsewhere).toMatchObject({ passed: false, placeholder: MAIL });
  });

  it('placeholder_ignore is used only by SI.L2-3.14.2.anti-malware (each use is a founder-scoped exception)', () => {
    expect(all.filter(e => e.verification?.placeholder_ignore?.length).map(e => e.entry_id)).toEqual(['SI.L2-3.14.2.anti-malware']);
  });

  it('IR.L2-3.6.1.user-reporting: before the guard the placeholder satisfied its own equals {securityEmail} check (why it was SAT on mp)', () => {
    const ev = JSON.parse(resolve(JSON.stringify(entry('IR.L2-3.6.1.user-reporting').verification!.evidence), MPV));
    expect(ev.checks.find((c: any) => c.jsonpath === '$.ReportPhishAddresses').equals).toBe(MAIL);
  });

  it('the AU.L2-3.3.4 per-entry regex (PH-13 FX) is kept; the shared guard now covers it too', () => {
    const checks = entry('AU.L2-3.3.4.audit-config-alert').verification!.evidence!.checks!;
    expect(checks.some(c => c.regex === '^(?!.*(unset-|\\.invalid)).*@')).toBe(true);
  });
});

describe('FIX-SCORE PL-119: read_after', () => {
  it('MP.L2-3.8.5.media-access reads after AC.L2-3.1.21.block-storage; the wireless evidence read after AC.L2-3.1.16.wifi-profile', () => {
    expect(entry('MP.L2-3.8.5.media-access').read_after).toEqual(['AC.L2-3.1.21.block-storage']);
    expect(entry('AC.L2-3.1.17.wireless-profile-evidence').read_after).toEqual(['AC.L2-3.1.16.wifi-profile']);
  });

  it('every read_after names an entry that exists and configures (has a SET)', () => {
    const bad: string[] = [];
    for (const e of all) for (const c of e.read_after ?? []) {
      const creator = all.find(x => x.entry_id === c);
      if (!creator || !creator.set_command?.trim()) bad.push(`${e.entry_id} -> ${c}`);
    }
    expect(bad).toEqual([]);
  });

  // The R-F11 S3 shape (executable-plan.json): the MP.L2-3.8.5 validate task at [3] with dependents (MP.L2-3.8.9, the
  // SC tasks), block-storage at [28] after AC.L1-3.1.1 and AC.L2-3.1.11.
  const sub = (id: string, extra: Partial<SubCommand> = {}): SubCommand => ({
    id, label: id, set_command: '', get_command: '', engine: 'mgraph', sequence_hint: 0, idempotency: 'evidence-only',
    variables_required: [], variables_runtime: [], captures: [], on_failure: 'warn_continue', evidence_commands: [], ...extra,
  } as SubCommand);
  const task = (id: string, subs: SubCommand[], deps: string[] = []): ExeTask => ({
    id, type: 'validate', priority: 'p2', depends_on: deps,
    action: { engine: 'mgraph', command: 'x', args: { _directive: 'validate', _sub_commands: subs } },
    inputs: [], outputs: [], controls: [id], idempotency: 'safe', rollback: { strategy: 'none' },
  } as ExeTask);
  it('orderByReadAfter: MP runs after block-storage, its dependents after it; tasks outside MP and its dependents keep their order', () => {
    const graph = [
      task('IR', [sub('IR.x')]),
      task('MP5', [sub('MP.L2-3.8.5.media-access', { read_after: ['AC.L2-3.1.21.block-storage'] } as any)]),
      task('IA', [sub('IA.x')]),
      task('MP9', [sub('MP.L2-3.8.9.dlp-policy')], ['MP5']),
      task('SC4', [sub('SC.L2-3.13.4.remote-access')], ['MP5']),
      task('AC1', [sub('AC.L1-3.1.1.x')]),
      task('AC11', [sub('AC.L2-3.1.11.x')], ['AC1']),
      task('AC21', [sub('AC.L2-3.1.21.block-storage', { set_command: 'New-X', idempotency: 'get-then-set' })], ['AC1', 'AC11']),
      task('AU', [sub('AU.x')]),
    ];
    const plan = { plan_id: 'p', execution_graph: graph, variables: {} } as unknown as ExecutablePlan;
    const warnings = orderByReadAfter(plan);
    const order = plan.execution_graph.map(t => t.id);
    expect(warnings).toEqual(['READ_AFTER: MP5 now depends on AC21: MP.L2-3.8.5.media-access reads what AC.L2-3.1.21.block-storage creates']);
    expect(order.indexOf('MP5')).toBeGreaterThan(order.indexOf('AC21'));
    expect(order.indexOf('MP9')).toBeGreaterThan(order.indexOf('MP5'));
    expect(order.indexOf('SC4')).toBeGreaterThan(order.indexOf('MP5'));
    const closure = new Set(['MP5', 'MP9', 'SC4']);
    expect(order.filter(id => !closure.has(id))).toEqual(['IR', 'IA', 'AC1', 'AC11', 'AC21', 'AU']);
  });
});
