// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { ArchitectureMetadata } from '../../shared/types/evidence.types.js';

const BYOD_TRIGGER_DIRECTIVES = new Set(['validate', 'document-prohibition', 'implement']);

export class ArchitectureDetector {

  static detectArchitecture(metadata: ArchitectureMetadata): string | null {
    if (this.isByodArchitecture(metadata)) {
      return 'session_controlled_byod';
    }
    return null;
  }

  static isByodArchitecture(metadata: ArchitectureMetadata): boolean {
    return (
      metadata.architecture_declared === 'session_controlled_byod' &&
      BYOD_TRIGGER_DIRECTIVES.has(metadata.directive)
    );
  }
}
