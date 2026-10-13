// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { promises as fs } from 'node:fs';
import type { InventoryItem } from './InventoryTypes.js';
import { classifyCommandEngine } from './engineClassifier.js';

/**
 * Static-parse extractor for ces-eo's ComplianceSignalFetcher.ts (every
 * fetch* method's Graph endpoint/cmdlet) and PowerShellFallbackAdapter.ts
 * (Exchange/Purview commands reached via fetchExchangeConfig()/
 * fetchPurviewConfig()). Read-only; no ces-eo edits. Deliberately tailored
 * to this file's known, verified-by-read structure (regex, not a general TS
 * parser) - safe because both source files are trusted, static inputs re-
 * read on every extraction run. Any expected method whose body doesn't match
 * the tailored pattern still yields an 'other'-engine, excluded item with an
 * explanatory note (never silently dropped) instead of being skipped.
 */

interface MethodBody {
  name: string;
  body: string;
}

function splitMethods(content: string): MethodBody[] {
  const re = /^\s{2}(?:private\s+)?(?:async\s+)?(\w+)\s*\(/gm;
  const matches: { name: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    matches.push({ name: m[1], index: m.index });
  }
  const bodies: MethodBody[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : content.length;
    bodies.push({ name: matches[i].name, body: content.slice(start, end) });
  }
  return bodies;
}

function parseGraphEndpoints(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const block = content.match(/const GRAPH_ENDPOINTS = \{([\s\S]*?)\n\};/);
  if (!block) return result;
  const re = /(\w+):\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block[1]))) {
    result[m[1]] = m[2];
  }
  return result;
}

function parseEndpointToCmdletMap(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const block = content.match(/endpointToCmdlet\([\s\S]*?const map: Record<string, string> = \{([\s\S]*?)\n\s*\};/);
  if (!block) return result;
  const re = /'([^']+)':\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block[1]))) {
    result[m[1]] = m[2];
  }
  return result;
}

function evalStringLiteral(literal: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    return new Function(`return ${literal};`)() as string;
  } catch {
    return literal;
  }
}

function extractEndpointArrayItems(body: string): Array<{ id: string; path: string; cmdlet: string }> {
  const re = /\{\s*id:\s*'([^']+)',\s*path:\s*'([^']+)',\s*cmdlet:\s*'([^']+)'\s*\}/g;
  const out: Array<{ id: string; path: string; cmdlet: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out.push({ id: m[1], path: m[2], cmdlet: m[3] });
  }
  return out;
}

function extractSingleSignalMethod(body: string): { signalId?: string; endpoint?: string; command?: string } {
  const signalIdMatch = body.match(/signalId:\s*'([^']+)'/);
  const endpointMatch = body.match(/endpoint:\s*'([^']+)'/);
  const cmdMatch = body.match(/execute\(\s*'mgraph',\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\)/);
  return {
    signalId: signalIdMatch?.[1],
    endpoint: endpointMatch?.[1],
    command: cmdMatch ? evalStringLiteral(cmdMatch[1]) : undefined,
  };
}

function extractFetchEndpointCalls(body: string): Array<{ signalId: string; constName: string; isBeta: boolean }> {
  const re = /this\.fetchEndpoint\(\s*'([^']+)',\s*GRAPH_ENDPOINTS\.(\w+)\s*(?:,\s*(true))?\)/g;
  const out: Array<{ signalId: string; constName: string; isBeta: boolean }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out.push({ signalId: m[1], constName: m[2], isBeta: m[3] === 'true' });
  }
  return out;
}

function cmdletForEndpoint(endpoint: string, endpointToCmdletMap: Record<string, string>): string {
  return endpointToCmdletMap[endpoint] ?? `Invoke-MgGraphRequest -Uri '${endpoint}' -Method GET`;
}

function extractAdapterCommands(body: string): Array<{ id: string; cmd: string }> {
  const re = /\{\s*id:\s*'([^']+)',\s*cmd:\s*`([\s\S]*?)`,?\s*\}/g;
  const out: Array<{ id: string; cmd: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out.push({ id: m[1], cmd: m[2] });
  }
  return out;
}

/** Replaces the adapter's `${this.tenantConfig.xxx}` JS template
 *  interpolations with plausible dummy values, faithfully reproducing what
 *  real ces-eo code sends to powershell.exe for a given tenant config. */
function substituteAdapterTenantConfig(cmd: string): string {
  return cmd.replace(/\$\{this\.tenantConfig\.(\w+)\}/g, (_m, field: string) => `sim-${field}`);
}

const DIRECT_ARRAY_METHODS = ['fetchIdentitySignals', 'fetchDeviceSignals', 'fetchSecuritySignals'];
const SINGLE_SIGNAL_METHODS = [
  'fetchDlpSignals',
  'fetchGroupMembership',
  'fetchAuthorizationPolicy',
  'fetchNamedLocations',
  'fetchDeviceConfigurations',
  'fetchManagedAppProtections',
  'fetchAuthStrengthPolicies',
  'fetchAgreements',
  'fetchPimPolicies',
  'fetchVulnerabilities',
];

export interface EoExtractorArgs {
  complianceSignalFetcherPath: string;
  powerShellFallbackAdapterPath: string;
}

export async function extractEoInventory(args: EoExtractorArgs): Promise<InventoryItem[]> {
  const items: InventoryItem[] = [];

  let content: string;
  try {
    content = await fs.readFile(args.complianceSignalFetcherPath, 'utf8');
  } catch (err) {
    items.push({
      id: 'eo:ComplianceSignalFetcher:read-error',
      source: 'eo',
      sourceRef: 'ComplianceSignalFetcher.ts',
      engine: 'other',
      commandText: '',
      classification: 'read',
      excluded: true,
      exclusionReason: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
    });
    return items;
  }

  const graphEndpoints = parseGraphEndpoints(content);
  const endpointToCmdletMap = parseEndpointToCmdletMap(content);
  const methods = splitMethods(content);
  const methodByName = new Map(methods.map((m) => [m.name, m]));

  for (const name of DIRECT_ARRAY_METHODS) {
    const method = methodByName.get(name);
    if (!method) {
      items.push({
        id: `eo:${name}:not-found`,
        source: 'eo',
        sourceRef: name,
        engine: 'other',
        commandText: '',
        classification: 'read',
        excluded: true,
        exclusionReason: `Expected method "${name}" not found by the static splitter - structure defeated extraction; not silently dropped.`,
      });
      continue;
    }
    const endpointItems = extractEndpointArrayItems(method.body);
    if (endpointItems.length === 0) {
      items.push({
        id: `eo:${name}:no-endpoints-parsed`,
        source: 'eo',
        sourceRef: name,
        engine: 'other',
        commandText: method.body.slice(0, 300),
        classification: 'read',
        excluded: true,
        exclusionReason: `Method "${name}" found but its endpoints array could not be parsed by the tailored regex.`,
      });
      continue;
    }
    for (const ep of endpointItems) {
      const commandText = `${ep.cmdlet} | ConvertTo-Json -Depth 5`;
      items.push({
        id: `eo:${name}:${ep.id}`,
        source: 'eo',
        sourceRef: `${name}:${ep.id}`,
        engine: classifyCommandEngine(commandText),
        commandText,
        classification: 'read',
        notes: `Graph endpoint: ${ep.path}`,
      });
    }
  }

  for (const name of SINGLE_SIGNAL_METHODS) {
    const method = methodByName.get(name);
    if (!method) {
      items.push({
        id: `eo:${name}:not-found`,
        source: 'eo',
        sourceRef: name,
        engine: 'other',
        commandText: '',
        classification: 'read',
        excluded: true,
        exclusionReason: `Expected method "${name}" not found by the static splitter - structure defeated extraction; not silently dropped.`,
      });
      continue;
    }
    const { signalId, endpoint, command } = extractSingleSignalMethod(method.body);
    if (!signalId || !command) {
      items.push({
        id: `eo:${name}:unparsed`,
        source: 'eo',
        sourceRef: name,
        engine: 'other',
        commandText: method.body.slice(0, 300),
        classification: 'read',
        excluded: true,
        exclusionReason: `Method "${name}" found but its signalId/command could not be parsed by the tailored regex.`,
      });
      continue;
    }
    items.push({
      id: `eo:${name}:${signalId}`,
      source: 'eo',
      sourceRef: `${name}:${signalId}`,
      engine: classifyCommandEngine(command),
      commandText: command,
      classification: 'read',
      notes: endpoint ? `Graph endpoint: ${endpoint}` : undefined,
    });
  }

  const expandedMethod = methodByName.get('fetchExpandedSignals');
  if (!expandedMethod) {
    items.push({
      id: 'eo:fetchExpandedSignals:not-found',
      source: 'eo',
      sourceRef: 'fetchExpandedSignals',
      engine: 'other',
      commandText: '',
      classification: 'read',
      excluded: true,
      exclusionReason: 'Expected method "fetchExpandedSignals" not found by the static splitter.',
    });
  } else {
    const calls = extractFetchEndpointCalls(expandedMethod.body);
    if (calls.length === 0) {
      items.push({
        id: 'eo:fetchExpandedSignals:no-calls-parsed',
        source: 'eo',
        sourceRef: 'fetchExpandedSignals',
        engine: 'other',
        commandText: expandedMethod.body.slice(0, 300),
        classification: 'read',
        excluded: true,
        exclusionReason: 'fetchExpandedSignals found but its this.fetchEndpoint(...) calls could not be parsed.',
      });
    }
    for (const call of calls) {
      const endpoint = graphEndpoints[call.constName];
      if (!endpoint) {
        items.push({
          id: `eo:fetchExpandedSignals:${call.signalId}`,
          source: 'eo',
          sourceRef: `fetchExpandedSignals:${call.signalId}`,
          engine: 'other',
          commandText: '',
          classification: 'read',
          excluded: true,
          exclusionReason: `GRAPH_ENDPOINTS.${call.constName} could not be resolved to an endpoint string.`,
        });
        continue;
      }
      const commandText = call.isBeta
        ? `Invoke-MgGraphRequest -Uri 'https://graph.microsoft.us/beta${endpoint}' -Method GET | ConvertTo-Json -Depth 5`
        : `${cmdletForEndpoint(endpoint, endpointToCmdletMap)} | ConvertTo-Json -Depth 5`;
      items.push({
        id: `eo:fetchExpandedSignals:${call.signalId}`,
        source: 'eo',
        sourceRef: `fetchExpandedSignals:${call.signalId}`,
        engine: classifyCommandEngine(commandText),
        commandText,
        classification: 'read',
        notes: `Graph endpoint: ${endpoint}${call.isBeta ? ' (beta)' : ''}`,
      });
    }
  }

  // fetchExchangeConfig()/fetchPurviewConfig() (ComplianceSignalFetcher.ts) are
  // pure delegations to PowerShellFallbackAdapter's runExchangeCommands()/
  // runPurviewCommands() - the actual command text lives in that file. The
  // sourceRef prefix uses the EO-facing method name (fetchExchangeConfig/
  // fetchPurviewConfig), since that is what a caller of ComplianceSignalFetcher
  // (and CoverageRunner) actually invokes.
  let adapterContent: string;
  try {
    adapterContent = await fs.readFile(args.powerShellFallbackAdapterPath, 'utf8');
  } catch (err) {
    items.push({
      id: 'eo:PowerShellFallbackAdapter:read-error',
      source: 'eo',
      sourceRef: 'PowerShellFallbackAdapter.ts',
      engine: 'other',
      commandText: '',
      classification: 'read',
      excluded: true,
      exclusionReason: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
    });
    adapterContent = '';
  }

  if (adapterContent) {
    const adapterMethods = splitMethods(adapterContent);
    const adapterByName = new Map(adapterMethods.map((m) => [m.name, m]));
    const adapterMapping: Array<{ adapterMethod: string; eoWrapper: string }> = [
      { adapterMethod: 'runExchangeCommands', eoWrapper: 'fetchExchangeConfig' },
      { adapterMethod: 'runPurviewCommands', eoWrapper: 'fetchPurviewConfig' },
    ];
    for (const { adapterMethod, eoWrapper } of adapterMapping) {
      const method = adapterByName.get(adapterMethod);
      if (!method) {
        items.push({
          id: `eo:${eoWrapper}:not-found`,
          source: 'eo',
          sourceRef: eoWrapper,
          engine: 'other',
          commandText: '',
          classification: 'read',
          excluded: true,
          exclusionReason: `Expected method "${adapterMethod}" not found in PowerShellFallbackAdapter.ts.`,
        });
        continue;
      }
      const commands = extractAdapterCommands(method.body);
      if (commands.length === 0) {
        items.push({
          id: `eo:${eoWrapper}:no-commands-parsed`,
          source: 'eo',
          sourceRef: eoWrapper,
          engine: 'other',
          commandText: method.body.slice(0, 300),
          classification: 'read',
          excluded: true,
          exclusionReason: `"${adapterMethod}" found but its command list could not be parsed by the tailored regex.`,
        });
        continue;
      }
      for (const cmd of commands) {
        const commandText = substituteAdapterTenantConfig(cmd.cmd);
        items.push({
          id: `eo:${eoWrapper}:${cmd.id}`,
          source: 'eo',
          sourceRef: `${eoWrapper}:${cmd.id}`,
          engine: classifyCommandEngine(commandText),
          commandText,
          classification: 'read',
          notes: `Reached via ComplianceSignalFetcher.${eoWrapper}() -> PowerShellFallbackAdapter.${adapterMethod}(); spawned by the adapter's own runPwsh(), not SessionManager's session-host.ps1.`,
        });
      }
    }
  }

  return items;
}
