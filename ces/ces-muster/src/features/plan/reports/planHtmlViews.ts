// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// planHtmlViews.ts — W8-FMT: the Mission Plan and Tenant Manifest as Planner's
// self-contained HTML views (inline <style>, no external stylesheet, script,
// font or image), rendered by the vendored formatters unchanged.
import { formatPlanAsHTML, formatManifestAsHTML } from '@/features/plan/engine/utils/exportPlan';

/** Planner's download names for the two views (its JSON names with .html). */
export const PLAN_HTML_VIEW_FILES = {
  missionPlan: 'manual-mission-plan.html',
  tenantManifest: 'tenant-manifest.html',
} as const;

/** File name -> HTML for the compiled Mission Plan and Tenant Manifest. */
export function renderPlanHtmlViews(artifacts: { missionPlan: unknown; tenantManifest: unknown }): Record<string, string> {
  return {
    [PLAN_HTML_VIEW_FILES.missionPlan]: formatPlanAsHTML(artifacts.missionPlan),
    [PLAN_HTML_VIEW_FILES.tenantManifest]: formatManifestAsHTML(artifacts.tenantManifest),
  };
}
