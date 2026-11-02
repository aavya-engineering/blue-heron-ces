// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { Gallery } from '../gallery/Gallery';
import * as kit from '../src';

afterEach(cleanup);

async function seriousViolations(root: Element) {
  // jsdom cannot compute colour contrast; that rule is checked in the browser (SPA axe run).
  const result = await axe.run(root, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

describe('gallery', () => {
  it('renders every shell component', () => {
    render(<Gallery />);
    expect(screen.getByRole('banner')).toHaveTextContent('Stamper');
    expect(screen.getAllByRole('navigation').length).toBeGreaterThanOrEqual(5);
    expect(screen.getByRole('tablist', { name: 'Output' })).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: 'Tenant' })).toHaveLength(4);
  });

  it('interactive rail cycles a step state and resets', () => {
    render(<Gallery />);
    const node = document.getElementById('galleryRail0');
    expect(node).toHaveAttribute('data-state', 'ready');
    fireEvent.click(node as HTMLElement);
    expect(document.getElementById('galleryRail0')).toHaveAttribute('data-state', 'running');
    fireEvent.click(screen.getByRole('button', { name: 'Reset steps' }));
    expect(document.getElementById('galleryRail0')).toHaveAttribute('data-state', 'ready');
  });

  it('has no serious or critical axe violations', async () => {
    const { container } = render(<Gallery />);
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('has no serious or critical axe violations with the Terminal tab active', async () => {
    const { container } = render(<Gallery />);
    fireEvent.click(screen.getByRole('tab', { name: 'Terminal' }));
    expect(await seriousViolations(container)).toEqual([]);
  });
});

describe('public API', () => {
  it('index exports AppShell (W8-KIT1 landed-when) and the rest of the shell', () => {
    expect(typeof kit.AppShell).toBe('function');
    for (const name of ['StepRail', 'TabNav', 'ThemeToggle', 'TenantBanner', 'useEventStream', 'useTheme']) {
      expect(typeof (kit as Record<string, unknown>)[name]).toBe('function');
    }
    expect(kit.THEME_STORAGE_KEY).toBe('ces-theme');
    expect(kit.STAMPER_STEPS.map((s) => s.label)).toEqual([
      'Tenant',
      'Configure',
      'Assess',
      'Translate',
      'Execute',
      'Evidence',
    ]);
  });
});
