// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// MusterSignIn.tsx — FX-MU4: the Plan tab's sign-in to muster-api. Calls the
// existing POST /auth/login through musterAuth.ts; the token it returns is what
// "Send to Stamper" and "Check Stamper progress" send as their bearer token.
import { useState, type FormEvent } from 'react';
import { signInToMuster, signOutOfMuster } from '@/shared/api/musterAuth';

export default function MusterSignIn({
  signedIn,
  onChange,
}: {
  signedIn: boolean;
  onChange: (signedIn: boolean) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (signedIn) {
    return (
      <p data-testid="muster-signin-state">
        Signed in to muster-api.{' '}
        <button
          type="button"
          className="btn-secondary"
          data-testid="muster-signout-btn"
          onClick={() => {
            signOutOfMuster();
            onChange(false);
          }}
        >
          Sign out
        </button>
      </p>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const outcome = await signInToMuster(email.trim(), password);
      setPassword('');
      if (outcome.ok) onChange(true);
      else setError(outcome.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form data-testid="muster-signin-form" onSubmit={submit} style={{ marginBottom: 8 }}>
      <p style={{ margin: '0 0 4px' }}>Sign in to muster-api to send the plan to Stamper.</p>
      <input
        type="email"
        autoComplete="username"
        placeholder="Email"
        aria-label="muster-api email"
        data-testid="muster-signin-email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />{' '}
      <input
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        aria-label="muster-api password"
        data-testid="muster-signin-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />{' '}
      <button type="submit" className="btn-secondary" data-testid="muster-signin-btn" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      {error && (
        <p className="callout-warning" data-testid="muster-signin-error">
          Sign-in failed — {error}.
        </p>
      )}
    </form>
  );
}
