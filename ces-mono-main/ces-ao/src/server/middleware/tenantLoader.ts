// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { Request, Response, NextFunction } from 'express';
import { loadTenantConfigBySlug } from '../../tenant/aoTenants.js';

/**
 * G-TENANT-M5: tenants resolve through the ces-tenant registry (same call
 * path as the CLI and MCP server) — the cwd-anchored
 * `resolveTenantJsonPath(slug, process.cwd())` chain is retired.
 */
export async function tenantLoader(req: Request, res: Response, next: NextFunction): Promise<void> {
  const slug = req.query.tenant as string | undefined;

  if (!slug) {
    res.status(400).json({ error: 'Missing tenant query parameter' });
    return;
  }

  try {
    const config = await loadTenantConfigBySlug(slug);
    (req as any).tenantConfig = config;
    next();
  } catch (err) {
    res.status(404).json({ error: `Tenant not found: ${slug}` });
    return;
  }
}
