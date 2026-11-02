// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import type { NistQualitativeScore, NistScoringScale } from '../../shared/types/risk-assessment.types.js';

/**
 * NIST SP 800-30 Rev. 1 Composite Risk Matrix (Appendix I)
 * 5x5 lookup: compositeRiskMatrix[likelihood][impact] = compositeRisk
 */
const COMPOSITE_RISK_MATRIX: Record<NistQualitativeScore, Record<NistQualitativeScore, NistQualitativeScore>> = {
  very_low: {
    very_low: 'very_low',
    low: 'very_low',
    moderate: 'low',
    high: 'low',
    very_high: 'moderate',
  },
  low: {
    very_low: 'very_low',
    low: 'low',
    moderate: 'low',
    high: 'moderate',
    very_high: 'moderate',
  },
  moderate: {
    very_low: 'low',
    low: 'low',
    moderate: 'moderate',
    high: 'moderate',
    very_high: 'high',
  },
  high: {
    very_low: 'low',
    low: 'moderate',
    moderate: 'moderate',
    high: 'high',
    very_high: 'very_high',
  },
  very_high: {
    very_low: 'moderate',
    low: 'moderate',
    moderate: 'high',
    high: 'very_high',
    very_high: 'very_high',
  },
};

const SCALE: NistQualitativeScore[] = ['very_low', 'low', 'moderate', 'high', 'very_high'];

/**
 * Compute composite risk from likelihood and impact using NIST SP 800-30 Rev. 1 Appendix I matrix.
 */
export function computeCompositeRisk(likelihood: NistQualitativeScore, impact: NistQualitativeScore): NistQualitativeScore {
  return COMPOSITE_RISK_MATRIX[likelihood][impact];
}

/**
 * Full NIST SP 800-30 Rev. 1 scoring scale definition for config storage.
 */
export const NIST_SP_800_30_SCALE: NistScoringScale = {
  methodology: 'nist_sp_800_30_rev1',
  likelihoodScale: SCALE,
  impactScale: SCALE,
  compositeRiskMatrix: COMPOSITE_RISK_MATRIX,
};
