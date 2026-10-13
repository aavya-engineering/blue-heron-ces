// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TESTER-2026A
// See LICENSE and TERMS.md.

/**
 * GP-DEMO-3 M3 — the sim certificate the Stamper GUI's Connect gate demands.
 *
 * FD-5's second item: Connect runs `Get-ChildItem Cert:\CurrentUser\My\<thumb>`
 * (`PrerequisiteChecker.ts:156-172`) and `StamperConfig` additionally requires a
 * cert FILE that exists (`StamperConfig.ts:114-133`), so the demo needs a real
 * self-signed cert in the founder's user store plus a `.pfx` on disk.
 *
 * **The founder ruled route (ii) — the GUI's own
 * `POST /api/prereqs/import-cert` — and M0 measured it non-functional:** the
 * route registers `req.on('close', () => kill())`, which on Node >= 16 fires
 * when the REQUEST completes, so it kills its own PowerShell child. Full body
 * back in 24 ms, `success:false`, store still empty; the identical command run
 * outside the route imports fine. Filed as
 * `REQ-STAMPER-PREREQ-ROUTES-KILL-OWN-CHILD` (HIGH).
 *
 * So this module implements FD-5's own stated fallback (i) — "a ces-tester
 * setup script does it" — as the WORKING path, while still ATTEMPTING the ruled
 * GUI route first whenever a GUI base URL is supplied. The day the sibling bug
 * is fixed the ruled path resumes with no code change here. This is invisible
 * setup outside the demo frame; the demo surface (Connect → Assess → Translate
 * → Execute, in the GUI) is untouched by the choice.
 *
 * The store is the only judge: every route is verified by re-probing
 * `Cert:\CurrentUser\My\<thumbprint>` afterwards, never by the route's own
 * success flag.
 *
 * Identity rule: the certificate subject is `CN=ces-tester-sim` — no personal
 * name, address or handle appears in the artifact, which may travel with a run.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Deliberately identity-free (global identity non-exposure rule). */
export const SIM_CERT_SUBJECT = 'CN=ces-tester-sim';
/** Sim-only PFX password — protects a throwaway self-signed key, nothing real. */
export const SIM_CERT_PASSWORD = 'ces-tester-sim';
export const SIM_CERT_FILENAME = 'sim.pfx';

/** How the cert ended up in `Cert:\CurrentUser\My` for this run. */
export type SimCertRoute = 'already-present' | 'gui' | 'ces-tester';

export interface SimCertResult {
  readonly thumbprint: string;
  /** Absolute path to the `.pfx` — goes straight into the record's `cert_path`. */
  readonly pfxPath: string;
  readonly password: string;
  readonly route: SimCertRoute;
  /** True when the ruled GUI-native import was tried (it is, whenever a GUI URL is given). */
  readonly guiImportAttempted: boolean;
  /** Why the ruled route did not take — kept so the REQ stays evidenced per run. */
  readonly guiImportError?: string;
}

function runPowerShell(command: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { encoding: 'utf8' },
  );
  return { status: r.status, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}

/** Reads the `IN-STORE` / `ABSENT` sentinel a presence probe prints. Pure. */
export function parseCertPresence(stdout: string): boolean {
  return stdout.trim().split(/\r?\n/).pop()?.trim() === 'IN-STORE';
}

/** Reads the one-line JSON a generation run prints. Pure. */
export function parseCertGenerationOutput(stdout: string): { thumbprint: string; pfxPath: string } {
  const line = stdout.trim().split(/\r?\n/).pop() ?? '';
  const parsed = JSON.parse(line) as { thumbprint?: unknown; pfxPath?: unknown };
  if (typeof parsed.thumbprint !== 'string' || typeof parsed.pfxPath !== 'string') {
    throw new Error(`unexpected certificate generation output: ${line.slice(0, 200)}`);
  }
  return { thumbprint: parsed.thumbprint, pfxPath: parsed.pfxPath };
}

/** `true` when the thumbprint is present in the current user's personal store. */
export function certInStore(thumbprint: string): boolean {
  const { stdout } = runPowerShell(
    `if (Test-Path 'Cert:\\CurrentUser\\My\\${thumbprint}') { 'IN-STORE' } else { 'ABSENT' }`,
  );
  return parseCertPresence(stdout);
}

/**
 * Generate a fresh self-signed sim cert, export it to `<outDir>/sim.pfx`, then
 * REMOVE it from the store — so whatever import route runs next is genuinely
 * the thing that installs it (that is what makes the GUI-route attempt real
 * rather than decorative).
 */
export function generateSimCert(outDir: string, password = SIM_CERT_PASSWORD): { thumbprint: string; pfxPath: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const pfx = path.join(outDir, SIM_CERT_FILENAME);
  const { status, stdout, stderr } = runPowerShell(
    [
      `$cert = New-SelfSignedCertificate -Subject '${SIM_CERT_SUBJECT}' -CertStoreLocation 'Cert:\\CurrentUser\\My'`,
      `  -KeyExportPolicy Exportable -KeySpec Signature -KeyLength 2048 -KeyAlgorithm RSA -HashAlgorithm SHA256`,
      `  -NotAfter (Get-Date).AddYears(1);`,
      `$pw = ConvertTo-SecureString -String '${password}' -Force -AsPlainText;`,
      `Export-PfxCertificate -Cert "Cert:\\CurrentUser\\My\\$($cert.Thumbprint)" -FilePath '${pfx}' -Password $pw | Out-Null;`,
      `Remove-Item -Path "Cert:\\CurrentUser\\My\\$($cert.Thumbprint)" -Force -Confirm:$false;`,
      `[pscustomobject]@{ thumbprint = $cert.Thumbprint; pfxPath = '${pfx}' } | ConvertTo-Json -Compress`,
    ].join(' '),
  );
  if (status !== 0) throw new Error(`sim certificate generation failed (exit ${status}): ${stderr || stdout}`);
  return parseCertGenerationOutput(stdout);
}

/** Re-export an already-installed cert into this run's directory (its `.pfx` is run-scoped, the store entry is not). */
export function exportSimCertFromStore(
  thumbprint: string,
  outDir: string,
  password = SIM_CERT_PASSWORD,
): string {
  fs.mkdirSync(outDir, { recursive: true });
  const pfx = path.join(outDir, SIM_CERT_FILENAME);
  const { status, stdout, stderr } = runPowerShell(
    `$pw = ConvertTo-SecureString -String '${password}' -Force -AsPlainText; ` +
      `Export-PfxCertificate -Cert 'Cert:\\CurrentUser\\My\\${thumbprint}' -FilePath '${pfx}' -Password $pw | Out-Null`,
  );
  if (status !== 0 || !fs.existsSync(pfx)) {
    throw new Error(`could not export installed sim cert ${thumbprint} (exit ${status}): ${stderr || stdout}`);
  }
  return pfx;
}

/**
 * ces-tester-side import — FD-5 fallback (i), the path that actually works today.
 *
 * `-Exportable` matters for the NEXT run: without it the private key lands
 * non-exportable, so a later run whose `.pfx` is in a fresh run directory
 * cannot re-export the installed cert and has to generate a new one. This is a
 * throwaway self-signed sim key, so exportability costs nothing.
 */
export function importSimCertLocally(pfxPath: string, password = SIM_CERT_PASSWORD): { ok: boolean; detail: string } {
  const { status, stdout, stderr } = runPowerShell(
    `Import-PfxCertificate -FilePath '${pfxPath}' -CertStoreLocation Cert:\\CurrentUser\\My -Exportable ` +
      `-Password (ConvertTo-SecureString -String '${password}' -AsPlainText -Force) | Out-Null`,
  );
  return { ok: status === 0, detail: stderr || stdout };
}

/**
 * The founder-ruled GUI-native import (FD-5(ii)). Attempted first, always
 * verified against the store afterwards — the route answers `success:false`
 * in ~24 ms today (REQ-STAMPER-PREREQ-ROUTES-KILL-OWN-CHILD) and the caller
 * must not believe either the flag or the latency.
 */
export async function importSimCertViaGui(
  guiBaseUrl: string,
  pfxPath: string,
  password = SIM_CERT_PASSWORD,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${guiBaseUrl}/api/prereqs/import-cert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ certPath: pfxPath, password }),
      signal: AbortSignal.timeout(180000),
    });
    const detail = (await res.text()).slice(0, 2000);
    return { ok: res.ok, detail };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export interface EnsureSimCertOptions {
  /** Run-scoped directory the `.pfx` is written into. */
  readonly outDir: string;
  /** A thumbprint already installed on this machine (M0 left one in place). */
  readonly knownThumbprint?: string;
  /** Stamper GUI base URL — when present, the ruled GUI import is attempted first. */
  readonly guiBaseUrl?: string;
  readonly password?: string;
}

/**
 * Make a usable sim cert exist BOTH in `Cert:\CurrentUser\My` and as a `.pfx`
 * on disk, and report which route got it there.
 *
 * Order: reuse an installed cert → otherwise generate → attempt the ruled GUI
 * import → fall back to the ces-tester-side import. Throws if the store still
 * does not hold it afterwards; the Connect gate is not something to degrade
 * around.
 */
export async function ensureSimCert(opts: EnsureSimCertOptions): Promise<SimCertResult> {
  const password = opts.password ?? SIM_CERT_PASSWORD;

  if (opts.knownThumbprint && certInStore(opts.knownThumbprint)) {
    // A run directory is fresh per run, so the `.pfx` normally has to be
    // re-exported from the store. That only works if the installed key is
    // exportable — an older import made without `-Exportable` is not, so a
    // failed re-export falls through to generating a fresh cert rather than
    // killing the run. A new thumbprint is fully coherent: the tenant record is
    // patched from the returned one, so Connect matches whatever we installed.
    const pfx = path.join(opts.outDir, SIM_CERT_FILENAME);
    let pfxPath: string | undefined = fs.existsSync(pfx) ? pfx : undefined;
    if (!pfxPath) {
      try {
        pfxPath = exportSimCertFromStore(opts.knownThumbprint, opts.outDir, password);
      } catch {
        pfxPath = undefined; // non-exportable key — generate a fresh cert below.
      }
    }
    if (pfxPath) {
      return {
        thumbprint: opts.knownThumbprint,
        pfxPath,
        password,
        route: 'already-present',
        guiImportAttempted: false,
      };
    }
  }

  const { thumbprint, pfxPath } = generateSimCert(opts.outDir, password);

  let guiImportAttempted = false;
  let guiImportError: string | undefined;
  if (opts.guiBaseUrl) {
    guiImportAttempted = true;
    const gui = await importSimCertViaGui(opts.guiBaseUrl, pfxPath, password);
    if (certInStore(thumbprint)) {
      return { thumbprint, pfxPath, password, route: 'gui', guiImportAttempted };
    }
    guiImportError = `GUI import did not install the cert (REQ-STAMPER-PREREQ-ROUTES-KILL-OWN-CHILD): ${gui.detail.slice(0, 300)}`;
  }

  const local = importSimCertLocally(pfxPath, password);
  if (!certInStore(thumbprint)) {
    throw new Error(
      `sim cert ${thumbprint} not in Cert:\\CurrentUser\\My after every import route — ` +
        `${guiImportError ?? 'GUI route not attempted'}; ces-tester import: ${local.detail || 'no detail'}`,
    );
  }
  return { thumbprint, pfxPath, password, route: 'ces-tester', guiImportAttempted, guiImportError };
}
