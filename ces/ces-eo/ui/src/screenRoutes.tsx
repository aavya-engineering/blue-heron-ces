// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FIN-31: the EO screens, in tab order (shared by the router and the shell's TabNav). FIN-31b adds
// Evidence Explorer and Policy Store in their legacy positions (after POA&M, after Risk).

import type { ComponentType } from 'react';
import AccessScreen from './screens/access';
import AssessScreen from './screens/assess';
import SspScreen from './screens/ssp';
import SprsScreen from './screens/sprs';
import PoamScreen from './screens/poam';
import PackageScreen from './screens/package';
import PersonnelScreen from './screens/personnel';
import TrainingScreen from './screens/training';
import RiskScreen from './screens/risk';
import OffboardingScreen from './screens/offboarding';
import UploadScreen from './screens/upload';
import ReviewScreen from './screens/review';
import AssessorScreen from './screens/assessor';
import EvidenceExplorerScreen from './screens/evidence';
import PolicyStoreScreen from './screens/policies';

export interface ScreenRoute {
  path: string;
  label: string;
  Component: ComponentType;
}

/** Screen order = tab order. FIN-31 row: no EC screen (FD-10); EC status sits on Upload. */
export const SCREEN_ROUTES: readonly ScreenRoute[] = [
  { path: 'access', label: 'Tenant and access', Component: AccessScreen },
  { path: 'assess', label: 'Assess', Component: AssessScreen },
  { path: 'ssp', label: 'SSP', Component: SspScreen },
  { path: 'sprs', label: 'SPRS', Component: SprsScreen },
  { path: 'poam', label: 'POA&M', Component: PoamScreen },
  { path: 'evidence', label: 'Evidence Explorer', Component: EvidenceExplorerScreen },
  { path: 'package', label: 'Package', Component: PackageScreen },
  { path: 'personnel', label: 'Personnel', Component: PersonnelScreen },
  { path: 'training', label: 'Training', Component: TrainingScreen },
  { path: 'risk', label: 'Risk', Component: RiskScreen },
  { path: 'policies', label: 'Policy Store', Component: PolicyStoreScreen },
  { path: 'offboarding', label: 'Offboarding', Component: OffboardingScreen },
  { path: 'upload', label: 'Upload', Component: UploadScreen },
  { path: 'review', label: 'Review', Component: ReviewScreen },
  { path: 'assessor', label: 'Assessor view', Component: AssessorScreen },
];
