// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { Router } from 'express';
import type { AoCommand } from '../../types/AoCommand.js';

export function createCommandsRouter(registry: AoCommand[]) {
  const router = Router();

  // GET /api/commands — return grouped by domain
  router.get('/api/commands', (req, res) => {
    const grouped = groupByDomain(registry);
    res.json({ domains: grouped });
  });

  // POST /api/commands/:id/execute — retired (AO-22, 2026-09-27 founder default).
  // Used to return 200 {status:'queued'} and do nothing. Real execution goes through
  // POST /api/execute/:commandId (src/server/routes/execute.routes.ts). Not id-gated:
  // the route itself is gone, so every id gets the same 410.
  router.post('/api/commands/:id/execute', (req, res) => {
    res.status(410).json({ error: 'gone: use POST /api/execute/:commandId' });
  });

  return router;
}

function groupByDomain(commands: AoCommand[]) {
  const domains = new Map<string, { id: string; name: string; commands: AoCommand[] }>();

  for (const cmd of commands) {
    if (!domains.has(cmd.domain)) {
      domains.set(cmd.domain, { id: cmd.domain, name: cmd.domainName, commands: [] });
    }
    domains.get(cmd.domain)!.commands.push(cmd);
  }

  return Array.from(domains.values());
}
