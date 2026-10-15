// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/** @type {import('tailwindcss').Config} */

/*
 * ComplianceOne design system (designmd.ai: chef/complianceone)
 * Applied as the canonical token layer for the CES Planner.
 * See repo-root DESIGN.md for the full source spec and
 * docs/context/UI_DESIGN_SELECTION.md for the selection rationale.
 *
 * Strategy: override Tailwind's default semantic palette + radius scale so
 * the existing utility classes across all pages resolve to ComplianceOne
 * values. Sharp 0px corners everywhere except status dots (rounded-full).
 */

// Slate ramp — ComplianceOne's neutral surface/border/text family.
const slate = {
  50: '#f8fafc',
  100: '#f1f5f9',
  200: '#e2e8f0',
  300: '#cbd5e1',
  400: '#94a3b8',
  500: '#64748b',
  600: '#475569',
  700: '#334155',
  800: '#1e293b',
  900: '#0f172a',
};

export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary — Heron Ink (#1B2A4A), the v2 "Instrument" identity. Actions + navigation.
        primary: {
          50: '#edf1f7',
          100: '#dce4ef',
          200: '#c2cfe3',
          300: '#9fb3d1',
          400: '#6c8ab5',
          500: '#3d5a8a',
          600: '#1b2a4a', // canonical primary (Heron Ink)
          700: '#24365c', // hover/pressed
          800: '#16233e',
          900: '#0b1220',
        },
        // Designation — regulation CUI-banner purple; theme-constant marking color.
        designation: { DEFAULT: '#502b85', text: '#ffffff' },
        // Retint Tailwind defaults so existing utility classes adopt the system.
        gray: slate,
        slate,
        // Compliance status semantics — text tokens darkened to >=4.5:1 on tint bgs (AA fix).
        compliant: { DEFAULT: '#047857', bg: '#dcfce7', text: '#047857' },
        risk: { DEFAULT: '#b45309', bg: '#fef3c7', text: '#b45309' },
        violation: { DEFAULT: '#b91c1c', bg: '#fee2e2', text: '#b91c1c' },
        review: { DEFAULT: '#1d4ed8', bg: '#dbeafe', text: '#1d4ed8' },
        // Keep green/yellow/red/blue mapped to compliance semantics so
        // legacy `bg-green-100 text-green-800` etc. read on-spec.
        green: {
          50: '#ecfdf5', 100: '#dcfce7', 200: '#bbf7d0', 300: '#86efac',
          400: '#34d399', 500: '#10b981', 600: '#059669', 700: '#047857',
          800: '#059669', 900: '#064e3b',
        },
        yellow: {
          50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d',
          400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309',
          800: '#d97706', 900: '#78350f',
        },
        red: {
          50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5',
          400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c',
          800: '#dc2626', 900: '#7f1d1d',
        },
        blue: {
          50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd',
          400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8',
          800: '#2563eb', 900: '#172554',
        },
        // Indigo legacy → fold into primary ink so old nav button matches.
        indigo: {
          50: '#edf1f7', 100: '#dce4ef', 200: '#c2cfe3', 300: '#9fb3d1',
          400: '#6c8ab5', 500: '#3d5a8a', 600: '#1b2a4a', 700: '#24365c',
          800: '#16233e', 900: '#0b1220',
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        serif: ['"Barlow Condensed"', '"Arial Narrow"', 'sans-serif'],
        display: ['"Barlow Condensed"', '"Arial Narrow"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // ComplianceOne type scale.
        small: ['12px', { lineHeight: '18px' }],
        body: ['14px', { lineHeight: '22px' }],
        h4: ['15px', { lineHeight: '20px', fontWeight: '600' }],
        h3: ['18px', { lineHeight: '24px', fontWeight: '600' }],
        h2: ['22px', { lineHeight: '28px', fontWeight: '600' }],
        h1: ['28px', { lineHeight: '36px', fontWeight: '700' }],
      },
      spacing: {
        // 4px base; ComplianceOne named steps available alongside defaults.
        xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px',
        '2xl': '32px', '3xl': '48px',
      },
      boxShadow: {
        // Flat-with-borders model; shadows reserved for overlays.
        sm: '0 1px 2px rgba(0,0,0,0.04)',
        md: '0 2px 6px rgba(0,0,0,0.06)',
        lg: '0 4px 16px rgba(0,0,0,0.10)',
      },
    },
    // Override the radius scale globally → sharp corners (ComplianceOne).
    borderRadius: {
      none: '0px',
      sm: '0px',
      DEFAULT: '0px',
      md: '0px',
      lg: '0px',
      xl: '0px',
      '2xl': '0px',
      '3xl': '0px',
      full: '9999px', // status dots / avatars only
    },
  },
  plugins: [],
};
