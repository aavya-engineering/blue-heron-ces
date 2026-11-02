// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import {
  AppShell,
  StepRail,
  STAMPER_STEPS,
  TabNav,
  TenantBanner,
  ThemeToggle,
  THEME_STORAGE_KEY,
  readStoredTheme,
} from '../src';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(cleanup);

describe('theme contract (same as ces-theme-toggle.js)', () => {
  it('defaults to dark when nothing is stored', () => {
    expect(readStoredTheme()).toBe('dark');
  });

  it('reads stored "light" as light and "dark" as dark', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(readStoredTheme()).toBe('light');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readStoredTheme()).toBe('dark');
  });

  it('treats any other stored value as light, as the legacy script does', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readStoredTheme()).toBe('light');
  });

  it('ThemeToggle keeps the legacy id and title, applies the stored theme, and toggles it', () => {
    const onChange = vi.fn();
    render(<ThemeToggle onChange={onChange} />);
    const button = screen.getByRole('button', { name: 'Switch to light theme' });
    expect(button).toHaveAttribute('id', 'ces-theme-toggle');
    expect(button).toHaveAttribute('title', 'Toggle light/dark theme');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');

    fireEvent.click(button);
    expect(window.localStorage.getItem('ces-theme')).toBe('light');
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(onChange).toHaveBeenLastCalledWith('light');

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(window.localStorage.getItem('ces-theme')).toBe('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('starts light when light is stored', () => {
    window.localStorage.setItem('ces-theme', 'light');
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });
});

describe('AppShell', () => {
  it('renders the legacy header (ids, brand, version, toggle), rail, banner and content', () => {
    render(
      <AppShell
        product="Stamper"
        version="v9.9.9"
        rail={<StepRail steps={STAMPER_STEPS} />}
        banner={<TenantBanner tenant="Ridgeline Machining" />}
        footer="Footer text"
      >
        <p>Screen body</p>
      </AppShell>,
    );
    const header = screen.getByRole('banner');
    expect(header).toHaveAttribute('id', 'header');
    expect(header).toHaveClass('ces-header');
    expect(header).toHaveTextContent('CES');
    expect(header).toHaveTextContent('Blue Heron Defense — Stamper');
    expect(header).toHaveTextContent('v9.9.9');
    expect(header.querySelector('#ces-theme-toggle')).not.toBeNull();
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(main).toHaveTextContent('Screen body');
    expect(screen.getByRole('navigation', { name: 'Workflow steps' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Tenant' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Footer text');
  });

  it('omits the logo when logoSrc is empty and the footer when none is given', () => {
    const { container } = render(<AppShell product="Muster" logoSrc="" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('footer')).toBeNull();
  });
});

describe('StepRail', () => {
  it('renders the six legacy steps with railNode ids and initial lock states', () => {
    render(<StepRail steps={STAMPER_STEPS} />);
    const labels = ['Tenant', 'Configure', 'Assess', 'Translate', 'Execute', 'Evidence'];
    labels.forEach((label, index) => {
      const node = document.getElementById(`railNode${index}`);
      expect(node).not.toBeNull();
      expect(node).toHaveTextContent(label);
      expect(node).toHaveAttribute('data-state', index < 3 ? 'ready' : 'locked');
      expect(node).toHaveClass(`ck-rail-${index < 3 ? 'ready' : 'locked'}`);
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
  });

  it('marks the running step as the current step', () => {
    const steps = STAMPER_STEPS.map((s) => (s.id === 'assess' ? { ...s, state: 'running' as const } : s));
    render(<StepRail steps={steps} />);
    expect(document.getElementById('railNode2')).toHaveAttribute('aria-current', 'step');
    expect(document.getElementById('railNode0')).not.toHaveAttribute('aria-current');
  });

  it('renders buttons when selectable, with locked steps disabled', () => {
    const onSelect = vi.fn();
    render(<StepRail steps={STAMPER_STEPS} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Configure/ }));
    expect(onSelect).toHaveBeenCalledWith('configure');
    expect(screen.getByRole('button', { name: /Translate/ })).toBeDisabled();
  });
});

describe('TabNav', () => {
  function Harness() {
    const [active, setActive] = useState('console');
    return (
      <TabNav
        label="Output"
        active={active}
        onChange={setActive}
        tabs={[
          { id: 'console', label: 'Console' },
          { id: 'terminal', label: 'Terminal' },
        ]}
      />
    );
  }

  it('exposes a tablist with the active tab selected and legacy data-tab attributes', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Output' })).toBeInTheDocument();
    const consoleTab = screen.getByRole('tab', { name: 'Console' });
    expect(consoleTab).toHaveAttribute('aria-selected', 'true');
    expect(consoleTab).toHaveAttribute('data-tab', 'console');
    expect(consoleTab).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Terminal' })).toHaveAttribute('tabindex', '-1');
  });

  it('switches on click and with arrow, Home and End keys', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: 'Terminal' }));
    expect(screen.getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Terminal' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Console' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Console' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Console' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Terminal' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Console' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('TenantBanner', () => {
  it('names a live tenant and its kind', () => {
    render(<TenantBanner tenant="Larkspur Avionics" kind="Commercial" />);
    const banner = screen.getByRole('region', { name: 'Tenant' });
    expect(banner).toHaveAttribute('id', 'tenantBanner');
    expect(banner).toHaveAttribute('data-simulator', 'false');
    expect(banner).toHaveTextContent('Larkspur Avionics');
    expect(banner).toHaveTextContent('Commercial');
    expect(banner).toHaveTextContent('Live tenant');
  });

  it('flags a simulated tenant with its profile', () => {
    render(<TenantBanner tenant="Ridgeline Machining" simulator simulatorProfile="s1-mach" />);
    const banner = screen.getByRole('region', { name: 'Tenant' });
    expect(banner).toHaveAttribute('data-simulator', 'true');
    expect(banner).toHaveClass('ck-banner-sim');
    expect(banner).toHaveTextContent('Simulator (s1-mach): commands run against a simulated tenant, not a live one.');
  });
});
