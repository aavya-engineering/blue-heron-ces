// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MUSTER-2026A
// See LICENSE and TERMS.md.

// Discovery offer screen copy — single constants module (M2, cited figures).
// DiscoveryOffer.tsx sources every string it renders from here so copy never
// drifts between the component and its test's number-drift guard.
export const DISCOVERY_OFFER_COPY = {
  heading: 'Run Discovery before the interview',
  body:
    'Discovery automatically resolves objective coverage from your environment ' +
    'before the interview begins, cutting the number of questions you have to ' +
    'answer by hand. In prior engagements, Discovery pre-answered 41.6% of ' +
    'objectives and reduced interview time by 87.3%, saving an average of 150 ' +
    'minutes across a 37-question interview.',
  runButtonLabel: 'Run Discovery',
  skipButtonLabel: 'Skip — start manual interview',
} as const;
