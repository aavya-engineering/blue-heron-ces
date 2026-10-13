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

export function generateUsers(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `user-${i + 1}`,
    displayName: `Sim User ${i + 1}`,
    userPrincipalName: `sim.user${i + 1}@simtenant.onmicrosoft.us`,
    accountEnabled: true,
  }));
}

export function generateServicePrincipals(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `sp-${i + 1}`,
    displayName: `Sim Service Principal ${i + 1}`,
    appId: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
  }));
}

export function generateGroups(count: number): StoreObject[] {
  // GP-STACKSIM-1 M3 (2026-07-25): the first group is the well-known
  // CUI-authorization group every CES-managed tenant carries - EO's
  // fetchGroupMembership reads it with
  // `-Filter "displayName eq 'CUI-Authorized-Users'"`, and since the
  // FIDELITY-1 tail made cmdlet -Filter honest, a generically-named seed
  // returned zero matches (empty ConvertTo-Json output -> eo:cuiGroup FAIL).
  return range(count).map((i) => ({
    id: `group-${i + 1}`,
    displayName: i === 0 ? 'CUI-Authorized-Users' : `Sim Group ${i + 1}`,
    groupTypes: [] as string[],
  }));
}

export function generateRoleAssignments(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `roleAssignment-${i + 1}`,
    principalId: `user-${i + 1}`,
    roleDefinitionId: `role-${i + 1}`,
  }));
}

export function generatePimSchedules(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `pimSchedule-${i + 1}`,
    principalId: `user-${i + 1}`,
    status: 'Provisioned',
  }));
}

export function generateAuthMethods(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: `authMethod-${i + 1}`,
    userId: `user-${i + 1}`,
    methodType: 'fido2',
  }));
}

export function generateAuthorizationPolicy(count: number): StoreObject[] {
  return range(count).map((i) => ({
    id: i === 0 ? 'authorizationPolicy' : `authorizationPolicy-${i + 1}`,
    allowInvitesFrom: 'adminsAndGuestInviters',
    guestUserRoleId: '10dae51f-b6af-4016-8d66-8c2a99b929b3',
    // G-STACKSIM-2 iteration 2: AO's A-18 read path
    // (Select-Object -ExpandProperty defaultUserRolePermissions) requires
    // this nested field to exist on the real Graph authorizationPolicy
    // resource - minimal, plausible shape, not a fabricated GET-success per
    // se (the object itself is a genuine seeded singleton; this just fills
    // in a real Graph sub-property AO's own read path expects).
    defaultUserRolePermissions: {
      allowedToCreateApps: true,
      allowedToCreateSecurityGroups: true,
      allowedToCreateTenants: false,
      allowedToReadOtherUsers: true,
      allowedToUseSSPR: true,
      permissionGrantPoliciesAssigned: ['ManagePermissionGrantsForSelf.microsoft-user-default-legacy'],
    },
  }));
}
