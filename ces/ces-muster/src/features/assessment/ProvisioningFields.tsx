// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// ProvisioningFields.tsx — FC-MU-2 (MS-5): the two Tenant Config intake
// widgets that are not text inputs.
//
//   TouFileField         — pick the terms-of-use PDF; storeTouFile keeps the
//                          bytes on the session and returns the fact answer
//                          (name + sha256), which is what gets recorded.
//   InitialPasswordField — a Generate button, never a text box. The generated
//                          value lives ONLY in this component's state, shown
//                          once so the operator can put it in their vault; the
//                          recorded answer is the one-time reference. Hiding it
//                          (or leaving the page) discards the value for good.
import { useState } from 'react';
import { generateInitialPassword, storeTouFile, TouFileError } from '@/features/plan/provisioningInputs';

/** A picked file's bytes (FileReader: works where Blob.arrayBuffer does not). */
function readFileBytes(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

export function TouFileField({
  id,
  sessionId,
  value,
  onCommit,
}: {
  id: string;
  sessionId: string | null;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [error, setError] = useState('');
  const name = /^file:([^;]+);/.exec(value)?.[1];
  return (
    <div className="field">
      <input
        type="file"
        accept="application/pdf,.pdf"
        name={id}
        data-testid={`plan-input-${id}`}
        disabled={!sessionId}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file || !sessionId) return;
          try {
            const ref = await storeTouFile(sessionId, file.name, await readFileBytes(file));
            setError('');
            onCommit(ref);
          } catch (err) {
            setError(err instanceof TouFileError ? err.message : 'could not read the file');
          }
        }}
      />
      {name && (
        <p className="field-note" data-testid={`plan-input-current-${id}`}>
          Stored: {name}
        </p>
      )}
      {error && (
        <p className="form-error" data-testid={`plan-input-error-${id}`}>
          {error}
        </p>
      )}
    </div>
  );
}

export function InitialPasswordField({
  id,
  value,
  onCommit,
}: {
  id: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  // Held in memory only, for one display. Never written anywhere.
  const [shown, setShown] = useState<string | null>(null);
  return (
    <div className="field">
      <button
        type="button"
        className="btn"
        data-testid={`plan-input-${id}`}
        onClick={() => {
          const secret = generateInitialPassword();
          setShown(secret.password);
          onCommit(secret.ref);
        }}
      >
        {value ? 'Generate a new password' : 'Generate password'}
      </button>
      {shown && (
        <div className="field-note" data-testid={`plan-input-secret-${id}`}>
          <p>
            Copy this password into your password vault now. Muster does not store it and will not show it
            again:
          </p>
          <code data-testid={`plan-input-secret-value-${id}`}>{shown}</code>
          <button type="button" className="btn" data-testid={`plan-input-secret-hide-${id}`} onClick={() => setShown(null)}>
            I have stored it — hide
          </button>
        </div>
      )}
      {value && !shown && (
        <p className="field-note" data-testid={`plan-input-current-${id}`}>
          Generated (reference only; the value is not stored).
        </p>
      )}
    </div>
  );
}
