// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PL-121 (founder ruling 2026-11-01, scope 2026-11-02): "the setting that provides the protection must not
 * depend on a placeholder". Muster's visible placeholders for operator values discovery cannot see
 * (ces-muster src/features/plan/derive/operatorValues.ts OPERATOR_PLACEHOLDER): MUSTER-DEFAULT-SSID,
 * unset-security-email@example.invalid. SAME MARKER LIST as Stamper's ces-stamper src/shared/musterPlaceholders.ts
 * (families MUSTER-DEFAULT-*, unset-*, the reserved .invalid domain); a parity test pins the two.
 */
export const PLACEHOLDER_REASON = 'built from an unanswered placeholder';

const FAMILIES: readonly RegExp[] = [
  /(?:^|[^A-Za-z0-9])MUSTER-DEFAULT(?:-|$|[^A-Za-z0-9])/i,
  /(?:^|[\s,;<"'(=:])unset-[A-Za-z0-9]/i,
  // a host or mail domain under the reserved .invalid TLD (not "invalidated", not "x.invalid.com")
  /[A-Za-z0-9-]\.invalid(?![A-Za-z0-9.-])/i,
];

/** True when one value is (or carries) a Muster placeholder. */
export function isMusterPlaceholder(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const t = value.trim();
  return t !== '' && FAMILIES.some((re) => re.test(t));
}

/** "built from an unanswered placeholder ('MUSTER-DEFAULT-SSID')". */
export const placeholderNote = (value: string): string => `${PLACEHOLDER_REASON} ('${value}')`;
