// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// W8-FMT: the Mission Plan and Tenant Manifest HTML views are the vendored
// Planner formatters' output, unchanged, and self-contained (AD-6).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test, expect } from 'vitest';
import { PLAN_HTML_VIEW_FILES, renderPlanHtmlViews } from '../planHtmlViews';
import { formatPlanAsHTML, formatManifestAsHTML } from '@/features/plan/engine/utils/exportPlan';

const fixture = (name: string): unknown =>
  JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/features/plan/__fixtures__', name), 'utf8'));

const missionPlan = fixture('manual-mission-plan.json');
const tenantManifest = fixture('tenant-manifest.json');
const views = renderPlanHtmlViews({ missionPlan, tenantManifest });

describe('W8-FMT: renderPlanHtmlViews', () => {
  test('emits the two views under Planner download names, equal to the vendored formatters', () => {
    expect(Object.keys(views).sort()).toEqual(['manual-mission-plan.html', 'tenant-manifest.html']);
    expect(views[PLAN_HTML_VIEW_FILES.missionPlan]).toBe(formatPlanAsHTML(missionPlan));
    expect(views[PLAN_HTML_VIEW_FILES.tenantManifest]).toBe(formatManifestAsHTML(tenantManifest));
  });

  test('each view is a full HTML document with an inline <style> and the artifact intent as title', () => {
    expect(views[PLAN_HTML_VIEW_FILES.missionPlan]).toMatch(
      /^<!DOCTYPE html>[\s\S]*<title>CMMC L2 compliance mission plan \(harden_existing\)<\/title>\n<style>[\s\S]+<\/style>[\s\S]*<\/html>$/,
    );
    expect(views[PLAN_HTML_VIEW_FILES.tenantManifest]).toMatch(
      /^<!DOCTYPE html>[\s\S]*<title>Tenant Manifest — Canonical tenant manifest defining RIGHT state for CMMC L2 \(harden_existing, m365_only\)<\/title>\n<style>[\s\S]+<\/style>[\s\S]*<\/html>$/,
    );
  });

  test('AD-6: no view loads an external resource (stylesheet, script, image, font, import, url())', () => {
    for (const [name, html] of Object.entries(views)) {
      expect(html, name).not.toMatch(/<link\b/i);
      expect(html, name).not.toMatch(/<script\b/i);
      expect(html, name).not.toMatch(/<(img|iframe|object|embed|source|video|audio)\b/i);
      expect(html, name).not.toMatch(/@import/i);
      expect(html, name).not.toMatch(/url\(/i);
      expect(html, name).not.toMatch(/\bsrc\s*=/i);
    }
  });

  test('an empty artifact still renders a document (formatter defaults)', () => {
    const empty = renderPlanHtmlViews({ missionPlan: {}, tenantManifest: {} });
    expect(empty[PLAN_HTML_VIEW_FILES.missionPlan]).toContain('<title>CMMC Compliance Mission Plan</title>');
    expect(empty[PLAN_HTML_VIEW_FILES.tenantManifest]).toContain('<title>Tenant Manifest — CMMC Compliance</title>');
  });
});
