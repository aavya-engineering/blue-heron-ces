// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-3 M4 — a hand-written `UiPage` for the driver ordering tests.
 *
 * The M0 spike proved these GUIs bite on ORDER (AO resets the tenant box on
 * every form open; Stamper's execute target sticks on Dry Run), so the flows
 * are written against the narrow `UiPage` seam and pinned here without a
 * browser. Every interaction is appended to `actions`, so a test can assert
 * the sequence, not just the outcome.
 */

import type { UiPage } from '../../src/demo/ui-page.js';

export interface FakeUiPageState {
  /** `textContent` per selector — mutate from an `onClick` hook to model a transition. */
  texts: Record<string, string>;
  /** `class` attribute per selector. */
  classes: Record<string, string>;
  /** Input/select values per selector. */
  values: Record<string, string>;
  visible: Set<string>;
  counts: Record<string, number>;
  lists: Record<string, string[]>;
  json: Record<string, unknown>;
  /** Body returned by `waitForResponse`, keyed by the url fragment. */
  responses: Record<string, unknown>;
  /** Fired when the selector is clicked — model the page's own state change here. */
  onClick: Record<string, () => void>;
  /** Selectors whose `waitForSelector` should reject (element never appears). */
  missing: Set<string>;
  /** Path returned by `waitForDownload`. */
  downloadPath?: string;
}

export class FakeUiPage implements UiPage {
  readonly actions: string[] = [];
  readonly state: FakeUiPageState;

  constructor(state: Partial<FakeUiPageState> = {}) {
    this.state = {
      texts: state.texts ?? {},
      classes: state.classes ?? {},
      values: state.values ?? {},
      visible: state.visible ?? new Set<string>(),
      counts: state.counts ?? {},
      lists: state.lists ?? {},
      json: state.json ?? {},
      responses: state.responses ?? {},
      onClick: state.onClick ?? {},
      missing: state.missing ?? new Set<string>(),
      downloadPath: state.downloadPath,
    };
  }

  async goto(url: string): Promise<void> {
    this.actions.push(`goto ${url}`);
  }

  async click(selector: string): Promise<void> {
    this.actions.push(`click ${selector}`);
    this.state.onClick[selector]?.();
  }

  async fill(selector: string, value: string): Promise<void> {
    this.actions.push(`fill ${selector}=${value}`);
    this.state.values[selector] = value;
  }

  async check(selector: string): Promise<void> {
    this.actions.push(`check ${selector}`);
    this.state.values[selector] = 'checked';
    this.state.onClick[selector]?.();
  }

  async selectOption(selector: string, value: string): Promise<void> {
    this.actions.push(`select ${selector}=${value}`);
    this.state.values[selector] = value;
    this.state.onClick[selector]?.();
  }

  async setInputFiles(selector: string, absPath: string): Promise<void> {
    this.actions.push(`setInputFiles ${selector}=${absPath}`);
    this.state.values[selector] = absPath;
    this.state.onClick[selector]?.();
  }

  async waitForDownload(action: () => Promise<void>, saveDir: string): Promise<string> {
    this.actions.push(`waitForDownload ${saveDir}`);
    await action();
    return this.state.downloadPath ?? `${saveDir}/download.json`;
  }

  async inputValue(selector: string): Promise<string> {
    return this.state.values[selector] ?? '';
  }

  async textContent(selector: string): Promise<string | null> {
    return this.state.texts[selector] ?? null;
  }

  async getAttribute(selector: string, name: string): Promise<string | null> {
    if (name !== 'class') return null;
    return this.state.classes[selector] ?? null;
  }

  async texts(selector: string): Promise<string[]> {
    return this.state.lists[selector] ?? [];
  }

  async count(selector: string): Promise<number> {
    return this.state.counts[selector] ?? 0;
  }

  async isVisible(selector: string): Promise<boolean> {
    return this.state.visible.has(selector);
  }

  async waitForSelector(selector: string, timeoutMs: number): Promise<void> {
    this.actions.push(`wait ${selector}`);
    if (this.state.missing.has(selector)) {
      throw new Error(`fake page: ${selector} never appeared (${timeoutMs}ms)`);
    }
  }

  async waitForResponse(urlPart: string, action: () => Promise<void>, _timeoutMs: number): Promise<unknown> {
    this.actions.push(`awaitResponse ${urlPart}`);
    await action();
    return this.state.responses[urlPart];
  }

  async getJson(urlPath: string): Promise<unknown> {
    this.actions.push(`getJson ${urlPath}`);
    return this.state.json[urlPath];
  }

  async screenshot(filePath: string): Promise<void> {
    this.actions.push(`screenshot ${filePath}`);
  }

  /** Index of the first action containing `fragment`, or -1. */
  indexOf(fragment: string): number {
    return this.actions.findIndex((a) => a.includes(fragment));
  }
}
