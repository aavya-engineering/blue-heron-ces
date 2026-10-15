// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * Extended SSP types for directive-aware control implementations.
 * Extends the base ControlImplementation from ces-shared/types/ssp
 * with directive-specific fields for SPRS calculation.
 */

import type { ControlImplementation, InfraResource } from 'ces-shared/types/ssp';
import type { DirectiveType, ExtendedDirectiveMetadata } from './directive.types.js';

/**
 * ControlImplementation with optional directive fields.
 * The base ControlImplementation.status field is preserved for backward compat.
 * sprsValue is a new field distinct from status (status is assessment state,
 * sprsValue is SPRS-specific determination).
 */
export interface DirectiveControlImplementation extends ControlImplementation {
  directive?: DirectiveType;
  directiveMetadata?: ExtendedDirectiveMetadata;
  sprsValue?: 'MET' | 'NOT_MET' | 'N/A';
  sprsRationale?: string;
}

export type { InheritanceSection } from '../../eo/ssp/FedRampInheritanceGenerator.js';

export interface SectionTwoNarrative {
  sectionNumber: string;
  content: string;
}

/** Authorization boundary zone structure for diagram generation */
export interface AuthorizationBoundary {
  zones: Array<{ name: string; description: string; components: string[] }>;
  externalConnections: string[];
}

/** CUI data flow structure for diagram generation */
export interface CuiDataFlows {
  ingress: Array<{ source: string; destination: string; cuiType: string; protocol: string }>;
  egress: Array<{ source: string; destination: string; cuiType: string; protocol: string }>;
  internal: Array<{ source: string; destination: string; cuiType: string }>;
}

/** Type alias for system component (maps to InfraResource) */
export type SystemComponent = InfraResource;

/** Physical security data for PE control narratives */
export interface PhysicalSecurityData {
  facilityType: string;
  accessControls: string[];
  visitorManagement: string;
  notes: string;
}
