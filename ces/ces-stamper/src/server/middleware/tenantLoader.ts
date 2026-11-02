// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Request, Response, NextFunction } from 'express';
import { loadClientConfigFromTenantJson, resolveTenantJsonPath } from '../../config/ClientConfig.js';

// Extend Express Request to include tenantConfig
declare global {
  namespace Express {
    interface Request {
      tenantConfig?: any;
    }
  }
}

/**
 * Middleware to load ClientConfig from tenant slug provided via ?tenant=<slug> query param.
 * Attaches config to req.tenantConfig for downstream route handlers.
 */
export async function loadTenantConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  const slug = req.query.tenant as string | undefined;

  if (!slug) {
    res.status(400).json({ error: 'Missing tenant query parameter' });
    return;
  }

  try {
    const tenantJsonPath = await resolveTenantJsonPath(slug);
    const cfg = loadClientConfigFromTenantJson(tenantJsonPath);
    req.tenantConfig = cfg;
    next();
  } catch (err: any) {
    res.status(404).json({ error: `Tenant config not found: ${err.message}` });
  }
}
