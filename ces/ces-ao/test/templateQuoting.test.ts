// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SEC-3 lint (GAP-CLOSURE-PLAN.md section 4 G-SEC): every placeholder in AO's 96 command templates
// sits inside a plain single-quoted PowerShell literal, so the Stamper adapter's guard escapes it
// (psLiteralBody) instead of relying on the double-quoted blocklist or a bare-token allowlist.
// No AO placeholder needs a bare (typed-kind) position, so the lint admits none.
// Where a value must appear inside a double-quoted (interpolated) string, the template first
// assigns it to a single-quoted variable `$ao_<name>='{<name>}';` and the string uses `$ao_<name>`.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { psContext } from 'ces-shared/security';
import { getCommandTemplates } from '../src/registry/TemplateRegistry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = JSON.parse(
  readFileSync(path.resolve(__dirname, '../src/registry/ao-commands.registry.json'), 'utf-8'),
) as Array<{ id: string; parameters: Array<{ name: string }> }>;

const FIELDS = ['get_command', 'set_command'] as const;

function fields(): Array<{ id: string; field: string; template: string; params: Set<string> }> {
  const out: Array<{ id: string; field: string; template: string; params: Set<string> }> = [];
  for (const c of REGISTRY) {
    const t = getCommandTemplates(c.id);
    if (!t) continue;
    for (const f of FIELDS) {
      if (t[f]) out.push({ id: c.id, field: f, template: t[f], params: new Set(c.parameters.map((p) => p.name)) });
    }
  }
  return out;
}

describe('SEC-3 template quoting lint (all 98 AO commands)', () => {
  const all = fields();

  it('covers all 98 registry commands, each with a template', () => {
    // FIN-22: 96 -> 97 (F-15, CES subnet egress baseline). PH-13 P13-LV: 97 -> 98 (A-22, leaver access termination).
    expect(REGISTRY.length).toBe(98);
    for (const c of REGISTRY) expect(getCommandTemplates(c.id), c.id).not.toBeNull();
    expect(new Set(all.map((f) => f.id)).size).toBe(98);
  });

  it('every placeholder is inside a plain single-quoted literal (none double-quoted, bare or in a here-string)', () => {
    const bad: string[] = [];
    let count = 0;
    for (const f of all) {
      for (const ph of psContext(f.template)) {
        count++;
        if (ph.context !== 'single' || ph.quote !== 'single') bad.push(`${f.id}.${f.field} {${ph.name}} ${ph.context}/${ph.quote}`);
      }
    }
    expect(bad).toEqual([]);
    expect(count).toBeGreaterThan(200);
  });

  it('every placeholder names a declared parameter of its command', () => {
    const bad: string[] = [];
    for (const f of all) {
      for (const ph of psContext(f.template)) if (!f.params.has(ph.name)) bad.push(`${f.id}.${f.field} {${ph.name}}`);
    }
    expect(bad).toEqual([]);
  });

  it('every $ao_<name> reference is defined in the same template as $ao_<name>=\'{<name>}\'', () => {
    const bad: string[] = [];
    for (const f of all) {
      const defined = new Set([...f.template.matchAll(/\$ao_(\w+)='\{(\w+)\}';/g)].filter((m) => m[1] === m[2]).map((m) => m[1]));
      for (const m of f.template.matchAll(/\$ao_(\w+)/g)) if (!defined.has(m[1])) bad.push(`${f.id}.${f.field} $ao_${m[1]}`);
    }
    expect(bad).toEqual([]);
  });

  it('no template re-parses a string as code (Invoke-Expression, iex, [scriptblock]::Create, -EncodedCommand)', () => {
    const bad = all.filter((f) => /Invoke-Expression|\biex\b|\[scriptblock\]::Create|-EncodedCommand/i.test(f.template));
    expect(bad.map((f) => `${f.id}.${f.field}`)).toEqual([]);
  });

  it('the lint itself flags a double-quoted and a bare placeholder', () => {
    const ctx = (t: string) => psContext(t).map((p) => p.context);
    expect(ctx("Get-MgUser -Filter \"userPrincipalName eq '{upn}'\"")).toEqual(['double']);
    expect(ctx('Get-AzFirewall -ResourceGroupName ${resourceGroup}')).toEqual(['bare']);
    expect(ctx("Get-MgUser -Filter 'userPrincipalName eq ''{upn}'''")).toEqual(['single']);
  });
});
