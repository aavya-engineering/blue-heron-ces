// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SEC-5 (GAP-CLOSURE-PLAN.md section 4 G-SEC): every placeholder in every PowerShell template field of
// Stamper's two registries sits in a single-quoted literal, or bare only where PS_TOKEN_KINDS types it.
// Comparison fields (verification.*.equals, lookup.by_name.equals, lookup.by_effect[].value*) and notes
// are NOT templates: resolveComparisonValue renders them raw (SEC-2 D3) and they are never executed,
// so they are deliberately outside this lint.

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'node:url';
import { psContext } from 'ces-shared/security';
import { PS_TOKEN_KINDS } from '../../src/utils/templateResolver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REGISTRY_FILES = ['cmmc-l2-commands.registry.json', 'infra-cmmc-l2-commands.registry.json'];

type Field = [where: string, template: string];

function templateFields(entry: any, prefix: string): Field[] {
  const out: Field[] = [];
  const add = (w: string, c: unknown): void => { if (typeof c === 'string' && c) out.push([`${prefix}:${w}`, c]); };
  add('set_command', entry.set_command);
  add('get_command', entry.get_command);
  (entry.evidence_commands ?? []).forEach((c: string, i: number) => add(`evidence_commands[${i}]`, c));
  add('destructive_guard.preview_command', entry.destructive_guard?.preview_command);
  (entry.destructive_guard?.exclusion_checks ?? []).forEach((c: string, i: number) => add(`destructive_guard.exclusion_checks[${i}]`, c));
  add('lookup.source', entry.lookup?.source);
  return out;
}

const registries: Record<string, any> = {};
for (const f of REGISTRY_FILES) {
  registries[f] = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../src/registry', f), 'utf-8'));
}
const fields: Field[] = [];
for (const f of REGISTRY_FILES) for (const e of registries[f].entries) fields.push(...templateFields(e, `${f}#${e.entry_id}`));

/** Lint one template: the placeholders that are neither single-quoted nor typed-bare. */
function violations(template: string): string[] {
  return psContext(template)
    .filter((ph) => !(ph.context === 'single' || (ph.context === 'bare' && ph.name in PS_TOKEN_KINDS)))
    .map((ph) => `${ph.name}(${ph.context})`);
}

/**
 * The SEC-5 quoting rules, applied to a pre-SEC-5 template: a bare whole-argument placeholder gains
 * single quotes; a non-interpolating double-quoted string holding a placeholder becomes single-quoted
 * with its inner quotes doubled. Typed bare names stay bare.
 */
function quoteSec5(template: string): string {
  let s = template;
  for (;;) {
    const ph = psContext(s).find((p) => !(p.context === 'single' || (p.context === 'bare' && p.name in PS_TOKEN_KINDS)));
    if (!ph) return s;
    if (ph.context === 'bare') {
      s = `${s.slice(0, ph.start)}'${s.slice(ph.start, ph.end)}'${s.slice(ph.end)}`;
    } else {
      const open = s.lastIndexOf('"', ph.start);
      const close = s.indexOf('"', ph.end);
      s = `${s.slice(0, open)}'${s.slice(open + 1, close).replace(/'/g, "''")}'${s.slice(close + 1)}`;
    }
  }
}

describe('SEC-5 registry quoting lint (Stamper)', () => {
  it('covers every PowerShell template field of both registries (676 placeholders: 671 in command fields + 5 in lookup.source; CG-7 + 17 resource-group / workspace variables; FIN-40 + 6 region placeholders (P-11) + 56 in the 7 new infra entries; FIN-41 + 13: AZ-VM-001 -2 (no Key Vault secret), AZ-VM-002 +6 (encryption at host), AZ-KV-005 +9 (HSM opt-in); DEPTH-2 + 1: AZ-NSG-007 {m365Ipv4Ranges}; PH-12 merge + 21 = 697: DEPTH-10.1/10.2 (P12-R1) + 3 (AU.L2-3.3.4.audit-config-alert {cisoEmail}, IA.L2-3.5.3.ca-mfa-all-users and IA.L1-3.5.1.ca-compliant-device {breakGlassUserId}); DEPTH-10.3 (P12-R2) + 4 (AC.L2-3.1.12.session-monitor 2, AC.L2-3.1.18.ios-compliance, AC.L2-3.1.19.android-compliance); DEPTH-10.5/10.8 (P12-R4) + 7 (IR.L2-3.6.1.user-reporting 3, SI.L1-3.14.1.mde-onboarding, SI.L2-3.14.6.defender-traffic-monitoring, SI.L2-3.14.7.signin-risk-policy, SI.L2-3.14.7.user-risk-policy); DEPTH-10.6..10.10 (P12-R5) + 7 (4 x {cuiGroupId} in the CM Intune SETs, MA.L2-3.7.5.session-terminate {breakGlassUserId}, PS.L2-3.9.2.access-review 3; AZ-LOG-002b -1); DEPTH-10.4 (P12-R3) + 0; PH-13 (P13-ST) + 5 = 702: AU.L2-3.3.8.audit-protect {complianceRoleId} x3, AZ-ID-003 evidence {appId} +2)', () => {
    expect(fields.length).toBeGreaterThan(500);
    const total = fields.reduce((n, [, t]) => n + psContext(t).length, 0);
    expect(total).toBe(702);
  });

  it('every placeholder is single-quoted, or bare only with a typed kind', () => {
    const bad = fields.flatMap(([w, t]) => violations(t).map((v) => `${w} ${v}`));
    expect(bad).toEqual([]);
  });

  it('self-check: the lint flags double-quoted and untyped bare placeholders, passes single and typed bare', () => {
    expect(violations('Get-MgGroup -DisplayName "{cuiGroupName}"')).toEqual(['cuiGroupName(double)']);
    expect(violations('Get-AzVM -ResourceGroupName {resourceGroup}')).toEqual(['resourceGroup(bare)']);
    expect(violations("Get-AzVM -ResourceGroupName '{resourceGroup}'")).toEqual([]);
    expect(violations('Get-MgUser -UserId {operatorUPN}')).toEqual([]);
  });

  // DEPTH-1a replaced this entry's wrong command (it listed Conditional Access policies; it now reads detected apps).
  // CG (cost gate): the NSG read takes {resourceGroup} (CG-7); the key vault is Standard (OQ-4).
  // DEPTH-2: the AV-signature read finds the policy by display name, not one tenant's fixed object id.
  const CHANGED_SINCE_FIXTURE = new Set(['CM.L2-3.4.8.detected-apps', 'SC.L1-3.13.1.nsg-boundary-rules', 'SC.L2-3.13.10.key-vault', 'SI.L1-3.14.4.av-signatures',
    'MA.L2-3.7.5.remote-mfa', // PH6-REG: created enabled, enabled-only lookup GET
    'IA.L2-3.5.7.password-protection', // DEPTH-10.2 (P12-R1): re-aimed from a read to the Password Rule Settings SET
    'AC.L2-3.1.20.spo-sharing', // DEPTH-10.3 (P12-R2): the GET now emits a JSON object
    'MP.L2-3.8.5.media-access', // DEPTH-10.7 (P12-R2): read repaired (JSON output, selects the assigned removable-storage policy)
    'CM.L2-3.4.8.app-protection-evidence', // DEPTH-10.6 (P12-R5): MAM list and operator-machine Get-MpPreference replaced by tenant App Control reads
    // PH-13 (P13-ST, founder Q3): evidence-only reads re-aimed so a read is never empty when it succeeds ((b) counts)
    // or finds the object the tenant really has ((c) repairs).
    'AC.L2-3.1.7.pim-roles-permanent', 'AC.L2-3.1.18.byod-nonbrowser-signins', 'AC.L2-3.1.3.byod-dlp-matches',
    'SC.L2-3.13.16.byod-label-usage', 'PS.L2-3.9.2.account-disable-evidence', 'PS.L2-3.9.2.termination', 'SC.L2-3.13.2.advisor',
    'SI.L2-3.14.3.advisory-evidence', 'SI.L1-3.14.2.malware-protection-evidence', 'SC.L2-3.13.4.remote-access',
    'MP.L2-3.8.7.removable-media-intune', 'MP.L2-3.8.8.unowned-storage-intune', 'AC.L2-3.1.17.wireless-profile-evidence',
    'AU.L2-3.3.8.audit-protect', 'AZ-ID-003',
    'SI.L1-3.14.5.scan-schedule-evidence', // PH13-REG (wt-r2, LOG-PH13-REG STOP-1): windows10GeneralConfiguration SET; lookup GET asks for a signature interval; type-agnostic Defender evidence read
    'SI.L1-3.14.4.av-update-evidence']); // PH13-REG (wt-r2, LOG-PH13-REG STOP-1): re-aimed from WUfB rings to per-device Defender signature currency

  it('S1 fixture link: the registry differs from what the translator emitted for S1 by the SEC-5 quoting rules alone', () => {
    const plan = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/gap-sec2/s1-executable-plan.json'), 'utf-8'));
    const byId: Record<string, any> = {};
    for (const f of REGISTRY_FILES) for (const e of registries[f].entries) byId[e.entry_id] = e;
    let linked = 0;
    const mismatches: string[] = [];
    for (const t of plan.execution_graph) {
      for (const s of t.action.args?._sub_commands ?? []) {
        const e = byId[s.id];
        if (!e) continue;
        if (CHANGED_SINCE_FIXTURE.has(s.id)) continue; // command deliberately replaced after the fixture was captured
        const pairs: Array<[string, unknown, unknown]> = [
          ['set_command', s.set_command, e.set_command],
          ['get_command', s.get_command, e.get_command],
          ...(s.evidence_commands ?? []).map((c: string, i: number): [string, unknown, unknown] => [`evidence_commands[${i}]`, c, (e.evidence_commands ?? [])[i]]),
        ];
        for (const [w, fixtureText, registryText] of pairs) {
          if (typeof fixtureText !== 'string' || !fixtureText) continue; // translator emitted no command here
          if (e.org_value_bindings) continue; // org values substituted at translate time
          linked++;
          if (quoteSec5(fixtureText) !== registryText) mismatches.push(`${s.id}:${w}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(linked).toBeGreaterThan(300);
  });
});
