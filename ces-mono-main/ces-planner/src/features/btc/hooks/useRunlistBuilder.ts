// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { useMemo } from 'react';
import { buildRunlist } from '../services/runlistEngine';
import type { BTCSectionDef, BTCQuestionDef, ActivationRule, Runlist } from '../types';

export function useRunlistBuilder(
  siOutputs: Record<string, unknown> | null,
  cuiOutputs: Record<string, unknown> | null,
  sections: BTCSectionDef[],
  virtualQuestions: BTCQuestionDef[],
  rules: ActivationRule[]
): Runlist | null {
  return useMemo(() => {
    if (!siOutputs || !cuiOutputs || sections.length === 0 || rules.length === 0) {
      return null;
    }

    return buildRunlist(siOutputs, cuiOutputs, { sections, virtualQuestions }, rules);
  }, [siOutputs, cuiOutputs, sections, virtualQuestions, rules]);
}
