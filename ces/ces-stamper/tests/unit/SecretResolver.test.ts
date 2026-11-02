// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-ST-3 step 2 (REQ-ces-stamper-secret-reference-resolution): SecretResolver must never return
// a blank value — an unresolvable reference always throws, naming the variable and why.
import { resolveSecretReference, buildSecretOverlay, SecretResolutionError } from '../../src/core/SecretResolver';
import type { SecretReference } from 'ces-shared/types/mission-plan';

describe('SecretResolver', () => {
  describe('resolveSecretReference — one_time_operator_held', () => {
    const ref: SecretReference = {
      variable: 'initialPassword',
      form: 'one_time_operator_held',
      ref: 'secretref:one-time:abc123',
    };

    it('resolves to the operator-supplied value keyed by ref', () => {
      const value = resolveSecretReference(ref, { operatorHeld: { 'secretref:one-time:abc123': 'Str0ng-P@ss!' } });
      expect(value).toBe('Str0ng-P@ss!');
    });

    it('throws SecretResolutionError — never a blank value — when the operator has not supplied it', () => {
      expect(() => resolveSecretReference(ref, { operatorHeld: {} })).toThrow(SecretResolutionError);
      expect(() => resolveSecretReference(ref, {})).toThrow(SecretResolutionError);
      try {
        resolveSecretReference(ref, {});
        throw new Error('expected resolveSecretReference to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(SecretResolutionError);
        expect((err as SecretResolutionError).variable).toBe('initialPassword');
        expect((err as SecretResolutionError).message).toContain('initialPassword');
        expect((err as SecretResolutionError).message).toContain('Configure time');
      }
    });

    it('throws rather than returning an empty string when the stored value is empty', () => {
      expect(() => resolveSecretReference(ref, { operatorHeld: { 'secretref:one-time:abc123': '' } })).toThrow(SecretResolutionError);
    });
  });

  describe('resolveSecretReference — key_vault_secret', () => {
    const ref: SecretReference = {
      variable: 'initialPassword',
      form: 'key_vault_secret',
      vault: 'kv-example',
      name: 'initial-password',
    };

    it('HONEST-OPEN: throws a clear, named error when no Key Vault reader is configured (no live client implemented this session)', () => {
      try {
        resolveSecretReference(ref, {});
        throw new Error('expected resolveSecretReference to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(SecretResolutionError);
        expect((err as SecretResolutionError).variable).toBe('initialPassword');
        expect((err as SecretResolutionError).message).toContain('kv-example/initial-password');
        expect((err as SecretResolutionError).message).toContain('Key Vault reader not configured');
      }
    });

    it('resolves via an injected reader (test double — never a live Key Vault call)', () => {
      const reader = (vault: string, name: string) => `${vault}:${name}:resolved`;
      const value = resolveSecretReference(ref, { keyVaultReader: reader });
      expect(value).toBe('kv-example:initial-password:resolved');
    });

    it('wraps a throwing reader in SecretResolutionError naming the variable', () => {
      const reader = () => { throw new Error('vault unreachable'); };
      expect(() => resolveSecretReference(ref, { keyVaultReader: reader })).toThrow(SecretResolutionError);
    });

    it('rejects a reader that resolves to an empty value', () => {
      const reader = () => '';
      expect(() => resolveSecretReference(ref, { keyVaultReader: reader })).toThrow(SecretResolutionError);
    });
  });

  describe('buildSecretOverlay', () => {
    it('collects successes into the overlay and failures into errors, without throwing', () => {
      const refs: SecretReference[] = [
        { variable: 'initialPassword', form: 'one_time_operator_held', ref: 'ref-a' },
        { variable: 'touAdminSecret', form: 'one_time_operator_held', ref: 'ref-b' },
      ];
      const { overlay, errors } = buildSecretOverlay(refs, { operatorHeld: { 'ref-a': 'resolved-a' } });
      expect(overlay).toEqual({ initialPassword: 'resolved-a' });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(SecretResolutionError);
      expect(errors[0].variable).toBe('touAdminSecret');
    });

    it('returns an empty overlay and no errors for an empty reference list', () => {
      const { overlay, errors } = buildSecretOverlay([], {});
      expect(overlay).toEqual({});
      expect(errors).toEqual([]);
    });
  });
});
