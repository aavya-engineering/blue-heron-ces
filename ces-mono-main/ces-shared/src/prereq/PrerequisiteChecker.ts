// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { spawn } from 'child_process';

export interface ModulePrerequisite {
  name: string;
  session: string;
  testCommand: string;
  installCommand: string;
  required: boolean;
}

export interface ModuleCheckResult {
  name: string;
  session: string;
  installed: boolean;
  version: string | null;
  required: boolean;
}

/** Bootstrap prefix: ensure TLS 1.2, NuGet provider, and trusted PSGallery before Install-Module */
const INSTALL_PREAMBLE = [
  '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12',
  'Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser | Out-Null',
  'Set-PSRepository -Name PSGallery -InstallationPolicy Trusted',
].join('; ');

function installCmd(moduleName: string): string {
  return `${INSTALL_PREAMBLE}; Install-Module ${moduleName} -Scope CurrentUser -Force -AllowClobber`;
}

export const MODULE_PREREQUISITES: ModulePrerequisite[] = [
  {
    name: 'Microsoft.Graph',
    session: 'graph',
    testCommand: "Get-Module -ListAvailable Microsoft.Graph | Select-Object -First 1 -ExpandProperty Version | ForEach-Object { $_.ToString() }",
    installCommand: installCmd('Microsoft.Graph'),
    required: true,
  },
  {
    name: 'ExchangeOnlineManagement',
    session: 'exchange',
    testCommand: "Get-Module -ListAvailable ExchangeOnlineManagement | Select-Object -First 1 -ExpandProperty Version | ForEach-Object { $_.ToString() }",
    installCommand: installCmd('ExchangeOnlineManagement'),
    required: true,
  },
  {
    name: 'Az',
    session: 'azure',
    testCommand: "Get-Module -ListAvailable Az.Accounts | Select-Object -First 1 -ExpandProperty Version | ForEach-Object { $_.ToString() }",
    installCommand: installCmd('Az'),
    required: true,
  },
  {
    name: 'Microsoft.Online.SharePoint.PowerShell',
    session: 'sharepoint',
    testCommand: "Get-Module -ListAvailable Microsoft.Online.SharePoint.PowerShell | Select-Object -First 1 -ExpandProperty Version | ForEach-Object { $_.ToString() }",
    installCommand: installCmd('Microsoft.Online.SharePoint.PowerShell'),
    required: false,
  },
  {
    name: 'MicrosoftTeams',
    session: 'teams',
    testCommand: "Get-Module -ListAvailable MicrosoftTeams | Select-Object -First 1 -ExpandProperty Version | ForEach-Object { $_.ToString() }",
    installCommand: installCmd('MicrosoftTeams'),
    required: false,
  },
];

export interface CertCheckResult {
  found: boolean;
  subject: string | null;
  expiry: string | null;
  expired: boolean;
}

export class PrerequisiteChecker {

  /** Check all modules and return their installed status. */
  async checkAll(): Promise<ModuleCheckResult[]> {
    const results: ModuleCheckResult[] = [];
    for (const mod of MODULE_PREREQUISITES) {
      const result = await this.checkModule(mod);
      results.push(result);
    }
    return results;
  }

  /** Check a single module. */
  private async checkModule(mod: ModulePrerequisite): Promise<ModuleCheckResult> {
    try {
      const { stdout, exitCode } = await this.execPS(mod.testCommand);
      const version = exitCode === 0 ? stdout.trim() || null : null;
      return {
        name: mod.name,
        session: mod.session,
        installed: exitCode === 0 && !!version,
        version,
        required: mod.required,
      };
    } catch {
      return {
        name: mod.name,
        session: mod.session,
        installed: false,
        version: null,
        required: mod.required,
      };
    }
  }

  /** Install a module, streaming progress lines via callback. Returns exit code. */
  installModule(name: string, onProgress: (line: string) => void): { promise: Promise<number>; kill: () => void } {
    const mod = MODULE_PREREQUISITES.find(m => m.name === name);
    if (!mod) {
      onProgress(`Unknown module: ${name}`);
      return { promise: Promise.resolve(1), kill: () => {} };
    }

    onProgress(`Installing ${name}...`);

    const proc = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', mod.installCommand,
    ]);

    const promise = new Promise<number>((resolve) => {
      proc.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) onProgress(line);
      });

      proc.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) onProgress(`WARN: ${line}`);
      });

      proc.on('close', (code) => {
        resolve(code ?? 1);
      });

      proc.on('error', (err) => {
        onProgress(`ERROR: ${err.message}`);
        resolve(1);
      });
    });

    const kill = (): void => {
      try { proc.kill(); } catch { /* already exited */ }
    };

    return { promise, kill };
  }

  /** Check if a certificate with the given thumbprint exists in Cert:\CurrentUser\My. */
  async checkCertificate(thumbprint: string): Promise<CertCheckResult> {
    if (!thumbprint) {
      return { found: false, subject: null, expiry: null, expired: false };
    }
    try {
      const script = [
        `$cert = Get-ChildItem Cert:\\CurrentUser\\My\\${thumbprint} -ErrorAction SilentlyContinue`,
        'if ($cert) {',
        '  $now = Get-Date',
        '  $exp = $cert.NotAfter.ToString("o")',
        '  $expired = if ($cert.NotAfter -lt $now) { "true" } else { "false" }',
        '  "$($cert.Subject)|$exp|$expired"',
        '} else { "NOT_FOUND" }',
      ].join('; ');

      const { stdout, exitCode } = await this.execPS(script);
      const out = stdout.trim();

      if (exitCode !== 0 || out === 'NOT_FOUND' || !out) {
        return { found: false, subject: null, expiry: null, expired: false };
      }

      const parts = out.split('|');
      return {
        found: true,
        subject: parts[0] || null,
        expiry: parts[1] || null,
        expired: parts[2] === 'true',
      };
    } catch {
      return { found: false, subject: null, expiry: null, expired: false };
    }
  }

  /** Import a PFX certificate, streaming progress. Returns exit code. */
  importCertificate(pfxPath: string, password: string, onProgress: (line: string) => void): { promise: Promise<number>; kill: () => void } {
    onProgress(`Importing certificate from ${pfxPath}...`);

    const escapedPw = password.replace(/'/g, "''");
    const script = `Import-PfxCertificate -FilePath '${pfxPath}' -CertStoreLocation Cert:\\CurrentUser\\My -Password (ConvertTo-SecureString -String '${escapedPw}' -AsPlainText -Force)`;

    const proc = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', script,
    ]);

    const promise = new Promise<number>((resolve) => {
      proc.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) onProgress(line);
      });

      proc.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().split(/\r?\n/).filter(Boolean);
        for (const line of lines) onProgress(`WARN: ${line}`);
      });

      proc.on('close', (code) => {
        resolve(code ?? 1);
      });

      proc.on('error', (err) => {
        onProgress(`ERROR: ${err.message}`);
        resolve(1);
      });
    });

    const kill = (): void => {
      try { proc.kill(); } catch { /* already exited */ }
    };

    return { promise, kill };
  }

  /** Get PowerShell version string. */
  async getPSVersion(): Promise<string | null> {
    try {
      const { stdout, exitCode } = await this.execPS('$PSVersionTable.PSVersion.ToString()');
      return exitCode === 0 ? stdout.trim() || null : null;
    } catch {
      return null;
    }
  }

  private execPS(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command', command,
      ]);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      proc.on('error', (error) => {
        reject(new Error(`Failed to spawn PowerShell: ${error.message}`));
      });
    });
  }
}
