// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { InventoryItem } from './InventoryTypes.js';
import { classifyCommandEngine, isAzCli } from './engineClassifier.js';

// G-STACKSIM-2 iteration 4: az CLI (`az`) commands are no longer excluded -
// see StamperExtractor.ts's identical comment for the shim mechanism
// (src/coverage/psHarness.ts, src/resolvers/azCliResolvers.ts).
const AZ_CLI_NOTE = 'Command contains an `az` CLI invocation - routed through tenant-stacksim\'s az CLI shim (azshim/az.cmd), not the real Azure CLI.';

/**
 * AO's TemplateRegistry.ts (ces-ao/src/registry/TemplateRegistry.ts) is a
 * single function, `getCommandTemplates(commandId)`, mapping ~95 command ids
 * to `{ set_command, get_command }` string pairs, with zero external imports
 * (confirmed by a targeted read). Rather than regex-parsing the object
 * literal (fragile against its varied single-line / `[...].join(' ')` /
 * multi-line-template-literal shapes), this extractor dynamically imports
 * the real, unmodified file by absolute path (via a spawned tsx process,
 * mirroring src/cli/commands/verify-doc.ts's DOC check 2 mechanism for
 * ces-eo) and calls the real exported function for every id discovered by a
 * lightweight id-only regex scan. This guarantees byte-exact command text
 * with zero risk of a hand-rolled parser silently mis-extracting a template.
 * Read-only; zero ces-ao edits.
 */

const ID_PATTERN = /'([A-Z]+-\d+[a-zA-Z]*)':\s*\{/g;

function discoverTemplateIds(rawContent: string): string[] {
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = ID_PATTERN.exec(rawContent))) {
    ids.add(m[1]);
  }
  return [...ids];
}

const AO_RUNNER_SCRIPT = `import { pathToFileURL } from 'node:url';
import * as path from 'node:path';

const cesAoRoot = process.env.CES_AO_ROOT;
const idsJson = process.env.CES_AO_IDS;
if (!cesAoRoot || !idsJson) {
  throw new Error('CES_AO_ROOT / CES_AO_IDS env vars are required');
}
const ids = JSON.parse(idsJson);

const trUrl = pathToFileURL(path.join(cesAoRoot, 'src', 'registry', 'TemplateRegistry.ts')).href;
const { getCommandTemplates } = await import(trUrl);

const out = [];
for (const id of ids) {
  const t = getCommandTemplates(id);
  out.push({ id, set_command: t ? t.set_command : '', get_command: t ? t.get_command : '' });
}
console.log('AO_RESULT::' + JSON.stringify(out));
process.exit(0);
`;

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runProcess(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function extractMarker(stdout: string, marker: string): string | undefined {
  const line = stdout.split('\n').find((l) => l.startsWith(marker));
  return line ? line.slice(marker.length).trim() : undefined;
}

export interface AoExtractorArgs {
  templateRegistryPath: string;
  cesAoRoot: string;
  tsxCliPath: string;
}

interface AoTemplateResult {
  id: string;
  set_command: string;
  get_command: string;
}

export async function extractAoInventory(args: AoExtractorArgs): Promise<InventoryItem[]> {
  const items: InventoryItem[] = [];

  let rawContent: string;
  try {
    rawContent = await fs.readFile(args.templateRegistryPath, 'utf8');
  } catch (err) {
    items.push({
      id: 'ao:TemplateRegistry:read-error',
      source: 'ao',
      sourceRef: 'TemplateRegistry.ts',
      engine: 'other',
      commandText: '',
      classification: 'read',
      excluded: true,
      exclusionReason: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
    });
    return items;
  }

  const ids = discoverTemplateIds(rawContent);
  if (ids.length === 0) {
    items.push({
      id: 'ao:TemplateRegistry:no-ids-found',
      source: 'ao',
      sourceRef: 'TemplateRegistry.ts',
      engine: 'other',
      commandText: '',
      classification: 'read',
      excluded: true,
      exclusionReason: 'No template ids matched the id-scan regex - structure defeated extraction.',
    });
    return items;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stacksim-ao-extract-'));
  try {
    const runnerPath = path.join(tempDir, 'ao-extract.mts');
    await fs.writeFile(runnerPath, AO_RUNNER_SCRIPT, 'utf8');

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CES_AO_ROOT: args.cesAoRoot,
      CES_AO_IDS: JSON.stringify(ids),
    };
    const result = await runProcess(process.execPath, [args.tsxCliPath, runnerPath], env);
    const marker = extractMarker(result.stdout, 'AO_RESULT::');

    if (result.exitCode !== 0 || !marker) {
      items.push({
        id: 'ao:TemplateRegistry:runner-failed',
        source: 'ao',
        sourceRef: 'TemplateRegistry.ts',
        engine: 'other',
        commandText: '',
        classification: 'read',
        excluded: true,
        exclusionReason: `AO template runner failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500)}`,
      });
      return items;
    }

    const parsed = JSON.parse(marker) as AoTemplateResult[];
    for (const t of parsed) {
      const setCmd = (t.set_command ?? '').trim();
      const getCmd = (t.get_command ?? '').trim();

      if (setCmd.length > 0) {
        const azCli = isAzCli(setCmd);
        items.push({
          id: `ao:${t.id}:set`,
          source: 'ao',
          sourceRef: `${t.id}:set`,
          engine: classifyCommandEngine(setCmd),
          commandText: setCmd,
          classification: 'write',
          notes: azCli ? AZ_CLI_NOTE : undefined,
        });
      }
      if (getCmd.length > 0) {
        const azCli = isAzCli(getCmd);
        items.push({
          id: `ao:${t.id}:get`,
          source: 'ao',
          sourceRef: `${t.id}:get`,
          engine: classifyCommandEngine(getCmd),
          commandText: getCmd,
          classification: 'read',
          notes: azCli ? AZ_CLI_NOTE : undefined,
        });
      }
      if (setCmd.length === 0 && getCmd.length === 0) {
        items.push({
          id: `ao:${t.id}:empty`,
          source: 'ao',
          sourceRef: `${t.id}:empty`,
          engine: 'other',
          commandText: '',
          classification: 'read',
          excluded: true,
          exclusionReason: `getCommandTemplates("${t.id}") returned a template with both set_command and get_command empty.`,
        });
      }
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }

  return items;
}
