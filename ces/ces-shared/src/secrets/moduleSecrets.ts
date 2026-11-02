// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SP-4 (SECRETS-PLAN.md §3): the module-secret store. CES's OWN secrets only (module bearer
// tokens, principal-signing secrets, EC's ingest secret, muster-api's JWT secret). Customer and
// tenant secrets never go here (A-1031-19: BHD and customer secrets are stored separately).
//
// Store file (written by ces-shared/scripts/New-CesModuleSecrets.ps1; default
// %ProgramData%\CES\secrets\module-secrets.dpapi, or CES_MODULE_SECRETS_PATH):
//   { "format": "ces-module-secrets/1", "scope": "CurrentUser"|"LocalMachine",
//     "created": "<iso>", "names": ["CES_AO_AUTH_TOKEN", ...], "protected": "<base64 DPAPI blob>" }
// The blob decrypts (with DPAPI_ENTROPY) to UTF-8 JSON { "<NAME>": "<value>", ... }.
//
// Rules:
//   - The loader NEVER writes into process.env. Read sites use secretEnv(), a read-only view in
//     which a store value wins over the environment for that name only.
//   - Store ABSENT: developer/simulator mode; secretEnv() returns the environment unchanged
//     (until SP-6 makes a release build refuse this). CES_MODULE_SECRETS_REQUIRED=1 refuses instead.
//   - Store PRESENT but unreadable, malformed, tampered or orphaned (a new service SID, a deleted
//     profile, a sysprep'd image, a copy to another VM; spike SP-0(b) §2 rule 3): fail closed.
//     The recovery is to regenerate the store with New-CesModuleSecrets.ps1.
//   - Errors name the path, the field and the secret NAME; never a value.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { windowsDpapiProtector, DpapiError, type DpapiScope, type Protector } from './dpapi.js';
import { isModuleSecretName } from './scrubEnv.js';

export const MODULE_SECRETS_FORMAT = 'ces-module-secrets/1';
export const MODULE_SECRETS_PATH_ENV = 'CES_MODULE_SECRETS_PATH';
export const MODULE_SECRETS_REQUIRED_ENV = 'CES_MODULE_SECRETS_REQUIRED';

export type ModuleSecretsErrorCode =
  | 'STORE_MISSING'
  | 'STORE_UNREADABLE'
  | 'STORE_MALFORMED'
  | 'STORE_UNPROTECT_FAILED'
  | 'STORE_BAD_NAME'
  | 'STORE_BAD_VALUE'
  | 'STORE_NAME_MISMATCH';

export class ModuleSecretsError extends Error {
  readonly code: ModuleSecretsErrorCode;
  readonly storePath: string;
  constructor(code: ModuleSecretsErrorCode, storePath: string, message: string) {
    super(`module-secret store ${storePath}: ${message}`);
    this.name = 'ModuleSecretsError';
    this.code = code;
    this.storePath = storePath;
  }
}

export interface ModuleSecrets {
  /** 'store' when a store file was read; 'none' when there is no store (environment only). */
  readonly source: 'store' | 'none';
  readonly path: string;
  /** Secret names held by the store (never values). */
  readonly names: readonly string[];
  get(name: string): string | undefined;
}

export interface LoadModuleSecretsOptions {
  path?: string;
  env?: NodeJS.ProcessEnv;
  protector?: Protector;
  /** Refuse a missing store. Defaults to env CES_MODULE_SECRETS_REQUIRED === '1'. */
  required?: boolean;
}

/** %ProgramData%\CES\secrets\module-secrets.dpapi, or CES_MODULE_SECRETS_PATH. */
export function defaultModuleSecretsPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[MODULE_SECRETS_PATH_ENV];
  if (typeof override === 'string' && override.trim() !== '') return override.trim();
  const programData = env['ProgramData'] || env['PROGRAMDATA'] || 'C:\\ProgramData';
  return path.win32.join(programData, 'CES', 'secrets', 'module-secrets.dpapi');
}

function noneSecrets(storePath: string): ModuleSecrets {
  return Object.freeze({ source: 'none' as const, path: storePath, names: Object.freeze([]) as readonly string[], get: () => undefined });
}

function validateValues(storePath: string, obj: unknown): Record<string, string> {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new ModuleSecretsError('STORE_MALFORMED', storePath, 'protected payload is not a JSON object');
  }
  const out: Record<string, string> = Object.create(null);
  for (const [name, value] of Object.entries(obj as Record<string, unknown>)) {
    if (!isModuleSecretName(name) || name !== name.toUpperCase()) {
      throw new ModuleSecretsError('STORE_BAD_NAME', storePath, `"${name}" is not a CES module secret name`);
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new ModuleSecretsError('STORE_BAD_VALUE', storePath, `value of ${name} is empty or not a string`);
    }
    out[name] = value;
  }
  return out;
}

/** Read and decrypt the store. Synchronous, so entrypoints can call it before any secret read. */
export function loadModuleSecrets(opts: LoadModuleSecretsOptions = {}): ModuleSecrets {
  const env = opts.env ?? process.env;
  const storePath = opts.path ?? defaultModuleSecretsPath(env);
  const required = opts.required ?? env[MODULE_SECRETS_REQUIRED_ENV] === '1';

  let raw: string;
  try {
    raw = fs.readFileSync(storePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      if (required) throw new ModuleSecretsError('STORE_MISSING', storePath, `missing and ${MODULE_SECRETS_REQUIRED_ENV}=1`);
      return noneSecrets(storePath);
    }
    throw new ModuleSecretsError('STORE_UNREADABLE', storePath, `cannot be read (${code ?? 'error'})`);
  }

  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(raw.replace(/^\uFEFF/, '')) as Record<string, unknown>;
  } catch {
    throw new ModuleSecretsError('STORE_MALFORMED', storePath, 'is not JSON');
  }
  if (doc === null || typeof doc !== 'object' || doc['format'] !== MODULE_SECRETS_FORMAT) {
    throw new ModuleSecretsError('STORE_MALFORMED', storePath, `format must be "${MODULE_SECRETS_FORMAT}"`);
  }
  const scope = doc['scope'];
  if (scope !== 'CurrentUser' && scope !== 'LocalMachine') {
    throw new ModuleSecretsError('STORE_MALFORMED', storePath, 'scope must be CurrentUser or LocalMachine');
  }
  const blobB64 = doc['protected'];
  if (typeof blobB64 !== 'string' || blobB64.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(blobB64)) {
    throw new ModuleSecretsError('STORE_MALFORMED', storePath, '"protected" must be base64');
  }
  const listed = doc['names'];
  if (!Array.isArray(listed) || !listed.every((n) => typeof n === 'string')) {
    throw new ModuleSecretsError('STORE_MALFORMED', storePath, '"names" must be a list of strings');
  }

  let plain: Buffer;
  try {
    plain = (opts.protector ?? windowsDpapiProtector).unprotect(Buffer.from(blobB64, 'base64'), scope as DpapiScope);
  } catch (err) {
    const why = err instanceof DpapiError ? err.message : 'unprotect failed';
    throw new ModuleSecretsError(
      'STORE_UNPROTECT_FAILED',
      storePath,
      `${why}; the store is tampered, or was made for another account or machine. Regenerate it with New-CesModuleSecrets.ps1`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plain.toString('utf8'));
  } catch {
    throw new ModuleSecretsError('STORE_MALFORMED', storePath, 'protected payload is not JSON');
  } finally {
    plain.fill(0);
  }
  const values = validateValues(storePath, parsed);
  const names = Object.keys(values).sort();
  const listedSorted = [...(listed as string[])].sort();
  if (names.length !== listedSorted.length || names.some((n, i) => n !== listedSorted[i])) {
    throw new ModuleSecretsError('STORE_NAME_MISMATCH', storePath, '"names" does not match the protected payload');
  }
  Object.freeze(values);
  return Object.freeze({
    source: 'store' as const,
    path: storePath,
    names: Object.freeze(names) as readonly string[],
    get: (name: string) => values[name],
  });
}

/** Build a store document (tests, and any future Node-side writer). Same format as the PS script. */
export function buildModuleSecretsStore(
  values: Record<string, string>,
  scope: DpapiScope,
  protector: Protector = windowsDpapiProtector,
  created: Date = new Date(),
): string {
  const checked = validateValues('(new)', values);
  const plain = Buffer.from(JSON.stringify(checked), 'utf8');
  try {
    const blob = protector.protect(plain, scope);
    return JSON.stringify({
      format: MODULE_SECRETS_FORMAT,
      scope,
      created: created.toISOString(),
      names: Object.keys(checked).sort(),
      protected: blob.toString('base64'),
    }, null, 2);
  } finally {
    plain.fill(0);
  }
}

/**
 * A read-only view of `env` in which each store value overrides that name. Reads are live
 * (call-time) and keep Windows' case-insensitive lookup for non-store names. Writes throw.
 */
export function overlaySecrets(secrets: ModuleSecrets, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (secrets.source !== 'store' || secrets.names.length === 0) return env;
  const held = new Set(secrets.names);
  const lookup = (key: string | symbol): string | undefined =>
    typeof key === 'string' && held.has(key) ? secrets.get(key) : (Reflect.get(env, key) as string | undefined);
  return new Proxy(Object.create(null) as NodeJS.ProcessEnv, {
    get: (_t, key) => lookup(key),
    has: (_t, key) => (typeof key === 'string' && held.has(key)) || Reflect.has(env, key),
    ownKeys: () => Array.from(new Set([...Reflect.ownKeys(env).filter((k) => typeof k === 'string'), ...held])),
    getOwnPropertyDescriptor: (_t, key) => {
      const v = lookup(key);
      return v === undefined ? undefined : { value: v, writable: false, enumerable: true, configurable: true };
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
}

// ---- process-wide state (one store per server process) ----

let loaded: ModuleSecrets | null = null;

/**
 * Entrypoints call this once, before any secret read. Throws (fail closed) when a store is
 * present but unreadable. Idempotent: a second call returns the first result.
 */
export function initModuleSecrets(opts: LoadModuleSecretsOptions = {}): ModuleSecrets {
  if (!loaded) loaded = loadModuleSecrets(opts);
  return loaded;
}

/** The environment view read sites use. Before init, or with no store, it IS `env`. */
export function secretEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return loaded ? overlaySecrets(loaded, env) : env;
}

/** One posture line for start-up logs: names and source only, never values. */
export function moduleSecretsPostureLine(): string {
  if (!loaded) return 'module secrets: not initialised (environment only)';
  if (loaded.source === 'none') return `module secrets: no store at ${loaded.path} (environment only)`;
  return `module secrets: DPAPI store ${loaded.path} (${loaded.names.length} names: ${loaded.names.join(', ')})`;
}

/** Test seam: forget the process-wide store. */
export function resetModuleSecretsForTests(): void {
  loaded = null;
}
