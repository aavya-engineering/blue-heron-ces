// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MG-25: tooltips on derived-answer rows render for SI, TCP and boundary
// nodes, from the copied help YAMLs (public/knowledge/), with the value's
// provenance and source.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, test, expect, beforeAll, afterEach, vi } from 'vitest';
import { buildHelpIndex, loadHelpIndex, _resetHelpIndexCache, type HelpIndex } from '@/features/interview/derivedAnswerHelp';
import { DerivedValueTooltip, type DerivedValueTooltipProps } from '../DerivedValueTooltip';
import { GlossaryText } from '../GlossaryText';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (f: string) => fs.readFileSync(path.resolve(process.cwd(), 'public/knowledge', f), 'utf8');
let help: HelpIndex;
beforeAll(() => {
  help = buildHelpIndex({
    glossary: read('help Glossary.yaml'),
    tcp: read('help TCP Guidance.yaml'),
    cui: read('help CUI Boundary Guidance.yaml'),
  });
});

let container: HTMLDivElement;
let root: Root;
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(el: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(el));
}
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

function renderTip(p: Omit<DerivedValueTooltipProps, 'help'>) {
  render(<DerivedValueTooltip {...p} help={help} />);
  const trigger = q(`derived-help-${p.nodeId}`)!;
  expect(trigger).not.toBeNull();
  const tip = q(`derived-help-tip-${p.nodeId}`)!;
  expect(tip.hidden).toBe(true);
  act(() => {
    trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  expect(tip.hidden).toBe(false);
  return { trigger, tip };
}

describe('MG-25: derived-answer tooltips', () => {
  test('SI node: value, provenance + source, and the glossary terms of its prompt', () => {
    const { trigger, tip } = renderTip({
      nodeId: 'S-27',
      kind: 'si',
      prompt: 'Is BYOD allowed, and are personal devices enrolled for Conditional Access?',
      value: 'blocked',
      provenance: 'derived:si:discovery:graph:deviceConfigurations',
      source: 'graph:deviceConfigurations',
    });
    expect(q('derived-help-tip-S-27-value')!.textContent).toContain('blocked');
    expect(q('derived-help-tip-S-27-provenance')!.textContent).toContain('derived:si:discovery:graph:deviceConfigurations');
    expect(q('derived-help-tip-S-27-provenance')!.textContent).toContain('graph:deviceConfigurations');
    const terms = [...tip.querySelectorAll('[data-testid="derived-help-tip-S-27-term"]')].map((e) => e.textContent);
    expect(terms.some((t) => t!.startsWith('Conditional Access:'))).toBe(true);
    expect(terms.some((t) => t!.startsWith('BYOD:'))).toBe(true);
    expect(q('derived-help-tip-S-27-guidance')).toBeNull();
    expect(trigger.getAttribute('title')).toContain('Provenance: derived:si:discovery:graph:deviceConfigurations');
    expect(tip.querySelectorAll('[data-testid="glossary-term"]').length).toBeGreaterThan(0);
  });

  test('TCP node: the TCP guidance for the node id plus provenance', () => {
    renderTip({
      nodeId: 'TCP.TI.004',
      kind: 'tcp',
      prompt: 'Which cloud environment is the tenant in?',
      value: 'gcc_high',
      provenance: 'auto_detected',
      source: 'graph:organization',
    });
    expect(q('derived-help-tip-TCP.TI.004-guidance')!.textContent).toContain('cloud environment determines');
    expect(q('derived-help-tip-TCP.TI.004-provenance')!.textContent).toContain('auto_detected');
  });

  test('CUI boundary node: the CUI boundary guidance plus provenance', () => {
    renderTip({
      nodeId: 'CUI.DEV.001',
      kind: 'boundary',
      prompt: 'Are only managed devices allowed to access CUI?',
      value: 'Yes – managed only',
      provenance: 'derived:cui:si:byod_posture',
    });
    expect(q('derived-help-tip-CUI.DEV.001-guidance')!.textContent!.length).toBeGreaterThan(10);
    expect(q('derived-help-tip-CUI.DEV.001-provenance')!.textContent).toContain('derived:cui:si:byod_posture');
  });

  test('bnd-* boundary node (footprint inference): provenance and glossary terms', () => {
    renderTip({
      nodeId: 'bnd-001',
      kind: 'boundary',
      prompt: 'Does the GCC High tenant hold CUI?',
      value: 'yes',
      provenance: 'derived:boundary:footprint',
    });
    expect(q('derived-help-tip-bnd-001-provenance')!.textContent).toContain('derived:boundary:footprint');
    const terms = [...container.querySelectorAll('[data-testid="derived-help-tip-bnd-001-term"]')].map((e) => e.textContent);
    expect(terms.some((t) => t!.startsWith('GCC High:'))).toBe(true);
  });

  test('keyboard focus opens the tooltip; blur closes it', () => {
    render(<DerivedValueTooltip nodeId="G-02" kind="si" prompt="CUI presence" value="cui_present" provenance="answered" help={help} />);
    const trigger = q('derived-help-G-02')!;
    act(() => trigger.focus());
    expect(q('derived-help-tip-G-02')!.hidden).toBe(false);
    act(() => trigger.blur());
    expect(q('derived-help-tip-G-02')!.hidden).toBe(true);
  });

  test('GlossaryText marks highlightable terms only (Planner: CUI is highlight_in_prompts false)', () => {
    render(<GlossaryText text="BYOD access to CUI under Conditional Access" glossary={help.glossary} />);
    const marked = [...container.querySelectorAll('[data-testid="glossary-term"]')].map((e) => e.textContent);
    expect(marked).toEqual(['BYOD', 'Conditional Access']);
    expect(container.textContent).toBe('BYOD access to CUI under Conditional Access');
  });

  test('loadHelpIndex reads the three help files from /knowledge', async () => {
    _resetHelpIndexCache();
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url));
      const text = read(decodeURI(String(url)).replace(/^\/knowledge\//, ''));
      return { ok: true, text: async () => text } as unknown as Response;
    });
    const i = await loadHelpIndex();
    expect(urls.sort()).toEqual(['/knowledge/help CUI Boundary Guidance.yaml', '/knowledge/help Glossary.yaml', '/knowledge/help TCP Guidance.yaml']);
    expect(i.guidance['TCP.TI.001']).toBeDefined();
    expect(i.guidance['CUI.DEV.001']).toBeDefined();
    render(<span />);
  });
});
