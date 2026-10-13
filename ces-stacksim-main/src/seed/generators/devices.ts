// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-STACKSIM-2026A
// See LICENSE and TERMS.md.

import type { StoreObject } from '../../store/StoreTypes.js';

function range(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

export function generateDevices(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `device-${i + 1}`,
    displayName: `Sim Device ${i + 1}`,
    operatingSystem: 'Windows',
    complianceState: 'compliant',
  }));
}

export function generateDeviceCompliancePolicies(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `deviceCompliancePolicy-${i + 1}`,
    displayName: `Sim Compliance Policy ${i + 1}`,
    platformType: 'windows10',
  }));
}

export function generateManagedDevices(count: number): StoreObject[] {
  // GP-STACKSIM-1 M3 (2026-07-25): real Intune managed devices carry their
  // enrolled user's UPN and an ownership type - AO's B-05 (stale-device
  // retire) filters on `userPrincipalName eq '<upn>'` and branches on
  // ManagedDeviceOwnerType, so devices seeded without those fields made the
  // honest cmdlet -Filter match nothing (ao:B-05 "no ledger mutation" FAIL).
  // UPNs round-robin over M1's seeded users so the linkage is real.
  return range(count).map((i) => ({
    id: `managedDevice-${i + 1}`,
    deviceName: `Sim Managed Device ${i + 1}`,
    complianceState: 'compliant',
    isEncrypted: true,
    userPrincipalName: `sim.user${(i % 5) + 1}@simtenant.onmicrosoft.us`,
    managedDeviceOwnerType: 'company',
  }));
}

export function generateDeviceConfigurations(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `deviceConfiguration-${i + 1}`,
    displayName: `Sim Device Configuration ${i + 1}`,
  }));
}

export function generateDetectedApps(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `detectedApp-${i + 1}`,
    displayName: `Sim Detected App ${i + 1}`,
    version: '1.0.0',
  }));
}
