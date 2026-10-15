// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// FC-EO-G (2026-09-28): the on-box operator command.
//
//   npm run operator:enroll -- --name "<display name>" --upn <own sign-in address>
//       Prints a one-time enrollment link + code (valid 10 minutes). Open the link on the EO
//       machine's browser and register a passkey. Used for the FIRST operator (and for recovery if
//       every passkey is lost); later operators get their code from an enrolled operator on the page.
//   npm run operator:passkeys -- list
//   npm run operator:passkeys -- revoke <credentialId>
//
// The command writes straight to EO's CES store (CES_PIPELINE_ROOT/ces.db), so it only works for
// someone with a shell on the EO machine; it opens no network port. It must see the same
// CES_PIPELINE_ROOT and CES_EO_OPERATOR_PASSKEY_ORIGIN as the running EO server.

import { operatorAuthFromEnv, ApproverTokenRefusal } from './ApproverTokenIssuer.js';
import { PasskeyOperatorService, PasskeyRefusal } from './PasskeyOperatorService.js';

type Env = Record<string, string | undefined>;

export interface OperatorCliDeps {
  env?: Env;
  service?: PasskeyOperatorService;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}

const USAGE = [
  'usage:',
  '  operator:enroll   -- --name "<display name>" --upn <own sign-in address>',
  '  operator:passkeys -- list',
  '  operator:passkeys -- revoke <credentialId>',
].join('\n');

/** Run the operator command. Returns the process exit code. */
export function runOperatorCli(argv: string[], deps: OperatorCliDeps = {}): number {
  const env = deps.env ?? process.env;
  const out = deps.out ?? ((l: string) => console.log(l));
  const err = deps.err ?? ((l: string) => console.error(l));
  const [command, ...rest] = argv;
  try {
    const auth = operatorAuthFromEnv(env);
    if (auth.mode !== 'passkey') {
      err('passkey operator sign-in is not the configured mode (set CES_EO_OPERATOR_PASSKEY_ORIGIN, e.g. http://localhost:5004)');
      return 2;
    }
    const service = deps.service ?? new PasskeyOperatorService();
    const by = { kind: 'local-command' as const };
    if (command === 'enroll') {
      const r = service.issueEnrollmentCode(auth.config, { displayName: flag(rest, 'name'), upn: flag(rest, 'upn'), issuedBy: by });
      out(`One-time operator enrollment for ${flag(rest, 'name')!.trim()} (expires ${r.expiresAt}, single use):`);
      out(`  open on this machine: ${r.link}`);
      out(`  or enter the code:    ${r.code}`);
      return 0;
    }
    if (command === 'list') {
      const list = service.listPasskeys();
      if (!list.length) out('No operator passkeys registered.');
      for (const p of list) {
        out(`${p.credentialId}  ${p.displayName} <${p.upn}>  created ${p.createdAt}` +
          `${p.lastUsedAt ? `  last used ${p.lastUsedAt}` : ''}${p.revokedAt ? `  REVOKED ${p.revokedAt}` : ''}`);
      }
      return 0;
    }
    if (command === 'revoke') {
      const r = service.revoke(rest[0], by);
      out(`Revoked passkey ${r.credentialId} (${r.displayName}) at ${r.revokedAt}.`);
      return 0;
    }
    err(USAGE);
    return 64;
  } catch (e) {
    if (e instanceof PasskeyRefusal || e instanceof ApproverTokenRefusal) {
      err(`${e.code}: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
