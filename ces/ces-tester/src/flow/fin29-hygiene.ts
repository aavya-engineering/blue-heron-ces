// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * FIN-29 (finishing plan PH-2): harness hygiene from the secrets plan's SP-11 (`docs/context/secrets/SECRETS-PLAN.md`).
 * - Leak scan (V101): at the end of a run, while the run's secrets are still in memory, every file under the scanned
 *   roots is searched for each secret as raw text, base64 and URL-encoded text. Only names, lengths and counts are
 *   written (`out/secret-scan.json`); a value never leaves this process.
 * - Live-folder guard: a simulator run refuses to start when its tenant registry could hold or reach a live tenant
 *   record (`<registry root>/live/`, ces-tenant `src/impl/paths.ts` registryRecordPath).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const SECRET_SCAN_SCHEMA = 'ces-tester/secret-scan@1';
/** Secrets shorter than this are not scanned reliably (a short value matches by chance); V101 flags them. */
export const MIN_SECRET_LENGTH = 16;

export interface SecretScanRoot {
  name: string;
  dir: string;
}

export interface SecretScanRow {
  name: string;
  length: number;
  hits: number;
  files_with_hits: number;
  encodings: string[];
}

export interface SecretScanRecord {
  schema: typeof SECRET_SCAN_SCHEMA;
  taken: string;
  roots: Array<{ name: string; dir: string; present: boolean; files: number; bytes: number; skipped_large: number }>;
  secrets: SecretScanRow[];
  /** Files (relative to the workspace) with at least one hit; never the matching text. */
  hit_files: string[];
  note: string;
}

/** The encodings each secret is searched in: the value itself, standard base64, base64url, URL-encoded. */
export function secretForms(value: string): Array<{ encoding: string; bytes: Buffer }> {
  const forms = new Map<string, string>();
  forms.set('raw', value);
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  forms.set('base64', b64.replace(/=+$/, ''));
  forms.set('base64url', b64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'));
  forms.set('url', encodeURIComponent(value));
  // A JSON-escaped copy of a value with a backslash or quote differs from the raw form.
  forms.set('json', JSON.stringify(value).slice(1, -1));
  const seen = new Set<string>();
  const out: Array<{ encoding: string; bytes: Buffer }> = [];
  for (const [encoding, text] of forms) {
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push({ encoding, bytes: Buffer.from(text, 'utf8') });
  }
  return out;
}

function countOccurrences(hay: Buffer, needle: Buffer): number {
  if (needle.length === 0) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

function listFilesRec(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/**
 * Scans the roots for every secret (name -> value). Files above `maxBytes` are counted as skipped (the run's large files
 * are the sim ledger and the executable plan, both under the cap). Never returns or writes a value.
 */
export function scanForSecrets(o: {
  secrets: ReadonlyMap<string, string>;
  roots: SecretScanRoot[];
  relTo: string;
  maxBytes?: number;
  now?: () => string;
  exclude?: (file: string) => boolean;
}): SecretScanRecord {
  const maxBytes = o.maxBytes ?? 256 * 1024 * 1024;
  const forms = [...o.secrets].map(([name, value]) => ({ name, length: value.length, forms: secretForms(value) }));
  const rows = new Map<string, SecretScanRow>(forms.map((f) => [f.name, { name: f.name, length: f.length, hits: 0, files_with_hits: 0, encodings: [] }]));
  const hitFiles = new Set<string>();
  const roots: SecretScanRecord['roots'] = [];
  for (const r of o.roots) {
    const present = fs.existsSync(r.dir);
    const row = { name: r.name, dir: path.relative(o.relTo, r.dir).split(path.sep).join('/') || '.', present, files: 0, bytes: 0, skipped_large: 0 };
    if (present) {
      for (const file of listFilesRec(r.dir)) {
        if (o.exclude?.(file)) continue;
        let size = 0;
        try {
          size = fs.statSync(file).size;
        } catch {
          continue;
        }
        if (size > maxBytes) {
          row.skipped_large++;
          continue;
        }
        let buf: Buffer;
        try {
          buf = fs.readFileSync(file);
        } catch {
          continue;
        }
        row.files++;
        row.bytes += buf.length;
        for (const f of forms) {
          let fileHits = 0;
          for (const form of f.forms) {
            const n = countOccurrences(buf, form.bytes);
            if (n > 0) {
              fileHits += n;
              const sr = rows.get(f.name)!;
              if (!sr.encodings.includes(form.encoding)) sr.encodings.push(form.encoding);
            }
          }
          if (fileHits > 0) {
            const sr = rows.get(f.name)!;
            sr.hits += fileHits;
            sr.files_with_hits++;
            hitFiles.add(path.relative(o.relTo, file).split(path.sep).join('/'));
          }
        }
      }
    }
    roots.push(row);
  }
  return {
    schema: SECRET_SCAN_SCHEMA,
    taken: (o.now ?? (() => new Date().toISOString()))(),
    roots,
    secrets: [...rows.values()],
    hit_files: [...hitFiles].sort(),
    note: 'counts only: no secret value or matching text is written. Compressed files (zip, docx) are scanned as bytes; their expanded copies under out/ are scanned as text.',
  };
}

/** The run's scan roots (SP-11: out/, the EO evidence store, the EC store, Stamper's evidence). */
export function runScanRoots(p: { out: string; pl: string; slug: string }): SecretScanRoot[] {
  return [
    { name: 'out', dir: p.out },
    { name: 'eo-evidence-store', dir: path.join(p.out, 'eo', 'evidence-store') },
    { name: 'ec-store', dir: path.join(p.pl, 'EvidenceCollector') },
    { name: 'stamper-evidence', dir: path.join(p.pl, 'Stamper', 'plan-data', p.slug) },
  ];
}

/**
 * A secret registry for one run: names are unique; a value shorter than MIN_SECRET_LENGTH is still recorded (V101
 * flags it) but empty values are ignored.
 */
export class RunSecrets {
  private readonly m = new Map<string, string>();
  register(name: string, value: string | undefined | null): void {
    if (!value) return;
    this.m.set(name, value);
  }
  get map(): ReadonlyMap<string, string> {
    return this.m;
  }
  names(): string[] {
    return [...this.m.keys()];
  }
}

// ---------- live-folder guard ----------

/** The machine's default tenant registry (ces-tenant getRegistryRoot without CES_TENANT_ROOT). */
export function defaultRegistryRoot(home: string = os.homedir()): string {
  return path.join(home, '.ces', 'tenants');
}

const inside = (child: string, parent: string): boolean => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * Why a simulator run must not start (empty: it may). The run's registry root must be its own (`<WS>/tenants`), never
 * the machine's default `~/.ces/tenants` (whose `live/` holds live tenant records) nor a folder inside it; the
 * children's CES_TENANT_ROOT must name the same root (unset means the default, which can reach `live/`); and the run's
 * root must hold no `live/` record.
 */
export function liveFolderViolations(o: { tenantRoot: string; env: NodeJS.ProcessEnv; home?: string; listDir?: (d: string) => string[]; readRecord?: (p: string) => unknown }): string[] {
  const v: string[] = [];
  const def = defaultRegistryRoot(o.home);
  const root = path.resolve(o.tenantRoot);
  if (inside(root, def) || inside(def, root)) v.push(`the run's tenant root ${root} is or overlaps the machine registry ${def}, whose live/ folder holds live tenant records`);
  const envRoot = o.env.CES_TENANT_ROOT;
  if (!envRoot) v.push('CES_TENANT_ROOT is unset: the run\'s children would read the machine registry (~/.ces/tenants, live/ included)');
  else if (path.resolve(envRoot) !== root) v.push(`CES_TENANT_ROOT (${path.resolve(envRoot)}) is not the run's tenant root (${root})`);
  const list = o.listDir ?? ((d: string) => (fs.existsSync(d) ? fs.readdirSync(d) : []));
  const readRecord = o.readRecord ?? ((p: string) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return undefined; } });
  // The reserved `dev` placeholder (slug dev, all-zero tenant id) is not a live tenant: it names no real directory,
  // and the founder's standing rule is to leave it alone, so it is neither refused nor touched (R-F2, 2026-10-31).
  const isDevPlaceholder = (f: string): boolean => {
    if (f.toLowerCase() !== 'dev.json') return false;
    const r = readRecord(path.join(root, 'live', f)) as { client?: { slug?: string }; tenant?: { tenant_id?: string } } | undefined;
    return r?.client?.slug === 'dev' && /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(r?.tenant?.tenant_id ?? '');
  };
  const live = list(path.join(root, 'live')).filter((f) => f.toLowerCase().endsWith('.json') && !isDevPlaceholder(f));
  if (live.length) v.push(`the run's tenant root holds ${live.length} live/ record(s); a simulator run never sits beside a live record`);
  return v;
}
