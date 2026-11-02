// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

/**
 * PL-121 (founder ruling 2026-11-01): "a setting built from an unanswered placeholder never counts".
 *
 * Muster gives the operator values that discovery can never see a VISIBLE placeholder when nobody
 * answered them (ces-muster src/features/plan/derive/operatorValues.ts, OPERATOR_PLACEHOLDER):
 *   wifi_ssid      -> MUSTER-DEFAULT-SSID                      (Stamper variable wifiSsid)
 *   security_email -> unset-security-email@example.invalid     (securityEmail)
 *   ciso_email     -> unset-security-email@example.invalid     (cisoEmail)
 * SYNC COUPLING: Stamper cannot import Muster, so the shapes are matched here by family
 * (MUSTER-DEFAULT-*, unset-*, the reserved .invalid domain, RFC 2606). A new Muster placeholder
 * must use one of these families, or this file must learn it.
 *
 * One shared judgement, used by every route that decides a verdict from a read (CLI and GUI alike):
 * OutputVerificationEngine.verify (SET, exists and verify-only paths), lookup.verifyEquivalent (a tenant
 * equivalent), buildStructuredEvidence (every record) and judgeProhibitionRead (evidence-only reads and
 * the task-level "evidence shown" rule). A read that shows a placeholder value is NOT_SAT with
 * PLACEHOLDER_REASON. The read is the tenant's answer, never the command Stamper sent.
 */

/** The verdict reason (founder ruling 2026-11-01). */
export const PLACEHOLDER_REASON = 'built from an unanswered placeholder';

/** Muster's visible placeholders as of 2026-11-01 (exact values; the families below cover them). */
export const MUSTER_OPERATOR_PLACEHOLDERS: readonly string[] = Object.freeze([
  'MUSTER-DEFAULT-SSID',
  'unset-security-email@example.invalid',
]);

/** The Stamper plan variables Muster may fill with a placeholder (STAMPER_VAR of OPERATOR_PLACEHOLDER's keys). */
export const PLACEHOLDER_VARIABLES: readonly string[] = Object.freeze(['wifiSsid', 'securityEmail', 'cisoEmail']);

const FAMILIES: readonly RegExp[] = [
  /(?:^|[^A-Za-z0-9])MUSTER-DEFAULT(?:-|$|[^A-Za-z0-9])/i,
  /(?:^|[\s,;<"'(=:])unset-[A-Za-z0-9]/i,
  // a host or mail domain under the reserved .invalid TLD (not "invalidated", not "x.invalid.com")
  /[A-Za-z0-9-]\.invalid(?![A-Za-z0-9.-])/i,
];

/** True when one string value is (or carries) a Muster placeholder. */
export function isMusterPlaceholder(value: string): boolean {
  const t = value.trim();
  return t !== '' && FAMILIES.some((re) => re.test(t));
}

/** The first placeholder string anywhere in a parsed JSON value (depth-first), else undefined. */
function firstPlaceholderIn(value: unknown, depth = 0): string | undefined {
  if (depth > 32 || value === null || value === undefined) return undefined;
  if (typeof value === 'string') return isMusterPlaceholder(value) ? value.trim() : undefined;
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = firstPlaceholderIn(v, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const hit = firstPlaceholderIn(v, depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** A copy of one object without the ignored dot paths (`$.a.b`, matched case-insensitively). */
function withoutPaths(value: unknown, ignore: readonly string[]): unknown {
  if (ignore.length === 0 || value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const copy: Record<string, unknown> = JSON.parse(JSON.stringify(value));
  for (const p of ignore) {
    const parts = p.replace(/^\$\./, '').split('.');
    let cur: Record<string, unknown> | undefined = copy;
    for (let i = 0; cur && i < parts.length; i++) {
      const key: string | undefined = Object.keys(cur).find((k) => k.toLowerCase() === parts[i].toLowerCase());
      if (key === undefined) break;
      if (i === parts.length - 1) delete cur[key];
      else cur = cur[key] && typeof cur[key] === 'object' && !Array.isArray(cur[key]) ? (cur[key] as Record<string, unknown>) : undefined;
    }
  }
  return copy;
}

/** A Graph collection envelope ({ value: [...] , @odata.* }) is read as its list. */
function asList(parsed: unknown): unknown[] | undefined {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    const keys = Object.keys(o);
    if (Array.isArray(o.value) && keys.every((k) => k === 'value' || k.startsWith('@odata'))) return o.value as unknown[];
  }
  return undefined;
}

const MARKER = /\r?\nSTAMPER_EXECUTION_SUCCESS\s*$|^STAMPER_EXECUTION_SUCCESS\r?\n?$/;

/**
 * The placeholder a read shows, or undefined.
 * - One object (or a list of one): any string value anywhere in it that is a placeholder
 *   (a recipient list holding the placeholder beside a real address still shows it: PH-13 FX rule).
 * - A list of several objects (a listing read): only when EVERY item shows a placeholder. A list that
 *   also holds a real object still shows that object, and the placeholder-built one simply does not count.
 * - Text that is not JSON: a placeholder token anywhere in it.
 * `ignore` (Round 2, founder 2026-11-02): an entry's `verification.placeholder_ignore` paths, values incidental to
 * the protection (SI.L2-3.14.2.anti-malware: `$.InternalSenderAdminAddress`); they are left out of the judgement.
 */
export function placeholderInRead(rawOutput: string | undefined | null, ignore: readonly string[] = []): string | undefined {
  if (rawOutput === undefined || rawOutput === null) return undefined;
  const text = String(rawOutput).replace(MARKER, '').trim();
  if (text === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const token = text.split(/[\s,;"'<>()[\]{}]+/).find((t) => isMusterPlaceholder(t));
    return token;
  }
  const list = asList(parsed);
  if (list && list.length > 1) {
    const hits = list.map((item) => firstPlaceholderIn(withoutPaths(item, ignore)));
    return hits.every((h) => h !== undefined) ? hits[0] : undefined;
  }
  return firstPlaceholderIn(withoutPaths(list && list.length === 1 ? list[0] : parsed, ignore));
}

/** "built from an unanswered placeholder (the read shows 'MUSTER-DEFAULT-SSID')". */
export function placeholderRationale(value: string): string {
  return `${PLACEHOLDER_REASON} (the read shows '${value}')`;
}
