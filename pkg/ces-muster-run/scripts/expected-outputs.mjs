// Per-scenario expected outputs (synthetic-customer W0).
// Layout: expected-outputs/<slug>/{summary.json, verify.json, hashes.json, bundle/, proof-runs/}.
// muster-partial keeps its files at the expected-outputs/ root (not moved): the resolver looks in
// expected-outputs/<slug>/ first, then the root, and the root only for muster-partial.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEGACY_ROOT_SLUG = 'muster-partial';
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The folder holding <slug>'s expected outputs, or null when neither place exists. */
export function expectedOutputsDir(slug, pkg = packageRoot) {
  const base = path.join(pkg, 'expected-outputs');
  const own = path.join(base, slug);
  if (fs.existsSync(own)) return own;
  if (slug === LEGACY_ROOT_SLUG && fs.existsSync(base)) return base;
  return null;
}

/** One expected-outputs file for <slug> (summary.json, verify.json, hashes.json ...), or null when absent. */
export function expectedOutputsFile(slug, name, pkg = packageRoot) {
  const base = path.join(pkg, 'expected-outputs');
  const own = path.join(base, slug, name);
  if (fs.existsSync(own)) return own;
  const legacy = path.join(base, name);
  if (slug === LEGACY_ROOT_SLUG && fs.existsSync(legacy)) return legacy;
  return null;
}
