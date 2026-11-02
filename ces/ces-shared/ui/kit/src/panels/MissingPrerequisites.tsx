// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useState } from 'react';

/** Row state: missing (not yet acted on), working (install/import running), done, failed (retry offered). */
export type PrereqStatus = 'missing' | 'working' | 'done' | 'failed';

export interface PrereqModule {
  name: string;
  status?: PrereqStatus;
}

export interface PrereqCertificate {
  thumbprint: string;
  /** PFX path passed back to `onImportCert`. */
  path: string;
  status?: PrereqStatus;
}

export interface MissingPrerequisitesProps {
  modules: readonly PrereqModule[];
  certificate?: PrereqCertificate | null;
  onInstall: (name: string) => void;
  /** Called with the names not yet installed and not running. */
  onInstallAll: (names: string[]) => void;
  /** Called only with a non-empty password (legacy warns and does nothing otherwise). */
  onImportCert: (path: string, password: string) => void;
  id?: string;
}

const MODULE_TEXT: Record<PrereqStatus, { status: string; button: string }> = {
  missing: { status: 'not installed', button: 'Install' },
  working: { status: 'installing...', button: 'Installing...' },
  done: { status: 'installed', button: 'Installed' },
  failed: { status: 'failed', button: 'Retry' },
};

const CERT_TEXT: Record<PrereqStatus, { status: string; button: string }> = {
  missing: { status: 'not in store', button: 'Import' },
  working: { status: 'importing...', button: 'Importing...' },
  done: { status: 'imported', button: 'Imported' },
  failed: { status: 'failed', button: 'Retry' },
};

/** Legacy "Missing Prerequisites" panel (`.prereq-panel`): certificate import row, module install rows, Install All. */
export function MissingPrerequisites({
  modules,
  certificate,
  onInstall,
  onInstallAll,
  onImportCert,
  id = 'prereqPanel',
}: MissingPrerequisitesProps) {
  const [password, setPassword] = useState('');
  const [needPassword, setNeedPassword] = useState(false);
  const certStatus = certificate?.status ?? 'missing';
  const certBusy = certStatus === 'working' || certStatus === 'done';
  const pending = modules.filter((m) => (m.status ?? 'missing') !== 'done' && m.status !== 'working').map((m) => m.name);

  function importCert() {
    if (!certificate || certBusy) return;
    if (!password) {
      setNeedPassword(true);
      return;
    }
    setNeedPassword(false);
    onImportCert(certificate.path, password);
  }

  return (
    <section id={id} className="ck-prereq" aria-labelledby={`${id}Title`}>
      <h4 id={`${id}Title`} className="ck-prereq-title">
        Missing Prerequisites
      </h4>
      {certificate ? (
        <div className="ck-prereq-row ck-prereq-cert" data-status={certStatus}>
          <span className="ck-prereq-name">Certificate ({certificate.thumbprint.substring(0, 8)}...)</span>
          <span className="ck-prereq-status">{CERT_TEXT[certStatus].status}</span>
          <input
            type="password"
            className="ck-prereq-pw"
            placeholder="PFX password"
            aria-label="PFX password"
            value={password}
            disabled={certBusy}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') importCert();
            }}
          />
          <button type="button" className="ck-prereq-btn" disabled={certBusy} onClick={importCert}>
            {CERT_TEXT[certStatus].button}
          </button>
          {needPassword ? (
            <span className="ck-prereq-hint" role="alert">
              Enter the PFX password to import
            </span>
          ) : null}
        </div>
      ) : null}
      {modules.map((m) => {
        const status = m.status ?? 'missing';
        const text = MODULE_TEXT[status];
        return (
          <div key={m.name} className="ck-prereq-row" data-status={status}>
            <span className="ck-prereq-name">{m.name}</span>
            <span className="ck-prereq-status">{text.status}</span>
            <button
              type="button"
              className="ck-prereq-btn"
              aria-label={`${text.button} ${m.name}`}
              disabled={status === 'working' || status === 'done'}
              onClick={() => onInstall(m.name)}
            >
              {text.button}
            </button>
          </div>
        );
      })}
      {modules.length > 1 ? (
        <button
          type="button"
          className="ck-prereq-all"
          disabled={pending.length === 0 || modules.some((m) => m.status === 'working')}
          onClick={() => onInstallAll(pending)}
        >
          Install All Modules
        </button>
      ) : null}
    </section>
  );
}
