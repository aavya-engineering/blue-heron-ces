// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// discoveryWiring.ts — G-MUSTER-DISCOVERY-1: the thin, live wiring around the
// pure executor (discoveryService.ts). Two adapters:
//   1. registry-as-data loader — reads Stamper's command registries in place
//      (no fork), reduced to the walkable get subset.
//   2. ces-tenant session adapter — wraps a TenantSessionFactory (the proven
//      PersistentSessionFactory surface) into the executor's narrow
//      DiscoverySession, mapping the registry engine -> SessionType via
//      ces-tenant's ENGINE_SESSION_MAP (never a hand-rolled map).
//
// muster-api is Node/server, so reading the sibling registry files as data and
// holding a PersistentSessionFactory are both in-bounds (the browser
// constraint that keeps this out of the SPA never applied here).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ENGINE_SESSION_MAP } from 'ces-tenant';
import type { SessionType, TenantSessionFactory, ConsumerIdentity } from 'ces-tenant';
import { toGetEntries, type RegistryGetEntry, type DiscoverySession } from './discoveryService.js';

/** The Stamper registries read as data (in place; no fork, no drift copy). */
const DEFAULT_REGISTRY_FILES = [
  'cmmc-l2-commands.registry.json',
  'infra-cmmc-l2-commands.registry.json',
];

function stamperRegistryRoot(): string {
  // muster-api runs from ces-muster/muster-api; ces-stamper is a sibling of
  // ces-muster. Overridable for tests / non-standard layouts.
  return (
    process.env.STAMPER_REGISTRY_ROOT ??
    path.resolve(process.cwd(), '..', '..', 'ces-stamper', 'src', 'registry')
  );
}

/** Load the runnable-get entries from Stamper's registries, in place. */
export function loadRegistryGetEntries(root: string = stamperRegistryRoot()): RegistryGetEntry[] {
  const all: RegistryGetEntry[] = [];
  for (const file of DEFAULT_REGISTRY_FILES) {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) continue;
    const reg = JSON.parse(fs.readFileSync(p, 'utf8'));
    all.push(...toGetEntries(reg.entries ?? []));
  }
  return all;
}

const DISCOVERY_CONSUMER: ConsumerIdentity = { module: 'ces-muster', purpose: 'discovery-lane' };

/**
 * Adapt a ces-tenant TenantSessionFactory into the executor's DiscoverySession.
 * Maps the registry `engine` string to a SessionType via ENGINE_SESSION_MAP,
 * ensures the session is connected, then executes READ-ONLY. Never touches a
 * set_command — it only forwards the get_command the executor hands it.
 */
export function sessionFromFactory(factory: TenantSessionFactory): DiscoverySession {
  return {
    async execute(engine: string, command: string) {
      const type: SessionType = ENGINE_SESSION_MAP[engine as keyof typeof ENGINE_SESSION_MAP] ?? 'graph';
      await factory.ensureConnected(type, DISCOVERY_CONSUMER);
      const r = await factory.execute(type, command, undefined, DISCOVERY_CONSUMER);
      return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, durationMs: r.durationMs };
    },
  };
}
