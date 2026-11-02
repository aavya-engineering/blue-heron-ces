#!/usr/bin/env node
// CES handoff kit generator.
//   node scripts/handoff/gen.mjs [--kit <dir>]
// Reads <kit>/handoff.manifest.yaml, <kit>/contracts.yaml and <kit>/config.schema.yaml and writes
// <kit>/README.md, <kit>/BUILD-ORDER.md, <kit>/handoff.manifest.json and <kit>/.env.example.
// Without config.schema.yaml, .env.example is not written (a notice says so).
// Exit 0 = written; 1 = invalid input or a dependency cycle.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from './lib/yaml.mjs';
import { validateManifest, validateContracts, validateConfigSchema } from './lib/validate.mjs';
import { renderReadme, renderBuildOrder, renderEnvExample, renderManifestJson } from './lib/render.mjs';
import { buildOrder } from './lib/graph.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The kit sits in the run package (<pkg>/handoff) in the module repos. In the contractor monorepo it sits at the repo
// root (<root>/handoff, next to <root>/pkg/ces-muster-run) and the package has no handoff/ folder (H1, 2026-11-01).
const PKG_KIT = path.resolve(HERE, '..', '..', 'handoff');
const MONO_KIT = path.resolve(HERE, '..', '..', '..', '..', 'handoff');
export const DEFAULT_KIT = !fs.existsSync(PKG_KIT) && fs.existsSync(path.join(MONO_KIT, 'handoff.manifest.yaml')) ? MONO_KIT : PKG_KIT;

export const FILES = {
  manifest: 'handoff.manifest.yaml',
  contracts: 'contracts.yaml',
  schema: 'config.schema.yaml',
  inventory: 'secrets.inventory.yaml',
  readme: 'README.md',
  buildOrder: 'BUILD-ORDER.md',
  envExample: '.env.example',
  manifestJson: 'handoff.manifest.json',
};

export function readYamlFile(file) {
  if (!fs.existsSync(file)) return { missing: true };
  try {
    return { doc: parseYaml(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { error: `${path.basename(file)}: ${e.message}` };
  }
}

/**
 * Load and validate the kit inputs, then render every generated file in memory.
 * Returns { outputs: { relName: content }, errors: [], notices: [] }.
 */
export function generate(kitDir) {
  const errors = [];
  const notices = [];
  const outputs = {};
  const m = readYamlFile(path.join(kitDir, FILES.manifest));
  if (m.missing) return { outputs, errors: [`${FILES.manifest} missing`], notices };
  if (m.error) return { outputs, errors: [m.error], notices };
  const mv = validateManifest(m.doc);
  for (const w of mv.warnings) notices.push(`${FILES.manifest}: ${w}`);
  if (mv.errors.length) return { outputs, errors: mv.errors.map((e) => `${FILES.manifest}: ${e}`), notices };
  const ids = new Set(m.doc.components.map((c) => c.id));
  try {
    buildOrder(m.doc.components);
  } catch (e) {
    return { outputs, errors: [`${FILES.manifest}: ${e.message} (-> = depends on)`], notices };
  }

  const k = readYamlFile(path.join(kitDir, FILES.contracts));
  let contracts = null;
  if (k.missing) notices.push(`${FILES.contracts} missing: README.md is generated without the contracts table`);
  else if (k.error) errors.push(k.error);
  else {
    const kv = validateContracts(k.doc, ids);
    for (const w of kv.warnings) notices.push(`${FILES.contracts}: ${w}`);
    if (kv.errors.length) errors.push(...kv.errors.map((e) => `${FILES.contracts}: ${e}`));
    else contracts = k.doc;
  }

  const s = readYamlFile(path.join(kitDir, FILES.schema));
  if (s.missing) notices.push(`schema missing: ${FILES.schema} not found, so ${FILES.envExample} is not generated`);
  else if (s.error) errors.push(s.error);
  else {
    const sv = validateConfigSchema(s.doc, ids);
    for (const w of sv.warnings) notices.push(`${FILES.schema}: ${w}`);
    if (sv.errors.length) errors.push(...sv.errors.map((e) => `${FILES.schema}: ${e}`));
    else outputs[FILES.envExample] = renderEnvExample(s.doc);
  }
  if (errors.length) return { outputs: {}, errors, notices };

  outputs[FILES.manifestJson] = renderManifestJson(m.doc);
  outputs[FILES.buildOrder] = renderBuildOrder(m.doc);
  outputs[FILES.readme] = renderReadme(m.doc, contracts);
  return { outputs, errors, notices };
}

function main(argv) {
  let kit = DEFAULT_KIT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--kit') kit = path.resolve(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('usage: node gen.mjs [--kit <dir>]');
      return 0;
    } else {
      console.error(`gen: unknown argument ${argv[i]}`);
      return 1;
    }
  }
  const { outputs, errors, notices } = generate(kit);
  for (const n of notices) console.log(`notice: ${n}`);
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`);
    return 1;
  }
  for (const [name, content] of Object.entries(outputs)) {
    fs.writeFileSync(path.join(kit, name), content);
    console.log(`wrote ${name}`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
