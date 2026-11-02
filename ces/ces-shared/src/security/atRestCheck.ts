// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-41 / SP-12 (SECRETS-PLAN.md): the start-up check that `ces.db` and the evidence store sit on
// storage encrypted at rest, at no cost. Two accepted protections:
//   - encryption at host on an Azure VM (the VM's disks, temp disk and caches; platform-managed keys),
//     read from the Instance Metadata Service (IMDS). The IMDS field is not yet confirmed in Azure
//     Government (SP-0(c)), so a missing field counts as "not shown", never as "on".
//   - BitLocker on every volume that holds a data path (the dev workstation, or a VM without it).
// In a release build the module refuses to start without one of them, unless the install recorded
// the operator's explicit acknowledgment (secrets flag F-7: override allowed with a record). Outside a
// release build an unprotected volume is a warning only.
//
// The result is for /api/health and the start-up log. It is NOT evidence for SC.L2-3.13.16 (protect CUI
// at rest): using it as evidence would be a scoring change (SP-12), so `evidence_for_scoring` is false.
//
// Every probe is injected; the default probes call IMDS over HTTP (one second timeout) and read the
// Windows shell's BitLocker property, which needs no administrator rights. Nothing here writes a file.

import * as path from 'node:path';

/** The interim release-build marker (also read by muster-api; SP-6 / FIN-44 owns the final switch). */
export const AT_REST_RELEASE_ENV = 'CES_RELEASE_BUILD';
/** Where the install recorded the operator's override (F-7), when not passed in. */
export const AT_REST_OVERRIDE_ENV = 'CES_AT_REST_OVERRIDE_FILE';
/** The override record's kind tag. */
export const AT_REST_OVERRIDE_KIND = 'ces-at-rest-override';

export type AtRestMethod = 'encryption_at_host' | 'bitlocker' | 'none';
export type AtRestVerdict = 'ok' | 'ok_overridden' | 'warn' | 'refuse';

/** The IMDS compute.securityProfile fields this check reads (strings in IMDS: "true" / "false"). */
export interface ImdsSecurityProfile {
  encryptionAtHost?: string | boolean;
  secureBootEnabled?: string | boolean;
  virtualTpmEnabled?: string | boolean;
  securityType?: string;
}

/** BitLocker state of one volume. `protected` = fully encrypted with protection on. */
export interface BitLockerVolumeStatus {
  volume: string;
  protected: boolean;
  /** The raw state the probe saw, for the log (e.g. "on", "off", "encrypting", "unknown"). */
  state: string;
}

/** F-7: the install's record of the operator's acknowledgment. */
export interface AtRestOverrideRecord {
  kind: typeof AT_REST_OVERRIDE_KIND;
  /** The operator's sign-in name or id, as the install recorded it. */
  acknowledged_by: string;
  /** ISO 8601. */
  acknowledged_at: string;
  /** Why at-rest encryption is not available here; at least 10 characters. */
  reason: string;
  /** The machine or install the acknowledgment covers. */
  scope: string;
}

export interface AtRestProbes {
  /** compute.securityProfile from IMDS, or null when IMDS does not answer (not an Azure VM). */
  readImdsSecurityProfile?: () => Promise<ImdsSecurityProfile | null>;
  /** BitLocker state of a volume root such as "C:\\", or null when it cannot be read. */
  readBitLocker?: (volume: string) => Promise<BitLockerVolumeStatus | null>;
  /** The override file's text, or null when it does not exist. */
  readOverrideFile?: (filePath: string) => Promise<string | null>;
}

export interface AtRestCheckInput {
  /** Paths that hold CES data: the folder of `ces.db` and the evidence store (any number). */
  dataPaths: string[];
  /** Release build; default: `CES_RELEASE_BUILD=1` in `env`. */
  releaseBuild?: boolean;
  /** Override record path; default: `CES_AT_REST_OVERRIDE_FILE` in `env`. */
  overridePath?: string;
  env?: NodeJS.ProcessEnv;
  probes?: AtRestProbes;
  now?: () => Date;
}

export interface AtRestCheckResult {
  checked_at: string;
  release_build: boolean;
  encrypted: boolean;
  method: AtRestMethod;
  verdict: AtRestVerdict;
  reason: string;
  volumes: Array<{ volume: string; protected: boolean; method: AtRestMethod; state: string }>;
  imds: { answered: boolean; encryption_at_host: boolean | null; security_type: string | null };
  /** The recorded override, when one was read and valid (the reason is kept; it is the operator's own text). */
  override: (Omit<AtRestOverrideRecord, 'kind'> & { path: string }) | null;
  /** Why an override file was present but not accepted. */
  override_rejected?: string;
  /** Never evidence for SC.L2-3.13.16 (SP-12: that would be a scoring change). */
  evidence_for_scoring: false;
}

/** Thrown by enforceAtRestAtStartup when a release build has no at-rest protection and no override. */
export class AtRestRefusedError extends Error {
  readonly result: AtRestCheckResult;
  constructor(result: AtRestCheckResult) {
    super(`CES refuses to start: ${result.reason}`);
    this.name = 'AtRestRefusedError';
    this.result = result;
  }
}

const truthy = (v: unknown): boolean => v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');

/** The volume roots that hold the data paths, de-duplicated, in input order (case-insensitive on Windows). */
export function dataVolumes(dataPaths: string[]): string[] {
  const seen = new Map<string, string>();
  for (const p of dataPaths) {
    if (!p || !p.trim()) continue;
    const root = path.parse(path.resolve(p)).root || path.resolve(p);
    const key = root.toLowerCase();
    if (!seen.has(key)) seen.set(key, root);
  }
  return [...seen.values()];
}

/** Parse and validate an override record (F-7). Returns the record or the reason it is refused. */
export function parseOverrideRecord(text: string): { record: AtRestOverrideRecord } | { error: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { error: 'override file is not JSON' }; }
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.kind !== AT_REST_OVERRIDE_KIND) return { error: `override kind is not ${AT_REST_OVERRIDE_KIND}` };
  for (const f of ['acknowledged_by', 'acknowledged_at', 'reason', 'scope'] as const) {
    if (typeof r[f] !== 'string' || !(r[f] as string).trim()) return { error: `override field ${f} is missing` };
  }
  if (Number.isNaN(Date.parse(r.acknowledged_at as string))) return { error: 'override acknowledged_at is not a date' };
  if ((r.reason as string).trim().length < 10) return { error: 'override reason is shorter than 10 characters' };
  return {
    record: {
      kind: AT_REST_OVERRIDE_KIND,
      acknowledged_by: (r.acknowledged_by as string).trim(),
      acknowledged_at: r.acknowledged_at as string,
      reason: (r.reason as string).trim(),
      scope: (r.scope as string).trim(),
    },
  };
}

/** The text an install writes for the operator's override (F-7). */
export function formatOverrideRecord(input: Omit<AtRestOverrideRecord, 'kind' | 'acknowledged_at'> & { acknowledged_at?: string }): string {
  const rec: AtRestOverrideRecord = {
    kind: AT_REST_OVERRIDE_KIND,
    acknowledged_by: input.acknowledged_by,
    acknowledged_at: input.acknowledged_at ?? new Date().toISOString(),
    reason: input.reason,
    scope: input.scope,
  };
  const parsed = parseOverrideRecord(JSON.stringify(rec));
  if ('error' in parsed) throw new Error(`invalid at-rest override: ${parsed.error}`);
  return JSON.stringify(rec, null, 2) + '\n';
}

/** Run the check. Never throws on a probe failure: a failed probe counts as "not shown". */
export async function checkAtRest(input: AtRestCheckInput): Promise<AtRestCheckResult> {
  const env = input.env ?? process.env;
  const probes = { ...defaultAtRestProbes(), ...(input.probes ?? {}) };
  const releaseBuild = input.releaseBuild ?? env[AT_REST_RELEASE_ENV] === '1';
  const now = (input.now ?? (() => new Date()))();
  const volumes = dataVolumes(input.dataPaths);

  let profile: ImdsSecurityProfile | null = null;
  try { profile = await probes.readImdsSecurityProfile(); } catch { profile = null; }
  const eah = profile ? (profile.encryptionAtHost === undefined ? null : truthy(profile.encryptionAtHost)) : null;

  const vols: AtRestCheckResult['volumes'] = [];
  for (const v of volumes) {
    if (eah === true) { vols.push({ volume: v, protected: true, method: 'encryption_at_host', state: 'encryption at host' }); continue; }
    let bl: BitLockerVolumeStatus | null = null;
    try { bl = await probes.readBitLocker(v); } catch { bl = null; }
    if (bl?.protected) vols.push({ volume: v, protected: true, method: 'bitlocker', state: bl.state });
    else vols.push({ volume: v, protected: false, method: 'none', state: bl?.state ?? 'unknown' });
  }
  const encrypted = vols.length > 0 && vols.every(v => v.protected);
  const method: AtRestMethod = !encrypted ? 'none' : vols.every(v => v.method === 'encryption_at_host') ? 'encryption_at_host' : 'bitlocker';

  const base = {
    checked_at: now.toISOString(),
    release_build: releaseBuild,
    encrypted,
    method,
    volumes: vols,
    imds: { answered: profile !== null, encryption_at_host: eah, security_type: profile?.securityType ?? null },
    evidence_for_scoring: false as const,
  };
  if (vols.length === 0) {
    return { ...base, verdict: releaseBuild ? 'refuse' : 'warn', reason: 'no data path was given to check', override: null };
  }
  if (encrypted) {
    return { ...base, verdict: 'ok', reason: method === 'encryption_at_host' ? 'encryption at host is on (IMDS)' : `BitLocker protects ${vols.map(v => v.volume).join(', ')}`, override: null };
  }

  const unprotected = vols.filter(v => !v.protected).map(v => v.volume).join(', ');
  const overridePath = input.overridePath ?? env[AT_REST_OVERRIDE_ENV];
  let override: AtRestCheckResult['override'] = null;
  let overrideRejected: string | undefined;
  if (overridePath) {
    let text: string | null = null;
    try { text = await probes.readOverrideFile(overridePath); } catch { text = null; }
    if (text !== null) {
      const parsed = parseOverrideRecord(text);
      if ('record' in parsed) {
        const { kind: _kind, ...rest } = parsed.record;
        override = { ...rest, path: overridePath };
      } else {
        overrideRejected = parsed.error;
      }
    }
  }
  const rejected = overrideRejected ? { override_rejected: overrideRejected } : {};
  if (override) {
    return { ...base, ...rejected, verdict: 'ok_overridden', reason: `no at-rest encryption on ${unprotected}; operator override recorded ${override.acknowledged_at} (F-7)`, override };
  }
  if (releaseBuild) {
    return { ...base, ...rejected, verdict: 'refuse', reason: `no at-rest encryption on ${unprotected} (need encryption at host or BitLocker) and no recorded operator override (F-7)`, override: null };
  }
  return { ...base, ...rejected, verdict: 'warn', reason: `no at-rest encryption shown on ${unprotected} (developer build: warning only)`, override: null };
}

/** The /api/health block: verdict and method, never the operator's identity or reason text. */
export function atRestHealth(r: AtRestCheckResult): {
  verdict: AtRestVerdict; encrypted: boolean; method: AtRestMethod; release_build: boolean;
  override_recorded: boolean; override_at: string | null; checked_at: string; evidence_for_scoring: false;
} {
  return {
    verdict: r.verdict,
    encrypted: r.encrypted,
    method: r.method,
    release_build: r.release_build,
    override_recorded: r.override !== null,
    override_at: r.override?.acknowledged_at ?? null,
    checked_at: r.checked_at,
    evidence_for_scoring: false,
  };
}

/** Run the check at start-up; log one line; throw AtRestRefusedError when the verdict is refuse. */
export async function enforceAtRestAtStartup(
  input: AtRestCheckInput,
  log: (line: string) => void = (l) => console.warn(l),
): Promise<AtRestCheckResult> {
  const r = await checkAtRest(input);
  log(`[at-rest] ${r.verdict}: ${r.reason}`);
  if (r.verdict === 'refuse') throw new AtRestRefusedError(r);
  return r;
}

// ---- default probes -------------------------------------------------------------------------

const IMDS_URL = 'http://169.254.169.254/metadata/instance/compute?api-version=2021-12-13';

async function defaultReadImds(): Promise<ImdsSecurityProfile | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 1000);
  try {
    // IMDS is link-local, needs the Metadata header, and must never go through a proxy.
    const res = await fetch(IMDS_URL, { headers: { Metadata: 'true' }, signal: ctl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { securityProfile?: ImdsSecurityProfile };
    return body?.securityProfile ?? {};
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Windows shell property System.Volume.BitLockerProtection (no administrator rights needed).
 * Values: 1 = on, 2 = off, 3 = encrypting, 4 = decrypting, 5 = suspended, 6 = on (locked); others unknown.
 */
async function defaultReadBitLocker(volume: string): Promise<BitLockerVolumeStatus | null> {
  if (process.platform !== 'win32') return null;
  const drive = volume.replace(/[\\/]+$/, '');
  if (!/^[A-Za-z]:$/.test(drive)) return null;
  const { execFile } = await import('node:child_process');
  const script = `(New-Object -ComObject Shell.Application).NameSpace('${drive}').Self.ExtendedProperty('System.Volume.BitLockerProtection')`;
  const out = await new Promise<string | null>((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 10_000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim());
    });
  });
  if (out === null) return null;
  const states: Record<string, string> = { '1': 'on', '2': 'off', '3': 'encrypting', '4': 'decrypting', '5': 'suspended', '6': 'on' };
  const state = states[out] ?? 'unknown';
  return { volume, protected: state === 'on', state };
}

async function defaultReadOverrideFile(filePath: string): Promise<string | null> {
  const fs = await import('node:fs/promises');
  try { return await fs.readFile(filePath, 'utf-8'); } catch { return null; }
}

export function defaultAtRestProbes(): Required<AtRestProbes> {
  return { readImdsSecurityProfile: defaultReadImds, readBitLocker: defaultReadBitLocker, readOverrideFile: defaultReadOverrideFile };
}
