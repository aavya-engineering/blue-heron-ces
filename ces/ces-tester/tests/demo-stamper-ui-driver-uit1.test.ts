// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

// W8-UIT1 extensions of the Stamper driver: the parity contract with the SPA's selectors, the base-path URL,
// Incremental mode with per-gate approval, the execute window, the ledger and evidence reads, step captions.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STAMPER_SELECTORS,
  STAMPER_UIT_SELECTORS,
  STAMPER_EXEC_MODE_VALUE,
  WATCH_CAPTION_ID,
  approveUntilTerminal,
  captionScript,
  openStamperCard,
  runStamperUiFlow,
  stamperConsoleUrl,
  stamperRailNode,
  type StamperUiDriveContext,
} from '../src/demo/stamper-ui-driver.js';
import { FakeUiPage } from './helpers/fake-ui-page.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.resolve(here, '..', 'src', 'demo', 'stamper-ui-driver.ts');
const SPA_SELECTORS = path.resolve(here, '..', '..', 'ces-stamper', 'ui', 'e2e', 'parity', 'selectors.ts');

/** The `STAMPER_SELECTORS` block, trimmed lines, comments dropped (the SPA's parity.test.ts uses the same rule). */
function selectorsBlock(text: string): string[] {
  const start = text.indexOf('export const STAMPER_SELECTORS = {');
  const end = text.indexOf('} as const;', start);
  return text
    .slice(start, end)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('/**') && !l.startsWith('*') && !l.startsWith('//'));
}

describe('contract: STAMPER_SELECTORS = ces-stamper/ui/e2e/parity/selectors.ts', () => {
  it.skipIf(!fs.existsSync(SPA_SELECTORS))('the two STAMPER_SELECTORS blocks are equal (keys, order, values)', () => {
    const ours = selectorsBlock(fs.readFileSync(DRIVER, 'utf8'));
    const spa = selectorsBlock(fs.readFileSync(SPA_SELECTORS, 'utf8'));
    expect(ours.length).toBeGreaterThan(1);
    expect(ours).toEqual(spa);
    const keyOf = (l: string) => /^([A-Za-z0-9]+):/.exec(l)?.[1];
    expect(spa.map(keyOf).filter(Boolean)).toEqual(Object.keys(STAMPER_SELECTORS));
    expect(Object.keys(STAMPER_SELECTORS)).toHaveLength(18);
  });

  it('the W8-UIT1 selectors live outside the mirrored block', () => {
    for (const k of Object.keys(STAMPER_UIT_SELECTORS)) expect(Object.keys(STAMPER_SELECTORS)).not.toContain(k);
    expect(selectorsBlock(fs.readFileSync(DRIVER, 'utf8')).join('\n')).not.toContain('pendingApprove');
    expect(STAMPER_UIT_SELECTORS.pendingApprove).not.toContain('layer-approval');
  });
});

describe('stamperConsoleUrl (base path variant)', () => {
  it('no base path = the origin as given; / and /app/ join without doubled slashes', () => {
    expect(stamperConsoleUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
    expect(stamperConsoleUrl('http://127.0.0.1:3000', '/')).toBe('http://127.0.0.1:3000/');
    expect(stamperConsoleUrl('http://127.0.0.1:3000/', '/app/')).toBe('http://127.0.0.1:3000/app/');
    expect(stamperConsoleUrl('http://127.0.0.1:3000', 'app/')).toBe('http://127.0.0.1:3000/app/');
  });

  it('Incremental is the console option value "manual"', () => {
    expect(STAMPER_EXEC_MODE_VALUE).toEqual({ auto: 'auto', incremental: 'manual' });
  });
});

function flowPage(): FakeUiPage {
  const page = new FakeUiPage({
    texts: {
      [STAMPER_SELECTORS.cardStatus2]: 'Pending',
      [STAMPER_SELECTORS.cardStatus3]: 'Pending',
      [STAMPER_SELECTORS.cardStatus4]: 'Locked',
    },
    classes: Object.fromEntries([0, 1, 2, 3, 4, 5].map((n) => [STAMPER_SELECTORS.card(n), 'workflow-card card-collapsed'])),
    visible: new Set([STAMPER_SELECTORS.connectionGate]),
    responses: { '/api/translate': { success: true, planDataPaths: { output: 'C:\\pl\\ep.json' } } },
  });
  page.state.onClick[STAMPER_SELECTORS.gateAllow] = () => {
    page.state.classes[STAMPER_SELECTORS.card(0)] = 'workflow-card tenant-connected';
  };
  page.state.onClick[STAMPER_SELECTORS.assess] = () => {
    page.state.texts[STAMPER_SELECTORS.cardStatus2] = 'Assessed';
  };
  page.state.onClick[STAMPER_SELECTORS.translate] = () => {
    page.state.texts[STAMPER_SELECTORS.cardStatus3] = 'Translated';
  };
  return page;
}

/** Model Incremental: Execute starts the run; each Approve clears one gate; after `gates` approvals the badge is terminal. */
function withGates(page: FakeUiPage, gates: number): void {
  let left = gates;
  page.state.onClick[STAMPER_SELECTORS.execute] = () => {
    page.state.texts[STAMPER_SELECTORS.cardStatus4] = 'Executing...';
    page.state.counts[STAMPER_UIT_SELECTORS.pendingApprove] = left > 0 ? 1 : 0;
    if (left === 0) page.state.texts[STAMPER_SELECTORS.cardStatus4] = 'Complete';
  };
  page.state.onClick[STAMPER_UIT_SELECTORS.pendingApprove] = () => {
    left--;
    page.state.counts[STAMPER_UIT_SELECTORS.pendingApprove] = left > 0 ? 1 : 0;
    if (left === 0) page.state.texts[STAMPER_SELECTORS.cardStatus4] = 'Partial: 2 failed';
  };
}

function ctx(overrides: Partial<StamperUiDriveContext> = {}): StamperUiDriveContext {
  return {
    baseUrl: 'http://127.0.0.1:3000',
    slug: 's1-mach',
    missionPlanPath: 'C:\\ws\\pl\\mp.json',
    manifestPath: 'C:\\ws\\pl\\tm.json',
    pipelineRoot: path.join(os.tmpdir(), 'no-such-pipeline-root-uit1'),
    planVariables: false,
    approvalPollMs: 1,
    ...overrides,
  };
}

describe('runStamperUiFlow, Incremental mode (W8-UIT1)', () => {
  it('selects Incremental ("manual"), approves every pending gate until terminal, records approvals and the execute window', async () => {
    const page = flowPage();
    withGates(page, 3);
    const before = new Date().toISOString();
    const r = await runStamperUiFlow(page, ctx({ execMode: 'incremental' }));
    expect(page.state.values[STAMPER_SELECTORS.execMode]).toBe('manual');
    expect(page.state.values[STAMPER_SELECTORS.execTarget]).toBe('tenant');
    expect(r.approvals).toBe(3);
    expect(page.actions.filter((a) => a === `click ${STAMPER_UIT_SELECTORS.pendingApprove}`)).toHaveLength(3);
    expect(page.indexOf(`click ${STAMPER_UIT_SELECTORS.pendingApprove}`)).toBeGreaterThan(page.indexOf(`click ${STAMPER_SELECTORS.execute}`));
    expect(r.executeBadge).toBe('Partial: 2 failed');
    expect(r.executeWindow!.started >= before).toBe(true);
    expect(r.executeWindow!.ended >= r.executeWindow!.started).toBe(true);
    expect(r.translateResponse).toEqual({ success: true, planDataPaths: { output: 'C:\\pl\\ep.json' } });
  });

  it('fills the IM path after the MP and TM paths, before Assess, only when given', async () => {
    const page = flowPage();
    withGates(page, 0);
    await runStamperUiFlow(page, ctx({ execMode: 'incremental', infraManifestPath: 'C:\\ws\\pl\\im.json' }));
    const im = page.indexOf(`fill ${STAMPER_UIT_SELECTORS.infraManifestPath}=C:\\ws\\pl\\im.json`);
    expect(im).toBeGreaterThan(page.indexOf(`fill ${STAMPER_SELECTORS.manifestPath}`));
    expect(im).toBeLessThan(page.indexOf(`click ${STAMPER_SELECTORS.assess}`));
    const plain = flowPage();
    withGates(plain, 0);
    await runStamperUiFlow(plain, ctx());
    expect(plain.indexOf(STAMPER_UIT_SELECTORS.infraManifestPath)).toBe(-1);
  });

  it('an explicit auto mode records the window but clicks no approval', async () => {
    const page = flowPage();
    withGates(page, 0);
    const r = await runStamperUiFlow(page, ctx({ execMode: 'auto' }));
    expect(page.state.values[STAMPER_SELECTORS.execMode]).toBe('auto');
    expect(r.approvals).toBeUndefined();
    expect(r.executeWindow).toBeDefined();
    expect(page.indexOf(STAMPER_UIT_SELECTORS.pendingApprove)).toBe(-1);
  });

  it('without the new options the result carries none of the new fields (demo:e2e unchanged)', async () => {
    const page = flowPage();
    withGates(page, 0);
    const r = await runStamperUiFlow(page, ctx());
    for (const k of ['approvals', 'executeWindow', 'resourceLedger', 'evidenceScan', 'recording']) expect(r).not.toHaveProperty(k);
    expect(page.state.values[STAMPER_SELECTORS.execMode]).toBe('auto');
  });

  it('approveUntilTerminal times out naming the approvals so far', async () => {
    const page = flowPage();
    page.state.texts[STAMPER_SELECTORS.cardStatus4] = 'Executing...';
    page.state.counts[STAMPER_UIT_SELECTORS.pendingApprove] = 1;
    await expect(approveUntilTerminal(page, { timeoutMs: 5, pollMs: 1 })).rejects.toThrow(/approval\(s\)/);
  });
});

describe('runStamperUiFlow ledger and evidence reads (W8-UIT1)', () => {
  it('opens the resource ledger, reads its count, closes it; runs the evidence scan from the Evidence card', async () => {
    const page = flowPage();
    withGates(page, 1);
    page.state.visible.add(STAMPER_UIT_SELECTORS.resourcesButton);
    page.state.texts[STAMPER_UIT_SELECTORS.ledgerCount] = '41 resources';
    page.state.responses['/api/evidence-scan'] = { summary: { totalControls: 110, controlsWithEvidence: 72, coveragePct: 65 } };
    page.state.onClick[STAMPER_UIT_SELECTORS.evidenceScan] = () => {
      page.state.texts[STAMPER_UIT_SELECTORS.cardStatus5] = '65% Coverage';
    };
    const r = await runStamperUiFlow(page, ctx({ execMode: 'incremental', readLedgerAndEvidence: true }));
    expect(r.resourceLedger).toEqual({ countText: '41 resources' });
    expect(r.evidenceScan).toEqual({ summary: { totalControls: 110, controlsWithEvidence: 72, coveragePct: 65 }, badge: '65% Coverage' });
    const order = [
      page.indexOf(`click ${STAMPER_SELECTORS.execute}`),
      page.indexOf(`click ${STAMPER_UIT_SELECTORS.resourcesButton}`),
      page.indexOf(`click ${STAMPER_UIT_SELECTORS.ledgerClose}`),
      page.indexOf(`click ${STAMPER_SELECTORS.card(5)} .workflow-card-header`),
      page.indexOf('awaitResponse /api/evidence-scan'),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('a ledger with no button and an evidence scan with no summary are recorded as errors, never as observed', async () => {
    const page = flowPage();
    withGates(page, 0);
    page.state.responses['/api/evidence-scan'] = { error: 'tenant query param required' };
    const r = await runStamperUiFlow(page, ctx({ execMode: 'incremental', readLedgerAndEvidence: true }));
    expect(r.resourceLedger?.error).toMatch(/not shown/);
    expect(r.resourceLedger?.countText).toBeUndefined();
    expect(r.evidenceScan?.error).toMatch(/no summary: tenant query param required/);
    expect(r.evidenceScan?.summary).toBeUndefined();
  });
});

// W8-UIT3: the SPA (/app/) renders one screen per card, reached through the rail. Model it: only the current
// screen's card is in the DOM (waitForSelector rejects the others), and #railNode<n> switches the screen.
function spaPage(): FakeUiPage {
  const page = flowPage();
  const cards = [0, 1, 2, 3, 4, 5].map((n) => STAMPER_SELECTORS.card(n));
  const show = (n: number) => {
    page.state.missing = new Set(cards.filter((_, i) => i !== n));
  };
  show(0);
  for (let n = 0; n <= 5; n++) page.state.onClick[stamperRailNode(n)] = () => show(n);
  return page;
}

describe('runStamperUiFlow on the SPA console (W8-UIT3)', () => {
  const KIT = path.resolve(here, '..', '..', 'ces-shared', 'ui', 'kit', 'src');

  it('opens each card from the rail (#railNode<n>) and waits for it before using it, in drive order', async () => {
    const page = spaPage();
    withGates(page, 2);
    page.state.visible.add(STAMPER_UIT_SELECTORS.resourcesButton);
    page.state.responses['/api/evidence-scan'] = { summary: { totalControls: 110 } };
    const r = await runStamperUiFlow(page, ctx({ execMode: 'incremental', readLedgerAndEvidence: true, consoleVariant: 'spa' }));
    expect(r.approvals).toBe(2);
    const rail = [0, 1, 2, 3, 4, 5].map((n) => page.indexOf(`click ${stamperRailNode(n)}`));
    expect(rail.every((i) => i >= 0)).toBe(true);
    expect([...rail].sort((a, b) => a - b)).toEqual(rail);
    for (let n = 0; n <= 5; n++) expect(page.indexOf(`wait ${STAMPER_SELECTORS.card(n)}`)).toBeGreaterThan(rail[n]);
    expect(page.indexOf(`fill ${STAMPER_SELECTORS.missionPlanPath}`)).toBeGreaterThan(rail[1]);
    expect(page.indexOf(`click ${STAMPER_SELECTORS.assess}`)).toBeGreaterThan(rail[2]);
    expect(page.indexOf(`click ${STAMPER_SELECTORS.translate}`)).toBeGreaterThan(rail[3]);
    expect(page.indexOf(`click ${STAMPER_SELECTORS.execute}`)).toBeGreaterThan(rail[4]);
    expect(page.indexOf('awaitResponse /api/evidence-scan')).toBeGreaterThan(rail[5]);
    expect(page.actions.some((a) => a.startsWith('goto'))).toBe(false);
  });

  it('a card the rail did not bring on screen fails at once, naming the card', async () => {
    const page = spaPage();
    page.state.onClick[stamperRailNode(1)] = () => undefined;
    await expect(openStamperCard(page, 1, 'spa')).rejects.toThrow(/#workflowCard1 never appeared/);
  });

  it('the legacy console never touches the rail (unchanged behaviour)', async () => {
    const page = flowPage();
    withGates(page, 0);
    await runStamperUiFlow(page, ctx({ execMode: 'incremental' }));
    expect(page.actions.some((a) => a.includes('#railNode'))).toBe(false);
  });

  it.skipIf(!fs.existsSync(KIT))('approve and ledger-close selectors match the legacy classes and the kit (ApprovalCard, ResourceLedger, StepRail)', () => {
    expect(STAMPER_UIT_SELECTORS.pendingApprove).toContain('button.btn-success');
    expect(STAMPER_UIT_SELECTORS.pendingApprove).toContain('button.ck-approval-approve');
    expect(STAMPER_UIT_SELECTORS.ledgerClose).toContain('.ledger-close-btn');
    expect(STAMPER_UIT_SELECTORS.ledgerClose).toContain('.ck-ledger-close');
    const approval = fs.readFileSync(path.join(KIT, 'editors', 'ApprovalCard.tsx'), 'utf8');
    expect(approval).toContain('btn btn-primary ck-approval-approve');
    expect(approval).toContain("'ck-approval sub-approval-btns'");
    expect(approval).toContain("'ck-approval approval-btns'");
    expect(approval).toContain('return `approval-${escId(target.taskId)}`');
    expect(fs.readFileSync(path.join(KIT, 'panels', 'ResourceLedger.tsx'), 'utf8')).toContain('className="ck-ledger-close"');
    expect(fs.readFileSync(path.join(KIT, 'shell', 'StepRail.tsx'), 'utf8')).toContain("idPrefix = 'railNode'");
  });
});

describe('step captions (Watchable)', () => {
  it('captions each step in drive order; a failing caption never fails the drive', async () => {
    const page = flowPage();
    withGates(page, 1);
    const seen: string[] = [];
    await runStamperUiFlow(page, ctx({ execMode: 'incremental', readLedgerAndEvidence: true, caption: async (t) => { seen.push(t); } }));
    expect(seen.map((t) => t.split(':')[0])).toEqual(['Tenant', 'Translate', 'Translate', 'Approve and execute', 'Ledger', 'Evidence']);
    const page2 = flowPage();
    withGates(page2, 0);
    await expect(runStamperUiFlow(page2, ctx({ caption: async () => { throw new Error('page closed'); } }))).resolves.toBeDefined();
  });

  it('captionScript is a self-contained page script with the caption id and the text JSON-escaped', () => {
    const s = captionScript('Approve "all" </script>');
    expect(s).toContain(JSON.stringify(WATCH_CAPTION_ID));
    expect(s).toContain(JSON.stringify('Approve "all" </script>'));
    expect(s).toContain('pointer-events:none');
    expect(() => new Function(s)).not.toThrow();
  });
});
