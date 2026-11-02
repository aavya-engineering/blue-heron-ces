// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// SP-1 (R12, SECRETS-PLAN.md): AO's evidence writer builds commandExecuted with every secret-class
// variable (ces-shared SECRET_VARIABLE_NAMES) as Stamper's sentinel, never its value.
import { describe, it, expect } from 'vitest';
import { buildEvidenceArtifact, resolvePlaceholders, secretSentinel } from '../src/execution/EvidenceEmitter.js';
import { makeAoCommand } from './fixtures.js';

const LITERAL = 'Literal-Pw-123!';

describe('AO evidence: secret-class variables become the sentinel (SP-1, R12)', () => {
  it('uses the same sentinel format as Stamper', () => {
    expect(secretSentinel('initialPassword')).toBe('<<CES_SECRET:initialPassword>>');
  });

  it('resolvePlaceholders writes the sentinel for initialPassword and the value for others', () => {
    const out = resolvePlaceholders("New-MgUser -UPN '{upn}' -Password '{initialPassword}'", { upn: 'a@b.us', initialPassword: LITERAL });
    expect(out).toBe("New-MgUser -UPN 'a@b.us' -Password '<<CES_SECRET:initialPassword>>'");
    expect(out).not.toContain(LITERAL);
  });

  it('an absent secret-class variable stays an unfilled placeholder, as before', () => {
    expect(resolvePlaceholders("X '{initialPassword}'", {})).toBe("X '{initialPassword}'");
  });

  it('buildEvidenceArtifact never carries the literal in commandExecuted or anywhere in the record', () => {
    const evidence = buildEvidenceArtifact(
      makeAoCommand(),
      { stdout: 'ok', stderr: '', exit_code: 0 } as any,
      { entry_id: 'X-01', label: 'x', set_command: "New-MgUser -Password '{initialPassword}'", get_command: '' } as any,
      { initialPassword: LITERAL },
      { dryRun: false },
    );
    expect(evidence.metadata.commandExecuted).toContain('<<CES_SECRET:initialPassword>>');
    expect(JSON.stringify(evidence)).not.toContain(LITERAL);
  });
});
