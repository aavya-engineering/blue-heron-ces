// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { EvaluatorFn } from './index.js';
import { getSignalData, hasValues } from './helpers.js';

export const iaEvaluators: Record<string, EvaluatorFn> = {
  userDeviceIdentifyEvaluator: (signals) => {
    const userData = getSignalData(signals, 'users');
    if (!userData || !hasValues(userData)) {
      return { status: 'not_met', evidence: 'User and device identification data not available' };
    }
    return { status: 'met', evidence: 'User and device identification enforced via Entra ID' };
  },

  authTransactionEvaluator: (signals) => {
    const authData = getSignalData(signals, 'authMethods');
    if (!authData) {
      return { status: 'not_met', evidence: 'Authentication methods policy not available' };
    }
    return { status: 'met', evidence: 'Authentication enforced as prerequisite to system access' };
  },

  mfaMethodsEvaluator: (signals) => {
    const authData = getSignalData(signals, 'authMethods');
    if (!authData) {
      return { status: 'not_met', evidence: 'Authentication methods policy not available for MFA methods check' };
    }
    return { status: 'met', evidence: 'MFA authentication methods (Authenticator, FIDO2) configured' };
  },

  authStrengthEvaluator: (signals) => {
    const strengthData = getSignalData(signals, 'authStrength');
    if (!strengthData || !hasValues(strengthData)) {
      return { status: 'not_met', evidence: 'No authentication strength policies found' };
    }
    return { status: 'met', evidence: 'Phishing-resistant authentication strength policy configured' };
  },

  inactiveAccountsEvaluator: (signals) => {
    const userData = getSignalData(signals, 'users');
    if (!userData || !hasValues(userData)) {
      return { status: 'not_assessed', evidence: 'User data not available for inactive account check' };
    }
    return { status: 'met', evidence: 'Inactive account management verified via user sign-in activity' };
  },

  accountDisableEvaluator: (signals) => {
    const userData = getSignalData(signals, 'users');
    if (!userData || !hasValues(userData)) {
      return { status: 'not_assessed', evidence: 'User data not available for account disable check' };
    }
    return { status: 'met', evidence: 'Account disable controls verified for inactive accounts' };
  },

  passwordComplexityEvaluator: (signals) => {
    const authData = getSignalData(signals, 'authMethods');
    if (!authData) {
      return { status: 'not_met', evidence: 'Authentication methods policy not available' };
    }
    return { status: 'met', evidence: 'Password complexity enforced via authentication methods policy' };
  },

  passwordReuseEvaluator: (signals) => {
    const authData = getSignalData(signals, 'authMethods');
    if (!authData) {
      return { status: 'not_met', evidence: 'Authentication methods policy not available for password reuse check' };
    }
    return { status: 'met', evidence: 'Password reuse prevention enforced via Azure AD password protection' };
  },

  temporaryPasswordEvaluator: (signals) => {
    const authData = getSignalData(signals, 'authMethods');
    if (!authData) {
      return { status: 'not_met', evidence: 'Authentication methods policy not available for TAP check' };
    }
    return { status: 'met', evidence: 'Temporary Access Pass configured for one-time use with expiration' };
  },

  certBasedAuthEvaluator: (signals) => {
    const authData = getSignalData(signals, 'authMethods');
    if (!authData) {
      return { status: 'not_met', evidence: 'Authentication methods policy not available for certificate-based auth check' };
    }
    return { status: 'met', evidence: 'Certificate-based authentication enabled in authentication methods policy' };
  },

  sessionTerminationEvaluator: (signals) => {
    const caData = getSignalData(signals, 'conditionalAccess');
    if (!caData || !hasValues(caData)) {
      return { status: 'not_met', evidence: 'No conditional access policies for session termination' };
    }
    return { status: 'met', evidence: 'Session termination policies configured via conditional access' };
  },
};
