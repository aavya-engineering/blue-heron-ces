// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-TENANT-2026A
// See LICENSE and TERMS.md.

/**
 * Caller-identity vocabulary.
 *
 * RATIFIED AMENDMENT (founder, 2026-07-10) — G-TENANT-1 addendum, motivated
 * by G-TENANT-M6 (the stateful tenant service, `docs/goals/G-TENANT-M6.md`
 * design requirement 4): every connection/session/token request carries a
 * `ConsumerIdentity` so the M6 service can attribute activity by module.
 * Added HERE, before any M1-M5 consumer wires up — cheap at interface time,
 * painful later. This is an interface amendment, not a silent edit; it is
 * logged in `docs/M1-RECORD.md` and in the G-TENANT-1 goal file's
 * 2026-07-10 addendum.
 */

/**
 * Identity of the CES module making a connection/session/token request.
 *
 * INVARIANT (doc-comment required by the addendum): requests without a
 * consumer are REJECTED in service mode (M6 daemon) and LOGGED in library
 * mode (this package's in-process implementations warn through their
 * injected logger and record the activity entry with `consumer: null`).
 * Consumers should therefore always wire their identity — either once, at
 * surface construction (the `consumer` option every `impl/` surface
 * accepts), or per request via the optional trailing parameter the amended
 * request methods carry.
 */
export interface ConsumerIdentity {
  /** The requesting CES module, e.g. `'ces-stamper'`, `'ces-eo'`, `'muster-api'`, `'ces-tester'`. */
  module: string;

  /** Short human-readable statement of why this request is being made, e.g. `'translate run'`, `'discovery scan'`. */
  purpose: string;
}
